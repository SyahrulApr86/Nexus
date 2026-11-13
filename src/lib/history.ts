import "server-only";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { note, noteRevision, type RevisionReason } from "@/db/schema";
import { splitFrontmatter } from "@/lib/markdown/parse";
import { HttpError } from "@/lib/session";

/*
 * File recovery, after Obsidian's core plugin: before a note's content is
 * overwritten, its current content may be kept as a revision.
 *
 * - At most one revision per 5 minutes per note, so autosave does not flood
 *   the history. A restore always keeps one, so the restore can be undone.
 * - Nothing is kept when the content does not change or when it equals the
 *   newest revision.
 * - Each note keeps its 50 newest revisions, none older than 30 days. Pruning
 *   runs in the same transaction as the insert; reads also skip expired rows,
 *   so a note that is never written again does not show stale history.
 */

const SNAPSHOT_INTERVAL = sql`interval '5 minutes'`;
const RETENTION = sql`interval '30 days'`;
const MAX_REVISIONS = 50;
const PREVIEW_CHARS = 160;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Revisions inside the retention window; older rows count as already deleted. */
const live = () => sql`${noteRevision.createdAt} >= now() - ${RETENTION}`;
const newestFirst = () => [desc(noteRevision.createdAt), desc(noteRevision.id)];

/**
 * Call inside the transaction that is about to replace the content of
 * `noteId` with `next`. Locks the note row (the same lock the UPDATE takes),
 * so concurrent saves of one note take turns instead of both writing a revision.
 */
export async function snapshotBeforeWrite(
  tx: Tx,
  vaultId: string,
  noteId: string,
  next: string,
  reason: RevisionReason,
) {
  const [current] = await tx
    .select({ content: note.content })
    .from(note)
    .where(and(eq(note.vaultId, vaultId), eq(note.id, noteId)))
    .for("no key update");
  if (!current || current.content === next) return;

  const [newest] = await tx
    .select({
      recent: sql<boolean>`${noteRevision.createdAt} > now() - ${SNAPSHOT_INTERVAL}`,
      same: sql<boolean>`${noteRevision.content} = ${note.content}`,
    })
    .from(noteRevision)
    .innerJoin(note, eq(note.id, noteRevision.noteId))
    .where(and(eq(noteRevision.noteId, noteId), live()))
    .orderBy(...newestFirst())
    .limit(1);
  if (newest?.same) return;
  if (newest?.recent && reason !== "restore") return;

  await tx.insert(noteRevision).values({ noteId, vaultId, content: current.content, reason });

  const overflow = tx
    .select({ id: noteRevision.id })
    .from(noteRevision)
    .where(eq(noteRevision.noteId, noteId))
    .orderBy(...newestFirst())
    .offset(MAX_REVISIONS);
  await tx
    .delete(noteRevision)
    .where(
      and(
        eq(noteRevision.noteId, noteId),
        or(sql`${noteRevision.createdAt} < now() - ${RETENTION}`, inArray(noteRevision.id, overflow)),
      ),
    );
}

async function assertNote(vaultId: string, noteId: string) {
  const [n] = await db
    .select({ id: note.id })
    .from(note)
    .where(and(eq(note.vaultId, vaultId), eq(note.id, noteId)))
    .limit(1);
  if (!n) throw new HttpError(404, "Note not found");
}

/** First words of a revision for the history list, frontmatter and line breaks removed. */
function previewOf(head: string) {
  const text = splitFrontmatter(head).body.replace(/\s+/g, " ").trim();
  const chars = Array.from(text);
  return chars.length > PREVIEW_CHARS ? `${chars.slice(0, PREVIEW_CHARS - 1).join("")}…` : text;
}

/** Newest first. `size` is in bytes (UTF-8). Full content comes from getRevision. */
export async function listRevisions(vaultId: string, noteId: string) {
  await assertNote(vaultId, noteId);
  const rows = await db
    .select({
      id: noteRevision.id,
      createdAt: noteRevision.createdAt,
      reason: noteRevision.reason,
      size: sql<number>`octet_length(${noteRevision.content})`,
      head: sql<string>`left(${noteRevision.content}, 2000)`,
    })
    .from(noteRevision)
    .where(and(eq(noteRevision.vaultId, vaultId), eq(noteRevision.noteId, noteId), live()))
    .orderBy(...newestFirst())
    .limit(MAX_REVISIONS);
  return rows.map(({ head, size, ...r }) => ({ ...r, size: Number(size), preview: previewOf(head) }));
}

export async function getRevision(vaultId: string, noteId: string, revisionId: string) {
  const [r] = await db
    .select({
      id: noteRevision.id,
      createdAt: noteRevision.createdAt,
      reason: noteRevision.reason,
      content: noteRevision.content,
    })
    .from(noteRevision)
    .where(
      and(
        eq(noteRevision.vaultId, vaultId),
        eq(noteRevision.noteId, noteId),
        eq(noteRevision.id, revisionId),
        live(),
      ),
    )
    .limit(1);
  if (!r) throw new HttpError(404, "Revision not found");
  return r;
}
