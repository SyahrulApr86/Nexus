/**
 * Live collaboration sessions, one per open note (collab/README.md, "Kontrak untuk editor").
 *
 * A session owns the socket and a Y.Doc for one note, and every editor showing that note binds to
 * it. Each connection starts from a fresh Y.Doc: whatever this device typed while it was not live
 * went through REST, so replaying an older local document on reconnect would apply it twice.
 *
 * The workspace store is the host: it decides when a note may go live (nothing held by a conflict
 * or a deleted note), stops PATCHing content while it is live, and takes the text back into REST
 * autosave when the socket goes away. The rules for those switches live in ./mode.ts.
 */
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { hasQueuedEdits } from "../offline/offline-api";
import type { Awareness } from "y-protocols/awareness";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import {
  backoff,
  closeAction,
  collabUrl,
  diff,
  ownAck,
  presenceColors,
  presenceSlot,
  safeColor,
  seedSplices,
  type CloseAction,
} from "./mode";

export type CollabState = "off" | "connecting" | "live";
export type Peer = { clientId: number; name: string; color: string; self: boolean };
/**
 * Where this device's edits of a live note are:
 * - "saved": the service wrote every one of them to the database (it said so, after the write);
 * - "synced": the service has every one of them, but does not report saves (an older service);
 * - "syncing": some are still on their way, or not written yet.
 */
export type CollabSync = "saved" | "synced" | "syncing";
export type CollabSnapshot = { state: CollabState; peers: readonly Peer[]; sync: CollabSync };

/** Why a note left live mode: "graceful" means this device closed a healthy socket itself. */
export type LeaveReason = "graceful" | "dropped" | Exclude<CloseAction, "reconnect">;

/** The workspace store's side of the switch (store.tsx, collab-editor block). */
export type CollabHost = {
  /** Mark the note live. Resolves with the REST base and the newest local text, or null to stay on REST. */
  enter: (noteId: string) => Promise<{ server: string | undefined; local: string | undefined } | null>;
  /**
   * The note is back on REST autosave. `text` is what the shared document last held; `confirmed` is
   * the text the service is known to hold, local edits included only once it acknowledged them
   * (undefined when it never went live), the base for merging with a server copy that may hold edits this device never received.
   */
  leave: (noteId: string, text: string, reason: LeaveReason, confirmed?: string) => void;
  notify: (message: string) => void;
};

/** An editor view showing the note (editor.tsx). */
export type Binder = {
  /** Put the shared text into the editor, then bind it with yCollab. */
  bind: (text: Y.Text, awareness: Awareness, undo: Y.UndoManager) => void;
  unbind: () => void;
};

const OFF: CollabSnapshot = Object.freeze({ state: "off" as const, peers: Object.freeze([]) as readonly Peer[], sync: "saved" as const });
const ORIGIN_SEED = "nexus:seed";
const ORIGIN_STORE = "nexus:store";
const SYNC_TIMEOUT = 10_000;
const LINGER = 1500;
/** Pause after a local edit before asking the service to acknowledge it (see `requestAck`). */
const ACK_DELAY = 200;
/** Unanswered acknowledgement requests kept; older ones are forgotten (a stalled socket). */
const ACK_KEEP = 64;
const MESSAGE_AWARENESS = 1;
/** Persistence acknowledgements (collab/src/room.ts): `[7]` asks for them, `[7, n]` reports one. */
const MESSAGE_PERSISTED = 7;
/** Acknowledgement numbers remembered until the service reports them persisted. */
const PERSIST_KEEP = 256;
/** Without NEXT_PUBLIC_COLLAB_URL the same origin is only probed: no answer there means no service. */
const PROBE_PAUSE = 5 * 60_000;

let host: CollabHost | null = null;
let user = { name: "" };
let halted = false; // 4401: the account's session ended; nothing reconnects until the window is focused again
let unavailableUntil = 0;
let everOpened = false;
const sessions = new Map<string, Session>();
const listeners = new Map<string, Set<() => void>>();

function baseUrl(): string | null {
  if (typeof window === "undefined") return null;
  return collabUrl(process.env.NEXT_PUBLIC_COLLAB_URL, window.location);
}
const configured = () => !!process.env.NEXT_PUBLIC_COLLAB_URL?.trim();

function emit(noteId: string) {
  listeners.get(noteId)?.forEach((fn) => fn());
}

class Session {
  snapshot: CollabSnapshot = { state: "connecting", peers: [], sync: "saved" };
  private binders = new Set<Binder>();
  private bound = new Set<Binder>();
  private doc: Y.Doc | null = null;
  private provider: WebsocketProvider | null = null;
  private undo: Y.UndoManager | null = null;
  private live = false;
  /**
   * Shared text the service is known to hold: advanced only when it acknowledges this device's
   * edits (its echo of our awareness `ack`), or by its own updates while no local edit is
   * unacknowledged. Never includes a local edit the service may not have received.
   */
  private confirmed: string | undefined;
  /** Local edits so far on this connection, and how many of them the service has acknowledged. */
  private epoch = 0;
  private ackedEpoch = 0;
  private seq = 0;
  /** Text and local-edit count at each acknowledgement request still waiting for its echo. */
  private sent = new Map<number, { text: string; epoch: number }>();
  private ackTimer: ReturnType<typeof setTimeout> | undefined;
  /** The service reports database writes (it answered `[7]`). */
  private persistReports = false;
  /** Local edits the service has written to the database, and the edit count at each request. */
  private persistedEpoch = 0;
  private persistAt = new Map<number, number>();
  private failures = 0;
  private stopped = false; // 4404 or 4413: this note does not go live again on this page
  private retry: ReturnType<typeof setTimeout> | undefined;
  private syncTimer: ReturnType<typeof setTimeout> | undefined;
  private lingerTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(readonly noteId: string) {}

  get text(): Y.Text | null {
    return this.doc?.getText("content") ?? null;
  }

  private set(state: CollabState, peers: readonly Peer[] = this.snapshot.peers, sync: CollabSync = this.syncState()) {
    if (state === this.snapshot.state && peers === this.snapshot.peers && sync === this.snapshot.sync) return;
    this.snapshot = { state, peers, sync };
    emit(this.noteId);
  }

  private syncState(): CollabSync {
    if (this.persistReports) return this.persistedEpoch >= this.epoch ? "saved" : "syncing";
    return this.ackedEpoch >= this.epoch ? "synced" : "syncing";
  }

  /** Re-read where the edits are; emits only when the label would change. */
  private resync() {
    this.set(this.snapshot.state);
  }

  add(binder: Binder) {
    clearTimeout(this.lingerTimer);
    this.binders.add(binder);
    if (this.live && this.text && this.provider && this.undo) {
      binder.bind(this.text, this.provider.awareness, this.undo);
      this.bound.add(binder);
    } else if (!this.provider && !this.retry) this.connect();
  }

  remove(binder: Binder) {
    this.binders.delete(binder);
    if (this.bound.delete(binder)) binder.unbind();
    if (this.binders.size) return;
    // Remounts (a new revision, the properties form) come straight back: keep the socket a moment.
    clearTimeout(this.lingerTimer);
    this.lingerTimer = setTimeout(() => {
      if (!this.binders.size) this.dispose("graceful");
    }, LINGER);
  }

  /** The store's newest text while live (reading-view task toggles, the properties form). */
  write(content: string) {
    const text = this.text;
    if (!this.live || !text || !this.doc) return;
    const current = text.toString();
    if (current === content) return;
    this.doc.transact(() => {
      for (const s of diff(current, content)) {
        if (s.remove) text.delete(s.index, s.remove);
        if (s.insert) text.insert(s.index, s.insert);
      }
    }, ORIGIN_STORE);
  }

  connect() {
    clearTimeout(this.retry);
    this.retry = undefined;
    if (this.provider || this.stopped || halted || !host) return;
    const url = baseUrl();
    if (!url || (!configured() && Date.now() < unavailableUntil) || (typeof navigator !== "undefined" && !navigator.onLine)) {
      this.set("off");
      if (url && !this.stopped) this.schedule();
      return;
    }
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(url, this.noteId, doc, {
      // Reconnects are this session's (with a fresh document each time), never the provider's own.
      shouldReconnect: () => false,
      // Other tabs stay in step through the service, not a channel that bypasses its checks.
      disableBc: true,
      maxBackoffTime: 30_000,
    });
    this.doc = doc;
    this.provider = provider;
    this.set("connecting", []);
    provider.awareness.setLocalStateField("user", { name: user.name || "Someone", ...presenceColors(presenceSlot(user.name)) });
    provider.awareness.on("change", () => this.readPeers());
    this.confirmed = undefined;
    this.epoch = this.ackedEpoch = this.seq = 0;
    this.sent.clear();
    this.persistReports = false;
    this.persistedEpoch = 0;
    this.persistAt.clear();
    doc.on("update", (_: unknown, origin: unknown) => {
      if (provider !== this.provider) return;
      if (origin !== provider) {
        // Typed here (or seeded, or written by the store): not confirmed until the service says so.
        this.epoch++;
        this.requestAck(provider);
        this.resync();
      } else if (this.epoch === this.ackedEpoch && this.confirmed !== undefined) {
        // From the service, with nothing of ours outstanding: the service holds all of this text.
        this.confirmed = doc.getText("content").toString();
      }
    });
    // Our own awareness comes back from the service: read the acknowledgement before y-websocket applies it.
    const applyAwareness = provider.messageHandlers[MESSAGE_AWARENESS];
    provider.messageHandlers[MESSAGE_AWARENESS] = (encoder, decoder, p, emitSynced, type) => {
      const peek = decoding.clone(decoder);
      const ack = ownAck(decoding.readVarUint8Array(peek), doc.clientID);
      applyAwareness(encoder, decoder, p, emitSynced, type);
      if (ack !== null && provider === this.provider) this.acknowledged(ack);
    };
    // The service reports when our edits are in the database: read `[7, n]`, and ask for it once
    // the socket opens (an older service ignores the request and never sends one).
    provider.messageHandlers[MESSAGE_PERSISTED] = (_encoder, decoder) => {
      const n = decoding.readVarUint(decoder);
      if (provider === this.provider) this.persisted(n);
    };
    provider.on("status", ({ status }: { status: string }) => {
      if (status !== "connected") return;
      everOpened = true;
      const hello = encoding.createEncoder();
      encoding.writeVarUint(hello, MESSAGE_PERSISTED);
      try {
        provider.ws?.send(encoding.toUint8Array(hello));
      } catch {}
    });
    provider.on("sync", (synced: boolean) => {
      if (synced && provider === this.provider) void this.goLive(provider);
    });
    provider.on("connection-close", (event: CloseEvent | null) => {
      if (provider === this.provider) this.closed(event?.code ?? 1006);
    });
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      if (provider === this.provider && !this.live) this.closed(1006);
    }, SYNC_TIMEOUT);
  }

  private async goLive(provider: WebsocketProvider) {
    clearTimeout(this.syncTimer);
    const h = host;
    if (!h) return;
    if (hasQueuedEdits(this.noteId)) {
      // Edits made offline wait in the outbox. The store counts them as saved (their text is its save
      // base), so seeding the shared document from them would see nothing new and drop them. They go
      // through REST first, the service merges that write, and the note goes live on the next try.
      this.teardown();
      this.set("off", []);
      this.schedule();
      return;
    }
    const start = await h.enter(this.noteId);
    const text = this.text;
    if (provider !== this.provider || !text || !this.doc) {
      // Closed while the store finished a save: the text it handed over goes back to REST.
      if (start) h.leave(this.noteId, start.local ?? "", "dropped");
      return;
    }
    if (!start) {
      // Held by a conflict or a deleted note: stay on REST and look again later.
      this.teardown();
      this.set("off", []);
      this.schedule();
      return;
    }
    this.failures = 0;
    const doc = text.toString();
    // Just synced: the service holds exactly this text (local edits so far, if any, were all acknowledged).
    if (this.epoch === this.ackedEpoch) this.confirmed = doc;
    const local = start.local ?? doc;
    const splices = seedSplices(start.server, doc, local);
    if (splices.length)
      this.doc.transact(() => {
        for (const s of splices) {
          if (s.remove) text.delete(s.index, s.remove);
          if (s.insert) text.insert(s.index, s.insert);
        }
      }, ORIGIN_SEED);
    this.undo = new Y.UndoManager(text);
    this.live = true;
    for (const b of this.binders) {
      b.bind(text, provider.awareness, this.undo);
      this.bound.add(b);
    }
    this.set("live");
    this.readPeers();
  }

  /**
   * Ask the service to acknowledge the local edits so far: put a new number in our awareness state
   * and remember the text it stands for. y-websocket sends document updates the moment they happen,
   * on the same socket and before this awareness frame, so its echo covers all of them.
   */
  private requestAck(provider: WebsocketProvider) {
    if (this.ackTimer !== undefined) return;
    this.ackTimer = setTimeout(() => {
      this.ackTimer = undefined;
      const text = this.text;
      if (provider !== this.provider || !text) return;
      const n = ++this.seq;
      this.sent.set(n, { text: text.toString(), epoch: this.epoch });
      if (this.sent.size > ACK_KEEP) this.sent.delete(this.sent.keys().next().value!);
      this.persistAt.set(n, this.epoch);
      if (this.persistAt.size > PERSIST_KEEP) this.persistAt.delete(this.persistAt.keys().next().value!);
      provider.awareness.setLocalStateField("ack", n);
    }, ACK_DELAY);
  }

  /** The service echoed acknowledgement `n`: it holds the text recorded for it. */
  private acknowledged(n: number) {
    const at = this.sent.get(n);
    if (!at) return;
    for (const k of this.sent.keys()) if (k <= n) this.sent.delete(k);
    this.ackedEpoch = at.epoch;
    // No local edit since: whatever else arrived meanwhile came from the service too.
    this.confirmed = this.epoch === at.epoch ? (this.text?.toString() ?? at.text) : at.text;
    this.resync();
  }

  /** The service wrote this device's edits up to acknowledgement `n` to the database (0: it reports writes). */
  private persisted(n: number) {
    this.persistReports = true;
    let epoch = this.persistedEpoch;
    for (const [k, e] of this.persistAt) {
      if (k > n) continue;
      epoch = Math.max(epoch, e);
      this.persistAt.delete(k);
    }
    this.persistedEpoch = epoch;
    this.resync();
  }

  private readPeers() {
    const provider = this.provider;
    if (!provider) return;
    const self = provider.doc.clientID;
    const peers: Peer[] = [];
    provider.awareness.getStates().forEach((state, clientId) => {
      const u = (state as { user?: { name?: unknown; color?: unknown } }).user;
      if (!u) return;
      peers.push({
        clientId,
        name: typeof u.name === "string" && u.name.trim() ? u.name.slice(0, 80) : "Someone",
        color: safeColor(u.color),
        self: clientId === self,
      });
    });
    peers.sort((a, b) => Number(b.self) - Number(a.self) || a.clientId - b.clientId);
    const prev = this.snapshot.peers;
    const same = prev.length === peers.length && prev.every((p, i) => p.clientId === peers[i].clientId && p.name === peers[i].name && p.color === peers[i].color);
    if (!same) this.set(this.snapshot.state, peers);
  }

  /** The socket closed (or never synced): back to REST, then act on the close code. */
  closed(code: number) {
    const action = closeAction(code);
    const wasLive = this.live;
    const text = this.text?.toString() ?? "";
    const confirmed = this.confirmed;
    this.teardown();
    if (!everOpened && !configured()) unavailableUntil = Date.now() + PROBE_PAUSE;
    if (wasLive && host) host.leave(this.noteId, text, action === "reconnect" ? "dropped" : action, confirmed);
    if (action === "too-large") host?.notify("This note is too large to edit live, over 5 MiB. Changes save the usual way.");
    if (action === "signed-out") halted = true;
    if (action === "deleted" || action === "too-large") this.stopped = true;
    this.set("off", []);
    if (action === "reconnect") this.schedule();
  }

  private schedule() {
    if (this.stopped || halted || this.retry || !this.binders.size) return;
    const wait = !configured() && Date.now() < unavailableUntil ? unavailableUntil - Date.now() : backoff(++this.failures);
    this.retry = setTimeout(() => {
      this.retry = undefined;
      this.connect();
    }, wait);
  }

  /** Online again or back in the window: try now instead of waiting out the backoff. */
  wake() {
    if (this.provider || this.stopped || halted || !this.binders.size) return;
    this.failures = 0;
    this.connect();
  }

  /** Drop the socket and the document; editors fall back to plain CodeMirror. */
  private teardown() {
    clearTimeout(this.syncTimer);
    clearTimeout(this.ackTimer);
    this.ackTimer = undefined;
    this.sent.clear();
    this.persistAt.clear();
    for (const b of this.bound) b.unbind();
    this.bound.clear();
    this.live = false;
    this.confirmed = undefined;
    const provider = this.provider;
    this.provider = null;
    this.undo?.destroy();
    this.undo = null;
    if (provider) {
      provider.awareness.setLocalState(null);
      provider.destroy();
    }
    this.doc?.destroy();
    this.doc = null;
  }

  /** Close for good: the last editor went away, or the user signed out. */
  dispose(reason: "graceful" | "signed-out") {
    clearTimeout(this.retry);
    clearTimeout(this.lingerTimer);
    this.retry = undefined;
    const wasLive = this.live;
    const text = this.text?.toString() ?? "";
    this.teardown();
    sessions.delete(this.noteId);
    if (wasLive && reason === "graceful") host?.leave(this.noteId, text, "graceful");
    this.snapshot = OFF;
    emit(this.noteId);
  }

  goOffline() {
    // The browser knows before the socket does: fall back at once.
    if (this.provider) this.closed(1006);
  }
}

/* ---------------- registry ---------------- */

export function setCollabHost(next: CollabHost | null, who?: { name: string }) {
  host = next;
  if (who) user = { name: who.name };
}

/** An editor for `noteId` mounted. Returns the release function. */
export function attachEditor(noteId: string, binder: Binder): () => void {
  if (!host || !baseUrl()) return () => {};
  let s = sessions.get(noteId);
  if (!s) {
    s = new Session(noteId);
    sessions.set(noteId, s);
  }
  const session = s;
  session.add(binder);
  emit(noteId);
  return () => session.remove(binder);
}

/** Store edits for a live note go into the shared document (the server saves it). */
export function writeLive(noteId: string, content: string) {
  sessions.get(noteId)?.write(content);
}

export function isLive(noteId: string) {
  return sessions.get(noteId)?.snapshot.state === "live";
}

export function collabSnapshot(noteId: string | undefined): CollabSnapshot {
  return (noteId && sessions.get(noteId)?.snapshot) || OFF;
}

export function subscribeCollab(noteId: string | undefined, fn: () => void): () => void {
  if (!noteId) return () => {};
  let set = listeners.get(noteId);
  if (!set) {
    set = new Set();
    listeners.set(noteId, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
    if (!set.size) listeners.delete(noteId);
  };
}

/** Sign-out: close every socket and forget every document, without handing text back to REST. */
export function closeAllCollab() {
  for (const s of [...sessions.values()]) s.dispose("signed-out");
  halted = false;
  unavailableUntil = 0;
  everOpened = false;
}

if (typeof window !== "undefined") {
  window.addEventListener("offline", () => sessions.forEach((s) => s.goOffline()));
  window.addEventListener("online", () => sessions.forEach((s) => s.wake()));
  // Back from signing in on another tab: one fresh try.
  window.addEventListener("focus", () => {
    if (!halted) return;
    halted = false;
    sessions.forEach((s) => s.wake());
  });
}
