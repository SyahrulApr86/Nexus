/**
 * Replaying a folder edit made offline against the server as it is now. Pure functions over the
 * server's tree, so the conflict rules are tested on their own (tests/unit/offline-folders.test.ts).
 *
 * The rule is the one the note outbox follows: what this device did lands when it still makes
 * sense, and nothing written elsewhere in the meantime is lost.
 */
import type { Tree } from "../api";
import { movePath, within, type SeenNote } from "./outbox";

export type FolderRenamePlan =
  /** Rename to `to` (the typed name, or a free variant of it when that one would collide). */
  | { kind: "rename"; to: string; renamed: boolean }
  /** The folder is not on the server any more (renamed or deleted elsewhere): nothing to rename. */
  | { kind: "missing" }
  /** The server already has it under the new name (sent before the connection dropped). */
  | { kind: "done" };

const has = (tree: Tree, folder: string) => tree.folders.includes(folder) || tree.notes.some((n) => within(n.path, folder));

/**
 * A folder renamed offline. When notes already sit at the paths the move would give, the folder
 * goes to "<name> (offline)" (then "(offline 2)", ...) instead, so no note overwrites or blocks another.
 */
export function planFolderRename(tree: Tree, from: string, to: string): FolderRenamePlan {
  if (!has(tree, from)) return has(tree, to) ? { kind: "done" } : { kind: "missing" };
  const moving = tree.notes.filter((n) => within(n.path, from));
  const taken = new Set(tree.notes.filter((n) => !within(n.path, from)).map((n) => n.path.toLowerCase()));
  const fits = (dst: string) => moving.every((n) => !taken.has(movePath(n.path, from, dst).toLowerCase()));
  if (fits(to)) return { kind: "rename", to, renamed: false };
  for (let i = 1; i < 100; i++) {
    const alt = `${to} (offline${i === 1 ? "" : ` ${i}`})`;
    if (!has(tree, alt) && fits(alt)) return { kind: "rename", to: alt, renamed: true };
  }
  return { kind: "missing" };
}

export type FolderDeletePlan = {
  /** Delete the whole folder on the server: it holds exactly the notes seen in it, unchanged. */
  whole: boolean;
  /** Notes to delete one by one (seen here and unchanged on the server), when not `whole`. */
  remove: string[];
  /** Notes kept: added to the folder or changed elsewhere since this device saw them. */
  kept: number;
};

/**
 * A folder deleted offline. Only the notes this device saw in it, at the version it saw, are
 * deleted; a note added to the folder or edited elsewhere meanwhile stays, and so does the folder.
 */
export function planFolderDelete(tree: Tree, path: string, seen: readonly SeenNote[]): FolderDeletePlan {
  const at = new Map(seen.map((n) => [n.id, n.updatedAt]));
  const unchanged = (n: { id: string; updatedAt: string }) => at.has(n.id) && sameTime(at.get(n.id)!, n.updatedAt);
  const inside = tree.notes.filter((n) => within(n.path, path));
  const extra = inside.filter((n) => !unchanged(n));
  // Seen notes that live elsewhere now (moved out from another device) go only when unchanged.
  const remove = tree.notes.filter((n) => unchanged(n) && (!extra.length ? !within(n.path, path) : true)).map((n) => n.id);
  if (!extra.length) return { whole: true, remove, kept: 0 };
  return { whole: false, remove, kept: extra.length };
}

/** Versions compare as instants: the mirror and the server may format the same time differently. */
function sameTime(a: string, b: string) {
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isNaN(x) || Number.isNaN(y) ? a === b : x === y;
}
