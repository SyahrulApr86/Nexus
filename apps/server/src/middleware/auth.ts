import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { prisma } from "../db.js";
import { getSession, touchSession } from "../lib/session.js";

export const SESSION_COOKIE = "nexus_session";

export interface AuthVars {
  userId: string;
  vaultId: string;
  sessionToken: string;
}

declare module "hono" {
  interface ContextVariableMap extends AuthVars {}
}

export async function requireAuth(c: Context, next: Next) {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    return c.json({ error: "Not authenticated", code: "UNAUTHENTICATED" }, 401);
  }
  const session = await getSession(token);
  if (!session) {
    return c.json({ error: "Session expired", code: "SESSION_EXPIRED" }, 401);
  }
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { idleTimeoutMinutes: true },
  });
  if (!user) {
    return c.json({ error: "Session expired", code: "SESSION_EXPIRED" }, 401);
  }
  await touchSession(token, user.idleTimeoutMinutes);
  c.set("userId", session.userId);
  c.set("vaultId", session.vaultId);
  c.set("sessionToken", token);
  await next();
}
