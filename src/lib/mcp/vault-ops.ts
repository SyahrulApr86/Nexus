import "server-only";
import { and, asc, desc, eq, gt, inArray, like, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { folder, link, note, tag } from "@/db/schema";
import { getNote, listTags, notesByTag, resolveLink } from "@/lib/notes";
import { basename, linkKey, normalizePath } from "@/lib/markdown/parse";
import { HttpError } from "@/lib/session";
import { MCP_LIMITS } from "./format";

/*
 * Read-side queries the MCP tools need beyond the existing domain functions in src/lib/notes.ts.
 * Every query is scoped by the vault id of the authenticated token (access control): no function
 * here takes a note id or path without its vault.
 */

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export type NoteKey = { path?: string; id?: string };

/** The note named by `key` in the vault: exact path first, then a [[wikilink]]-style match by name. 404 otherwise. */
export async function findNote(vaultId: string, key: NoteKey): Promise<{ id: string; path: string; name: string }> {
  if (key.id) {
    const [n] = await db
      .select({ id: note.id, path: note.path, name: note.name })
      .from(note)
      .where(and(eq(note.vaultId, vaultId), eq(note.id, key.id)))
      .limit(1);
    if (n) return n;
    throw new HttpError(404, "Note not found");
  }
  const raw = key.path ?? "";
  const path = normalizePath(raw);
  if (path) {
    const [n] = await db
      .select({ id: note.id, path: note.path, name: note.name })
      .from(note)
      .where(and(eq(note.vaultId, vaultId), eq(note.path, path)))
      .limit(1);
    if (n) return n;
    const r = await resolveLink(vaultId, path);
    if (r) return r;
  }
  throw new HttpError(404, `No note at "${path || raw}". Use list_notes or search_notes to find the right path.`);
}

/** The whole note row the read tools return, with its indexed tags. */
export async function readNoteRow(vaultId: string, id: string) {
  const [n] = await db
    .select({
      id: note.id,
      path: note.path,
      name: note.name,
      content: note.content,
      frontmatter: note.frontmatter,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    })
    .from(note)
    .where(and(eq(note.vaultId, vaultId), eq(note.id, id)))
    .limit(1);
  if (!n) throw new HttpError(404, "Note not found");
  const tags = await db
    .select({ tag: tag.tag })
    .from(tag)
    .where(and(eq(tag.vaultId, vaultId), eq(tag.noteId, id)))
    .orderBy(asc(tag.tag));
  return { ...n, tags: tags.map((t) => t.tag) };
}

/** One page of notes by path, optionally inside `folder`, after path `cursor`. */
export async function listNotesPage(vaultId: string, opts: { folder?: string; cursor?: string; limit?: number }) {
  const limit = opts.limit ?? MCP_LIMITS.listPage;
  const prefix = opts.folder ? normalizePath(opts.folder) : "";
  const rows = await db
    .select({ id: note.id, path: note.path, name: note.name, updatedAt: note.updatedAt })
    .from(note)
    .where(
      and(
        eq(note.vaultId, vaultId),
        prefix ? like(note.path, `${escapeLike(prefix)}/%`) : undefined,
        opts.cursor ? gt(note.path, opts.cursor) : undefined,
      ),
    )
    .orderBy(asc(note.path))
    .limit(limit + 1);
  const more = rows.length > limit;
  const notes = rows.slice(0, limit);
  return { notes, nextCursor: more ? notes[notes.length - 1].path : null };
}

/** Every folder of the vault by path (empty folders included), capped. */
export async function listFolderPaths(vaultId: string) {
  const rows = await db
    .select({ path: folder.path })
    .from(folder)
    .where(eq(folder.vaultId, vaultId))
    .orderBy(asc(folder.path))
    .limit(MCP_LIMITS.maxFolders + 1);
  return { folders: rows.slice(0, MCP_LIMITS.maxFolders).map((r) => r.path), truncated: rows.length > MCP_LIMITS.maxFolders };
}

/** The most recently edited notes. */
export async function recentNotes(vaultId: string, limit: number) {
  return db
    .select({ id: note.id, path: note.path, name: note.name, updatedAt: note.updatedAt })
    .from(note)
    .where(eq(note.vaultId, vaultId))
    .orderBy(desc(note.updatedAt), asc(note.path))
    .limit(limit);
}

/** Tags with counts, or the notes carrying one tag (nested tags included). */
export async function tagsOrNotes(vaultId: string, t?: string) {
  if (t !== undefined) {
    const notes = await notesByTag(vaultId, t.trim());
    return { kind: "notes" as const, tag: t.replace(/^#/, "").toLowerCase(), notes: notes.slice(0, MCP_LIMITS.maxNotesPerTag), truncated: notes.length > MCP_LIMITS.maxNotesPerTag };
  }
  const tags = await listTags(vaultId);
  return { kind: "tags" as const, tags: tags.slice(0, MCP_LIMITS.maxTags), truncated: tags.length > MCP_LIMITS.maxTags };
}

/**
 * Links into and out of a note. Backlinks come from the app's own getNote (with the line that links);
 * outgoing links are the note's indexed [[links]], each resolved as the app resolves them (path match
 * first, then the shortest path with that name), or `null` for a link to a note that does not exist.
 */
export async function linksOf(vaultId: string, id: string) {
  const n = await getNote(vaultId, id);
  const out = await db
    .select({ target: link.target, embed: link.embed })
    .from(link)
    .where(and(eq(link.vaultId, vaultId), eq(link.sourceId, id)))
    .orderBy(asc(link.target))
    .limit(MCP_LIMITS.maxOutgoing);
  const keys = [...new Set(out.map((l) => l.target))];
  const names = [...new Set(keys.map((k) => basename(k)))];
  const candidates = keys.length
    ? await db
        .select({ id: note.id, path: note.path, name: note.name })
        .from(note)
        .where(
          and(
            eq(note.vaultId, vaultId),
            or(inArray(sql`lower(${note.path})`, keys), inArray(sql`lower(${note.name})`, names)),
          ),
        )
    : [];
  const byPath = new Map(candidates.map((c) => [c.path.toLowerCase(), c]));
  const byName = new Map<string, (typeof candidates)[number]>();
  for (const c of [...candidates].sort((a, b) => b.path.length - a.path.length)) byName.set(c.name.toLowerCase(), c);
  const outgoing = out.map((l) => {
    const hit = byPath.get(l.target) ?? byName.get(basename(l.target)) ?? null;
    return { target: l.target, embed: l.embed, note: hit && { id: hit.id, path: hit.path, name: hit.name } };
  });
  return {
    note: { id: n.id, path: n.path, name: n.name },
    backlinks: n.backlinks,
    outgoing,
  };
}

/** Notes for resources/list: the most recently edited, capped. */
export async function resourceNotes(vaultId: string) {
  return db
    .select({ path: note.path, name: note.name, updatedAt: note.updatedAt })
    .from(note)
    .where(eq(note.vaultId, vaultId))
    .orderBy(desc(note.updatedAt))
    .limit(MCP_LIMITS.maxResources);
}

/** A template note's content, found as the app finds one (path, case-insensitive, ".md" optional). */
export async function templateContent(vaultId: string, rawPath: string) {
  const key = linkKey(normalizePath(rawPath));
  if (!key) throw new HttpError(400, "Invalid template path");
  const [t] = await db
    .select({ content: note.content })
    .from(note)
    .where(and(eq(note.vaultId, vaultId), sql`lower(${note.path}) = ${key}`))
    .limit(1);
  if (!t) throw new HttpError(404, `No template at "${rawPath}"`);
  return t.content;
}

/** Whether a note exists at exactly this normalised path. */
export async function pathTaken(vaultId: string, path: string) {
  const [n] = await db
    .select({ id: note.id })
    .from(note)
    .where(and(eq(note.vaultId, vaultId), eq(note.path, path)))
    .limit(1);
  return !!n;
}
