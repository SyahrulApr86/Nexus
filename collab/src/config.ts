/**
 * Settings of the collaboration service, read once from the environment at start-up.
 * Every limit has a default that suits a personal vault; the README lists them.
 */
import { LIMITS } from "@/lib/notes";

export type CollabConfig = {
  /** TCP port of the HTTP + WebSocket listener (0 picks a free one, used by the tests). */
  port: number;
  host: string;
  /** BETTER_AUTH_SECRET: signs the session cookie the service verifies. */
  secret: string;
  /** Origins a browser may open a socket from (BETTER_AUTH_URL, NEXT_PUBLIC_APP_URL). */
  origins: string[];
  /** Better Auth names the cookie `__Secure-better-auth.session_token` when the app runs on https. */
  cookieName: string;
  maxConnections: number;
  maxConnectionsPerUser: number;
  /** Largest WebSocket frame accepted; a larger one closes the socket with 1009. */
  maxMessageBytes: number;
  /** A socket that sends nothing (not even awareness, which clients renew every 15 s) for this long is closed. */
  idleTimeoutMs: number;
  /** Ping interval; a socket that misses one pong is dropped. */
  heartbeatMs: number;
  /** How often open sockets are checked against the session table (sign-out, revoked sessions). */
  sessionCheckMs: number;
  /** Quiet time after the last edit before the note is written back. */
  persistDebounceMs: number;
  /** Longest a busy note waits before it is written back anyway. */
  persistMaxWaitMs: number;
};

function int(env: NodeJS.ProcessEnv, name: string, fallback: number, min = 0): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be an integer >= ${min}`);
  return n;
}

export function appOrigins(env: NodeJS.ProcessEnv): string[] {
  const out = new Set<string>();
  for (const name of ["BETTER_AUTH_URL", "NEXT_PUBLIC_APP_URL"] as const) {
    const v = env[name];
    if (!v) continue;
    try {
      out.add(new URL(v).origin);
    } catch {
      throw new Error(`${name} is not a valid URL`);
    }
  }
  return [...out];
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): CollabConfig {
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  const origins = appOrigins(env);
  // Fail closed: without a configured origin any site could open a socket with the user's cookie.
  if (!origins.length) throw new Error("Set BETTER_AUTH_URL (and NEXT_PUBLIC_APP_URL if it differs)");
  const secure = new URL(env.BETTER_AUTH_URL ?? origins[0]).protocol === "https:";
  const persistDebounceMs = int(env, "COLLAB_PERSIST_DEBOUNCE_MS", 2_000, 10);
  return {
    port: int(env, "COLLAB_PORT", 3001),
    host: env.COLLAB_HOST || "127.0.0.1",
    secret,
    origins,
    cookieName: `${secure ? "__Secure-" : ""}better-auth.session_token`,
    maxConnections: int(env, "COLLAB_MAX_CONNECTIONS", 1_000, 1),
    maxConnectionsPerUser: int(env, "COLLAB_MAX_CONNECTIONS_PER_USER", 20, 1),
    // A whole note (LIMITS.noteBytes) must fit in the first sync of a client that edited offline.
    maxMessageBytes: int(env, "COLLAB_MAX_MESSAGE_BYTES", LIMITS.noteBytes + 1024 * 1024, 1024),
    idleTimeoutMs: int(env, "COLLAB_IDLE_TIMEOUT_MS", 120_000, 1_000),
    heartbeatMs: int(env, "COLLAB_HEARTBEAT_MS", 30_000, 1_000),
    sessionCheckMs: int(env, "COLLAB_SESSION_CHECK_MS", 60_000, 1_000),
    persistDebounceMs,
    persistMaxWaitMs: Math.max(persistDebounceMs, int(env, "COLLAB_PERSIST_MAX_WAIT_MS", 10_000, 10)),
  };
}
