import { headers } from "next/headers";
import { ATTACHMENT_CSP } from "@/lib/attachments/headers";
import { servedInline } from "@/lib/attachments/sniff";
import { blobExists, readBlob } from "@/lib/attachments/storage";
import { HttpError, rateLimit } from "@/lib/session";
import { SHARE_LIMITS, clientIp, resolveShare, sharedAttachments } from "@/lib/shares";

/**
 * GET /s/<token>/a/<sha256>: one attachment of a shared note, for anyone holding the link.
 *
 * Serves only a file the shared note itself refers to (resolved as the share page resolves it), so
 * a token never opens the rest of the vault; a dead token, an unknown hash or a file the note does
 * not name all get the same 404. Same response rules as /api/attachments/file: the stored (sniffed)
 * Content-Type, nosniff, the sandbox CSP, `attachment` for SVG and other non-inline types. Never
 * cached by shared caches (the link can be revoked), never indexed, never sends a Referer on.
 */

const SHA256 = /^[0-9a-f]{64}$/;

/** `Content-Disposition` with an ASCII fallback name and the real name as RFC 5987 UTF-8. */
function disposition(kind: "inline" | "attachment", path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const fallback = name.replace(/[^\x20-\x7e]|["\\%;]/g, "_");
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

const base = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": ATTACHMENT_CSP,
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "Cross-Origin-Resource-Policy": "same-origin",
};

const notFound = () =>
  new Response("Not found", { status: 404, headers: { ...base, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export async function GET(req: Request, { params }: RouteContext<"/s/[token]/a/[hash]">) {
  try {
    rateLimit(`share-file:${clientIp(await headers())}`, SHARE_LIMITS.filesPerMinute, 60_000);
  } catch (e) {
    if (e instanceof HttpError && e.status === 429)
      return new Response("Too many requests", {
        status: 429,
        headers: { ...base, "Content-Type": "text/plain; charset=utf-8", "Retry-After": "60", "Cache-Control": "no-store" },
      });
    throw e;
  }
  const { token, hash } = await params;
  if (!SHA256.test(hash)) return notFound();
  const shared = await resolveShare(token);
  if (!shared) return notFound();
  const file = (await sharedAttachments(token, shared)).files.get(hash);
  if (!file || !(await blobExists(shared.vaultId, file.sha256))) return notFound();

  const etag = `"${file.sha256}"`;
  const h = new Headers({
    ...base,
    "Content-Type": file.mime,
    "Content-Disposition": disposition(servedInline(file.mime) ? "inline" : "attachment", file.path),
    // Revalidated on every use, so a revoked or expired link stops serving at once.
    "Cache-Control": "private, no-cache",
    ETag: etag,
  });
  const inm = req.headers.get("if-none-match");
  if (inm && inm.split(",").some((t) => t.trim().replace(/^W\//, "") === etag)) return new Response(null, { status: 304, headers: h });
  h.set("Content-Length", String(file.size));
  return new Response(readBlob(shared.vaultId, file.sha256), { status: 200, headers: h });
}
