import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import WebSocket from "ws";
import * as Y from "yjs";
import * as decoding from "lib0/decoding";
import { WebsocketProvider } from "y-websocket";
import { db } from "@/db";
import { noteYdoc, session, user, vault } from "@/db/schema";
import { createNote, deleteNote, updateContent } from "@/lib/notes";
import { signCookieValue } from "../../collab/src/auth";
import type { CollabConfig } from "../../collab/src/config";
import { startCollabServer, type CollabServer } from "../../collab/src/server";
import { describeDb, linksOf, noteRow, tagsOf } from "./fixtures";

const ORIGIN = "http://localhost:3096";
const SECRET = randomBytes(32).toString("base64");

function config(overrides: Partial<CollabConfig> = {}): CollabConfig {
  return {
    port: 0,
    host: "127.0.0.1",
    secret: SECRET,
    origins: [ORIGIN],
    cookieName: "better-auth.session_token",
    maxConnections: 100,
    maxConnectionsPerUser: 10,
    maxMessageBytes: 6 * 1024 * 1024,
    idleTimeoutMs: 60_000,
    heartbeatMs: 30_000,
    sessionCheckMs: 60_000,
    persistDebounceMs: 50,
    persistMaxWaitMs: 200,
    ...overrides,
  };
}

/** Polls `check` until it stops throwing (expect inside), or fails after `ms`. */
async function until(check: () => unknown | Promise<unknown>, ms = 5_000) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      await check();
      return;
    } catch (err) {
      if (Date.now() > end) throw err;
      await new Promise((r) => setTimeout(r, 25));
    }
  }
}

type Account = { userId: string; vaultId: string; cookie: string; token: string };

async function account(name: string): Promise<Account> {
  const userId = `vitest-collab-${randomUUID()}`;
  await db.insert(user).values({ id: userId, name, email: `${userId}@example.test` });
  const [v] = await db.insert(vault).values({ ownerId: userId, name: "Vault" }).returning({ id: vault.id });
  const token = randomBytes(24).toString("hex");
  await db.insert(session).values({
    id: randomUUID(),
    token,
    userId,
    expiresAt: new Date(Date.now() + 3_600_000),
    updatedAt: new Date(),
  });
  return { userId, vaultId: v.id, token, cookie: `better-auth.session_token=${signCookieValue(token, SECRET)}` };
}

/** A ws client class that sends the given handshake headers (what a browser adds by itself). */
function socketWith(headers: Record<string, string>) {
  return class extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols, { headers });
    }
  };
}

const providers: WebsocketProvider[] = [];

function client(srv: CollabServer, noteId: string, cookie: string, doc = new Y.Doc()) {
  const provider = new WebsocketProvider(`ws://127.0.0.1:${srv.port}/collab`, noteId, doc, {
    WebSocketPolyfill: socketWith({ cookie, origin: ORIGIN }) as unknown as typeof globalThis.WebSocket,
    disableBc: true,
    maxBackoffTime: 200,
  });
  providers.push(provider);
  return { doc, text: doc.getText("content"), provider };
}

async function synced(p: WebsocketProvider) {
  await until(() => expect(p.synced).toBe(true));
}

/** Status of a refused handshake (the server answers with HTTP, no socket). */
function handshakeStatus(srv: CollabServer, path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}${path}`, { headers });
    ws.on("unexpected-response", (_req, res) => {
      resolve(res.statusCode ?? 0);
      ws.terminate();
    });
    ws.on("open", () => {
      ws.close();
      resolve(101);
    });
    ws.on("error", (err) => {
      if (!/Unexpected server response/.test(String(err))) reject(err);
    });
  });
}

describeDb("collab server", () => {
  let srv: CollabServer;
  let alice: Account;
  let bob: Account;

  beforeAll(async () => {
    alice = await account("Alice");
    bob = await account("Bob");
    srv = await startCollabServer(config());
  });

  afterEach(async () => {
    for (const p of providers.splice(0)) p.destroy();
    await until(() => expect(srv.rooms.size).toBe(0));
  });

  afterAll(async () => {
    await srv?.close();
    for (const a of [alice, bob]) if (a) await db.delete(user).where(eq(user.id, a.userId));
  });

  it("keeps two clients of the same note in step, with cursors", async () => {
    const n = await createNote(alice.vaultId, "Collab/Converge", "Start");
    const a = client(srv, n.id, alice.cookie);
    const b = client(srv, n.id, alice.cookie);
    await Promise.all([synced(a.provider), synced(b.provider)]);
    expect(a.text.toString()).toBe("Start");
    expect(b.text.toString()).toBe("Start");

    a.text.insert(0, "Hello. ");
    b.text.insert(b.text.length, " and end");
    await until(() => {
      expect(a.text.toString()).toBe("Hello. Start and end");
      expect(b.text.toString()).toBe("Hello. Start and end");
    });

    // Awareness: the name comes from the session, whatever the client claims.
    a.provider.awareness.setLocalStateField("user", { name: "Mallory", color: "#0297DE" });
    await until(() => {
      const state = b.provider.awareness.getStates().get(a.doc.clientID) as { user?: { name: string; color: string } };
      expect(state?.user).toEqual({ name: "Alice", color: "#0297DE" });
    });
  });

  it("refuses sockets without a valid session, from another origin, or for someone else's note", async () => {
    const n = await createNote(alice.vaultId, "Collab/Private", "secret");
    const path = `/collab?note=${n.id}`;
    expect(await handshakeStatus(srv, path, { origin: ORIGIN })).toBe(401);
    expect(await handshakeStatus(srv, path, { origin: ORIGIN, cookie: `better-auth.session_token=${alice.token}.${"A".repeat(43)}=` })).toBe(401);
    expect(await handshakeStatus(srv, path, { origin: "https://evil.example", cookie: alice.cookie })).toBe(403);
    expect(await handshakeStatus(srv, path, { cookie: alice.cookie })).toBe(403);
    expect(await handshakeStatus(srv, path, { origin: ORIGIN, cookie: bob.cookie })).toBe(404);
    expect(await handshakeStatus(srv, `/collab?note=${randomUUID()}`, { origin: ORIGIN, cookie: alice.cookie })).toBe(404);
    expect(await handshakeStatus(srv, "/collab?note=not-a-uuid", { origin: ORIGIN, cookie: alice.cookie })).toBe(400);
    expect(await handshakeStatus(srv, `/collab/${n.id}`, { origin: ORIGIN, cookie: alice.cookie })).toBe(101);

    // An expired session is refused even with a correctly signed cookie.
    await db.update(session).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(session.token, bob.token));
    const bobNote = await createNote(bob.vaultId, "Mine", "");
    expect(await handshakeStatus(srv, `/collab?note=${bobNote.id}`, { origin: ORIGIN, cookie: bob.cookie })).toBe(401);
    await db.update(session).set({ expiresAt: new Date(Date.now() + 3_600_000) }).where(eq(session.token, bob.token));
  });

  it("caps sockets per user", async () => {
    const capped = await startCollabServer(config({ maxConnectionsPerUser: 1 }));
    try {
      const n = await createNote(alice.vaultId, "Collab/Capped", "");
      const ws = new WebSocket(`ws://127.0.0.1:${capped.port}/collab?note=${n.id}`, { headers: { origin: ORIGIN, cookie: alice.cookie } });
      await new Promise((r) => ws.once("open", r));
      expect(await handshakeStatus(capped, `/collab?note=${n.id}`, { origin: ORIGIN, cookie: alice.cookie })).toBe(429);
      ws.close();
    } finally {
      await capped.close();
    }
  });

  it("closes a socket that sends a frame over the size cap", async () => {
    const small = await startCollabServer(config({ maxMessageBytes: 1024 }));
    try {
      const n = await createNote(alice.vaultId, "Collab/Small", "");
      const ws = new WebSocket(`ws://127.0.0.1:${small.port}/collab?note=${n.id}`, { headers: { origin: ORIGIN, cookie: alice.cookie } });
      await new Promise((r) => ws.once("open", r));
      const code = await new Promise<number>((resolve) => {
        ws.once("close", (c) => resolve(c));
        ws.send(new Uint8Array(4096));
      });
      expect(code).toBe(1009);
    } finally {
      await small.close();
    }
  });

  it("saves edits through the PATCH path and resumes the same history after a restart", async () => {
    const n = await createNote(alice.vaultId, "Collab/Persist", "# Persist\n");
    await createNote(alice.vaultId, "Other", "");
    const a = client(srv, n.id, alice.cookie);
    await synced(a.provider);
    a.text.insert(a.text.length, "See [[Other]] #shared\n");
    // Saved within the debounce, with links and tags indexed like a REST save.
    await until(async () => expect((await noteRow(alice.vaultId, n.id)).content).toBe("# Persist\nSee [[Other]] #shared\n"));
    expect(await linksOf(n.id)).toEqual([{ target: "other", embed: false }]);
    expect(await tagsOf(n.id)).toEqual(["shared"]);
    const [state] = await db.select().from(noteYdoc).where(eq(noteYdoc.noteId, n.id));
    expect(state?.state.byteLength).toBeGreaterThan(0);

    // A client that keeps its document across a server restart reconnects without duplicating text.
    const keptDoc = a.doc;
    a.provider.destroy();
    providers.splice(providers.indexOf(a.provider), 1);
    await until(() => expect(srv.rooms.size).toBe(0));
    await srv.close();
    srv = await startCollabServer(config());

    keptDoc.getText("content").insert(0, "Offline line\n");
    const back = client(srv, n.id, alice.cookie, keptDoc);
    const fresh = client(srv, n.id, alice.cookie);
    await Promise.all([synced(back.provider), synced(fresh.provider)]);
    const expected = "Offline line\n# Persist\nSee [[Other]] #shared\n";
    await until(() => {
      expect(back.text.toString()).toBe(expected);
      expect(fresh.text.toString()).toBe(expected);
    });
    await until(async () => expect((await noteRow(alice.vaultId, n.id)).content).toBe(expected));
  });

  it("merges a REST write into the live document, keeping unsaved local edits", async () => {
    const slow = await startCollabServer(config({ persistDebounceMs: 1_000, persistMaxWaitMs: 1_000 }));
    try {
      const n = await createNote(alice.vaultId, "Collab/Rest", "alpha\nbeta\ngamma\n");
      const a = client(slow, n.id, alice.cookie);
      await synced(a.provider);

      // Plain REST save while nobody has typed: shows up live.
      await updateContent(alice.vaultId, n.id, "ALPHA\nbeta\ngamma\n");
      await until(() => expect(a.text.toString()).toBe("ALPHA\nbeta\ngamma\n"));

      // A local edit not yet saved (debounce 1 s) and a REST write elsewhere in the note: both kept.
      a.text.insert(a.text.length, "delta\n");
      await new Promise((r) => setTimeout(r, 50));
      await updateContent(alice.vaultId, n.id, "ALPHA\nBETA\ngamma\n");
      const merged = "ALPHA\nBETA\ngamma\ndelta\n";
      await until(() => expect(a.text.toString()).toBe(merged));
      await until(async () => expect((await noteRow(alice.vaultId, n.id)).content).toBe(merged));

      // Deleting the note closes the room's sockets with 4404.
      const closed = new Promise<number>((resolve) => a.provider.ws?.addEventListener("close", (e) => resolve(e.code)));
      a.provider.shouldConnect = false;
      await deleteNote(alice.vaultId, n.id);
      expect(await closed).toBe(4404);
    } finally {
      for (const p of providers.splice(0)) p.destroy();
      await slow.close();
    }
  });

  it("acknowledges an edit as persisted only after the database write, and only to clients that ask", async () => {
    const slow = await startCollabServer(config({ persistDebounceMs: 400, persistMaxWaitMs: 400 }));
    try {
      const n = await createNote(alice.vaultId, "Collab/Ack", "one\n");
      const a = client(slow, n.id, alice.cookie);
      const old = client(slow, n.id, alice.cookie);
      const got: number[] = [];
      let rowAtAck: string | null = null;
      a.provider.messageHandlers[7] = (_e, decoder) => {
        const v = decoding.readVarUint(decoder);
        got.push(v);
        if (v === 1) void noteRow(alice.vaultId, n.id).then((r) => (rowAtAck = r.content));
      };
      // A client that never asks must never see the new message type (y-websocket would log an error).
      let oldSaw = 0;
      old.provider.messageHandlers[7] = () => void oldSaw++;
      await Promise.all([synced(a.provider), synced(old.provider)]);
      a.provider.ws!.send(new Uint8Array([7]));
      await until(() => expect(got).toEqual([0]));

      a.text.insert(a.text.length, "two\n");
      a.provider.awareness.setLocalStateField("ack", 1);
      // Received at once, but not written yet: no acknowledgement during the debounce.
      await new Promise((r) => setTimeout(r, 150));
      expect(got).toEqual([0]);
      await until(() => expect(got).toEqual([0, 1]));
      await until(() => expect(rowAtAck).toBe("one\ntwo\n"));

      // Asking again with nothing new to write is answered straight away.
      a.provider.awareness.setLocalStateField("ack", 2);
      await until(() => expect(got).toEqual([0, 1, 2]));
      old.text.insert(0, "zero\n");
      old.provider.awareness.setLocalStateField("ack", 1);
      await until(async () => expect((await noteRow(alice.vaultId, n.id)).content).toBe("zero\none\ntwo\n"));
      await new Promise((r) => setTimeout(r, 100));
      expect(oldSaw).toBe(0);
    } finally {
      for (const p of providers.splice(0)) p.destroy();
      await slow.close();
    }
  });
});
