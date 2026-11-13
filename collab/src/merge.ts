/**
 * Bringing a plain-text write (REST PATCH, link rewrite on rename, restore, import) into a live
 * Yjs document. Pure functions, so the rules are testable without a socket or a database.
 */
import { simpleDiffString } from "lib0/diff";

/** Delete `remove` characters at `index`, then insert `insert` there (UTF-16 offsets, like Y.Text). */
export type Splice = { index: number; remove: number; insert: string };

const isNoop = (s: Splice) => s.remove === 0 && s.insert === "";

/** One splice that turns `from` into `to`, or none when they are equal. */
export function diff(from: string, to: string): Splice[] {
  const s = simpleDiffString(from, to);
  return isNoop(s) ? [] : [s];
}

/**
 * Splices that turn `current` (the live text) into one holding both its unsaved edits and the
 * write that just landed in the database.
 *
 * `base` is the content the database held when the live text was last saved or loaded,
 * `incoming` is what it holds now. When the two changes touch different parts of the note both are
 * kept; when they overlap the database write wins, like any later save does (the earlier text
 * is still in the note's history).
 */
export function mergeIncoming(base: string, current: string, incoming: string): Splice[] {
  if (incoming === base || incoming === current) return [];
  if (current === base) return diff(current, incoming);
  const local = simpleDiffString(base, current);
  const remote = simpleDiffString(base, incoming);
  const localEnd = local.index + local.remove;
  const remoteEnd = remote.index + remote.remove;
  // Wholly before the local edit: offsets are unchanged (an insert at the same point goes first).
  if (remoteEnd <= local.index) return [remote];
  // Wholly after it: shift by what the local edit added or removed.
  if (remote.index >= localEnd) return [{ ...remote, index: remote.index + local.insert.length - local.remove }];
  return diff(current, incoming);
}
