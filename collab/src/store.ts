/**
 * Database reads and writes of the collaboration service. Note content goes through
 * updateContent in src/lib/notes.ts (the PATCH path), so revisions, link and tag indexes and
 * quotas behave exactly as for a REST save; only the Yjs state table is written here.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { note, noteYdoc } from "@/db/schema";

export type NoteRow = { content: string; updatedAt: Date };

export async function readNote(noteId: string): Promise<NoteRow | null> {
  const [row] = await db
    .select({ content: note.content, updatedAt: note.updatedAt })
    .from(note)
    .where(eq(note.id, noteId))
    .limit(1);
  return row ?? null;
}

export async function readState(noteId: string): Promise<Uint8Array | null> {
  const [row] = await db.select({ state: noteYdoc.state }).from(noteYdoc).where(eq(noteYdoc.noteId, noteId)).limit(1);
  return row ? new Uint8Array(row.state) : null;
}

/** Upserts the encoded document. A note deleted meanwhile is skipped (foreign key violation). */
export async function writeState(noteId: string, state: Uint8Array): Promise<void> {
  const bytes = Buffer.from(state.buffer, state.byteOffset, state.byteLength);
  try {
    await db
      .insert(noteYdoc)
      .values({ noteId, state: bytes })
      .onConflictDoUpdate({ target: noteYdoc.noteId, set: { state: bytes, updatedAt: sql`now()` } });
  } catch (err) {
    const code = (err as { code?: unknown; cause?: { code?: unknown } }).cause?.code ?? (err as { code?: unknown }).code;
    if (code !== "23503") throw err;
  }
}
