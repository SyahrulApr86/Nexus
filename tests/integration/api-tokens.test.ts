import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { db } from "@/db";
import { apiToken, user, vault } from "@/db/schema";
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

const tokensRoute = await import("@/app/api/tokens/route");
const tokenRoute = await import("@/app/api/tokens/[id]/route");
const { API_TOKEN_LIMITS, hashToken, verifyToken } = await import("@/lib/api-tokens");

function as(userId: string | null, extra: Record<string, string> = {}) {
  req.headers = new Headers({ ...(userId ? { "x-test-user": userId } : {}), ...extra });
}
const post = (body: unknown, type = "application/json") =>
  new Request("http://app.test/api/tokens", { method: "POST", headers: { "content-type": type }, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const del = () => new Request("http://app.test/api/tokens/x", { method: "DELETE" });
async function call(res: Promise<Response>) {
  const r = await res;
  return { status: r.status, body: await r.json() };
}

describeDb("personal API tokens", () => {
  const A = `vitest-tok-a-${randomUUID()}`;
  const B = `vitest-tok-b-${randomUUID()}`;
  let a1 = "";
  let a2 = "";
  let b1 = "";

  beforeAll(async () => {
    for (const id of [A, B]) {
      await db.insert(user).values({ id, name: id, email: `${id}@example.test` });
      req.users.set(id, { id, name: id, email: `${id}@example.test` });
    }
    [{ id: a1 }] = await db.insert(vault).values({ ownerId: A, name: "A default" }).returning({ id: vault.id });
    [{ id: a2 }] = await db.insert(vault).values({ ownerId: A, name: "A second" }).returning({ id: vault.id });
    [{ id: b1 }] = await db.insert(vault).values({ ownerId: B, name: "B default" }).returning({ id: vault.id });
  });

  afterAll(async () => {
    await db.delete(user).where(inArray(user.id, [A, B]));
  });

  it("creates a token, returns it once and stores only its hash", async () => {
    as(A);
    const made = await call(tokensRoute.POST(post({ name: "Laptop", scope: "write" })));
    expect(made.status).toBe(201);
    expect(made.body.token).toMatch(/^nxs_[A-Za-z0-9_-]{43}$/);
    expect(made.body.vaultId).toBe(a1); // no header: the default (oldest) vault
    const [row] = await db.select().from(apiToken).where(eq(apiToken.id, made.body.id));
    expect(row.tokenHash).toBe(hashToken(made.body.token));
    expect(JSON.stringify(row)).not.toContain(made.body.token);
    expect(row.prefix).toBe(made.body.token.slice(0, 12));

    const list = await call(tokensRoute.GET());
    expect(list.status).toBe(200);
    const text = JSON.stringify(list.body);
    expect(text).not.toContain(made.body.token);
    expect(text).not.toMatch(/tokenHash|"token"/);
    expect(list.body[0]).toMatchObject({ id: made.body.id, name: "Laptop", scope: "write", vaultName: "A default" });
  });

  it("binds to the vault in the body or the X-Nexus-Vault header, and only the user's own", async () => {
    as(A);
    expect((await call(tokensRoute.POST(post({ name: "Second", scope: "read", vaultId: a2 })))).body.vaultId).toBe(a2);
    as(A, { "x-nexus-vault": a2 });
    expect((await call(tokensRoute.POST(post({ name: "Header", scope: "read" })))).body.vaultId).toBe(a2);
    as(A);
    expect((await call(tokensRoute.POST(post({ name: "Foreign", scope: "read", vaultId: b1 })))).status).toBe(404);
  });

  it("keeps the cookie route guards: session, same origin, JSON only, validation", async () => {
    as(null);
    expect((await call(tokensRoute.POST(post({ name: "x", scope: "read" })))).status).toBe(401);
    expect((await call(tokensRoute.GET())).status).toBe(401);
    as(A, { origin: "https://evil.example" });
    expect((await call(tokensRoute.POST(post({ name: "x", scope: "read" })))).status).toBe(403);
    as(A, { "sec-fetch-site": "cross-site" });
    expect((await call(tokenRoute.DELETE(del(), params(randomUUID())))).status).toBe(403);
    as(A);
    expect((await call(tokensRoute.POST(post({ name: "x", scope: "read" }, "text/plain")))).status).toBe(415);
    expect((await call(tokensRoute.POST(post({ name: "x", scope: "owner" })))).status).toBe(400);
    expect((await call(tokensRoute.POST(post({ name: "x", scope: "read", userId: B })))).status).toBe(400);
  });

  it("revokes: the token stops verifying at once; another user's token is a 404", async () => {
    as(B);
    const made = await call(tokensRoute.POST(post({ name: "B token", scope: "read" })));
    expect(await verifyToken(made.body.token)).toMatchObject({ userId: B, vaultId: b1, scope: "read" });
    as(A);
    expect((await call(tokenRoute.DELETE(del(), params(made.body.id)))).status).toBe(404);
    expect(await verifyToken(made.body.token)).not.toBeNull();
    as(B);
    expect((await call(tokenRoute.DELETE(del(), params(made.body.id)))).status).toBe(200);
    expect((await call(tokenRoute.DELETE(del(), params(made.body.id)))).status).toBe(200); // idempotent
    expect(await verifyToken(made.body.token)).toBeNull();
    expect((await call(tokensRoute.GET())).body.some((t: { id: string }) => t.id === made.body.id)).toBe(false);
    expect((await call(tokenRoute.DELETE(del(), params("not-a-uuid")))).status).toBe(404);
  });

  it("refuses expired, unknown and malformed tokens and records lastUsedAt at most once a minute", async () => {
    as(B);
    const made = await call(tokensRoute.POST(post({ name: "Expiring", scope: "write", expiresInDays: 1 })));
    const now = new Date();
    const first = await verifyToken(made.body.token, now);
    expect(first).not.toBeNull();
    const [r1] = await db.select({ at: apiToken.lastUsedAt }).from(apiToken).where(eq(apiToken.id, made.body.id));
    expect(r1.at?.getTime()).toBe(now.getTime());
    await verifyToken(made.body.token, new Date(now.getTime() + 30_000));
    const [r2] = await db.select({ at: apiToken.lastUsedAt }).from(apiToken).where(eq(apiToken.id, made.body.id));
    expect(r2.at?.getTime()).toBe(now.getTime());
    expect(await verifyToken(made.body.token, new Date(now.getTime() + 2 * 86_400_000))).toBeNull();
    expect(await verifyToken(`nxs_${"A".repeat(43)}`)).toBeNull();
    expect(await verifyToken("nxs_short")).toBeNull();
    expect(await verifyToken(made.body.token.toUpperCase())).toBeNull();
  });

  it("caps live tokens per user, and deleting the vault deletes its tokens", async () => {
    const C = `vitest-tok-c-${randomUUID()}`;
    await db.insert(user).values({ id: C, name: C, email: `${C}@example.test` });
    req.users.set(C, { id: C, name: C, email: `${C}@example.test` });
    const [{ id: c1 }] = await db.insert(vault).values({ ownerId: C, name: "C" }).returning({ id: vault.id });
    try {
      // Straight into the table: the route's creation rate limit is lower than the cap.
      await db.insert(apiToken).values(
        Array.from({ length: API_TOKEN_LIMITS.activePerUser }, (_, i) => ({
          userId: C,
          vaultId: c1,
          name: `t${i}`,
          scope: "read" as const,
          tokenHash: hashToken(`seed-${C}-${i}`),
          prefix: "nxs_seed0000",
        })),
      );
      as(C);
      const over = await call(tokensRoute.POST(post({ name: "One too many", scope: "read" })));
      expect(over.status).toBe(409);
      await db.delete(vault).where(eq(vault.id, c1));
      expect(await db.select().from(apiToken).where(eq(apiToken.userId, C))).toHaveLength(0);
    } finally {
      await db.delete(user).where(eq(user.id, C));
    }
  });

  it("rate limits creation per user", async () => {
    const D = `vitest-tok-d-${randomUUID()}`;
    await db.insert(user).values({ id: D, name: D, email: `${D}@example.test` });
    req.users.set(D, { id: D, name: D, email: `${D}@example.test` });
    await db.insert(vault).values({ ownerId: D, name: "D" });
    try {
      as(D);
      const statuses: number[] = [];
      for (let i = 0; i <= API_TOKEN_LIMITS.createsPerHour; i++)
        statuses.push((await call(tokensRoute.POST(post({ name: `n${i}`, scope: "read" })))).status);
      expect(statuses.slice(0, -1).every((s) => s === 201)).toBe(true);
      expect(statuses.at(-1)).toBe(429);
    } finally {
      await db.delete(user).where(eq(user.id, D));
    }
  });
});
