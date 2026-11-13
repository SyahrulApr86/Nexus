/**
 * The collaboration service: an HTTP server that answers /healthz and upgrades /collab to a
 * WebSocket speaking the Yjs sync and awareness protocols (y-protocols), one room per note.
 *
 *   GET /collab?note=<uuid>   or   GET /collab/<uuid>   (y-websocket's WebsocketProvider form)
 *
 * Every upgrade is checked before the handshake: Origin, signed session cookie, live session,
 * note access, connection caps. A refused one gets a plain HTTP status and no socket.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { z } from "zod";
import { getDb } from "@/db";
import { logError } from "@/lib/session";
import { liveTokens, noteAccess, parseCookies, sessionByToken, verifySignedCookie } from "./auth";
import type { CollabConfig } from "./config";
import { CLOSE, Room } from "./room";

export const COLLAB_PATH = "/collab";
/** The channel the note trigger in drizzle/0004_note_ydoc.sql notifies, payload = note id. */
export const NOTE_CHANNEL = "nexus_note_content";

const NoteId = z.uuid();

type Conn = { userId: string; token: string; noteId: string; expiresAt: Date };

export type CollabServer = {
  server: Server;
  port: number;
  /** Live rooms by note id (read-only use: tests and metrics). */
  rooms: ReadonlyMap<string, Room>;
  /** Stops accepting sockets, closes open ones, saves every room. */
  close(): Promise<void>;
};

class Refused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function refuse(socket: Duplex, status: number, message: string) {
  if (!socket.writable) return socket.destroy();
  socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`);
}

/** The note id from `/collab?note=<id>` or `/collab/<id>`, or null for any other path. */
export function noteIdFromUrl(rawUrl: string | undefined): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl ?? "", "http://collab.invalid");
  } catch {
    return null;
  }
  const path = url.pathname.replace(/\/+$/, "");
  let id: string | null = null;
  if (path === COLLAB_PATH) id = url.searchParams.get("note");
  else if (path.startsWith(`${COLLAB_PATH}/`)) id = decodeURIComponent(path.slice(COLLAB_PATH.length + 1));
  if (id === null) return null;
  const parsed = NoteId.safeParse(id);
  return parsed.success ? parsed.data.toLowerCase() : "";
}

export async function startCollabServer(config: CollabConfig): Promise<CollabServer> {
  const rooms = new Map<string, Room>();
  const loading = new Map<string, Promise<Room | null>>();
  const conns = new Map<WebSocket, Conn>();
  const perUser = new Map<string, number>();
  let pending = 0;
  let stopping = false;

  const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxMessageBytes, perMessageDeflate: false });

  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
  });

  /* -------------------------------------------------------------- */
  /* Rooms                                                          */
  /* -------------------------------------------------------------- */

  async function roomFor(noteId: string, vaultId: string): Promise<Room | null> {
    for (;;) {
      const live = rooms.get(noteId);
      if (live && !live.isClosing) return live;
      if (live) await live.close(); // wait for the old copy to save before loading a new one
      const inFlight = loading.get(noteId);
      if (inFlight) {
        await inFlight;
        continue;
      }
      const load = Room.load(noteId, vaultId, config).finally(() => loading.delete(noteId));
      loading.set(noteId, load);
      const room = await load;
      if (room) rooms.set(noteId, room);
      return room;
    }
  }

  async function release(room: Room) {
    await room.close();
    if (rooms.get(room.noteId) === room) rooms.delete(room.noteId);
  }

  /* -------------------------------------------------------------- */
  /* Database notifications (REST writes to a live note)             */
  /* -------------------------------------------------------------- */

  const listener = await getDb().$client.listen(
    NOTE_CHANNEL,
    (noteId) => {
      const room = rooms.get(noteId);
      if (room && !room.isClosing) void room.databaseChanged();
    },
    // Runs on every (re)connect of the listening connection: anything missed while it was down
    // is picked up by re-reading every live note.
    () => {
      for (const room of rooms.values()) if (!room.isClosing) void room.databaseChanged();
    },
  );

  /* -------------------------------------------------------------- */
  /* Upgrade                                                        */
  /* -------------------------------------------------------------- */

  async function admit(req: IncomingMessage): Promise<{ conn: Conn; name: string; vaultId: string }> {
    const noteId = noteIdFromUrl(req.url);
    if (noteId === null) throw new Refused(404, "Not Found");
    // Browsers always send Origin on a WebSocket handshake; a missing or foreign one is refused.
    const origin = req.headers.origin;
    if (!origin || !config.origins.includes(origin)) throw new Refused(403, "Forbidden");
    if (conns.size + pending >= config.maxConnections) throw new Refused(503, "Service Unavailable");
    const raw = parseCookies(req.headers.cookie).get(config.cookieName);
    const token = raw ? verifySignedCookie(raw, config.secret) : null;
    if (!token) throw new Refused(401, "Unauthorized");
    if (!noteId) throw new Refused(400, "Bad Request");
    const user = await sessionByToken(token);
    if (!user) throw new Refused(401, "Unauthorized");
    // Not found and not yours look the same, so note ids of other users cannot be probed.
    const access = await noteAccess(noteId, user.userId);
    if (!access) throw new Refused(404, "Not Found");
    if ((perUser.get(user.userId) ?? 0) >= config.maxConnectionsPerUser) throw new Refused(429, "Too Many Requests");
    return { conn: { userId: user.userId, token, noteId, expiresAt: user.expiresAt }, name: user.name, vaultId: access.vaultId };
  }

  server.on("upgrade", (req, socket, head) => {
    socket.on("error", () => socket.destroy());
    if (stopping) return refuse(socket, 503, "Service Unavailable");
    pending++;
    void (async () => {
      let counted: string | undefined;
      let room: Room | null = null;
      try {
        const { conn, name, vaultId } = await admit(req);
        perUser.set(conn.userId, (perUser.get(conn.userId) ?? 0) + 1);
        counted = conn.userId;
        room = await roomFor(conn.noteId, vaultId);
        if (!room) throw new Refused(404, "Not Found");
        if (socket.destroyed) throw new Refused(499, "Client Closed Request");
        const target = room;
        wss.handleUpgrade(req, socket, head, (ws) => {
          counted = undefined; // the socket's close handler owns the count from here
          attach(ws, target, conn, name);
        });
      } catch (err) {
        if (counted) decrement(counted);
        // Loaded for a socket that never arrived: do not keep it in memory.
        if (room && room.peers.size === 0) void release(room);
        if (err instanceof Refused) refuse(socket, err.status, err.message);
        else {
          logError("collab", err);
          refuse(socket, 500, "Internal Server Error");
        }
      } finally {
        pending--;
      }
    })();
  });

  function decrement(userId: string) {
    const n = (perUser.get(userId) ?? 1) - 1;
    if (n > 0) perUser.set(userId, n);
    else perUser.delete(userId);
  }

  /* -------------------------------------------------------------- */
  /* Sockets                                                        */
  /* -------------------------------------------------------------- */

  function attach(ws: WebSocket, room: Room, conn: Conn, name: string) {
    conns.set(ws, conn);
    let alive = true;
    let idle: NodeJS.Timeout | undefined;
    const touch = () => {
      clearTimeout(idle);
      idle = setTimeout(() => ws.close(CLOSE.idle, "Idle timeout"), config.idleTimeoutMs);
    };
    touch();
    const heartbeat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, config.heartbeatMs);
    // Close when the session runs out (setTimeout holds at most ~24.8 days).
    const expiry = setTimeout(
      () => ws.close(CLOSE.unauthorized, "Session expired"),
      Math.min(Math.max(0, conn.expiresAt.getTime() - Date.now()), 2 ** 31 - 1),
    );

    ws.on("pong", () => (alive = true));
    ws.on("message", (data: RawData, isBinary: boolean) => {
      touch();
      if (!isBinary) return ws.close(CLOSE.badMessage, "Binary frames only");
      try {
        room.receive(ws, toBytes(data));
      } catch {
        ws.close(CLOSE.badMessage, "Malformed message");
      }
    });
    ws.on("error", () => ws.terminate());
    ws.on("close", () => {
      clearTimeout(idle);
      clearTimeout(expiry);
      clearInterval(heartbeat);
      conns.delete(ws);
      decrement(conn.userId);
      if (room.leave(ws)) void release(room);
    });
    room.join({ ws, name, clients: new Set() });
  }

  function toBytes(data: RawData): Uint8Array {
    if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }

  /** Signed out (session row deleted) or revoked sessions lose their sockets within sessionCheckMs. */
  const sessionCheck = setInterval(() => {
    const tokens = [...new Set([...conns.values()].map((c) => c.token))];
    if (!tokens.length) return;
    liveTokens(tokens)
      .then((live) => {
        for (const [ws, c] of conns) if (!live.has(c.token)) ws.close(CLOSE.unauthorized, "Signed out");
      })
      .catch((err) => logError("collab", err));
  }, config.sessionCheckMs);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.port;

  return {
    server,
    port,
    rooms,
    async close() {
      stopping = true;
      clearInterval(sessionCheck);
      for (const ws of conns.keys()) ws.close(CLOSE.shutdown, "Server shutting down");
      await Promise.all([...rooms.values()].map((r) => release(r)));
      await listener.unlisten().catch(() => {});
      wss.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
