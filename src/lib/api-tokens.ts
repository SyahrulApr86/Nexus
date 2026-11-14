import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, count, desc, eq, gt, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { apiToken, apiTokenScopes, user, vault, type ApiTokenScope } from "@/db/schema";
import { HttpError } from "@/lib/session";

/*
 * Personal API tokens: how an AI client (an MCP client) reaches one vault without a browser
 * session. Security model (named risk areas):
 * - Secrets management: a token is `nxs_` + 32 random bytes (256 bits) in base64url. Only its
 *   sha256 is stored; the token itself is in the creation answer only. Nothing here logs a token.
 * - Authentication: verifyToken looks the hash up on its unique index and compares it in constant
 *   time; a revoked or expired token is refused the same way as an unknown one.
 * - Access control: a token is bound to ONE vault of its owner and carries a scope, `read` or
 *   `write`. Deleting the vault or the user deletes its tokens (cascade).
 * - Resource limits: at most API_TOKEN_LIMITS.activePerUser live tokens per user.
 */

export const API_TOKEN_LIMITS = {
  /** Live (not revoked, not expired) tokens per user. */
  activePerUser: 20,
  /** Longest expiry a token can be given, in days. Tokens without an expiry live until revoked. */
  maxDays: 365,
  /** Characters in a token's name. */
  nameLength: 80,
  /** Token creations per user per hour (rate limit on POST /api/tokens). */
  createsPerHour: 10,
  /** lastUsedAt is written at most this often per token, so every MCP call is not a row update. */
  lastUsedEveryMs: 60_000,
} as const;

export const TOKEN_PREFIX = "nxs_";
/** Random bytes in a token: 256 bits, so a token can be neither guessed nor enumerated. */
const TOKEN_BYTES = 32;
/** `nxs_` and base64url of 32 bytes, without padding. */
export const TOKEN_SHAPE = /^nxs_[A-Za-z0-9_-]{43}$/;
/** Characters of the token kept for display: `nxs_` and the first 8 random characters. */
const PREFIX_LENGTH = TOKEN_PREFIX.length + 8;

/** A fresh token. Exported for tests; production code only calls createToken. */
export function generateToken(): string {
  return TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString("base64url");
}

/** sha256 of the token as 64 lowercase hex characters (what api_token.token_hash holds). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** The display prefix of a token, e.g. "nxs_AbCd1234". */
export function tokenPrefix(token: string): string {
  return token.slice(0, PREFIX_LENGTH);
}

/** Whether a scope allows writes. The one place that decides it. */
export function canWrite(scope: ApiTokenScope): boolean {
  return scope === "write";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /api/tokens body. `vaultId` absent: the request's active vault (X-Nexus-Vault). */
export const CreateTokenBody = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Give the token a name")
      .max(API_TOKEN_LIMITS.nameLength, `A name has at most ${API_TOKEN_LIMITS.nameLength} characters`)
      // Control characters would hide or reorder what the list shows.
      .refine((s) => !/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/.test(s), "The name has characters that cannot be shown"),
    scope: z.enum(apiTokenScopes),
    vaultId: z.string().regex(UUID, "Invalid vault").optional(),
    expiresInDays: z.number().int().min(1).max(API_TOKEN_LIMITS.maxDays).nullable().optional(),
  })
  .strict();
export type CreateTokenInput = z.infer<typeof CreateTokenBody>;

/** Live tokens: not revoked and not past their expiry. */
const live = (now: Date) => and(isNull(apiToken.revokedAt), or(isNull(apiToken.expiresAt), gt(apiToken.expiresAt, now)));

/** Fields of a token its owner may see. The token is never stored, so it is never listed. */
const publicFields = {
  id: apiToken.id,
  name: apiToken.name,
  prefix: apiToken.prefix,
  scope: apiToken.scope,
  vaultId: apiToken.vaultId,
  createdAt: apiToken.createdAt,
  lastUsedAt: apiToken.lastUsedAt,
  expiresAt: apiToken.expiresAt,
};

/**
 * Makes a token for vault `vaultId` of user `userId` (the caller has checked the vault is theirs).
 * Returns the token once; only its hash is stored. 409 at the live-token limit.
 */
export async function createToken(userId: string, vaultId: string, input: Omit<CreateTokenInput, "vaultId">) {
  const token = generateToken();
  const now = new Date();
  const expiresAt = input.expiresInDays ? new Date(now.getTime() + input.expiresInDays * 86_400_000) : null;
  const row = await db.transaction(async (tx) => {
    // Locks the user row, so concurrent requests cannot pass the per-user limit together.
    const [u] = await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update");
    if (!u) throw new HttpError(401, "Unauthorized");
    // The vault check again, inside the transaction: the vault must still be the user's.
    const [v] = await tx
      .select({ id: vault.id })
      .from(vault)
      .where(and(eq(vault.id, vaultId), eq(vault.ownerId, userId)))
      .limit(1);
    if (!v) throw new HttpError(404, "Vault not found");
    const [{ active }] = await tx
      .select({ active: count() })
      .from(apiToken)
      .where(and(eq(apiToken.userId, userId), live(now)));
    if (active >= API_TOKEN_LIMITS.activePerUser)
      throw new HttpError(409, `You can have at most ${API_TOKEN_LIMITS.activePerUser} active tokens. Revoke one first.`);
    const [created] = await tx
      .insert(apiToken)
      .values({
        userId,
        vaultId,
        name: input.name,
        scope: input.scope,
        tokenHash: hashToken(token),
        prefix: tokenPrefix(token),
        expiresAt,
      })
      .returning(publicFields);
    return created;
  });
  return { ...row, token };
}

/** The user's live tokens with their vault's name, newest first, without secrets. */
export async function listTokens(userId: string, now = new Date()) {
  return db
    .select({ ...publicFields, vaultName: vault.name })
    .from(apiToken)
    .innerJoin(vault, eq(vault.id, apiToken.vaultId))
    .where(and(eq(apiToken.userId, userId), live(now)))
    .orderBy(desc(apiToken.createdAt), asc(apiToken.id));
}

/** Revokes token `id` of `userId`. Idempotent; 404 for another user's token or a missing one. */
export async function revokeToken(userId: string, id: string) {
  if (!UUID.test(id)) throw new HttpError(404, "Token not found");
  const [t] = await db
    .select({ id: apiToken.id, revokedAt: apiToken.revokedAt })
    .from(apiToken)
    .where(and(eq(apiToken.id, id), eq(apiToken.userId, userId)))
    .limit(1);
  if (!t) throw new HttpError(404, "Token not found");
  if (!t.revokedAt)
    await db
      .update(apiToken)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiToken.id, t.id), isNull(apiToken.revokedAt)));
  return { ok: true as const, id: t.id };
}

/** Who a verified token acts as: one user, one vault, one scope. */
export type TokenPrincipal = {
  tokenId: string;
  userId: string;
  vaultId: string;
  scope: ApiTokenScope;
  expiresAt: Date | null;
};

/**
 * The principal behind `token`, or null for a malformed, unknown, revoked or expired one. The
 * caller answers every null the same way. Records lastUsedAt at most once per minute.
 */
export async function verifyToken(token: string, now = new Date()): Promise<TokenPrincipal | null> {
  if (!TOKEN_SHAPE.test(token)) return null;
  const hash = hashToken(token);
  const [row] = await db
    .select({
      id: apiToken.id,
      tokenHash: apiToken.tokenHash,
      userId: apiToken.userId,
      vaultId: apiToken.vaultId,
      scope: apiToken.scope,
      revokedAt: apiToken.revokedAt,
      expiresAt: apiToken.expiresAt,
      lastUsedAt: apiToken.lastUsedAt,
      owner: vault.ownerId,
    })
    .from(apiToken)
    .innerJoin(vault, eq(vault.id, apiToken.vaultId))
    .where(eq(apiToken.tokenHash, hash))
    .limit(1);
  if (!row) return null;
  // Constant-time check of the stored hash, so no comparison in this process leaks how much matched.
  if (!timingSafeEqual(Buffer.from(row.tokenHash, "hex"), Buffer.from(hash, "hex"))) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return null;
  // Defence in depth: the vault must still belong to the token's owner.
  if (row.owner !== row.userId) return null;
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() >= API_TOKEN_LIMITS.lastUsedEveryMs) {
    const stale = new Date(now.getTime() - API_TOKEN_LIMITS.lastUsedEveryMs);
    await db
      .update(apiToken)
      .set({ lastUsedAt: now })
      .where(and(eq(apiToken.id, row.id), or(isNull(apiToken.lastUsedAt), lt(apiToken.lastUsedAt, stale))));
  }
  return { tokenId: row.id, userId: row.userId, vaultId: row.vaultId, scope: row.scope, expiresAt: row.expiresAt };
}
