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
 *   the history. Restore and import replace the whole content from outside
 *   the editor, so they always keep one: otherwise edits made since the last
 *   revision would be lost.
 * - Nothing is kept when the content does not change or when it equals the
 *   newest revision.
 * - Each note keeps its 50 newest revisions. Rows older than 30 days are
 *   hidden from reads at once and deleted when that note next saves a
 *   revision (same transaction as the insert). There is no periodic purge
 *   yet, so expired rows of a note that is never written again stay in the
 *   table until then.
 */

const SNAPSHOT_INTERVAL = sql`interval '5 minutes'`;
const RETENTION = sql`interval '30 days'`;
const MAX_REVISIONS = 50;
const PREVIEW_CHARS = 160;
/** Reasons that bypass the 5-minute throttle (identical content is still skipped). */
const ALWAYS_KEEP: ReadonlySet<RevisionReason> = new Set(["restore", "import"]);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Revisions inside the retention window; older rows count as already deleted. */
const live = () => sql`${noteRevision.createdAt} >= now() - ${RETENTION}`;
const newestFirst = () => [desc(noteRevision.createdAt), desc(noteRevision.id)];

/**
 * Call inside the transaction that is about to replace the content of
 * `noteId` with `next`. Locks the note row (the same lock the UPDATE takes),
 * so concurrent saves of one note take turns instead of both writing a revision.
 * Returns the UTF-8 size of the content being replaced (null when the note does
 * not exist), so the caller can skip the vault quota check when a note shrinks.
 */
export async function snapshotBeforeWrite(
  tx: Tx,
  vaultId: string,
  noteId: string,
  next: string,
  reason: RevisionReason,
): Promise<number | null> {
  const [current] = await tx
    .select({ content: note.content })
    .from(note)
    .where(and(eq(note.vaultId, vaultId), eq(note.id, noteId)))
    .for("no key update");
  if (!current) return null;
  const previousBytes = Buffer.byteLength(current.content, "utf8");
  if (current.content === next) return previousBytes;
  await keepRevision(tx, vaultId, noteId, current.content, reason);
  return previousBytes;
}

/** The revision policy of snapshotBeforeWrite, once the content is known to change. */
async function keepRevision(tx: Tx, vaultId: string, noteId: string, current: string, reason: RevisionReason) {
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
  if (newest?.recent && !ALWAYS_KEEP.has(reason)) return;

  await tx.insert(noteRevision).values({ noteId, vaultId, content: current, reason });

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

/**
 * snapshotBeforeWrite for many notes at once, for import (reason "import", which skips the
 * throttle). `next` maps note id to the content about to be written. Set-based: the comparison
 * and the copy run in Postgres, so no current note body is loaded into the app.
 */
export async function snapshotBeforeImport(tx: Tx, vaultId: string, next: Map<string, string>) {
  if (!next.size) return;
  const ids = [...next.keys()];
  await tx
    .select({ id: note.id })
    .from(note)
    .where(and(eq(note.vaultId, vaultId), inArray(note.id, ids)))
    .for("no key update");
  const incoming = sql.join(
    [...next].map(([id, content]) => sql`(${id}::uuid, ${content}::text)`),
    sql`, `,
  );
  await tx.execute(sql`
    insert into ${noteRevision} (note_id, vault_id, content, reason)
    select n.id, n.vault_id, n.content, 'import'
    from ${note} n
    join (values ${incoming}) as v(id, content) on v.id = n.id
    where n.vault_id = ${vaultId}
      and n.content <> v.content
      and not exists (
        select 1 from (
          select r.content from ${noteRevision} r
          where r.note_id = n.id and r.created_at >= now() - ${RETENTION}
          order by r.created_at desc, r.id desc
          limit 1
        ) newest
        where newest.content = n.content
      )`);
  await tx.execute(sql`
    delete from ${noteRevision}
    where note_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
      and (
        created_at < now() - ${RETENTION}
        or id in (
          select id from (
            select id, row_number() over (partition by note_id order by created_at desc, id desc) as rn
            from ${noteRevision}
            where note_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
          ) ranked
          where rn > ${MAX_REVISIONS}
        )
      )`);
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

/** The note's content and version stamp, for restoring single changes against what is there now. */
export async function currentOf(vaultId: string, noteId: string) {
  const [n] = await db
    .select({ id: note.id, content: note.content, updatedAt: note.updatedAt })
    .from(note)
    .where(and(eq(note.vaultId, vaultId), eq(note.id, noteId)))
    .limit(1);
  if (!n) throw new HttpError(404, "Note not found");
  return n;
}
