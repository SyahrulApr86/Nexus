/**
 * The offline outbox: edits made without a connection, kept in the order they were made and
 * replayed once the server can be reached. Pure functions only (no IndexedDB, no fetch), so the
 * ordering and coalescing rules can be tested on their own.
 *
 * Coalescing keeps the queue short without changing what the server ends up with:
 * - a save merges into the newest queued save of the same note (its base stays the first one,
 *   so a note changed elsewhere in the meantime still answers 409 on replay);
 * - a note created offline has a temporary id: saves and renames of it fold into its create,
 *   and deleting it drops it and everything queued for it, so the server never sees it;
 * - deleting a server note drops its queued saves and renames, which would only be thrown away;
 * - a rename merges into the newest queued rename of the same note.
 * An entry that is being sent right now (`inFlight`) is never changed: what was sent stays sent,
 * and a later edit is queued after it.
 *
 * Folder edits (create, rename, delete) queue too, in the same order as note edits, so "rename a
 * folder, then edit a note in it" reaches the server in that order. They carry no note id. Deleting
 * a folder records the notes this device saw in it (with their server version): the replay deletes
 * only those, so a note added or changed there from elsewhere meanwhile is kept (./folders.ts).
 */
import { basename, dirname, linkKey, normalizePath } from "@/lib/markdown/parse";
import type { Tree, TreeNote } from "../api";

export const TEMP_PREFIX = "local-";
export const isTempId = (id: string) => id.startsWith(TEMP_PREFIX);

export type CreateOp = { kind: "create"; seq: number; at: number; id: string; path: string; content: string };
/**
 * `base`: the server version the text was based on (undefined: overwrite, "Keep mine").
 * `chained`: queued behind a save of the same note that was already being sent; its base is
 * whatever that save leaves behind, so it is read when the save is replayed.
 */
export type SaveOp = { kind: "save"; seq: number; at: number; id: string; content: string; base?: string; chained?: boolean };
export type RenameOp = { kind: "rename"; seq: number; at: number; id: string; path: string };
export type DeleteOp = { kind: "delete"; seq: number; at: number; id: string };
export type NoteOp = CreateOp | SaveOp | RenameOp | DeleteOp;

/** A note seen in a folder when it was deleted: its server id and the server version seen. */
export type SeenNote = { id: string; updatedAt: string };
export type MkdirOp = { kind: "mkdir"; seq: number; at: number; id?: undefined; path: string };
export type MvdirOp = { kind: "mvdir"; seq: number; at: number; id?: undefined; from: string; to: string };
export type RmdirOp = { kind: "rmdir"; seq: number; at: number; id?: undefined; path: string; notes: SeenNote[] };
export type FolderOp = MkdirOp | MvdirOp | RmdirOp;
export type OutboxOp = NoteOp | FolderOp;

export const isFolderOp = (o: OutboxOp): o is FolderOp => o.kind === "mkdir" || o.kind === "mvdir" || o.kind === "rmdir";
/** True when `path` is `folder` or inside it. */
export const within = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);
/** `path` with the folder prefix `from` replaced by `to` (unchanged when it is not inside). */
export const movePath = (path: string, from: string, to: string) => (within(path, from) ? to + path.slice(from.length) : path);

type Without<T> = T extends unknown ? Omit<T, "seq" | "at"> : never;
export type NewOp = Without<OutboxOp>;

const nextSeq = (ops: readonly OutboxOp[]) => ops.reduce((m, o) => Math.max(m, o.seq), 0) + 1;

/** Add one edit to the queue, coalescing it with what is already there. Returns a new array. */
export function enqueue(ops: readonly OutboxOp[], op: NewOp, now: number, inFlight?: number): OutboxOp[] {
  const open = (o: OutboxOp) => o.seq !== inFlight;
  const lastIndex = (pred: (o: OutboxOp) => boolean) => {
    for (let i = ops.length - 1; i >= 0; i--) if (pred(ops[i])) return i;
    return -1;
  };
  const seq = nextSeq(ops);
  const append = (o: OutboxOp): OutboxOp[] => [...ops, o];

  switch (op.kind) {
    case "create":
      return append({ ...op, path: normalizePath(op.path) || "Untitled", seq, at: now });

    case "save": {
      if (isTempId(op.id)) {
        const i = lastIndex((o) => o.kind === "create" && o.id === op.id && open(o));
        if (i !== -1) return ops.map((o, j) => (j === i ? { ...(o as CreateOp), content: op.content, at: now } : o));
      }
      const i = lastIndex((o) => o.id === op.id && (o.kind === "save" || o.kind === "delete"));
      const prev = i === -1 ? undefined : ops[i];
      if (prev?.kind === "save" && open(prev)) {
        return ops.map((o, j) => (j === i ? { ...(o as SaveOp), content: op.content, at: now } : o));
      }
      // Behind a save that is being sent: its base is only known once that save lands.
      if (prev?.kind === "save") return append({ kind: "save", id: op.id, content: op.content, chained: true, seq, at: now });
      // A note created offline has no server version to be based on.
      return append({ ...op, base: isTempId(op.id) ? undefined : op.base, seq, at: now });
    }

    case "rename": {
      const path = normalizePath(op.path);
      if (isTempId(op.id)) {
        const i = lastIndex((o) => o.kind === "create" && o.id === op.id && open(o));
        if (i !== -1) return ops.map((o, j) => (j === i ? { ...(o as CreateOp), path, at: now } : o));
      }
      const i = lastIndex((o) => o.kind === "rename" && o.id === op.id && open(o));
      if (i !== -1) return ops.map((o, j) => (j === i ? { ...(o as RenameOp), path, at: now } : o));
      return append({ ...op, path, seq, at: now });
    }

    case "delete": {
      if (isTempId(op.id) && ops.some((o) => o.kind === "create" && o.id === op.id && open(o))) {
        return ops.filter((o) => o.id !== op.id || !open(o));
      }
      const kept = ops.filter((o) => o.id !== op.id || !open(o) || o.kind === "create");
      return [...kept, { ...op, seq, at: now }];
    }

    case "mkdir":
      return append({ ...op, path: normalizePath(op.path), seq, at: now });

    case "mvdir":
      return append({ ...op, from: normalizePath(op.from), to: normalizePath(op.to), seq, at: now });

    case "rmdir": {
      const path = normalizePath(op.path);
      // Notes created offline in the folder never reach the server; queued edits of the server's
      // notes in it are moot (and would change the version the replay checks before deleting).
      const temp = new Set(ops.filter((o): o is CreateOp => o.kind === "create" && open(o) && within(pathOf(ops, o.id) ?? "", path)).map((o) => o.id));
      const seen = new Set(op.notes.map((n) => n.id));
      const kept = ops.filter((o) => !open(o) || o.id === undefined || (!temp.has(o.id) && !(seen.has(o.id) && o.kind !== "delete")));
      return [...kept, { ...op, path, seq, at: now }];
    }
  }
}

/**
 * The path a note ends up with after the queue, walking it in order: creates and renames set it,
 * folder renames move it, a folder delete removes it (null). `start` is its server path, if known.
 */
export function pathOf(ops: readonly OutboxOp[], id: string, start?: string): string | null {
  let path: string | null = start ?? null;
  for (const o of ops) {
    if (o.kind === "create" || o.kind === "rename") {
      if (o.id === id) path = o.path;
    } else if (o.kind === "delete") {
      if (o.id === id) path = null;
    } else if (path !== null && o.kind === "mvdir") path = movePath(path, o.from, o.to);
    else if (path !== null && o.kind === "rmdir" && (within(path, o.path) || o.notes.some((n) => n.id === id))) path = null;
  }
  return path;
}

/** True when a queued folder delete removes this server note. */
export const deletedWithFolder = (ops: readonly OutboxOp[], id: string) =>
  ops.some((o) => o.kind === "rmdir" && o.notes.some((n) => n.id === id));

/** A note created offline got its server id: later entries for it now use that id. */
export function remapId(ops: readonly OutboxOp[], from: string, to: string): OutboxOp[] {
  return ops.map((o) => (o.id !== undefined && o.id === from ? { ...o, id: to } : o));
}

/** Forget every entry for a note (deleted from this device while online). */
export function dropId(ops: readonly OutboxOp[], id: string, inFlight?: number): OutboxOp[] {
  return ops.filter((o) => o.id !== id || o.seq === inFlight);
}

/** True when an edit of this note waits in the queue, so a new one must queue behind it. */
export const touches = (ops: readonly OutboxOp[], id: string) => ops.some((o) => o.id === id);

/** The newest queued text of a note, if any, with the base it was written against. */
export function queuedText(ops: readonly OutboxOp[], id: string): { content: string; base?: string } | null {
  for (let i = ops.length - 1; i >= 0; i--) {
    const o = ops[i];
    if (o.id !== id) continue;
    if (o.kind === "delete") return null;
    if (o.kind === "create") return { content: o.content };
    if (o.kind === "save") {
      // A chained save's base is the first unchained save's.
      const first = ops.find((x): x is SaveOp => x.kind === "save" && x.id === id && !x.chained);
      return { content: o.content, base: first?.base ?? o.base };
    }
  }
  return null;
}

/**
 * The queued path of a note created, renamed or moved with its folder offline, or null when the
 * queue does not move it. `start` is its server path (needed to follow a folder rename).
 */
export function queuedPath(ops: readonly OutboxOp[], id: string, start?: string): string | null {
  const p = pathOf(ops, id, start);
  return p !== null && p !== start ? p : null;
}

function addFolders(folders: Set<string>, path: string) {
  for (let d = dirname(path); d; d = dirname(d)) folders.add(d);
}

/** The server's tree as this device sees it: queued creates, renames, deletes and saves applied. */
export function overlayTree(tree: Tree, ops: readonly OutboxOp[]): Tree {
  if (!ops.length) return tree;
  const notes = new Map<string, TreeNote>(tree.notes.map((n) => [n.id, n]));
  const folders = new Set(tree.folders);
  for (const o of ops) {
    const at = new Date(o.at).toISOString();
    const cur = o.id === undefined ? undefined : notes.get(o.id);
    if (o.kind === "create") {
      notes.set(o.id, { id: o.id, path: o.path, name: basename(o.path), updatedAt: at });
      addFolders(folders, o.path);
    } else if (o.kind === "delete") {
      notes.delete(o.id);
    } else if (cur && o.kind === "rename") {
      notes.set(o.id, { ...cur, path: o.path, name: basename(o.path) });
      addFolders(folders, o.path);
    } else if (cur && o.kind === "save") {
      notes.set(o.id, { ...cur, updatedAt: at });
    } else if (o.kind === "mkdir") {
      folders.add(o.path);
      addFolders(folders, o.path);
    } else if (o.kind === "mvdir") {
      for (const n of [...notes.values()])
        if (within(n.path, o.from)) notes.set(n.id, { ...n, path: movePath(n.path, o.from, o.to) });
      for (const f of [...folders])
        if (within(f, o.from)) {
          folders.delete(f);
          folders.add(movePath(f, o.from, o.to));
        }
      folders.add(o.to);
      addFolders(folders, o.to);
    } else if (o.kind === "rmdir") {
      const seen = new Set(o.notes.map((n) => n.id));
      for (const n of [...notes.values()]) if (within(n.path, o.path) || seen.has(n.id)) notes.delete(n.id);
      for (const f of [...folders]) if (within(f, o.path)) folders.delete(f);
    }
  }
  return { notes: [...notes.values()], folders: [...folders].sort() };
}

/** A wikilink target in a tree: by path first, then by name, as the store resolves links. */
export function findInTree(tree: Tree, target: string): TreeNote | undefined {
  const k = linkKey(target);
  return tree.notes.find((n) => n.path.toLowerCase() === k) ?? tree.notes.find((n) => n.name.toLowerCase() === basename(k));
}

/** How many changes wait: what the status bar counts. */
export const pendingCount = (ops: readonly OutboxOp[]) => ops.length;

type ViewLike = { type: string; id?: string };
type LayoutLike = { groups: { tabs: { history: ViewLike[] }[] }[] };

/** Point every tab history entry at a note's new id. */
export function remapLayout<L extends LayoutLike>(layout: L, from: string, to: string): L {
  let changed = false;
  const groups = layout.groups.map((g) => ({
    ...g,
    tabs: g.tabs.map((t) => ({
      ...t,
      history: t.history.map((v) => {
        if (v.type !== "note" || v.id !== from) return v;
        changed = true;
        return { ...v, id: to };
      }),
    })),
  }));
  return changed ? ({ ...layout, groups } as L) : layout;
}
