import "server-only";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { note, vault } from "@/db/schema";
import { LIMITS } from "@/lib/notes";
import { HttpError, getDefaultVaultId } from "@/lib/session";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

export const VAULT_LIMITS = {
  /** Vaults one user may own. */
  vaults: 20,
  /** Characters in a vault name. */
  name: 100,
  /** Notes across all of a user's vaults: five vaults' worth. */
  userNotes: LIMITS.vaultNotes * 5,
  /** UTF-8 bytes of notes across all of a user's vaults: five vaults' worth. */
  userBytes: LIMITS.vaultBytes * 5,
} as const;

/** A vault name from a request body: trimmed, 1 to 100 characters, no control characters or slashes. */
export const VaultName = z
  .string()
  .trim()
  .min(1, "Give the vault a name")
  .max(VAULT_LIMITS.name, `A vault name has at most ${VAULT_LIMITS.name} characters`)
  .refine((s) => !/[\u0000-\u001f\u007f/\\]/.test(s), "A vault name cannot contain slashes or control characters");

export type VaultSummary = {
  id: string;
  name: string;
  createdAt: Date;
  isDefault: boolean;
  notes: number;
};

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

/**
 * Serialises vault creation, renaming and deletion per user for the rest of `tx`, so two requests
 * can neither pass the 20-vault limit together, take the same name, nor delete the last two vaults.
 */
async function lockUser(tx: Tx, userId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`nexus:vaults:${userId}`}, 0))`);
}

/** The user's vaults, oldest first; the oldest is the default one (used when no vault is named). */
export async function listVaults(userId: string): Promise<VaultSummary[]> {
  // Creates "My Vault" on first use, as every other route does.
  await getDefaultVaultId(userId);
  const rows = await db
    .select({
      id: vault.id,
      name: vault.name,
      createdAt: vault.createdAt,
      notes: count(note.id),
    })
    .from(vault)
    .leftJoin(note, eq(note.vaultId, vault.id))
    .where(eq(vault.ownerId, userId))
    .groupBy(vault.id)
    .orderBy(asc(vault.createdAt), asc(vault.id));
  return rows.map((r, i) => ({ ...r, isDefault: i === 0 }));
}

async function ownedVault(tx: Exec, userId: string, id: string) {
  const [v] = await tx
    .select({ id: vault.id, name: vault.name, createdAt: vault.createdAt })
    .from(vault)
    .where(and(eq(vault.id, id), eq(vault.ownerId, userId)))
    .limit(1);
  // The same 404 for someone else's vault and a missing one: ids are never confirmed.
  if (!v) throw new HttpError(404, "Vault not found");
  return v;
}

async function assertNameFree(tx: Exec, userId: string, name: string, exceptId?: string) {
  const [taken] = await tx
    .select({ id: vault.id })
    .from(vault)
    .where(
      and(
        eq(vault.ownerId, userId),
        sql`lower(${vault.name}) = lower(${name})`,
        exceptId ? sql`${vault.id} <> ${exceptId}` : undefined,
      ),
    )
    .limit(1);
  if (taken) throw new HttpError(409, `You already have a vault named “${name}”. Choose another name.`);
}

export async function createVault(userId: string, rawName: string) {
  const name = VaultName.parse(rawName);
  // The default vault exists first, so a user's first POST never leaves them with an extra "My Vault".
  await getDefaultVaultId(userId);
  return db.transaction(async (tx) => {
    await lockUser(tx, userId);
    const [{ n }] = await tx.select({ n: count() }).from(vault).where(eq(vault.ownerId, userId));
    if (n >= VAULT_LIMITS.vaults)
      throw new HttpError(409, `You can have at most ${VAULT_LIMITS.vaults} vaults. Delete one to make room.`);
    await assertNameFree(tx, userId, name);
    const [created] = await tx.insert(vault).values({ ownerId: userId, name }).returning({
      id: vault.id,
      name: vault.name,
      createdAt: vault.createdAt,
    });
    return { ...created, isDefault: false, notes: 0 };
  });
}

export async function renameVault(userId: string, id: string, rawName: string) {
  const name = VaultName.parse(rawName);
  return db.transaction(async (tx) => {
    await lockUser(tx, userId);
    await ownedVault(tx, userId, id);
    await assertNameFree(tx, userId, name, id);
    const [v] = await tx
      .update(vault)
      .set({ name })
      .where(and(eq(vault.id, id), eq(vault.ownerId, userId)))
      .returning({
        id: vault.id,
        name: vault.name,
        createdAt: vault.createdAt,
      });
    return v;
  });
}

/**
 * Deletes a vault and everything in it (notes, folders, links, tags, history, bookmarks and share
 * links cascade). `confirm` must be the vault's exact name, so a stray request cannot do it, and
 * the user's last vault is never deleted.
 */
export async function deleteVault(userId: string, id: string, confirm: string) {
  return db.transaction(async (tx) => {
    await lockUser(tx, userId);
    const v = await ownedVault(tx, userId, id);
    if (confirm !== v.name) throw new HttpError(400, "Type the vault's name exactly to delete it");
    const [{ n }] = await tx.select({ n: count() }).from(vault).where(eq(vault.ownerId, userId));
    if (n <= 1) throw new HttpError(409, "This is your only vault. Create another vault before deleting this one.");
    await tx.delete(vault).where(and(eq(vault.id, id), eq(vault.ownerId, userId)));
    return { ok: true as const, id };
  });
}

/* ------------------------------------------------------------------ */
/* Per-user quota (across vaults)                                      */
/* ------------------------------------------------------------------ */

/**
 * Throws 413 when the owner of `vaultId` is over the total note or byte quota across all their
 * vaults. Meant to run inside a note write's transaction, next to the per-vault quota check
 * (assertVaultQuota in src/lib/notes.ts).
 */
export async function assertUserQuota(tx: Exec, vaultId: string) {
  const [owner] = await tx.select({ id: vault.ownerId }).from(vault).where(eq(vault.id, vaultId)).limit(1);
  if (!owner) throw new HttpError(404, "Vault not found");
  const [q] = await tx
    .select({
      notes: count(note.id),
      bytes: sql<string>`coalesce(sum(octet_length(${note.content})), 0)`,
    })
    .from(note)
    .innerJoin(vault, eq(vault.id, note.vaultId))
    .where(eq(vault.ownerId, owner.id));
  if (q.notes > VAULT_LIMITS.userNotes)
    throw new HttpError(
      413,
      `Your vaults hold at most ${VAULT_LIMITS.userNotes} notes in total. Delete notes to make room.`,
    );
  if (Number(q.bytes) > VAULT_LIMITS.userBytes)
    throw new HttpError(413, "Your vaults are full. Delete notes to make room.");
}
