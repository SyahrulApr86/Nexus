import "server-only";
import { and, asc, count, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { folder, link, note, tag, type RevisionReason } from "@/db/schema";
import { z } from "zod";
import { snapshotBeforeImport, snapshotBeforeWrite } from "@/lib/history";
import {
  basename,
  dirname,
  extractTags,
  extractWikiLinks,
  linkKey,
  maskCode,
  isUnsafePath,
  normalizePath,
  parseFrontmatter,
  splitFrontmatter,
} from "@/lib/markdown/parse";
import { HttpError } from "@/lib/session";
// --- canvas track: .canvas notes (JSON Canvas) ---
import { canvasLinks, canvasText, isCanvasPath, rewriteCanvasLinks } from "@/lib/canvas";
// --- end canvas track ---

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;

/* ------------------------------------------------------------------ */
/* Limits (input validation and resource quotas)                       */
/* ------------------------------------------------------------------ */

/** Policy values: generous for a personal vault, small enough that no request can exhaust the server. */
export const LIMITS = {
  /** Characters in a path as typed or imported, before normalisation. */
  rawPath: 500,
  /** Characters in a normalised path. */
  path: 500,
  /** Folder depth of a path (segments). */
  segments: 32,
  /** Characters in one path segment (a common file-system limit). */
  segment: 255,
  /** UTF-8 bytes in one note. */
  noteBytes: 5 * 1024 * 1024,
  /** Notes in one vault. */
  vaultNotes: 20_000,
  /** UTF-8 bytes of all notes in one vault. */
  vaultBytes: 500 * 1024 * 1024,
  /** Distinct links and tags indexed per note; the rest of the note is still saved. */
  linksPerNote: 1_000,
  tagsPerNote: 200,
} as const;

const hasNul = (s: string) => s.includes("\u0000");

/** Raw path from a request body: bounded, no NUL. Normalised and checked again by validatePath. */
export const NotePath = z
  .string()
  .max(LIMITS.rawPath)
  .refine((s) => !hasNul(s), "Path must not contain NUL");

/** Note content from a request body: at most LIMITS.noteBytes of UTF-8, no NUL (Postgres text refuses it). */
export const NoteContent = z
  .string()
  .refine((s) => s.length <= LIMITS.noteBytes && Buffer.byteLength(s, "utf8") <= LIMITS.noteBytes, "Note is too large")
  .refine((s) => !hasNul(s), "Content must not contain NUL");

/** Why a normalised path is refused, or null when it is fine. */
export function pathProblem(path: string): string | null {
  if (!path) return "Invalid path";
  if (path.length > LIMITS.path) return "Path is too long";
  const segs = path.split("/");
  if (segs.length > LIMITS.segments) return "Path is nested too deeply";
  if (segs.some((s) => s.length > LIMITS.segment)) return "A path segment is too long";
  if (isUnsafePath(path)) return "Invalid path";
  return null;
}

/** Throws 400 unless the normalised path is within LIMITS and has no "." or ".." segment. */
function validatePath(path: string) {
  const problem = pathProblem(path);
  if (problem) throw new HttpError(400, problem);
}

/** Throws 413 when the vault is over its note or byte quota. Run inside the write's transaction. */
async function assertVaultQuota(tx: Exec, vaultId: string) {
  const [q] = await tx
    .select({ notes: count(), bytes: sql<string>`coalesce(sum(octet_length(${note.content})), 0)` })
    .from(note)
    .where(eq(note.vaultId, vaultId));
  if (q.notes > LIMITS.vaultNotes) throw new HttpError(413, `A vault holds at most ${LIMITS.vaultNotes} notes`);
  if (Number(q.bytes) > LIMITS.vaultBytes) throw new HttpError(413, "The vault is full");
}

/* ------------------------------------------------------------------ */
/* Indexing                                                            */
/* ------------------------------------------------------------------ */

/** Distinct outgoing links and tags of one note, capped at LIMITS.linksPerNote / tagsPerNote. */
function indexOf(content: string, fm: Record<string, unknown>, path?: string) {
  // --- canvas track: a canvas links through its file cards and text cards, and tags through its text ---
  if (path && isCanvasPath(path)) return canvasIndexOf(content);
  // --- end canvas track ---
  const seen = new Set<string>();
  const links: { target: string; embed: boolean }[] = [];
  for (const l of extractWikiLinks(content)) {
    if (!l.target) continue;
    const target = linkKey(l.target);
    const k = `${target}|${l.embed}`;
    if (seen.has(k)) continue;
    seen.add(k);
    links.push({ target, embed: l.embed });
    if (links.length >= LIMITS.linksPerNote) break;
  }
  const tags = extractTags(content, fm).slice(0, LIMITS.tagsPerNote);
  return { links, tags };
}

// --- canvas track ---
/** indexOf for a .canvas note: file cards that point at notes, [[links]] and #tags in text cards. */
function canvasIndexOf(content: string) {
  const seen = new Set<string>();
  const links: { target: string; embed: boolean }[] = [];
  for (const l of canvasLinks(content)) {
    const target = linkKey(l.target);
    const k = `${target}|${l.embed}`;
    if (!target || seen.has(k)) continue;
    seen.add(k);
    links.push({ target, embed: l.embed });
    if (links.length >= LIMITS.linksPerNote) break;
  }
  const tags = extractTags(canvasText(content), {}).slice(0, LIMITS.tagsPerNote);
  return { links, tags };
}

/** A canvas keeps its extension through a rename; a note cannot be renamed into a canvas. */
function keepKind(oldPath: string, next: string) {
  if (isCanvasPath(oldPath)) return isCanvasPath(next) ? next : `${next}.canvas`;
  if (isCanvasPath(next)) throw new HttpError(400, "A note cannot be renamed to a .canvas file");
  return next;
}
// --- end canvas track ---

async function reindex(tx: Exec, vaultId: string, noteId: string, content: string, fm = frontmatterOf(content), path?: string) {
  await tx.delete(link).where(eq(link.sourceId, noteId));
  await tx.delete(tag).where(eq(tag.noteId, noteId));
  const idx = indexOf(content, fm, path);
  if (idx.links.length) await tx.insert(link).values(idx.links.map((l) => ({ ...l, sourceId: noteId, vaultId })));
  if (idx.tags.length) await tx.insert(tag).values(idx.tags.map((t) => ({ noteId, vaultId, tag: t })));
}

function frontmatterOf(content: string) {
  return parseFrontmatter(splitFrontmatter(content).yaml);
}

/** Every ancestor folder of `notePath`, outermost first ("a", "a/b"). Built one segment at a time. */
function ancestors(notePath: string): string[] {
  const out: string[] = [];
  let acc = "";
  for (const part of dirname(notePath).split("/")) {
    if (!part) continue;
    acc = acc ? `${acc}/${part}` : part;
    out.push(acc);
  }
  return out;
}

async function ensureFolders(tx: Exec, vaultId: string, notePath: string) {
  const paths = ancestors(notePath);
  if (paths.length > LIMITS.segments) throw new HttpError(400, "Path is nested too deeply");
  if (paths.length)
    await tx
      .insert(folder)
      .values(paths.map((path) => ({ vaultId, path })))
      .onConflictDoNothing();
}

/** `path`, or the first free "path N", in one query (the new-note flow creates many "Untitled N"). */
async function uniquePath(tx: Exec, vaultId: string, path: string, excludeId?: string) {
  // --- canvas track: "Board.canvas" is followed by "Board 1.canvas", the extension stays last ---
  if (isCanvasPath(path)) {
    const stem = path.slice(0, -".canvas".length);
    const rows = await tx
      .select({ id: note.id, path: note.path })
      .from(note)
      .where(and(eq(note.vaultId, vaultId), or(eq(note.path, path), like(note.path, `${escapeLike(stem)} %.canvas`))));
    const used = new Set(rows.filter((t) => t.id !== excludeId).map((t) => t.path));
    if (!used.has(path)) return path;
    for (let i = 1; ; i++) if (!used.has(`${stem} ${i}.canvas`)) return `${stem} ${i}.canvas`;
  }
  // --- end canvas track ---
  const taken = await tx
    .select({ id: note.id, path: note.path })
    .from(note)
    .where(and(eq(note.vaultId, vaultId), or(eq(note.path, path), like(note.path, `${escapeLike(path)} %`))));
  const used = new Set(taken.filter((t) => t.id !== excludeId).map((t) => t.path));
  if (!used.has(path)) return path;
  for (let i = 1; ; i++) if (!used.has(`${path} ${i}`)) return `${path} ${i}`;
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export async function listTree(vaultId: string) {
  const [notes, folders] = await Promise.all([
    db
      .select({ id: note.id, path: note.path, name: note.name, updatedAt: note.updatedAt })
      .from(note)
      .where(eq(note.vaultId, vaultId))
      .orderBy(asc(note.path)),
    db.select({ path: folder.path }).from(folder).where(eq(folder.vaultId, vaultId)).orderBy(asc(folder.path)),
  ]);
  return { notes, folders: folders.map((f) => f.path) };
}

/**
 * Optimistic concurrency: locks the note row for the rest of `tx` and, when `base` is given and the
 * stored updatedAt differs from it, throws 409 { error: "conflict", note: { id, content, updatedAt } }.
 * Compared in milliseconds, the precision every updatedAt the API hands out has.
 */
async function assertUnchanged(tx: Exec, vaultId: string, id: string, base: Date | undefined) {
  if (!base) return;
  const [cur] = await tx
    .select({ id: note.id, content: note.content, updatedAt: note.updatedAt })
    .from(note)
    .where(and(eq(note.vaultId, vaultId), eq(note.id, id)))
    .for("update");
  if (!cur) throw new HttpError(404, "Note not found");
  if (cur.updatedAt.getTime() !== base.getTime())
    throw new HttpError(409, "The note changed since it was loaded", { error: "conflict", note: cur });
}

async function getOwned(vaultId: string, id: string) {
  const [n] = await db
    .select()
    .from(note)
    .where(and(eq(note.vaultId, vaultId), eq(note.id, id)))
    .limit(1);
  if (!n) throw new HttpError(404, "Note not found");
  return n;
}

/** Notes whose links point at `n` (by name or by full path). */
async function backlinksOf(vaultId: string, n: { id: string; name: string; path: string }) {
  const keys = [...new Set([linkKey(n.name), linkKey(n.path)])];
  return db
    .selectDistinct({ id: note.id, path: note.path, name: note.name })
    .from(link)
    .innerJoin(note, eq(note.id, link.sourceId))
    .where(and(eq(link.vaultId, vaultId), inArray(link.target, keys), sql`${note.id} <> ${n.id}`))
    .orderBy(asc(note.path))
    .limit(MAX_BACKLINKS);
}

const MAX_BACKLINKS = 500;
/** Characters of a source note loaded around its first link to the target, for the context line. */
const CONTEXT_WINDOW = 2_000;

/** The first line of `content` that links to one of `keys`, trimmed for display. */
function linkContext(content: string, keys: Set<string>): string | null {
  const hit = extractWikiLinks(content).find((l) => keys.has(linkKey(l.target)));
  if (!hit) return null;
  const start = content.lastIndexOf("\n", hit.from) + 1;
  const endIdx = content.indexOf("\n", hit.to);
  const line = content.slice(start, endIdx === -1 ? undefined : endIdx).trim();
  return line.length > 200 ? `${line.slice(0, 197)}…` : line;
}

export async function getNote(vaultId: string, id: string) {
  const n = await getOwned(vaultId, id);
  const sources = await backlinksOf(vaultId, n);
  const keys = new Set([linkKey(n.name), linkKey(n.path)]);
  // Only a window around the first "[[name" / "[[path" of each source leaves Postgres, never whole notes.
  const needles = [...keys].map((k) => `[[${k}`);
  const pos = sql`(select min(p) from unnest(array[${sql.join(
    needles.map((k) => sql`strpos(lower(${note.content}), ${k})`),
    sql`, `,
  )}]) as p where p > 0)`;
  const contents = sources.length
    ? await db
        .select({
          id: note.id,
          content: sql<string | null>`substr(${note.content}, greatest(${pos} - ${CONTEXT_WINDOW}, 1), ${2 * CONTEXT_WINDOW})`,
        })
        .from(note)
        .where(inArray(note.id, sources.map((s) => s.id)))
    : [];
  const byId = new Map(contents.map((c) => [c.id, c.content ?? ""]));
  const backlinks = sources.map((s) => ({ ...s, context: linkContext(byId.get(s.id) ?? "", keys) }));
  const { search: _s, ...rest } = n;
  void _s;
  return { ...rest, backlinks };
}

/* ------------------------------------------------------------------ */
/* Unlinked mentions                                                   */
/* ------------------------------------------------------------------ */

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Mask code and existing [[links]] so only plain prose can count as a mention. */
function maskLinks(md: string) {
  return maskCode(md).replace(/!?\[\[[^\[\]\n]*\]\]/g, (m) => " ".repeat(m.length));
}

function mentionRegex(name: string) {
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(name)}(?![\\p{L}\\p{N}_])`, "iu");
}

/** Notes that mention this note's name in plain text without linking to it. */
export async function unlinkedMentions(vaultId: string, id: string) {
  const n = await getOwned(vaultId, id);
  if (n.name.trim().length < 2) return [];
  const linked = new Set((await backlinksOf(vaultId, n)).map((b) => b.id));
  // Only a window around the first case-insensitive hit of each candidate leaves Postgres.
  const pos = sql`strpos(lower(${note.content}), lower(${n.name}))`;
  const candidates = await db
    .select({
      id: note.id,
      path: note.path,
      name: note.name,
      content: sql<string>`substr(${note.content}, greatest(${pos} - ${CONTEXT_WINDOW}, 1), ${2 * CONTEXT_WINDOW + n.name.length})`,
    })
    .from(note)
    .where(
      and(
        eq(note.vaultId, vaultId),
        sql`${note.id} <> ${n.id}`,
        sql`${note.content} ILIKE ${`%${escapeLike(n.name)}%`}`,
      ),
    )
    .orderBy(asc(note.path))
    .limit(100);
  const re = mentionRegex(n.name);
  const out: { id: string; path: string; name: string; context: string }[] = [];
  for (const c of candidates) {
    if (linked.has(c.id)) continue;
    const masked = maskLinks(c.content);
    const m = re.exec(masked);
    if (!m) continue;
    const start = c.content.lastIndexOf("\n", m.index) + 1;
    const endIdx = c.content.indexOf("\n", m.index);
    const line = c.content.slice(start, endIdx === -1 ? undefined : endIdx).trim();
    out.push({ id: c.id, path: c.path, name: c.name, context: line.length > 200 ? `${line.slice(0, 197)}…` : line });
    if (out.length >= 50) break;
  }
  return out;
}

/** Turn the first plain-text mention of the target note inside `sourceId` into a [[link]]. */
export async function linkMention(vaultId: string, targetId: string, sourceId: string) {
  const target = await getOwned(vaultId, targetId);
  const source = await getOwned(vaultId, sourceId);
  const m = mentionRegex(target.name).exec(maskLinks(source.content));
  if (!m) throw new HttpError(409, "That mention is no longer in the note");
  const written = source.content.slice(m.index, m.index + m[0].length);
  const replacement = written === target.name ? `[[${target.name}]]` : `[[${target.name}|${written}]]`;
  const content = source.content.slice(0, m.index) + replacement + source.content.slice(m.index + m[0].length);
  return updateContent(vaultId, sourceId, content);
}

/** Resolve a wikilink target to a note id. Path match wins, then name match (shortest path). */
export async function resolveLink(vaultId: string, target: string) {
  const key = linkKey(target);
  const rows = await db
    .select({ id: note.id, path: note.path, name: note.name })
    .from(note)
    .where(
      and(
        eq(note.vaultId, vaultId),
        or(sql`lower(${note.path}) = ${key}`, sql`lower(${note.name}) = ${basename(key)}`),
      ),
    );
  if (!rows.length) return null;
  return (
    rows.find((r) => r.path.toLowerCase() === key) ??
    rows.sort((a, b) => a.path.length - b.path.length)[0]
  );
}

export async function search(vaultId: string, q: string) {
  const words = q
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}_-]/gu, ""))
    .filter(Boolean);
  if (!words.length) return [];
  const tsq = words.map((w) => `${w}:*`).join(" & ");
  return db
    .select({
      id: note.id,
      path: note.path,
      name: note.name,
      snippet: sql<string>`ts_headline('simple', ${note.content}, to_tsquery('simple', ${tsq}), 'MaxFragments=2, MaxWords=18, MinWords=6, StartSel=<<, StopSel=>>')`,
    })
    .from(note)
    .where(and(eq(note.vaultId, vaultId), sql`${note.search} @@ to_tsquery('simple', ${tsq})`))
    .orderBy(desc(sql`ts_rank(${note.search}, to_tsquery('simple', ${tsq}))`))
    .limit(50);
}

export async function listTags(vaultId: string) {
  return db
    .select({ tag: tag.tag, count: count() })
    .from(tag)
    .where(eq(tag.vaultId, vaultId))
    .groupBy(tag.tag)
    .orderBy(asc(tag.tag))
    .limit(MAX_TAG_LIST);
}

const MAX_TAG_LIST = 5_000;
const MAX_GRAPH_EDGES = 50_000;
const MAX_GRAPH_TAG_ROWS = 100_000;

export async function notesByTag(vaultId: string, t: string) {
  const key = t.replace(/^#/, "").toLowerCase();
  return db
    .selectDistinct({ id: note.id, path: note.path, name: note.name })
    .from(tag)
    .innerJoin(note, eq(note.id, tag.noteId))
    .where(and(eq(tag.vaultId, vaultId), or(eq(tag.tag, key), like(tag.tag, `${key}/%`))))
    .orderBy(asc(note.path));
}

export async function graph(vaultId: string) {
  // Bounded reads: the note quota caps nodes; edges and tag rows are cut off with `truncated`.
  const [nodes, edgeRows, tagRowsAll] = await Promise.all([
    db
      .select({ id: note.id, name: note.name, path: note.path })
      .from(note)
      .where(eq(note.vaultId, vaultId))
      .limit(LIMITS.vaultNotes),
    db
      .select({ source: link.sourceId, target: link.target })
      .from(link)
      .where(eq(link.vaultId, vaultId))
      .limit(MAX_GRAPH_EDGES + 1),
    db
      .select({ noteId: tag.noteId, tag: tag.tag })
      .from(tag)
      .where(eq(tag.vaultId, vaultId))
      .limit(MAX_GRAPH_TAG_ROWS + 1),
  ]);
  const truncated = edgeRows.length > MAX_GRAPH_EDGES || tagRowsAll.length > MAX_GRAPH_TAG_ROWS;
  const edges = edgeRows.slice(0, MAX_GRAPH_EDGES);
  const tagRows = tagRowsAll.slice(0, MAX_GRAPH_TAG_ROWS);
  const byPath = new Map(nodes.map((n) => [n.path.toLowerCase(), n.id]));
  const byName = new Map<string, string>();
  for (const n of [...nodes].sort((a, b) => b.path.length - a.path.length)) byName.set(n.name.toLowerCase(), n.id);
  const resolved: { source: string; target: string }[] = [];
  const unresolved = new Set<string>();
  for (const e of edges) {
    const t = byPath.get(e.target) ?? byName.get(basename(e.target));
    if (t) {
      if (t !== e.source) resolved.push({ source: e.source, target: t });
    } else {
      unresolved.add(e.target);
      resolved.push({ source: e.source, target: `ghost:${e.target}` });
    }
  }
  const tags = new Map<string, string[]>();
  for (const r of tagRows) {
    const list = tags.get(r.noteId);
    if (list) list.push(r.tag);
    else tags.set(r.noteId, [r.tag]);
  }
  return {
    nodes: [
      ...nodes.map((n) => ({ ...n, tags: tags.get(n.id) ?? [], ghost: false })),
      ...[...unresolved].map((t) => ({ id: `ghost:${t}`, name: basename(t), path: t, tags: [], ghost: true })),
    ],
    edges: resolved,
    truncated,
  };
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export async function createNote(vaultId: string, rawPath: string, content = "") {
  const clean = normalizePath(rawPath) || "Untitled";
  validatePath(clean);
  const fm = frontmatterOf(content);
  return db.transaction(async (tx) => {
    const path = await uniquePath(tx, vaultId, clean);
    validatePath(path);
    await ensureFolders(tx, vaultId, path);
    const [n] = await tx
      .insert(note)
      .values({ vaultId, path, name: basename(path), content, frontmatter: fm })
      .returning({ id: note.id, path: note.path, name: note.name });
    await reindex(tx, vaultId, n.id, content, fm, path); // canvas track: path picks the indexer
    await assertVaultQuota(tx, vaultId);
    return n;
  });
}

export async function updateContent(
  vaultId: string,
  id: string,
  content: string,
  reason: RevisionReason = "autosave",
  baseUpdatedAt?: Date,
) {
  const fm = frontmatterOf(content);
  return db.transaction(async (tx) => {
    await assertUnchanged(tx, vaultId, id, baseUpdatedAt);
    const previousBytes = await snapshotBeforeWrite(tx, vaultId, id, content, reason);
    const grew = previousBytes === null || Buffer.byteLength(content, "utf8") > previousBytes;
    const [n] = await tx
      .update(note)
      .set({ content, frontmatter: fm })
      .where(and(eq(note.vaultId, vaultId), eq(note.id, id)))
      .returning({ id: note.id, updatedAt: note.updatedAt, path: note.path }); // canvas track: path
    if (!n) throw new HttpError(404, "Note not found");
    await reindex(tx, vaultId, id, content, fm, n.path); // canvas track: path picks the indexer
    if (grew) await assertVaultQuota(tx, vaultId);
    return { id: n.id, updatedAt: n.updatedAt };
  });
}

/** For path-only updates: overrides the schema's $onUpdate so a move leaves updatedAt as it was. */
const keepUpdatedAt = sql`${note.updatedAt}`;

/** Rewrite [[old]] → [[new]] in `content`, preserving #heading, |alias and ! embeds. */
function rewriteLinks(content: string, oldKeys: Set<string>, newTarget: string) {
  const links = extractWikiLinks(content);
  let out = "";
  let pos = 0;
  let changed = false;
  for (const l of links) {
    if (!oldKeys.has(linkKey(l.target))) continue;
    const rebuilt = `${l.embed ? "!" : ""}[[${newTarget}${l.heading ? `#${l.heading}` : ""}${l.alias ? `|${l.alias}` : ""}]]`;
    out += content.slice(pos, l.from) + rebuilt;
    pos = l.to;
    changed = true;
  }
  return changed ? out + content.slice(pos) : null;
}

export async function renameNote(vaultId: string, id: string, rawPath: string, baseUpdatedAt?: Date) {
  const old = await getOwned(vaultId, id);
  const clean = keepKind(old.path, normalizePath(rawPath)); // canvas track
  validatePath(clean);
  if (clean === old.path) {
    if (baseUpdatedAt && old.updatedAt.getTime() !== baseUpdatedAt.getTime())
      await assertUnchanged(db, vaultId, id, baseUpdatedAt);
    return { id, path: old.path, name: old.name, updatedLinks: 0 };
  }

  return db.transaction(async (tx) => {
    await assertUnchanged(tx, vaultId, id, baseUpdatedAt);
    const path = await uniquePath(tx, vaultId, clean, id);
    validatePath(path);
    const name = basename(path);
    await ensureFolders(tx, vaultId, path);
    // A move is not an edit: updatedAt (the R1 concurrency token and "recently edited") stays put.
    await tx.update(note).set({ path, name, updatedAt: keepUpdatedAt }).where(eq(note.id, id));

    // Update every note that linked to the old name/path.
    const sources = await backlinksOf(vaultId, old);
    const oldKeys = new Set([linkKey(old.name), linkKey(old.path)]);
    const newTarget = name; // Obsidian default: shortest unambiguous form
    let updatedLinks = 0;
    for (const s of sources) {
      const [src] = await tx.select({ content: note.content }).from(note).where(eq(note.id, s.id));
      // --- canvas track: a canvas source points its file cards at the new path ---
      const next = isCanvasPath(s.path)
        ? rewriteCanvasLinks(
            src.content,
            (t) => oldKeys.has(linkKey(t)),
            isCanvasPath(path) ? path : `${path}.md`,
            (text) => rewriteLinks(text, oldKeys, newTarget),
          )
        : rewriteLinks(src.content, oldKeys, newTarget);
      // --- end canvas track ---
      if (next !== null) {
        await snapshotBeforeWrite(tx, vaultId, s.id, next, "rename");
        await tx.update(note).set({ content: next }).where(eq(note.id, s.id));
        await reindex(tx, vaultId, s.id, next, undefined, s.path); // canvas track: path
        updatedLinks++;
      }
    }
    return { id, path, name, updatedLinks };
  });
}

export async function deleteNote(vaultId: string, id: string) {
  const res = await db
    .delete(note)
    .where(and(eq(note.vaultId, vaultId), eq(note.id, id)))
    .returning({ id: note.id });
  if (!res.length) throw new HttpError(404, "Note not found");
}

export async function createFolder(vaultId: string, rawPath: string) {
  const path = normalizePath(rawPath);
  validatePath(path);
  await ensureFolders(db, vaultId, `${path}/x`);
  return { path };
}

export async function renameFolder(vaultId: string, from: string, to: string) {
  const src = normalizePath(from);
  const dst = normalizePath(to);
  validatePath(src);
  validatePath(dst);
  if (dst === src || dst.startsWith(`${src}/`)) throw new HttpError(400, "Cannot move folder into itself");
  /** The moved path, re-normalised; a stored path that would change shape is refused, never written. */
  const moved = (p: string) => {
    const raw = dst + p.slice(src.length);
    const path = normalizePath(raw);
    if (path !== raw) throw new HttpError(400, "Invalid path");
    validatePath(path);
    return path;
  };
  return db.transaction(async (tx) => {
    const notes = await tx
      .select({ id: note.id, path: note.path })
      .from(note)
      .where(and(eq(note.vaultId, vaultId), like(note.path, `${escapeLike(src)}/%`)));
    for (const n of notes) {
      const path = moved(n.path);
      await tx.update(note).set({ path, name: basename(path), updatedAt: keepUpdatedAt }).where(eq(note.id, n.id));
    }
    const folders = await tx
      .select({ id: folder.id, path: folder.path })
      .from(folder)
      .where(and(eq(folder.vaultId, vaultId), or(eq(folder.path, src), like(folder.path, `${escapeLike(src)}/%`))));
    const newPaths = folders.map((f) => moved(f.path));
    for (const f of folders) await tx.delete(folder).where(eq(folder.id, f.id));
    await ensureFolders(tx, vaultId, `${dst}/x`);
    if (newPaths.length)
      await tx
        .insert(folder)
        .values(newPaths.map((path) => ({ vaultId, path })))
        .onConflictDoNothing();
    return { moved: notes.length };
  });
}

export async function deleteFolder(vaultId: string, rawPath: string) {
  const path = normalizePath(rawPath);
  if (!path) throw new HttpError(400, "Invalid path");
  const pattern = `${escapeLike(path)}/%`;
  await db.transaction(async (tx) => {
    await tx.delete(note).where(and(eq(note.vaultId, vaultId), like(note.path, pattern)));
    await tx
      .delete(folder)
      .where(and(eq(folder.vaultId, vaultId), or(eq(folder.path, path), like(folder.path, pattern))));
  });
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/* ------------------------------------------------------------------ */
/* Import / export (Obsidian vault <-> zip)                            */
/* ------------------------------------------------------------------ */

/** One page of the vault for a streaming export, ordered by path (keyset pagination after `afterPath`). */
export async function exportPage(vaultId: string, afterPath: string | null, limit: number) {
  return db
    .select({ path: note.path, content: note.content })
    .from(note)
    .where(and(eq(note.vaultId, vaultId), afterPath === null ? undefined : sql`${note.path} > ${afterPath}`))
    .orderBy(asc(note.path))
    .limit(limit);
}

/** The whole vault in one array. Tests use it; the export route streams exportPage instead. */
export async function exportVault(vaultId: string) {
  return db
    .select({ path: note.path, content: note.content })
    .from(note)
    .where(eq(note.vaultId, vaultId));
}

const IMPORT_CHUNK = 500;
/** Rows per multi-row INSERT, well under the 65,534 bind parameters Postgres allows. */
const INSERT_ROWS = 5_000;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type ImportResult = { created: number; updated: number; skipped: { path: string; reason: string }[] };

/**
 * Upsert by path: existing notes are overwritten, new ones created. Every file is checked against
 * the same limits as the JSON routes (path shape and length, note size, no NUL); a file that fails
 * is skipped and listed in `skipped`. The write is set-based (a few queries per 500 files), runs one
 * import per vault at a time (else 429) and is rolled back when the vault would exceed its quota.
 */
/** The notes an import would write, by normalised path, after the per-file checks importNotes applies. */
function planImport(files: { path: string; content: string }[]) {
  const skipped: ImportResult["skipped"] = [];
  const byPath = new Map<string, string>();
  let repeats = 0;
  for (const f of files) {
    if (f.path.length > LIMITS.rawPath * 2) {
      skipped.push({ path: f.path.slice(0, 80), reason: "Path is too long" });
      continue;
    }
    const path = normalizePath(f.path);
    if (!path) continue;
    const problem = pathProblem(path);
    if (problem) {
      skipped.push({ path: f.path.slice(0, 200), reason: problem });
      continue;
    }
    const content = f.content.replaceAll("\u0000", "");
    if (Buffer.byteLength(content, "utf8") > LIMITS.noteBytes) {
      skipped.push({ path, reason: "Note is too large" });
      continue;
    }
    if (byPath.has(path)) repeats++;
    byPath.set(path, content);
  }
  return { byPath, skipped, repeats };
}

export type ImportPreview = { conflicts: string[]; total: number };

/**
 * Dry run of importNotes: the same per-file checks, then one read per 500 paths. `conflicts` are
 * the paths (sorted) that already hold a note and would be overwritten; `total` counts the notes the
 * import would write. Writes nothing.
 */
export async function previewImport(vaultId: string, files: { path: string; content: string }[]): Promise<ImportPreview> {
  const { byPath } = planImport(files);
  const conflicts: string[] = [];
  for (const part of chunks([...byPath.keys()], IMPORT_CHUNK)) {
    const rows = await db
      .select({ path: note.path })
      .from(note)
      .where(and(eq(note.vaultId, vaultId), inArray(note.path, part)));
    for (const r of rows) conflicts.push(r.path);
  }
  return { conflicts: conflicts.sort(), total: byPath.size };
}

/**
 * More writes in the import's transaction (the vault's attachments, src/lib/attachments.ts). Runs
 * after the notes and before the quota check; `discard` undoes side effects outside the database
 * when the transaction fails afterwards, while it is still open.
 */
export type ImportExtra = (tx: Tx) => Promise<{ discard: () => Promise<void> }>;

export async function importNotes(
  vaultId: string,
  files: { path: string; content: string }[],
  extra?: ImportExtra,
): Promise<ImportResult> {
  const { byPath, skipped, repeats } = planImport(files);
  let created = 0;
  let updated = repeats; // a path repeated within one import counts as an update, as if written twice
  await db.transaction(async (tx) => {
    const [lock] = await tx.execute<{ ok: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtext(${`import:${vaultId}`})) as ok`,
    );
    if (!lock?.ok) throw new HttpError(429, "An import into this vault is already running");
    await tx.execute(sql`set local statement_timeout = '60s'`);

    const folders = new Set<string>();
    for (const path of byPath.keys()) for (const a of ancestors(path)) folders.add(a);
    for (const part of chunks([...folders], INSERT_ROWS))
      await tx
        .insert(folder)
        .values(part.map((path) => ({ vaultId, path })))
        .onConflictDoNothing();

    for (const part of chunks([...byPath], IMPORT_CHUNK)) {
      const existing = await tx
        .select({ id: note.id, path: note.path })
        .from(note)
        .where(and(eq(note.vaultId, vaultId), inArray(note.path, part.map(([p]) => p))));
      if (existing.length) {
        const contentByPath = new Map(part);
        await snapshotBeforeImport(tx, vaultId, new Map(existing.map((e) => [e.id, contentByPath.get(e.path)!])));
      }

      const values = part.map(([path, content]) => {
        const fm = frontmatterOf(content);
        return { vaultId, path, name: basename(path), content, frontmatter: fm };
      });
      const written = await tx
        .insert(note)
        .values(values)
        .onConflictDoUpdate({
          target: [note.vaultId, note.path],
          set: { content: sql`excluded.content`, frontmatter: sql`excluded.frontmatter`, updatedAt: sql`now()` },
        })
        .returning({ id: note.id, path: note.path, inserted: sql<boolean>`(xmax = 0)` });
      for (const w of written) {
        if (w.inserted) created++;
        else updated++;
      }

      const ids = written.map((w) => w.id);
      await tx.delete(link).where(inArray(link.sourceId, ids));
      await tx.delete(tag).where(inArray(tag.noteId, ids));
      const idByPath = new Map(written.map((w) => [w.path, w.id]));
      const linkRows: (typeof link.$inferInsert)[] = [];
      const tagRows: (typeof tag.$inferInsert)[] = [];
      for (const v of values) {
        const id = idByPath.get(v.path)!;
        const idx = indexOf(v.content, v.frontmatter, v.path); // canvas track: path picks the indexer
        for (const l of idx.links) linkRows.push({ sourceId: id, vaultId, ...l });
        for (const t of idx.tags) tagRows.push({ noteId: id, vaultId, tag: t });
      }
      for (const rowsPart of chunks(linkRows, INSERT_ROWS)) await tx.insert(link).values(rowsPart);
      for (const rowsPart of chunks(tagRows, INSERT_ROWS)) await tx.insert(tag).values(rowsPart);
    }
    const more = extra ? await extra(tx) : null;
    try {
      await assertVaultQuota(tx, vaultId);
    } catch (err) {
      await more?.discard();
      throw err;
    }
  });
  return { created, updated, skipped };
}
