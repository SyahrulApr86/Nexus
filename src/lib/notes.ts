import "server-only";
import { and, asc, count, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { folder, link, note, tag, type RevisionReason } from "@/db/schema";
import { snapshotBeforeWrite } from "@/lib/history";
import {
  basename,
  dirname,
  extractTags,
  extractWikiLinks,
  linkKey,
  maskCode,
  normalizePath,
  parseFrontmatter,
  splitFrontmatter,
} from "@/lib/markdown/parse";
import { HttpError } from "@/lib/session";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;

/* ------------------------------------------------------------------ */
/* Indexing                                                            */
/* ------------------------------------------------------------------ */

async function reindex(tx: Exec, vaultId: string, noteId: string, content: string) {
  await tx.delete(link).where(eq(link.sourceId, noteId));
  await tx.delete(tag).where(eq(tag.noteId, noteId));

  const seen = new Set<string>();
  const links = extractWikiLinks(content)
    .filter((l) => l.target)
    .map((l) => ({ sourceId: noteId, vaultId, target: linkKey(l.target), embed: l.embed }))
    .filter((l) => {
      const k = `${l.target}|${l.embed}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  if (links.length) await tx.insert(link).values(links);

  const tags = extractTags(content).map((t) => ({ noteId, vaultId, tag: t }));
  if (tags.length) await tx.insert(tag).values(tags);
}

function frontmatterOf(content: string) {
  return parseFrontmatter(splitFrontmatter(content).yaml);
}

async function ensureFolders(tx: Exec, vaultId: string, notePath: string) {
  const parts = dirname(notePath).split("/").filter(Boolean);
  const paths = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
  if (paths.length)
    await tx
      .insert(folder)
      .values(paths.map((path) => ({ vaultId, path })))
      .onConflictDoNothing();
}

async function uniquePath(tx: Exec, vaultId: string, path: string, excludeId?: string) {
  let candidate = path;
  for (let i = 1; ; i++) {
    const [hit] = await tx
      .select({ id: note.id })
      .from(note)
      .where(and(eq(note.vaultId, vaultId), eq(note.path, candidate)))
      .limit(1);
    if (!hit || hit.id === excludeId) return candidate;
    candidate = `${path} ${i}`;
  }
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
    .orderBy(asc(note.path));
}

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
  const contents = sources.length
    ? await db
        .select({ id: note.id, content: note.content })
        .from(note)
        .where(inArray(note.id, sources.map((s) => s.id)))
    : [];
  const byId = new Map(contents.map((c) => [c.id, c.content]));
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
  const candidates = await db
    .select({ id: note.id, path: note.path, name: note.name, content: note.content })
    .from(note)
    .where(
      and(
        eq(note.vaultId, vaultId),
        sql`${note.id} <> ${n.id}`,
        sql`${note.content} ILIKE ${`%${escapeLike(n.name)}%`}`,
      ),
    )
    .orderBy(asc(note.path))
    .limit(200);
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
    .orderBy(asc(tag.tag));
}

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
  const [nodes, edges, tagRows] = await Promise.all([
    db.select({ id: note.id, name: note.name, path: note.path }).from(note).where(eq(note.vaultId, vaultId)),
    db.select({ source: link.sourceId, target: link.target }).from(link).where(eq(link.vaultId, vaultId)),
    db.select({ noteId: tag.noteId, tag: tag.tag }).from(tag).where(eq(tag.vaultId, vaultId)),
  ]);
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
  for (const r of tagRows) tags.set(r.noteId, [...(tags.get(r.noteId) ?? []), r.tag]);
  return {
    nodes: [
      ...nodes.map((n) => ({ ...n, tags: tags.get(n.id) ?? [], ghost: false })),
      ...[...unresolved].map((t) => ({ id: `ghost:${t}`, name: basename(t), path: t, tags: [], ghost: true })),
    ],
    edges: resolved,
  };
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export async function createNote(vaultId: string, rawPath: string, content = "") {
  const clean = normalizePath(rawPath) || "Untitled";
  return db.transaction(async (tx) => {
    const path = await uniquePath(tx, vaultId, clean);
    await ensureFolders(tx, vaultId, path);
    const [n] = await tx
      .insert(note)
      .values({ vaultId, path, name: basename(path), content, frontmatter: frontmatterOf(content) })
      .returning({ id: note.id, path: note.path, name: note.name });
    await reindex(tx, vaultId, n.id, content);
    return n;
  });
}

export async function updateContent(vaultId: string, id: string, content: string, reason: RevisionReason = "autosave") {
  return db.transaction(async (tx) => {
    await snapshotBeforeWrite(tx, vaultId, id, content, reason);
    const [n] = await tx
      .update(note)
      .set({ content, frontmatter: frontmatterOf(content) })
      .where(and(eq(note.vaultId, vaultId), eq(note.id, id)))
      .returning({ id: note.id, updatedAt: note.updatedAt });
    if (!n) throw new HttpError(404, "Note not found");
    await reindex(tx, vaultId, id, content);
    return n;
  });
}

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

export async function renameNote(vaultId: string, id: string, rawPath: string) {
  const old = await getOwned(vaultId, id);
  const clean = normalizePath(rawPath);
  if (!clean) throw new HttpError(400, "Invalid path");
  if (clean === old.path) return { id, path: old.path, name: old.name, updatedLinks: 0 };

  return db.transaction(async (tx) => {
    const path = await uniquePath(tx, vaultId, clean, id);
    const name = basename(path);
    await ensureFolders(tx, vaultId, path);
    await tx.update(note).set({ path, name }).where(eq(note.id, id));

    // Update every note that linked to the old name/path.
    const sources = await backlinksOf(vaultId, old);
    const oldKeys = new Set([linkKey(old.name), linkKey(old.path)]);
    const newTarget = name; // Obsidian default: shortest unambiguous form
    let updatedLinks = 0;
    for (const s of sources) {
      const [src] = await tx.select({ content: note.content }).from(note).where(eq(note.id, s.id));
      const next = rewriteLinks(src.content, oldKeys, newTarget);
      if (next !== null) {
        await snapshotBeforeWrite(tx, vaultId, s.id, next, "rename");
        await tx.update(note).set({ content: next }).where(eq(note.id, s.id));
        await reindex(tx, vaultId, s.id, next);
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
  if (!path) throw new HttpError(400, "Invalid path");
  await ensureFolders(db, vaultId, `${path}/x`);
  return { path };
}

export async function renameFolder(vaultId: string, from: string, to: string) {
  const src = normalizePath(from);
  const dst = normalizePath(to);
  if (!src || !dst) throw new HttpError(400, "Invalid path");
  if (dst === src || dst.startsWith(`${src}/`)) throw new HttpError(400, "Cannot move folder into itself");
  return db.transaction(async (tx) => {
    const notes = await tx
      .select({ id: note.id, path: note.path })
      .from(note)
      .where(and(eq(note.vaultId, vaultId), like(note.path, `${escapeLike(src)}/%`)));
    for (const n of notes) {
      const path = dst + n.path.slice(src.length);
      await tx.update(note).set({ path, name: basename(path) }).where(eq(note.id, n.id));
    }
    const folders = await tx
      .select({ id: folder.id, path: folder.path })
      .from(folder)
      .where(and(eq(folder.vaultId, vaultId), or(eq(folder.path, src), like(folder.path, `${escapeLike(src)}/%`))));
    for (const f of folders) await tx.delete(folder).where(eq(folder.id, f.id));
    const newPaths = folders.map((f) => dst + f.path.slice(src.length));
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

export async function exportVault(vaultId: string) {
  return db
    .select({ path: note.path, content: note.content })
    .from(note)
    .where(eq(note.vaultId, vaultId));
}

/** Upsert by path: existing notes are overwritten, new ones created. */
export async function importNotes(vaultId: string, files: { path: string; content: string }[]) {
  let created = 0;
  let updated = 0;
  await db.transaction(async (tx) => {
    for (const f of files) {
      const path = normalizePath(f.path);
      if (!path) continue;
      await ensureFolders(tx, vaultId, path);
      const [existing] = await tx
        .select({ id: note.id })
        .from(note)
        .where(and(eq(note.vaultId, vaultId), eq(note.path, path)))
        .limit(1);
      let id: string;
      if (existing) {
        await snapshotBeforeWrite(tx, vaultId, existing.id, f.content, "import");
        await tx
          .update(note)
          .set({ content: f.content, frontmatter: frontmatterOf(f.content) })
          .where(eq(note.id, existing.id));
        id = existing.id;
        updated++;
      } else {
        const [n] = await tx
          .insert(note)
          .values({ vaultId, path, name: basename(path), content: f.content, frontmatter: frontmatterOf(f.content) })
          .returning({ id: note.id });
        id = n.id;
        created++;
      }
      await reindex(tx, vaultId, id, f.content);
    }
  });
  return { created, updated };
}
