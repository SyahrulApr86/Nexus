/**
 * One live note: its Y.Doc, the awareness of the people editing it, the sockets attached to it,
 * and writing it back to the database.
 */
import type { WebSocket } from "ws";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { LIMITS, updateContent } from "@/lib/notes";
import { HttpError, logError } from "@/lib/session";
import { diff, mergeIncoming, type Splice } from "./merge";
import { readNote, readState, writeState, type NoteRow } from "./store";

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;

/** Close codes the client can act on (4000-4999 are free for applications). */
export const CLOSE = {
  unauthorized: 4401,
  notFound: 4404,
  idle: 4408,
  tooLarge: 4413,
  shutdown: 1001,
  badMessage: 1003,
} as const;

/** The shared text every client binds its editor to (y-codemirror.next). */
export const TEXT_NAME = "content";

/** Transaction origins of changes that do not come from a socket. */
const ORIGIN_LOAD = "nexus:load";
const ORIGIN_DATABASE = "nexus:database";

export type Peer = {
  ws: WebSocket;
  /** Display name from the session; overrides whatever name the client puts in its awareness. */
  name: string;
  /** Awareness client ids this socket controls, removed when it closes. */
  clients: Set<number>;
};

export type RoomOptions = { persistDebounceMs: number; persistMaxWaitMs: number };

function send(ws: WebSocket, message: Uint8Array) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(message, (err) => {
    if (err) ws.terminate();
  });
}

function applySplices(text: Y.Text, splices: Splice[]) {
  for (const s of splices) {
    if (s.remove) text.delete(s.index, s.remove);
    if (s.insert) text.insert(s.index, s.insert);
  }
}

const bytes = (s: string) => Buffer.byteLength(s, "utf8");

export class Room {
  readonly doc = new Y.Doc();
  readonly text = this.doc.getText(TEXT_NAME);
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  readonly peers = new Map<WebSocket, Peer>();

  /** note.content as last read or written by this room: the merge base for database writes. */
  private base = "";
  /** note.updatedAt that goes with `base`; a save against any other one is refused with 409. */
  private baseUpdatedAt: Date | undefined;
  private dirty = false;
  private firstDirtyAt = 0;
  private timer: NodeJS.Timeout | undefined;
  /** Saves and database merges run one at a time, in order. */
  private queue: Promise<void> = Promise.resolve();
  private closing: Promise<void> | undefined;
  /** Set when the note is gone: nothing is saved any more. */
  private dead = false;

  private constructor(
    readonly noteId: string,
    readonly vaultId: string,
    private readonly options: RoomOptions,
  ) {
    // The server is not an editor: it has no awareness state of its own.
    this.awareness.setLocalState(null);
    this.doc.on("update", (update: Uint8Array, origin: unknown) => this.onUpdate(update, origin));
    this.awareness.on(
      "update",
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        const peer = origin && typeof origin === "object" ? this.peers.get(origin as WebSocket) : undefined;
        if (peer) {
          for (const id of [...added, ...updated]) peer.clients.add(id);
          for (const id of removed) peer.clients.delete(id);
        }
        const changed = [...added, ...updated, ...removed];
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
        this.broadcast(encoding.toUint8Array(encoder));
      },
    );
  }

  /**
   * Builds the document from the stored Yjs state, then makes its text equal note.content (the
   * source of truth: a REST write while nobody was connected, or a crash between the two writes).
   * The first load seeds the text and stores the state at once, so every later load and every
   * client continue the same history instead of merging an unrelated copy.
   */
  static async load(noteId: string, vaultId: string, options: RoomOptions): Promise<Room | null> {
    const [row, state] = await Promise.all([readNote(noteId), readState(noteId)]);
    if (!row) return null;
    const room = new Room(noteId, vaultId, options);
    if (state) Y.applyUpdate(room.doc, state, ORIGIN_LOAD);
    const splices = diff(room.text.toString(), row.content);
    if (splices.length) room.doc.transact(() => applySplices(room.text, splices), ORIGIN_LOAD);
    room.base = row.content;
    room.baseUpdatedAt = row.updatedAt;
    if (!state || splices.length) await writeState(noteId, Y.encodeStateAsUpdate(room.doc));
    return room;
  }

  get isClosing() {
    return this.closing !== undefined;
  }

  /* ---------------------------------------------------------------- */
  /* Sockets                                                          */
  /* ---------------------------------------------------------------- */

  /** Attaches a socket and starts the sync: server step 1, then the current awareness. */
  join(peer: Peer) {
    this.peers.set(peer.ws, peer);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    send(peer.ws, encoding.toUint8Array(encoder));
    const states = [...this.awareness.getStates().keys()];
    if (states.length) {
      const aw = encoding.createEncoder();
      encoding.writeVarUint(aw, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(aw, awarenessProtocol.encodeAwarenessUpdate(this.awareness, states));
      send(peer.ws, encoding.toUint8Array(aw));
    }
  }

  /** Detaches a socket and drops its cursors. Returns true when the room is now empty. */
  leave(ws: WebSocket): boolean {
    const peer = this.peers.get(ws);
    if (!peer) return this.peers.size === 0;
    this.peers.delete(ws);
    if (peer.clients.size) awarenessProtocol.removeAwarenessStates(this.awareness, [...peer.clients], null);
    return this.peers.size === 0;
  }

  /** Handles one binary frame. Throws on a malformed one; the caller closes that socket. */
  receive(ws: WebSocket, data: Uint8Array) {
    const peer = this.peers.get(ws);
    if (!peer) return;
    const decoder = decoding.createDecoder(data);
    const type = decoding.readVarUint(decoder);
    if (type === MESSAGE_SYNC) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      const sub = decoding.readVarUint(decoder);
      if (sub === syncProtocol.messageYjsSyncStep1) {
        syncProtocol.readSyncStep1(decoder, encoder, this.doc);
      } else if (sub === syncProtocol.messageYjsSyncStep2 || sub === syncProtocol.messageYjsUpdate) {
        this.applyClientUpdate(peer, decoding.readVarUint8Array(decoder));
      } else {
        throw new Error("Unknown sync message");
      }
      if (encoding.length(encoder) > 1) send(ws, encoding.toUint8Array(encoder));
    } else if (type === MESSAGE_AWARENESS) {
      const update = decoding.readVarUint8Array(decoder);
      awarenessProtocol.applyAwarenessUpdate(this.awareness, this.withPeerName(update, peer.name), ws);
    }
    // Other message types (auth, query-awareness) are ignored, as y-websocket's server does.
  }

  /** Closes every socket, e.g. when the note was deleted or the server shuts down. */
  closeAll(code: number, reason: string) {
    for (const ws of this.peers.keys()) ws.close(code, reason);
  }

  private broadcast(message: Uint8Array, except?: WebSocket) {
    for (const ws of this.peers.keys()) if (ws !== except) send(ws, message);
  }

  /** The awareness `user.name` is the session's name, so nobody can show up as someone else. */
  private withPeerName(update: Uint8Array, name: string) {
    return awarenessProtocol.modifyAwarenessUpdate(update, (state: unknown) => {
      if (!state || typeof state !== "object") return state;
      const s = state as { user?: unknown };
      const u = s.user && typeof s.user === "object" ? (s.user as Record<string, unknown>) : {};
      return { ...s, user: { ...u, name } };
    });
  }

  /**
   * Applies an update from a client unless it would grow the note past LIMITS.noteBytes. Near the
   * limit the update is tried on a copy first, so a refused one never reaches the document.
   */
  private applyClientUpdate(peer: Peer, update: Uint8Array) {
    if (bytes(this.text.toString()) + update.byteLength > LIMITS.noteBytes) {
      const probe = new Y.Doc({ gc: true });
      Y.applyUpdate(probe, Y.encodeStateAsUpdate(this.doc));
      Y.applyUpdate(probe, update);
      const size = bytes(probe.getText(TEXT_NAME).toString());
      probe.destroy();
      if (size > LIMITS.noteBytes) {
        peer.ws.close(CLOSE.tooLarge, "Note is too large");
        return;
      }
    }
    Y.applyUpdate(this.doc, update, peer.ws);
  }

  /* ---------------------------------------------------------------- */
  /* Persistence                                                      */
  /* ---------------------------------------------------------------- */

  private onUpdate(update: Uint8Array, origin: unknown) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const sender = origin && typeof origin === "object" && this.peers.has(origin as WebSocket) ? (origin as WebSocket) : undefined;
    this.broadcast(encoding.toUint8Array(encoder), sender);
    if (origin === ORIGIN_LOAD) return;
    this.schedule();
  }

  /** Debounced save: `persistDebounceMs` after the last edit, at most `persistMaxWaitMs` after the first. */
  private schedule() {
    if (this.dead) return;
    const now = Date.now();
    if (!this.dirty) {
      this.dirty = true;
      this.firstDirtyAt = now;
    }
    clearTimeout(this.timer);
    const wait = Math.min(this.options.persistDebounceMs, Math.max(0, this.firstDirtyAt + this.options.persistMaxWaitMs - now));
    this.timer = setTimeout(() => void this.flush(), wait);
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task, task);
    this.queue = run.catch((err) => logError("collab", err));
    return this.queue;
  }

  /** Writes pending edits now. Resolves once they are stored (or failed and were logged). */
  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    return this.enqueue(() => this.persist());
  }

  private async persist(attempt = 0): Promise<void> {
    if (!this.dirty || this.dead) return;
    this.dirty = false;
    const content = this.text.toString();
    if (content !== this.base) {
      try {
        // The PATCH path, guarded by the same optimistic check a REST client uses.
        const saved = await updateContent(this.vaultId, this.noteId, content, "autosave", this.baseUpdatedAt);
        this.base = content;
        this.baseUpdatedAt = saved.updatedAt;
      } catch (err) {
        if (err instanceof HttpError && err.status === 409 && attempt < 3) {
          // A REST write landed first: merge it in, then save the result against its updatedAt.
          const current = (err.body?.note ?? null) as NoteRow | null;
          if (current) this.mergeDatabase(current);
          this.dirty = true;
          return this.persist(attempt + 1);
        }
        if (err instanceof HttpError && err.status === 404) return this.gone();
        // Quota and other refusals keep the edits in memory and retry on the next change.
        this.dirty = true;
        throw err;
      }
    }
    await writeState(this.noteId, Y.encodeStateAsUpdate(this.doc));
  }

  /** Brings a database write into the live text (see mergeIncoming). */
  private mergeDatabase(row: NoteRow) {
    const splices = mergeIncoming(this.base, this.text.toString(), row.content);
    this.base = row.content;
    this.baseUpdatedAt = row.updatedAt;
    if (splices.length) this.doc.transact(() => applySplices(this.text, splices), ORIGIN_DATABASE);
  }

  /** note.content changed or the note was deleted (NOTIFY from the database trigger). */
  databaseChanged(): Promise<void> {
    return this.enqueue(async () => {
      if (this.dead) return;
      const row = await readNote(this.noteId);
      if (!row) return this.gone();
      // Our own save notifies too: then the row is exactly what we wrote and nothing happens.
      if (row.content !== this.base) this.mergeDatabase(row);
      else this.baseUpdatedAt = row.updatedAt;
    });
  }

  private gone() {
    this.dead = true;
    this.dirty = false;
    clearTimeout(this.timer);
    this.closeAll(CLOSE.notFound, "Note deleted");
  }

  /** Saves what is pending and frees the document. Idempotent. */
  close(): Promise<void> {
    this.closing ??= (async () => {
      await this.flush();
      this.awareness.destroy();
      this.doc.destroy();
    })();
    return this.closing;
  }
}
