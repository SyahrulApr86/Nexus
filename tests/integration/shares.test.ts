import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { db } from "@/db";
import { share, user, vault } from "@/db/schema";
import { createNote, deleteNote } from "@/lib/notes";
import { describeDb } from "./fixtures";

const req = vi.hoisted(() => ({
  headers: new Headers(),
  users: new Map<string, { id: string; name: string; email: string }>(),
}));

vi.mock("next/headers", () => ({ headers: async () => req.headers }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getAuth: () => ({
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const u = req.users.get(headers.get("x-test-user") ?? "");
        return u ? { user: u } : null;
      },
    },
  }),
}));

const shareRoute = await import("@/app/api/notes/[id]/share/route");
const revokeRoute = await import("@/app/api/shares/[id]/route");
const { SHARE_LIMITS, resolveShare } = await import("@/lib/shares");

function as(userId: string | null, vaultId?: string) {
  req.headers = new Headers({
    ...(userId ? { "x-test-user": userId } : {}),
    ...(vaultId ? { "x-nexus-vault": vaultId } : {}),
  });
}
const json = (body: unknown) =>
  new Request("http://app.test/api/notes/x/share", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const del = () => new Request("http://app.test/api/shares/x", { method: "DELETE" });
async function call(res: Promise<Response>) {
  const r = await res;
  return { status: r.status, body: await r.json() };
}
const tokenOf = (url: string) => new URL(url).pathname.split("/").pop()!;

describeDb("public share links", () => {
  const A = `vitest-a-${randomUUID()}`;
  const B = `vitest-b-${randomUUID()}`;
  let a1 = "";
  let a2 = "";
  let b1 = "";

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://nexus.example";
    for (const id of [A, B]) {
      await db.insert(user).values({ id, name: id, email: `${id}@example.test` });
      req.users.set(id, { id, name: id, email: `${id}@example.test` });
    }
    [{ id: a1 }] = await db.insert(vault).values({ ownerId: A, name: "A default" }).returning({ id: vault.id });
    [{ id: a2 }] = await db.insert(vault).values({ ownerId: A, name: "A second" }).returning({ id: vault.id });
    [{ id: b1 }] = await db.insert(vault).values({ ownerId: B, name: "B default" }).returning({ id: vault.id });
  });

  afterAll(async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    await db.delete(user).where(inArray(user.id, [A, B]));
  });

  it("creates a link, returns its URL once, stores only the token's hash", async () => {
    const n = await createNote(a1, "Projects/Launch plan", "# Launch\n\nSee [[Budget]]");
    as(A);
    const made = await call(shareRoute.POST(json({}), params(n.id)));
    expect(made.status).toBe(201);
    expect(made.body.url).toMatch(/^https:\/\/nexus\.example\/s\/[A-Za-z0-9_-]{43}$/);
    expect(made.body.expiresAt).toBeNull();
    const token = tokenOf(made.body.url);

    const [row] = await db.select().from(share).where(eq(share.id, made.body.id));
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(token);

    const listed = await call(shareRoute.GET(new Request("http://app.test"), params(n.id)));
    expect(listed.body).toEqual([
      {
        id: made.body.id,
        noteId: n.id,
        createdAt: made.body.createdAt,
        expiresAt: null,
      },
    ]);
    expect(JSON.stringify(listed.body)).not.toContain(token);

    expect(await resolveShare(token)).toMatchObject({
      name: "Launch plan",
      content: "# Launch\n\nSee [[Budget]]",
    });
  });

  it("answers null for unknown, malformed, revoked and expired tokens, and for a deleted note", async () => {
    const n = await createNote(a1, "Temp", "temporary");
    as(A);
    const made = await call(shareRoute.POST(json({ expiresInDays: 1 }), params(n.id)));
    const token = tokenOf(made.body.url);
    expect(await resolveShare(token)).not.toBeNull();
    // Expired: one day and a second later.
    expect(await resolveShare(token, new Date(Date.now() + 86_401_000))).toBeNull();

    expect(await resolveShare("x".repeat(43))).toBeNull();
    expect(await resolveShare(token.slice(0, 42))).toBeNull();
    expect(await resolveShare(`${token}A`)).toBeNull();
    expect(await resolveShare("../../etc/passwd")).toBeNull();

    const revoked = await call(revokeRoute.DELETE(del(), params(made.body.id)));
    expect(revoked).toEqual({
      status: 200,
      body: { ok: true, id: made.body.id },
    });
    expect(await resolveShare(token)).toBeNull();
    // Idempotent.
    expect((await call(revokeRoute.DELETE(del(), params(made.body.id)))).status).toBe(200);
    expect((await call(shareRoute.GET(new Request("http://app.test"), params(n.id)))).body).toEqual([]);

    const again = await call(shareRoute.POST(json({}), params(n.id)));
    await deleteNote(a1, n.id);
    expect(await resolveShare(tokenOf(again.body.url))).toBeNull();
    expect(await db.select().from(share).where(eq(share.noteId, n.id))).toEqual([]);
  });

  it("scopes links to the active vault", async () => {
    const n = await createNote(a2, "Second vault note", "hello");
    as(A);
    // Not in the default vault.
    expect((await call(shareRoute.POST(json({}), params(n.id)))).status).toBe(404);
    as(A, a2);
    expect((await call(shareRoute.POST(json({}), params(n.id)))).status).toBe(201);
    // Revoking works whichever vault is active.
    const [s] = await call(shareRoute.GET(new Request("http://app.test"), params(n.id))).then((r) => r.body);
    as(A);
    expect((await call(revokeRoute.DELETE(del(), params(s.id)))).status).toBe(200);
  });

  it("user B can neither share, list, revoke nor read user A's notes (IDOR)", async () => {
    const n = await createNote(a1, "Diary", "private");
    as(A);
    const made = await call(shareRoute.POST(json({}), params(n.id)));

    as(B);
    expect((await call(shareRoute.POST(json({}), params(n.id)))).status).toBe(404);
    expect((await call(shareRoute.GET(new Request("http://app.test"), params(n.id)))).status).toBe(404);
    expect((await call(revokeRoute.DELETE(del(), params(made.body.id)))).status).toBe(404);
    // B naming A's vault in the header gets nothing either.
    as(B, a1);
    expect((await call(shareRoute.POST(json({}), params(n.id)))).status).toBe(404);
    expect((await call(shareRoute.GET(new Request("http://app.test"), params(n.id)))).status).toBe(404);
    expect((await call(revokeRoute.DELETE(del(), params(made.body.id)))).status).toBe(404);
    // B's own vault cannot be used to share A's note id.
    as(B, b1);
    expect((await call(shareRoute.POST(json({}), params(n.id)))).status).toBe(404);

    const [row] = await db.select().from(share).where(eq(share.id, made.body.id));
    expect(row.revokedAt).toBeNull();
    expect(await resolveShare(tokenOf(made.body.url))).not.toBeNull();
  });

  it("refuses without a session, cross-site, without JSON, and with bad options", async () => {
    const n = await createNote(a1, "Guarded", "x");
    as(null);
    expect((await call(shareRoute.POST(json({}), params(n.id)))).status).toBe(401);
    req.headers = new Headers({
      "x-test-user": A,
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    });
    expect((await call(shareRoute.POST(json({}), params(n.id)))).status).toBe(403);
    expect((await call(revokeRoute.DELETE(del(), params(randomUUID())))).status).toBe(403);
    as(A);
    const plain = new Request("http://app.test", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    expect((await call(shareRoute.POST(plain, params(n.id)))).status).toBe(415);
    expect((await call(shareRoute.POST(json({ expiresInDays: 0 }), params(n.id)))).status).toBe(400);
    expect((await call(shareRoute.POST(json({ expiresInDays: 400 }), params(n.id)))).status).toBe(400);
  });

  it(`allows at most ${SHARE_LIMITS.activePerNote} live links per note`, async () => {
    const n = await createNote(a1, "Popular", "x");
    as(A);
    for (let i = 0; i < SHARE_LIMITS.activePerNote; i++)
      expect((await call(shareRoute.POST(json({}), params(n.id)))).status).toBe(201);
    expect((await call(shareRoute.POST(json({}), params(n.id)))).status).toBe(409);
    const [first] = (await call(shareRoute.GET(new Request("http://app.test"), params(n.id)))).body;
    await call(revokeRoute.DELETE(del(), params(first.id)));
    expect((await call(shareRoute.POST(json({}), params(n.id)))).status).toBe(201);
  });

  it("deleting a vault removes its links", async () => {
    const [{ id: tmp }] = await db.insert(vault).values({ ownerId: A, name: "Tmp" }).returning({ id: vault.id });
    const n = await createNote(tmp, "Gone", "x");
    as(A, tmp);
    const made = await call(shareRoute.POST(json({}), params(n.id)));
    await db.delete(vault).where(eq(vault.id, tmp));
    expect(await resolveShare(tokenOf(made.body.url))).toBeNull();
  });
});
