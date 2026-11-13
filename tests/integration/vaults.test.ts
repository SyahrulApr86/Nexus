import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { db } from "@/db";
import { user, vault } from "@/db/schema";
import { createNote } from "@/lib/notes";
import { describeDb, expectHttpError } from "./fixtures";

/*
 * Route-level tests: the real route handlers, with the request headers and the session replaced.
 * `as(userId, vaultId?)` sets who is signed in and which vault the X-Nexus-Vault header names.
 */
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

const vaultsRoute = await import("@/app/api/vaults/route");
const vaultRoute = await import("@/app/api/vaults/[id]/route");
const defaultVaultRoute = await import("@/app/api/vault/route");
const notesRoute = await import("@/app/api/notes/route");
const noteRoute = await import("@/app/api/notes/[id]/route");
const searchRoute = await import("@/app/api/search/route");
const graphRoute = await import("@/app/api/graph/route");
const tagsRoute = await import("@/app/api/tags/route");
const foldersRoute = await import("@/app/api/folders/route");
const bookmarksRoute = await import("@/app/api/bookmarks/route");
const historyRoute = await import("@/app/api/notes/[id]/history/route");
const exportRoute = await import("@/app/api/vault/export/route");
const importRoute = await import("@/app/api/vault/import/route");
const { resolveVaultId } = await import("@/lib/session");
const { VAULT_LIMITS, assertUserQuota, listVaults } = await import("@/lib/vaults");

function as(userId: string, vaultId?: string) {
  req.headers = new Headers({
    "x-test-user": userId,
    ...(vaultId !== undefined ? { "x-nexus-vault": vaultId } : {}),
  });
}

const json = (method: string, body: unknown, url = "http://app.test/api") =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const params = <T extends Record<string, string>>(p: T) => ({
  params: Promise.resolve(p),
});

async function call(res: Promise<Response>) {
  const r = await res;
  const type = r.headers.get("content-type") ?? "";
  return {
    status: r.status,
    body: type.includes("json") ? await r.json() : await r.arrayBuffer(),
  };
}

describeDb("vaults API and vault scoping", () => {
  const A = `vitest-a-${randomUUID()}`;
  const B = `vitest-b-${randomUUID()}`;
  let a1 = "";
  let a2 = "";
  let b1 = "";

  beforeAll(async () => {
    for (const id of [A, B]) {
      await db.insert(user).values({ id, name: id, email: `${id}@example.test` });
      req.users.set(id, { id, name: id, email: `${id}@example.test` });
    }
    [{ id: a1 }] = await db.insert(vault).values({ ownerId: A, name: "Work" }).returning({ id: vault.id });
    [{ id: a2 }] = await db.insert(vault).values({ ownerId: A, name: "Research" }).returning({ id: vault.id });
    [{ id: b1 }] = await db.insert(vault).values({ ownerId: B, name: "B's vault" }).returning({ id: vault.id });
  });

  beforeEach(async () => {
    // Keep only the three vaults made above.
    const extra = (
      await db
        .select({ id: vault.id })
        .from(vault)
        .where(inArray(vault.ownerId, [A, B]))
    )
      .map((v) => v.id)
      .filter((id) => ![a1, a2, b1].includes(id));
    if (extra.length) await db.delete(vault).where(inArray(vault.id, extra));
  });

  afterAll(async () => {
    await db.delete(user).where(inArray(user.id, [A, B]));
  });

  /* ---------------- /api/vaults ---------------- */

  it("lists the user's own vaults only, oldest first, the oldest marked default", async () => {
    as(A);
    const { status, body } = await call(vaultsRoute.GET());
    expect(status).toBe(200);
    expect(body.map((v: { name: string }) => v.name)).toEqual(["Work", "Research"]);
    expect(body.map((v: { isDefault: boolean }) => v.isDefault)).toEqual([true, false]);
  });

  it("refuses without a session", async () => {
    req.headers = new Headers();
    expect((await call(vaultsRoute.GET())).status).toBe(401);
  });

  it("creates a vault, refuses a duplicate name and a non-JSON body", async () => {
    as(A);
    const made = await call(vaultsRoute.POST(json("POST", { name: "  Journal " })));
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ name: "Journal", isDefault: false });
    expect((await call(vaultsRoute.POST(json("POST", { name: "journal" })))).status).toBe(409);
    expect((await call(vaultsRoute.POST(json("POST", { name: "" })))).status).toBe(400);
    expect((await call(vaultsRoute.POST(json("POST", { name: "a/b" })))).status).toBe(400);
    const text = new Request("http://app.test/api", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: '{"name":"x"}',
    });
    expect((await call(vaultsRoute.POST(text))).status).toBe(415);
  });

  it("refuses a cross-site request", async () => {
    req.headers = new Headers({
      "x-test-user": A,
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    });
    expect((await call(vaultsRoute.POST(json("POST", { name: "Evil" })))).status).toBe(403);
  });

  it(`stops at ${VAULT_LIMITS.vaults} vaults per user`, async () => {
    for (let i = 3; i <= VAULT_LIMITS.vaults; i++) await db.insert(vault).values({ ownerId: A, name: `Extra ${i}` });
    expect(await listVaults(A)).toHaveLength(VAULT_LIMITS.vaults);
    as(A);
    const over = await call(vaultsRoute.POST(json("POST", { name: "One too many" })));
    expect(over.status).toBe(409);
  });

  it("renames own vaults; another user's vault is a 404", async () => {
    as(A);
    const r = await call(vaultRoute.PATCH(json("PATCH", { name: "Research notes" }), params({ id: a2 })));
    expect(r.status).toBe(200);
    expect(r.body.name).toBe("Research notes");
    await db.update(vault).set({ name: "Research" }).where(eq(vault.id, a2));
    expect((await call(vaultRoute.PATCH(json("PATCH", { name: "Mine now" }), params({ id: b1 })))).status).toBe(404);
    expect((await db.select().from(vault).where(eq(vault.id, b1)))[0].name).toBe("B's vault");
  });

  it("deletes only with the exact name, never the last vault, never another user's", async () => {
    as(A);
    const made = await call(vaultsRoute.POST(json("POST", { name: "Scratch" })));
    const id = made.body.id as string;
    await createNote(id, "Draft", "to be deleted");
    expect((await call(vaultRoute.DELETE(json("DELETE", { confirm: "scratch" }), params({ id })))).status).toBe(400);
    expect((await call(vaultRoute.DELETE(json("DELETE", {}), params({ id })))).status).toBe(400);
    expect((await call(vaultRoute.DELETE(json("DELETE", { confirm: "Scratch" }), params({ id })))).status).toBe(200);
    expect(await db.select().from(vault).where(eq(vault.id, id))).toEqual([]);

    expect((await call(vaultRoute.DELETE(json("DELETE", { confirm: "B's vault" }), params({ id: b1 })))).status).toBe(
      404,
    );
    as(B);
    expect((await call(vaultRoute.DELETE(json("DELETE", { confirm: "B's vault" }), params({ id: b1 })))).status).toBe(
      409,
    );
  });

  /* ---------------- X-Nexus-Vault on existing routes ---------------- */

  it("resolves the header: own vault, default when absent or empty, 404 otherwise", async () => {
    expect(await resolveVaultId(A, a2)).toBe(a2);
    expect(await resolveVaultId(A, null)).toBe(a1);
    expect(await resolveVaultId(A, "")).toBe(a1);
    await expectHttpError(resolveVaultId(A, b1), 404);
    await expectHttpError(resolveVaultId(A, "not-a-uuid"), 404);
    await expectHttpError(resolveVaultId(A, randomUUID()), 404);
  });

  it("scopes notes, search, tags, folders, graph and history to the header's vault", async () => {
    as(A, a2);
    const made = await call(
      notesRoute.POST(
        json("POST", {
          path: "Papers/Graph theory",
          content: "#maths about [[Euler]] zebracorn",
        }),
      ),
    );
    expect(made.status).toBe(200);
    const id = made.body.id as string;

    // In vault a2 it is there.
    expect((await call(noteRoute.GET(new Request("http://app.test"), params({ id })))).status).toBe(200);
    const hits = await call(searchRoute.GET(new Request("http://app.test/api/search?q=zebracorn")));
    expect(hits.body.map((h: { id: string }) => h.id)).toEqual([id]);
    expect((await call(tagsRoute.GET(new Request("http://app.test/api/tags")))).body).toEqual(
      expect.arrayContaining([expect.objectContaining({ tag: "maths" })]),
    );
    expect((await call(graphRoute.GET())).body.nodes.map((n: { id: string }) => n.id)).toContain(id);
    expect((await call(historyRoute.GET(new Request("http://app.test"), params({ id })))).status).toBe(200);
    const tree = await call(notesRoute.GET());
    expect(JSON.stringify(tree.body)).toContain("Papers/Graph theory");

    // The default vault (no header) and an explicit a1 do not see it.
    for (const v of [undefined, a1]) {
      as(A, v);
      expect((await call(noteRoute.GET(new Request("http://app.test"), params({ id })))).status).toBe(404);
      expect((await call(searchRoute.GET(new Request("http://app.test/api/search?q=zebracorn")))).body).toEqual([]);
      expect((await call(graphRoute.GET())).body.nodes.map((n: { id: string }) => n.id)).not.toContain(id);
      expect(JSON.stringify((await call(notesRoute.GET())).body)).not.toContain("Graph theory");
      expect((await call(historyRoute.GET(new Request("http://app.test"), params({ id })))).status).toBe(404);
    }
    // A folder made through the header's vault lands there only.
    as(A, a2);
    expect((await call(foldersRoute.POST(json("POST", { path: "Inbox" })))).status).toBe(200);
    expect(JSON.stringify((await call(notesRoute.GET())).body)).toContain("Inbox");
    as(A, a1);
    expect(JSON.stringify((await call(notesRoute.GET())).body)).not.toContain("Inbox");
    expect((await call(bookmarksRoute.GET())).body).toEqual([]);
  });

  it("refuses another user's vault id in the header on every route family (IDOR)", async () => {
    const theirs = await createNote(b1, "Private/Diary", "#secret B's diary kumquat");
    as(A, b1);
    const r = [
      await call(notesRoute.GET()),
      await call(notesRoute.POST(json("POST", { path: "Planted", content: "x" }))),
      await call(noteRoute.GET(new Request("http://app.test"), params({ id: theirs.id }))),
      await call(noteRoute.PATCH(json("PATCH", { content: "overwritten" }), params({ id: theirs.id }))),
      await call(noteRoute.DELETE(new Request("http://app.test", { method: "DELETE" }), params({ id: theirs.id }))),
      await call(searchRoute.GET(new Request("http://app.test/api/search?q=kumquat"))),
      await call(graphRoute.GET()),
      await call(tagsRoute.GET(new Request("http://app.test/api/tags"))),
      await call(foldersRoute.POST(json("POST", { path: "Planted folder" }))),
      await call(bookmarksRoute.GET()),
      await call(historyRoute.GET(new Request("http://app.test"), params({ id: theirs.id }))),
      await call(defaultVaultRoute.GET()),
      await call(exportRoute.GET(new Request("http://app.test/api/vault/export"))),
    ];
    expect(r.map((x) => x.status)).toEqual(r.map(() => 404));
    // And without the header, user A's default vault never shows B's note.
    as(A);
    expect((await call(searchRoute.GET(new Request("http://app.test/api/search?q=kumquat")))).body).toEqual([]);
    as(B);
    expect((await call(noteRoute.GET(new Request("http://app.test"), params({ id: theirs.id })))).body.content).toBe(
      "#secret B's diary kumquat",
    );
  });

  it("GET /api/vault keeps answering with the default vault, or the header's", async () => {
    as(A);
    expect((await call(defaultVaultRoute.GET())).body).toEqual({
      id: a1,
      name: "Work",
    });
    as(A, a2);
    expect((await call(defaultVaultRoute.GET())).body).toEqual({
      id: a2,
      name: "Research",
    });
  });

  it("exports and imports into the header's vault only", async () => {
    await createNote(a1, "Only in work", "work");
    await createNote(a2, "Only in research", "research");
    as(A, a2);
    const zip = await call(exportRoute.GET(new Request("http://app.test/api/vault/export")));
    expect(zip.status).toBe(200);
    const names = Object.keys(unzipSync(new Uint8Array(zip.body as ArrayBuffer)));
    expect(names).toContain("Only in research.md");
    expect(names).not.toContain("Only in work.md");

    const form = new FormData();
    form.append(
      "file",
      new File(["imported into research"], "Imported.md", {
        type: "text/markdown",
      }),
    );
    const imp = await call(
      importRoute.POST(
        new Request("http://app.test/api/vault/import", {
          method: "POST",
          body: form,
        }),
      ),
    );
    expect(imp.status).toBe(200);
    as(A, a2);
    const inA2 = await call(searchRoute.GET(new Request("http://app.test/api/search?q=imported")));
    expect(inA2.body.length).toBe(1);
    as(A, a1);
    expect((await call(searchRoute.GET(new Request("http://app.test/api/search?q=imported")))).body).toEqual([]);
  });

  it("counts the per-user quota across vaults", async () => {
    await createNote(a1, "Q1", "x");
    await expect(db.transaction((tx) => assertUserQuota(tx, a2))).resolves.toBeUndefined();
    await expectHttpError(assertUserQuota(db, randomUUID()), 404);
  });
});
