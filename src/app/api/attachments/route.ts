import { ATTACHMENT_LIMITS, deleteAttachment, listAttachments, uploadAttachment } from "@/lib/attachments";
import { NotePath } from "@/lib/notes";
import { HttpError, MiB, handle, rateLimit, readForm, requireVault } from "@/lib/session";

/** One file plus the multipart framing and the folder field. */
const BODY_LIMIT = ATTACHMENT_LIMITS.fileBytes + 1 * MiB;

/**
 * GET: the vault's attachments, by path, a page at a time.
 *   ?after=<path of the last item seen>&limit=<1..500>
 * Returns { items: [{ id, path, mime, size, sha256, createdAt }], next: string | null }. The
 * reading view builds its attachment lookup from it (src/lib/markdown/attachments.ts).
 */
export async function GET(req: Request) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const q = new URL(req.url).searchParams;
    const after = q.get("after");
    if (after !== null) NotePath.parse(after);
    const limit = Number(q.get("limit") ?? ATTACHMENT_LIMITS.pageSize);
    if (!Number.isInteger(limit) || limit < 1) throw new HttpError(400, "Invalid limit");
    return listAttachments(vaultId, after, limit);
  });
}

/**
 * POST multipart/form-data: field "file" (exactly one file) and optional "folder" (vault-relative
 * folder path). The type is sniffed from the bytes (png, jpeg, gif, webp, avif, svg, pdf, mp3, m4a,
 * ogg, wav, mp4, webm) and must match the extension, else 415. At most 25 MiB per file and 1 GiB
 * per vault (413). A taken path gets " 1", " 2"… before the extension; the same bytes uploaded to
 * the same path again return the existing attachment. 120 uploads per user per minute.
 * Returns 201 { id, path, mime, size }; the editor then inserts ![[<path>]].
 */
export async function POST(req: Request) {
  return handle(async () => {
    const { user, vaultId } = await requireVault();
    rateLimit(`attach:${user.id}`, 120, 60_000);
    const form = await readForm(req, BODY_LIMIT);
    const files = form.getAll("file");
    if (files.length !== 1 || !(files[0] instanceof File)) throw new HttpError(400, "Upload exactly one file");
    const file = files[0];
    const folder = form.get("folder");
    if (folder !== null && typeof folder !== "string") throw new HttpError(400, "Invalid folder");
    NotePath.parse(file.name);
    if (folder) NotePath.parse(folder);
    if (file.size > ATTACHMENT_LIMITS.fileBytes)
      throw new HttpError(413, `A file can be at most ${ATTACHMENT_LIMITS.fileBytes / MiB} MiB`);
    const info = await uploadAttachment(vaultId, {
      name: file.name,
      folder: folder ?? "",
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return Response.json(info, { status: 201 });
  });
}

/** DELETE ?path=<vault-relative path with extension>. 404 when there is no such attachment. */
export async function DELETE(req: Request) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const path = new URL(req.url).searchParams.get("path");
    if (!path) throw new HttpError(400, "Missing path");
    NotePath.parse(path);
    await deleteAttachment(vaultId, path);
    return { ok: true };
  });
}
