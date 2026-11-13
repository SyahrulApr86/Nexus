import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, expect, it } from "vitest";
import { db } from "@/db";
import { user, vault } from "@/db/schema";
import { createNote, deleteNote } from "@/lib/notes";
import { createShare, revokeShare } from "@/lib/shares";
import { describeDb } from "./fixtures";

/*
 * src/proxy.ts: /s/<token> answers a dead link with a real 404 before the page streams, and lets
 * a live one through untouched. The page renders the same "not available" view either way.
 */

const { proxy, config } = await import("@/proxy");

const status = async (path: string) => {
  const res = await proxy(new NextRequest(new URL(path, "http://app.test")));
  return { status: res.status, rewrite: res.headers.get("x-middleware-rewrite"), next: res.headers.get("x-middleware-next") };
};

describeDb("share proxy", () => {
  let userId = "";
  let vaultId = "";
  let noteId = "";

  beforeAll(async () => {
    userId = `vitest-${randomUUID()}`;
    await db.insert(user).values({ id: userId, name: "Vitest", email: `${userId}@example.test` });
    const [v] = await db.insert(vault).values({ ownerId: userId, name: "Proxy vault" }).returning({ id: vault.id });
    vaultId = v.id;
    noteId = (await createNote(vaultId, "Shared note", "Hello")).id;
  });

  afterAll(async () => {
    if (userId) await db.delete(user).where(eq(user.id, userId));
  });

  it("runs on the share page only", () => {
    expect(config.matcher).toBe("/s/:token");
  });

  it("lets a live link through", async () => {
    const { token } = await createShare(vaultId, noteId);
    const r = await status(`/s/${token}`);
    expect(r.status).toBe(200);
    expect(r.next).toBe("1");
  });

  it("answers 404 for a malformed, unknown, revoked or expired link, rendering the same page", async () => {
    const revoked = await createShare(vaultId, noteId);
    await revokeShare(userId, revoked.id);
    const expired = await createShare(vaultId, noteId, { expiresInDays: 1 });
    const { share } = await import("@/db/schema");
    await db.update(share).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(share.id, expired.id));

    for (const token of ["short", "A".repeat(43), revoked.token, expired.token]) {
      const r = await status(`/s/${token}`);
      expect(r.status, token.slice(0, 6)).toBe(404);
      // A rewrite to the same URL: the page's own not-found view, now with a 404 status.
      expect(new URL(r.rewrite!).pathname).toBe(`/s/${token}`);
    }
  });

  it("answers 404 once the note is deleted", async () => {
    const n = await createNote(vaultId, "Short-lived", "Bye");
    const { token } = await createShare(vaultId, n.id);
    await deleteNote(vaultId, n.id);
    expect((await status(`/s/${token}`)).status).toBe(404);
  });
});
