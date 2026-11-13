import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookmark, note, vault } from "@/db/schema";
import { HttpError } from "@/lib/session";

/* Bookmarks, after Obsidian's core plugin: an ordered list of notes per vault. */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;

/** The vault's bookmarks in display order: { noteId, path, name, position }[]. */
export async function listBookmarks(vaultId: string, exec: Exec = db) {
  return exec
    .select({ noteId: bookmark.noteId, path: note.path, name: note.name, position: bookmark.position })
    .from(bookmark)
    .innerJoin(note, and(eq(note.id, bookmark.noteId), eq(note.vaultId, bookmark.vaultId)))
    .where(eq(bookmark.vaultId, vaultId))
    .orderBy(asc(bookmark.position), asc(bookmark.createdAt), asc(bookmark.noteId));
}

/**
 * Bookmark writes of one vault take turns, so two appends never get the same
 * position. NO KEY UPDATE leaves the foreign-key checks of note writes alone.
 */
async function lockVault(tx: Tx, vaultId: string) {
  await tx.select({ id: vault.id }).from(vault).where(eq(vault.id, vaultId)).for("no key update");
}

/** Appends the note to the end of the list. Bookmarking it again changes nothing. */
export async function addBookmark(vaultId: string, noteId: string) {
  return db.transaction(async (tx) => {
    const [n] = await tx
      .select({ path: note.path, name: note.name })
      .from(note)
      .where(and(eq(note.vaultId, vaultId), eq(note.id, noteId)))
      .limit(1);
    if (!n) throw new HttpError(404, "Note not found");
    await lockVault(tx, vaultId);

    const [existing] = await tx
      .select({ position: bookmark.position })
      .from(bookmark)
      .where(and(eq(bookmark.vaultId, vaultId), eq(bookmark.noteId, noteId)));
    if (existing) return { noteId, ...n, position: existing.position };

    const [{ position }] = await tx
      .select({ position: sql<number>`coalesce(max(${bookmark.position}) + 1, 0)` })
      .from(bookmark)
      .where(eq(bookmark.vaultId, vaultId));
    await tx.insert(bookmark).values({ vaultId, noteId, position });
    return { noteId, ...n, position };
  });
}

export async function removeBookmark(vaultId: string, noteId: string) {
  const removed = await db
    .delete(bookmark)
    .where(and(eq(bookmark.vaultId, vaultId), eq(bookmark.noteId, noteId)))
    .returning({ noteId: bookmark.noteId });
  if (!removed.length) throw new HttpError(404, "Bookmark not found");
}

/**
 * Renumbers the list from `order` (0, 1, 2, ...). Ids that are not bookmarked
 * in this vault are ignored; bookmarks missing from `order` follow the listed
 * ones in their previous order. Returns the new list.
 */
export async function reorderBookmarks(vaultId: string, order: string[]) {
  return db.transaction(async (tx) => {
    await lockVault(tx, vaultId);
    const current = await listBookmarks(vaultId, tx);
    const bookmarked = new Set(current.map((b) => b.noteId));
    const listed = new Set(order.filter((id) => bookmarked.has(id)));
    const next = [...listed, ...current.map((b) => b.noteId).filter((id) => !listed.has(id))];
    const before = new Map(current.map((b) => [b.noteId, b.position]));
    for (const [position, noteId] of next.entries()) {
      if (before.get(noteId) === position) continue;
      await tx
        .update(bookmark)
        .set({ position })
        .where(and(eq(bookmark.vaultId, vaultId), eq(bookmark.noteId, noteId)));
    }
    return listBookmarks(vaultId, tx);
  });
}
