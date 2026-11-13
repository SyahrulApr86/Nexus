import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect } from "vitest";
import { db } from "@/db";
import { folder, link, note, tag, user, vault } from "@/db/schema";
import { HttpError } from "@/lib/session";

/** describe() that is skipped when no test database is configured (see setup.ts). */
export const describeDb = describe.skipIf(!process.env.TEST_DATABASE_URL);

export type Vaults = { userId: string; a: string; b: string };

/**
 * Registers hooks that create one user owning vaults A and B, empty both vaults
 * before every test, and delete the user afterwards (cascading to vaults,
 * folders, notes, links and tags). Call it inside a describeDb block.
 */
export function useVaults(): Readonly<Vaults> {
  const ctx: Vaults = { userId: "", a: "", b: "" };

  beforeAll(async () => {
    const userId = `vitest-${randomUUID()}`;
    await db.insert(user).values({ id: userId, name: "Vitest", email: `${userId}@example.test` });
    const [a] = await db.insert(vault).values({ ownerId: userId, name: "Vault A" }).returning({ id: vault.id });
    const [b] = await db.insert(vault).values({ ownerId: userId, name: "Vault B" }).returning({ id: vault.id });
    Object.assign(ctx, { userId, a: a.id, b: b.id });
  });

  beforeEach(async () => {
    const ids = [ctx.a, ctx.b];
    // Deleting notes cascades to their links and tags.
    await db.delete(note).where(inArray(note.vaultId, ids));
    await db.delete(folder).where(inArray(folder.vaultId, ids));
  });

  afterAll(async () => {
    if (ctx.userId) await db.delete(user).where(eq(user.id, ctx.userId));
  });

  return ctx;
}

/** Indexed outgoing links of a note, sorted. */
export async function linksOf(noteId: string) {
  return db
    .select({ target: link.target, embed: link.embed })
    .from(link)
    .where(eq(link.sourceId, noteId))
    .orderBy(asc(link.target), asc(link.embed));
}

/** Indexed tags of a note, sorted. */
export async function tagsOf(noteId: string) {
  const rows = await db.select({ tag: tag.tag }).from(tag).where(eq(tag.noteId, noteId)).orderBy(asc(tag.tag));
  return rows.map((r) => r.tag);
}

/** Raw note row (content, path, name) straight from the table. */
export async function noteRow(vaultId: string, id: string) {
  const [row] = await db
    .select({ path: note.path, name: note.name, content: note.content })
    .from(note)
    .where(and(eq(note.vaultId, vaultId), eq(note.id, id)));
  return row;
}

/** Asserts that `promise` rejects with an HttpError carrying `status`. */
export async function expectHttpError(promise: Promise<unknown>, status: number) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HttpError);
  expect(error).toMatchObject({ status });
}
