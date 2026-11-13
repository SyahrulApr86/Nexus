import { getAttachment } from "@/lib/attachments";
import { ATTACHMENT_CSP } from "@/lib/attachments/headers";
import { servedInline } from "@/lib/attachments/sniff";
import { blobExists, readBlob } from "@/lib/attachments/storage";
import { NotePath } from "@/lib/notes";
import { HttpError, handle, requireVault } from "@/lib/session";

/** Characters of the sha256 the reading view puts in `v` (src/lib/markdown/attachments.ts). */
const VERSION_CHARS = 16;

/**
 * `Content-Disposition` value: an ASCII fallback name (anything else becomes "_") and the real
 * name as RFC 5987 UTF-8, so neither quotes nor line breaks in a file name reach the header.
 */
function disposition(kind: "inline" | "attachment", path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const fallback = name.replace(/[^\x20-\x7e]|["\\%;]/g, "_");
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** One `bytes=` range within `size`, null for none or several (served whole), "invalid" for 416. */
function parseRange(header: string | null, size: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return header.trim().startsWith("bytes=") && header.includes(",") ? null : "invalid";
  const [, a, b] = m;
  if (!a && !b) return "invalid";
  let start: number;
  let end: number;
  if (!a) {
    // Suffix range: the last `b` bytes.
    const n = Number(b);
    if (n === 0) return "invalid";
    start = Math.max(size - n, 0);
    end = size - 1;
  } else {
    start = Number(a);
    end = b ? Math.min(Number(b), size - 1) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return "invalid";
  return { start, end };
}

/**
 * GET ?path=<vault-relative path>&v=<first 16 hex of the sha256>: the attachment's bytes.
 *
 * Served with the stored (sniffed) Content-Type, `X-Content-Type-Options: nosniff`,
 * `Content-Security-Policy: sandbox` (a document opened at this URL gets an opaque origin and
 * no script), and `Content-Disposition: inline` for images, PDF, audio and video, `attachment`
 * for SVG. ETag is the sha256. With a matching `v` the URL names one exact content, so it is
 * cached as immutable; without it the browser revalidates (304 on a matching If-None-Match).
 * Single `Range: bytes=` requests get 206 (audio and video seeking).
 */
export async function GET(req: Request) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const q = new URL(req.url).searchParams;
    const path = q.get("path");
    if (!path) throw new HttpError(400, "Missing path");
    NotePath.parse(path);
    const file = await getAttachment(vaultId, path);
    if (!file || !(await blobExists(vaultId, file.sha256))) throw new HttpError(404, "Attachment not found");

    const etag = `"${file.sha256}"`;
    const pinned = q.get("v") === file.sha256.slice(0, VERSION_CHARS);
    const headers = new Headers({
      "Content-Type": file.mime,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": ATTACHMENT_CSP,
      "Content-Disposition": disposition(servedInline(file.mime) ? "inline" : "attachment", file.path),
      "Cache-Control": pinned ? "private, max-age=31536000, immutable" : "private, no-cache",
      ETag: etag,
      "Accept-Ranges": "bytes",
      "Cross-Origin-Resource-Policy": "same-origin",
    });

    const inm = req.headers.get("if-none-match");
    if (inm && inm.split(",").some((t) => t.trim().replace(/^W\//, "") === etag))
      return new Response(null, { status: 304, headers });

    const ifRange = req.headers.get("if-range");
    const range = ifRange && ifRange !== etag ? null : parseRange(req.headers.get("range"), file.size);
    if (range === "invalid") {
      headers.set("Content-Range", `bytes */${file.size}`);
      return new Response(null, { status: 416, headers });
    }
    if (range) {
      headers.set("Content-Range", `bytes ${range.start}-${range.end}/${file.size}`);
      headers.set("Content-Length", String(range.end - range.start + 1));
      return new Response(readBlob(vaultId, file.sha256, range), { status: 206, headers });
    }
    headers.set("Content-Length", String(file.size));
    return new Response(readBlob(vaultId, file.sha256), { status: 200, headers });
  });
}
