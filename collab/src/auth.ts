/**
 * Who is opening a socket, and may they open this note. The service shares the app's database,
 * so it checks the Better Auth session cookie itself instead of calling the Next.js app.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import { note, session, user, vault } from "@/db/schema";

/** Cookie header to a name → raw value map (first occurrence wins, like Better Auth's parser). */
export function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name && !out.has(name)) out.set(name, part.slice(eq + 1).trim());
  }
  return out;
}

/** HMAC-SHA256 signature in the form Better Auth (better-call) writes: base64, 44 characters. */
export function signCookieValue(value: string, secret: string): string {
  const signature = createHmac("sha256", secret).update(value).digest("base64");
  return encodeURIComponent(`${value}.${signature}`);
}

/** The session token inside a signed cookie value, or null when the signature does not match. */
export function verifySignedCookie(raw: string, secret: string): string | null {
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const dot = value.lastIndexOf(".");
  if (dot < 1) return null;
  const token = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  if (signature.length !== 44 || !signature.endsWith("=")) return null;
  const expected = Buffer.from(createHmac("sha256", secret).update(token).digest("base64"));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected) ? token : null;
}

export type SessionUser = { userId: string; name: string; expiresAt: Date };

/** The live session behind `token`, or null when it does not exist or has expired. */
export async function sessionByToken(token: string): Promise<SessionUser | null> {
  const [row] = await db
    .select({ userId: session.userId, expiresAt: session.expiresAt, name: user.name })
    .from(session)
    .innerJoin(user, eq(user.id, session.userId))
    .where(and(eq(session.token, token), gt(session.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

/** Of `tokens`, the ones that still belong to a live session (signed out or expired ones drop out). */
export async function liveTokens(tokens: string[]): Promise<Set<string>> {
  if (!tokens.length) return new Set();
  const rows = await db
    .select({ token: session.token })
    .from(session)
    .where(and(inArray(session.token, tokens), gt(session.expiresAt, new Date())));
  return new Set(rows.map((r) => r.token));
}

/**
 * The vault of `noteId` when `userId` may edit it, else null. Today that is the vault owner;
 * shared vaults will widen this one query.
 */
export async function noteAccess(noteId: string, userId: string): Promise<{ vaultId: string } | null> {
  const [row] = await db
    .select({ vaultId: note.vaultId })
    .from(note)
    .innerJoin(vault, eq(vault.id, note.vaultId))
    .where(and(eq(note.id, noteId), eq(vault.ownerId, userId)))
    .limit(1);
  return row ?? null;
}
