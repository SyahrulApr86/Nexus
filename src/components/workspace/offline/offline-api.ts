/**
 * The workspace's API with an offline layer around it. Same shape as `api` in ../api, so the store
 * only swaps which object it calls. Online, every call goes to the server as before and what comes
 * back is mirrored to IndexedDB (the tree, the vault name, each note that was opened). Without a
 * connection, reads come from that mirror and edits (save, create, rename, delete) queue in the
 * outbox, which is replayed in order once /api/vault answers again.
 *
 * The mirror always holds the server's version; queued edits are applied on top when read, so a
 * note's base for the 409 check stays the server version its edits were written against.
 */
import { basename, normalizePath } from "@/lib/markdown/parse";
import { api as server, ApiError, type FullNote, type NoteRef, type Tree } from "../api";
import { DB_PREFIX, deleteKV, openKV, userKey, type KV } from "./idb";
import {
  TEMP_PREFIX,
  dropId,
  enqueue,
  findInTree,
  isTempId,
  overlayTree,
  queuedPath,
  queuedText,
  remapId,
  touches,
  type CreateOp,
  type NewOp,
  type OutboxOp,
  type SaveOp,
} from "./outbox";
import { replay, type ReplayResult, type SaveOutcome } from "./replay";
import { warmServiceWorker } from "./sw-events";

/* ---------------- status, for the status bar ---------------- */

export type OfflineStatus = {
  /** The server can be reached. */
  online: boolean;
  /** Edits waiting in the outbox. */
  queued: number;
  syncing: boolean;
};

const INITIAL: OfflineStatus = { online: true, queued: 0, syncing: false };
let status = INITIAL;
const listeners = new Set<() => void>();

export const getOfflineStatus = () => status;
export const getServerOfflineStatus = () => INITIAL;
export function subscribeOfflineStatus(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
function setStatus(patch: Partial<OfflineStatus>) {
  const next = { ...status, ...patch };
  if (next.online === status.online && next.queued === status.queued && next.syncing === status.syncing) return;
  status = next;
  listeners.forEach((fn) => fn());
}

/* ---------------- the signed-in user's store ---------------- */

type Session = {
  key: string;
  kv: KV | null;
  ops: OutboxOp[];
  /** The outbox entry being sent right now. */
  inFlight?: number;
  ready: Promise<void>;
  writes: Promise<void>;
};

let session: Session | null = null;
const LAST_USER = "nexus-offline-user";
const PROBE_EVERY = 15_000;

/** Open (once) the offline store of the user this workspace belongs to. */
export function bindOfflineUser(email: string) {
  const key = userKey(email);
  if (session?.key === key) return;
  session?.kv?.close();
  const s: Session = { key, kv: null, ops: [], ready: Promise.resolve(), writes: Promise.resolve() };
  s.ready = (async () => {
    s.kv = await openKV(DB_PREFIX + key);
    s.ops = (await s.kv?.get<OutboxOp[]>("outbox")) ?? [];
    // The cached vault page holds the last user's names: drop it when someone else signs in here.
    try {
      const last = localStorage.getItem(LAST_USER);
      if (last && last !== key) {
        await clearCaches();
        // Cache this user's vault page again, so it opens offline from the first visit.
        void warmServiceWorker();
      }
      localStorage.setItem(LAST_USER, key);
    } catch {}
    setStatus({ queued: s.ops.length });
    scheduleSync();
  })();
  session = s;
  watchConnectivity();
}

async function ready(): Promise<Session | null> {
  const s = session;
  if (!s) return null;
  await s.ready;
  return s.kv ? s : null;
}

function persist(s: Session) {
  setStatus({ queued: s.ops.length });
  const ops = s.ops;
  s.writes = s.writes.then(() => s.kv?.set("outbox", ops));
  return s.writes;
}

function push(s: Session, op: NewOp) {
  s.ops = enqueue(s.ops, op, Date.now(), s.inFlight);
  void persist(s);
  scheduleSync();
}

/* ---------------- connectivity ---------------- */

let unreachable = false;
let probeTimer: ReturnType<typeof setInterval> | undefined;
let watching = false;

const browserOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;
/** No connection, as far as this device can tell. */
export const isOffline = () => !browserOnline() || unreachable;

function markUnreachable() {
  unreachable = true;
  setStatus({ online: false });
  if (!probeTimer) probeTimer = setInterval(() => void probe(), PROBE_EVERY);
}

function markReachable() {
  unreachable = false;
  if (probeTimer) clearInterval(probeTimer);
  probeTimer = undefined;
  setStatus({ online: browserOnline() });
  scheduleSync();
}

/** Any answer from the server counts, even a 401: it is reachable. */
async function probe() {
  if (!browserOnline()) return;
  try {
    await fetch("/api/vault", { cache: "no-store", credentials: "same-origin" });
    markReachable();
  } catch {
    markUnreachable();
  }
}

function watchConnectivity() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  setStatus({ online: browserOnline() });
  window.addEventListener("online", () => void probe());
  window.addEventListener("offline", () => setStatus({ online: false }));
}

const isNetworkError = (e: unknown) => e instanceof ApiError && e.status === 0;

/* ---------------- sync ---------------- */

export type SyncBridge = {
  /** Replay one queued save through the workspace's own save, which owns the 409 flow. */
  save: (op: SaveOp) => Promise<SaveOutcome>;
  /** A note created offline now has a server id. */
  created: (tempId: string, ref: NoteRef) => Promise<void> | void;
  dropped: (op: OutboxOp, err: unknown) => void;
  finished: (r: ReplayResult) => void;
};

let bridge: SyncBridge | null = null;
let syncing: Promise<void> | null = null;
let syncTimer: ReturnType<typeof setTimeout> | undefined;
/** Notes whose save is being replayed: their saves go straight to the server. */
const replaying = new Set<string>();

export function setSyncBridge(b: SyncBridge | null) {
  bridge = b;
  scheduleSync();
}

function scheduleSync(delay = 300) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void syncNow(), delay);
}

/** Send the outbox now. Resolves when this replay ends (at once if there is nothing to do). */
export function syncNow(): Promise<void> {
  if (syncing) return syncing;
  const s = session;
  const b = bridge;
  if (!s || !b || isOffline() || !s.ops.length) return Promise.resolve();
  syncing = (async () => {
    await s.ready;
    setStatus({ syncing: true });
    try {
      const result = await replay({
        create: (path, content) => server.create(path, content),
        rename: async (id, path) => {
          const r = await server.rename(id, path);
          await mirrorPatch(s, id, { path: r.path, name: r.name });
          return r;
        },
        remove: async (id) => {
          const r = await server.remove(id);
          await s.kv?.del(`note:${id}`);
          return r;
        },
        save: async (op) => {
          replaying.add(op.id);
          try {
            return await b.save(op);
          } finally {
            replaying.delete(op.id);
          }
        },
        head: () => s.ops[0],
        begin: (seq) => void (s.inFlight = seq),
        finish: async (seq) => {
          s.ops = s.ops.filter((o) => o.seq !== seq);
          s.inFlight = undefined;
          await persist(s);
        },
        created: async (op: CreateOp, ref) => {
          s.ops = remapId(s.ops, op.id, ref.id);
          await persist(s);
          await b.created(op.id, ref);
        },
        dropped: (op, err) => b.dropped(op, err),
      });
      if (result.stopped === "offline") markUnreachable();
      b.finished(result);
    } finally {
      s.inFlight = undefined;
      syncing = null;
      setStatus({ syncing: false });
    }
  })();
  return syncing;
}

/** Edits still waiting for the server. */
export const queuedCount = () => session?.ops.length ?? 0;

/* ---------------- the mirror ---------------- */

async function mirrorPatch(s: Session, id: string, patch: Partial<FullNote>) {
  const m = await s.kv?.get<FullNote>(`note:${id}`);
  if (m) await s.kv?.set(`note:${id}`, { ...m, ...patch });
}

/** A mirrored (server) note with this device's queued edits on top. */
function withQueued(s: Session, n: FullNote): FullNote {
  const q = queuedText(s.ops, n.id);
  const path = queuedPath(s.ops, n.id);
  return {
    ...n,
    ...(path ? { path, name: basename(path) } : null),
    ...(q ? { content: q.content, updatedAt: q.base ?? n.updatedAt } : null),
  };
}

function offlineError(message: string) {
  return new ApiError(message, 0);
}

/* ---------------- the wrapped API ---------------- */

async function tree(): Promise<Tree> {
  const s = await ready();
  if (!s) return server.tree();
  if (!isOffline()) {
    try {
      const t = await server.tree();
      void s.kv?.set("tree", t);
      return overlayTree(t, s.ops);
    } catch (e) {
      if (!isNetworkError(e)) throw e;
      markUnreachable();
    }
  }
  const t = await s.kv?.get<Tree>("tree");
  if (!t) throw offlineError("You’re offline, and this vault hasn’t been opened on this device yet. Connect to the internet and reload.");
  return overlayTree(t, s.ops);
}

async function get(id: string): Promise<FullNote> {
  const s = await ready();
  if (!s) return server.get(id);
  if (isTempId(id)) {
    const c = s.ops.find((o): o is CreateOp => o.kind === "create" && o.id === id);
    if (!c) throw new ApiError("This note was deleted.", 404);
    const at = new Date(c.at).toISOString();
    return { id, path: c.path, name: basename(c.path), content: c.content, frontmatter: null, createdAt: at, updatedAt: at, backlinks: [] };
  }
  if (s.ops.some((o) => o.kind === "delete" && o.id === id)) throw new ApiError("This note was deleted on this device.", 404);
  if (!isOffline()) {
    try {
      const fresh = await server.get(id);
      void s.kv?.set(`note:${id}`, fresh);
      return withQueued(s, fresh);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) void s.kv?.del(`note:${id}`);
      if (!isNetworkError(e)) throw e;
      markUnreachable();
    }
  }
  const m = await s.kv?.get<FullNote>(`note:${id}`);
  if (!m) throw offlineError("This note isn’t saved on this device yet. Connect to the internet to open it.");
  return withQueued(s, m);
}

async function save(id: string, content: string, baseUpdatedAt?: string): Promise<{ id: string; updatedAt: string }> {
  const s = await ready();
  const direct = async () => {
    const r = await server.save(id, content, baseUpdatedAt);
    if (s) await mirrorPatch(s, id, { content, updatedAt: r.updatedAt });
    return r;
  };
  if (!s || replaying.has(id)) return direct();
  const queue = async () => {
    push(s, { kind: "save", id, content, base: baseUpdatedAt });
    // The base does not move until the server has the text.
    const m = baseUpdatedAt ? null : await s.kv?.get<FullNote>(`note:${id}`);
    return { id, updatedAt: baseUpdatedAt ?? m?.updatedAt ?? new Date(0).toISOString() };
  };
  // Queued edits of this note go first: a newer text must never land before an older one.
  if (isTempId(id) || isOffline() || touches(s.ops, id)) return queue();
  try {
    return await direct();
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    markUnreachable();
    return queue();
  }
}

async function create(path: string, content = ""): Promise<NoteRef> {
  const s = await ready();
  if (!s) return server.create(path, content);
  if (!isOffline()) {
    try {
      return await server.create(path, content);
    } catch (e) {
      if (!isNetworkError(e)) throw e;
      markUnreachable();
    }
  }
  const id = `${TEMP_PREFIX}${crypto.randomUUID()}`;
  push(s, { kind: "create", id, path, content });
  const p = normalizePath(path) || "Untitled";
  return { id, path: p, name: basename(p) };
}

async function rename(id: string, path: string): Promise<NoteRef & { updatedLinks: number }> {
  const s = await ready();
  if (!s) return server.rename(id, path);
  const queue = () => {
    push(s, { kind: "rename", id, path });
    const p = normalizePath(path);
    return { id, path: p, name: basename(p), updatedLinks: 0 };
  };
  if (isTempId(id) || isOffline()) return queue();
  try {
    const r = await server.rename(id, path);
    await mirrorPatch(s, id, { path: r.path, name: r.name });
    return r;
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    markUnreachable();
    return queue();
  }
}

async function remove(id: string): Promise<unknown> {
  const s = await ready();
  if (!s) return server.remove(id);
  const queue = () => {
    push(s, { kind: "delete", id });
    return {};
  };
  if (isTempId(id) || isOffline()) return queue();
  try {
    const r = await server.remove(id);
    // Queued edits of a deleted note would only come back as "deleted elsewhere".
    s.ops = dropId(s.ops, id, s.inFlight);
    void persist(s);
    await s.kv?.del(`note:${id}`);
    return r;
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    markUnreachable();
    return queue();
  }
}

type Resolved = Awaited<ReturnType<typeof server.resolve>>;

async function resolve(target: string, createIt = false, content?: string): Promise<Resolved> {
  if (!isOffline()) {
    try {
      return await server.resolve(target, createIt, content);
    } catch (e) {
      if (!isNetworkError(e) || !(await ready())) throw e;
      markUnreachable();
    }
  }
  const hit = findInTree(await tree(), target);
  if (hit) return { id: hit.id, path: hit.path, name: hit.name, created: false };
  if (!createIt) return { id: null } as unknown as Resolved;
  return { ...(await create(target, content ?? "")), created: true };
}

async function vault(): Promise<{ id: string; name: string }> {
  const s = await ready();
  if (!s) return server.vault();
  if (!isOffline()) {
    try {
      const v = await server.vault();
      void s.kv?.set("vault", v);
      return v;
    } catch (e) {
      if (!isNetworkError(e)) throw e;
      markUnreachable();
    }
  }
  const v = await s.kv?.get<{ id: string; name: string }>("vault");
  if (!v) throw offlineError("You’re offline.");
  return v;
}

export const offlineApi: typeof server = { ...server, tree, get, save, create, rename, remove, resolve, vault };

/* ---------------- signing out ---------------- */

async function clearCaches() {
  if (typeof caches === "undefined") return;
  const names = await caches.keys();
  await Promise.all(names.filter((n) => n.startsWith("nexus-")).map((n) => caches.delete(n)));
}

/** Signing out: delete this user's offline notes, queued edits and the cached app on this device. */
export async function clearOfflineData() {
  const s = session;
  session = null;
  if (s) {
    await s.writes.catch(() => {});
    s.kv?.close();
    await deleteKV(DB_PREFIX + s.key);
  }
  try {
    localStorage.removeItem(LAST_USER);
  } catch {}
  await clearCaches().catch(() => {});
  setStatus({ queued: 0, syncing: false });
}

/** Before signing out: try to send what waits, and say how many edits are still only on this device. */
export async function unsyncedBeforeSignOut(): Promise<number> {
  await syncNow().catch(() => {});
  return queuedCount();
}
