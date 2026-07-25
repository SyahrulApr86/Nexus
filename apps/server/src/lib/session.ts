import { randomBytes } from "node:crypto";
import { redis } from "../redis.js";

export interface SessionData {
  userId: string;
  vaultId: string;
}

const PREFIX = "sess:";

export async function createSession(
  data: SessionData,
  idleTimeoutMinutes: number,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await redis.set(
    PREFIX + token,
    JSON.stringify(data),
    "EX",
    idleTimeoutMinutes * 60,
  );
  return token;
}

export async function getSession(token: string): Promise<SessionData | null> {
  const raw = await redis.get(PREFIX + token);
  return raw ? (JSON.parse(raw) as SessionData) : null;
}

/** Rolling idle timeout (FR-003): refresh TTL on every authenticated hit. */
export async function touchSession(
  token: string,
  idleTimeoutMinutes: number,
): Promise<void> {
  await redis.expire(PREFIX + token, idleTimeoutMinutes * 60);
}

export async function destroySession(token: string): Promise<void> {
  await redis.del(PREFIX + token);
}
