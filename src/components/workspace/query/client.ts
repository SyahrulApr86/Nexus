/*
 * Client side of ```query blocks: running a query through POST /api/query with a small cache,
 * the refresh signal, and toggling a task in the note it belongs to.
 *
 * The workspace can lend the blocks its own task toggle (QueryBridge in ./bridge.tsx), so a toggle
 * in a note the workspace has open goes through the same path as a click in the reading view.
 * Without it a toggle reads the note from the server and saves it with the version it read, so a
 * note changed meanwhile answers 409 and nothing is overwritten.
 */
import { toggleTaskAt } from "@/lib/markdown/tasks";
import type { QueryResponse, QueryResult } from "@/lib/query/types";
import { ApiError, api, getActiveVault, vaultHeaders } from "../api";

/** Fired on window when query results may be stale (a note was saved, created, renamed or deleted). */
export const QUERY_REFRESH_EVENT = "nexus:query-refresh";

export type QueryOutcome =
  | { ok: true; stamp: string; result: QueryResult }
  | { ok: false; message: string; line: number | null; column: number | null; stamp?: string };

const cache = new Map<string, QueryOutcome>();
const inFlight = new Map<string, Promise<QueryOutcome>>();
const keyOf = (source: string) => `${getActiveVault() ?? ""}\u0000${source}`;

/** The last answer for this query in this vault, if any. */
export function cachedQuery(source: string): QueryOutcome | undefined {
  return cache.get(keyOf(source));
}

function store(key: string, outcome: QueryOutcome) {
  cache.delete(key);
  cache.set(key, outcome);
  if (cache.size > 100) cache.delete(cache.keys().next().value!);
}

/**
 * Runs the query, or confirms the cached answer is current (the server compares stamps). Calls
 * for the same query at the same time share one request.
 */
export function runQuery(source: string): Promise<QueryOutcome> {
  const key = keyOf(source);
  const running = inFlight.get(key);
  if (running) return running;
  const prev = cache.get(key);
  const p = (async (): Promise<QueryOutcome> => {
    let res: Response;
    try {
      res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...vaultHeaders() },
        body: JSON.stringify({ source, since: prev?.ok ? prev.stamp : undefined }),
      });
    } catch {
      return prev ?? { ok: false, message: "You appear to be offline, so this query couldn’t run.", line: null, column: null };
    }
    const data = (await res.json().catch(() => null)) as (QueryResponse & { error?: unknown }) | null;
    let outcome: QueryOutcome;
    if (res.status === 401) outcome = { ok: false, message: "Your session ended. Sign in again to see these results.", line: null, column: null };
    else if (!res.ok || !data) {
      const msg = typeof data?.error === "string" ? data.error : "Nexus couldn’t run this query. Try again in a moment.";
      // A passing failure (rate limit, timeout, restart) keeps the results already on screen.
      if (prev?.ok && res.status !== 400) return prev;
      outcome = { ok: false, message: msg, line: null, column: null };
    } else if (!data.ok) outcome = { ok: false, ...data.error };
    else if ("unchanged" in data) outcome = prev?.ok ? { ...prev, stamp: data.stamp } : { ok: false, message: "Nexus couldn’t run this query. Try again in a moment.", line: null, column: null };
    else outcome = { ok: true, stamp: data.stamp, result: data.result };
    store(key, outcome);
    return outcome;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

/** Ask every query block on screen to check its results. */
export function refreshQueries() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(QUERY_REFRESH_EVENT));
}

/* ------------------------------------------------------------------ */
/* Toggling a task in another note                                     */
/* ------------------------------------------------------------------ */

/** The text after a task's box on its line, as the server reports it (src/lib/query/run.ts). */
export function taskTextAt(content: string, offset: number): string {
  const end = content.indexOf("\n", offset);
  return content.slice(offset + 2, end === -1 ? undefined : end).trim().slice(0, 500);
}

export type TaskToggle = (noteId: string, offset: number, text: string) => Promise<void>;

export class StaleTaskError extends Error {
  constructor() {
    super("That task has changed since the list was drawn. The list is up to date now; try again.");
  }
}

/** Default toggle: read the note, flip the box, save with the version read. */
const serverToggle: TaskToggle = async (noteId, offset, text) => {
  const n = await api.get(noteId);
  if (taskTextAt(n.content, offset) !== text) throw new StaleTaskError();
  const next = toggleTaskAt(n.content, offset);
  if (next === n.content) throw new StaleTaskError();
  try {
    await api.save(noteId, next, n.updatedAt);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) throw new StaleTaskError();
    throw err;
  }
};

let toggle: TaskToggle = serverToggle;

/** The workspace lends its own toggle while it is mounted; returns the undo. */
export function setTaskToggle(fn: TaskToggle | null): () => void {
  toggle = fn ?? serverToggle;
  return () => {
    if (toggle === fn) toggle = serverToggle;
  };
}

export async function toggleQueryTask(noteId: string, offset: number, text: string) {
  await toggle(noteId, offset, text);
  refreshQueries();
}

export { serverToggle };
