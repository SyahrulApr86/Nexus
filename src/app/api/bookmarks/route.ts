import { z } from "zod";
import { addBookmark, listBookmarks, removeBookmark, reorderBookmarks } from "@/lib/bookmarks";
import { KiB, handle, readJson, requireVault } from "@/lib/session";

/** GET: bookmarked notes in order: { noteId, path, name, position }[]. */
export async function GET() {
  return handle(async () => {
    const { vaultId } = await requireVault();
    return listBookmarks(vaultId);
  });
}

/** POST { noteId }: append a bookmark. Idempotent: an existing bookmark is returned as is. */
export async function POST(req: Request) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const { noteId } = z.object({ noteId: z.uuid() }).parse(await readJson(req, 16 * KiB));
    return addBookmark(vaultId, noteId);
  });
}

/** DELETE ?noteId=: remove that note's bookmark. */
export async function DELETE(req: Request) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const noteId = z.uuid().parse(new URL(req.url).searchParams.get("noteId"));
    await removeBookmark(vaultId, noteId);
    return { ok: true };
  });
}

/** PATCH { order: noteId[] }: renumber the list in that order; returns the new list. */
export async function PATCH(req: Request) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const { order } = z.object({ order: z.array(z.uuid()).max(10_000) }).parse(await readJson(req, 512 * KiB));
    return reorderBookmarks(vaultId, order);
  });
}
