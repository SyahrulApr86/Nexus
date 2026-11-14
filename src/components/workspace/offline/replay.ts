/**
 * Replays the outbox against the server, oldest entry first, one at a time. Free of IndexedDB and
 * React: the caller passes the queue operations and the server calls, so tests can drive it.
 *
 * An entry leaves the queue only once the server has it (or once it can never succeed). A lost
 * connection, a signed-out session or a server error stops the replay with the entry still
 * queued, and it is tried again on the next reconnect.
 */
import { ApiError, type NoteRef } from "../api";
import type { CreateOp, FolderOp, OutboxOp, SaveOp } from "./outbox";

/** What became of a replayed save: on the server, held as a conflict for the user, or to try later. */
export type SaveOutcome = "done" | "conflict" | "retry";

export type ReplayDeps = {
  create: (path: string, content: string) => Promise<NoteRef>;
  rename: (id: string, path: string) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
  /**
   * A folder created, renamed or deleted offline, checked against the server's tree first
   * (./folders.ts). "conflict": it changed elsewhere and only the safe part was applied.
   */
  folder: (op: FolderOp) => Promise<"done" | "conflict">;
  /** Saves go through the workspace, which owns the conflict flow (409 -> "Keep mine" / "Load theirs"). */
  save: (op: SaveOp) => Promise<SaveOutcome>;
  /** The oldest queued entry. */
  head: () => OutboxOp | undefined;
  /** Mark the entry as being sent, so new edits queue behind it instead of merging into it. */
  begin: (seq: number) => void;
  /** Remove the entry once the server has it. */
  finish: (seq: number) => Promise<void>;
  /** A note created offline got its server id. */
  created: (op: CreateOp, ref: NoteRef) => Promise<void>;
  /** An entry the server refused for good (a 4xx other than 401): it is dropped. */
  dropped: (op: OutboxOp, err: unknown) => void;
};

export type ReplayResult = {
  synced: number;
  conflicts: number;
  failed: number;
  /** Why the replay stopped: the queue is empty, or what to wait for before trying again. */
  stopped: "empty" | "offline" | "signedOut" | "serverError";
};

const statusOf = (e: unknown) => (e instanceof ApiError ? e.status : -1);
const passing = (s: number) => s === 0 || s === -1 || s === 408 || s === 429 || s >= 500;

/** The path a create falls back to when the server refuses the one typed offline. */
export const fallbackPath = (at: number) => {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `Offline note ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`;
};

export async function replay(deps: ReplayDeps): Promise<ReplayResult> {
  const result: ReplayResult = { synced: 0, conflicts: 0, failed: 0, stopped: "empty" };
  for (let op = deps.head(); op; op = deps.head()) {
    deps.begin(op.seq);
    try {
      switch (op.kind) {
        case "create": {
          let ref: NoteRef;
          try {
            ref = await deps.create(op.path, op.content);
          } catch (e) {
            const s = statusOf(e);
            if (passing(s) || s === 401) throw e;
            // The typed path was refused: keep the text under a plain name rather than lose it.
            ref = await deps.create(fallbackPath(op.at), op.content);
          }
          await deps.created(op, ref);
          break;
        }
        case "save": {
          const outcome = await deps.save(op);
          if (outcome === "retry") {
            result.stopped = "serverError";
            return result;
          }
          if (outcome === "conflict") {
            result.conflicts++;
            await deps.finish(op.seq);
            continue;
          }
          break;
        }
        case "rename":
          await deps.rename(op.id, op.path);
          break;
        case "mkdir":
        case "mvdir":
        case "rmdir":
          if ((await deps.folder(op)) === "conflict") {
            result.conflicts++;
            await deps.finish(op.seq);
            continue;
          }
          break;
        case "delete":
          try {
            await deps.remove(op.id);
          } catch (e) {
            // Already gone: what the delete wanted.
            if (statusOf(e) !== 404) throw e;
          }
          break;
      }
      result.synced++;
      await deps.finish(op.seq);
    } catch (e) {
      const s = statusOf(e);
      if (s === 0) result.stopped = "offline";
      else if (s === 401) result.stopped = "signedOut";
      else if (passing(s)) result.stopped = "serverError";
      if (passing(s) || s === 401) return result;
      result.failed++;
      deps.dropped(op, e);
      await deps.finish(op.seq);
    }
  }
  return result;
}
