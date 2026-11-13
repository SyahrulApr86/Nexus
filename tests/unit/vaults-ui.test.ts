import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Active vault plumbing in src/components/workspace/api.ts: which vault a request names, how the
 * choice survives reloads (?v= and localStorage), and how each vault keeps its own layout.
 * The module keeps state per page, so every test imports a fresh copy into a fake browser.
 */

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const USER = "someone@example.test";

type Fake = { store: Map<string, string>; href: string; assigned: string[]; replaced: string[]; fetches: { url: string; init?: RequestInit }[] };
let fake: Fake;

function browser(href: string, store: Record<string, string> = {}, respond?: (url: string) => Response) {
  fake = { store: new Map(Object.entries(store)), href, assigned: [], replaced: [], fetches: [] };
  const location = {
    get href() {
      return fake.href;
    },
    get search() {
      return new URL(fake.href).search;
    },
    get origin() {
      return new URL(fake.href).origin;
    },
    assign: (u: string | URL) => fake.assigned.push(String(u)),
    replace: (u: string | URL) => fake.replaced.push(String(u)),
  };
  vi.stubGlobal("window", { location, history: { state: null, replaceState: (_s: unknown, _t: string, u: string | URL) => (fake.href = String(u)) } });
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => fake.store.get(k) ?? null,
    setItem: (k: string, v: string) => fake.store.set(k, v),
    removeItem: (k: string) => fake.store.delete(k),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      fake.fetches.push({ url, init });
      return respond ? respond(url) : Response.json({ notes: [], folders: [] });
    }),
  );
}

async function load() {
  vi.resetModules();
  return import("@/components/workspace/api");
}

const header = (i = 0) => new Headers(fake.fetches[i].init?.headers).get("x-nexus-vault");
const userKey = () => [...fake.store.keys()].find((k) => k.startsWith("nexus-vault:"));

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("active vault", () => {
  it("sends no vault header until one is chosen: the server uses the default vault", async () => {
    browser("http://app.test/vault");
    const m = await load();
    expect(m.initActiveVault(USER)).toBeNull();
    await m.api.tree();
    expect(header()).toBeNull();
    expect(m.vaultHeaders()).toEqual({});
  });

  it("takes ?v= from the URL, sends it on every request and remembers it per user", async () => {
    browser(`http://app.test/vault?v=${A}&n=x`);
    const m = await load();
    expect(m.initActiveVault(USER)).toBe(A);
    await m.api.tree();
    await m.api.save("note-1", "text");
    expect(header(0)).toBe(A);
    expect(header(1)).toBe(A);
    // JSON bodies still say so (the API refuses anything else).
    expect(new Headers(fake.fetches[1].init?.headers).get("content-type")).toBe("application/json");
    expect(m.vaultHeaders()).toEqual({ "x-nexus-vault": A });
    const key = userKey();
    expect(key).toBeDefined();
    expect(key).not.toContain(USER); // the email is never a storage key
    expect(fake.store.get(key!)).toBe(A);
  });

  it("falls back to this user's last vault and puts it in the URL next to ?n=", async () => {
    browser(`http://app.test/vault?v=${A}`);
    let m = await load();
    m.initActiveVault(USER);
    browser("http://app.test/vault?n=abc", Object.fromEntries(fake.store));
    m = await load();
    expect(m.initActiveVault(USER)).toBe(A);
    const url = new URL(fake.href);
    expect(url.searchParams.get("v")).toBe(A);
    expect(url.searchParams.get("n")).toBe("abc");
  });

  it("does not share one user's choice with another user on the same device", async () => {
    browser(`http://app.test/vault?v=${A}`);
    let m = await load();
    m.initActiveVault(USER);
    browser("http://app.test/vault", Object.fromEntries(fake.store));
    m = await load();
    expect(m.initActiveVault("other@example.test")).toBeNull();
  });

  it("ignores a ?v= that is not a vault id", async () => {
    browser("http://app.test/vault?v=../../etc");
    const m = await load();
    expect(m.initActiveVault(USER)).toBeNull();
  });

  it("does not send a JSON content type on GET or multipart requests", async () => {
    browser(`http://app.test/vault?v=${A}`);
    const m = await load();
    m.initActiveVault(USER);
    await m.api.importFiles([]);
    const h = new Headers(fake.fetches[0].init?.headers);
    expect(h.get("content-type")).toBeNull();
    expect(h.get("x-nexus-vault")).toBe(A);
  });
});

describe("switching vaults", () => {
  it("keeps each vault's layout and opens the other vault in a fresh page", async () => {
    browser(`http://app.test/vault?v=${A}&n=x`, { "nexus-layout": "layout-of-A" });
    const m = await load();
    m.initActiveVault(USER);
    m.goToVault(B, A);
    expect(fake.store.get(`nexus-layout@${A}`)).toBe("layout-of-A");
    expect(fake.store.has("nexus-layout")).toBe(false); // B has no saved layout yet
    expect(fake.assigned).toEqual([`http://app.test/vault?v=${B}`]);
    expect(fake.store.get(userKey()!)).toBe(B);

    // Back to A from B: B's layout is kept, A's comes back.
    fake.store.set("nexus-layout", "layout-of-B");
    m.goToVault(A, B);
    expect(fake.store.get(`nexus-layout@${B}`)).toBe("layout-of-B");
    expect(fake.store.get("nexus-layout")).toBe("layout-of-A");
  });

  it("swaps in the right layout when a bookmark opens another vault than last time", async () => {
    browser(`http://app.test/vault?v=${A}`, {
      "nexus-layout": "layout-of-B",
      "nexus-layout-vault": B,
      [`nexus-layout@${A}`]: "layout-of-A",
    });
    const m = await load();
    m.initActiveVault(USER);
    expect(fake.store.get("nexus-layout")).toBe("layout-of-A");
    expect(fake.store.get(`nexus-layout@${B}`)).toBe("layout-of-B");
  });

  it("adopts a layout saved before vaults were tracked instead of dropping it", async () => {
    browser(`http://app.test/vault?v=${A}`, { "nexus-layout": "older-layout" });
    const m = await load();
    m.initActiveVault(USER);
    expect(fake.store.get("nexus-layout")).toBe("older-layout");
    expect(fake.store.get("nexus-layout-vault")).toBe(A);
  });

  it("forgets a deleted vault's layout", async () => {
    browser("http://app.test/vault", { [`nexus-layout@${B}`]: "old" });
    const m = await load();
    m.forgetVaultLayout(B);
    expect(fake.store.has(`nexus-layout@${B}`)).toBe(false);
  });
});

describe("a vault that no longer exists", () => {
  it("drops the stale choice once and reopens the default vault", async () => {
    browser(`http://app.test/vault?v=${A}&n=x`, {}, () => Response.json({ error: "Vault not found" }, { status: 404 }));
    const m = await load();
    m.initActiveVault(USER);
    await expect(m.api.tree()).rejects.toMatchObject({ status: 404 });
    await expect(m.api.tags()).rejects.toMatchObject({ status: 404 });
    expect(fake.replaced).toEqual(["http://app.test/vault"]);
    expect(fake.store.has(userKey()!)).toBe(false);
  });

  it("leaves other 404s alone", async () => {
    browser(`http://app.test/vault?v=${A}`, {}, () => Response.json({ error: "Note not found" }, { status: 404 }));
    const m = await load();
    m.initActiveVault(USER);
    await expect(m.api.get("missing")).rejects.toMatchObject({ status: 404, message: "Note not found" });
    expect(fake.replaced).toEqual([]);
  });
});

describe("vault and share requests", () => {
  it("names the endpoints and bodies the API documents", async () => {
    browser(`http://app.test/vault?v=${A}`);
    const m = await load();
    m.initActiveVault(USER);
    await m.api.vaults();
    await m.api.createVault("Work");
    await m.api.renameVault(B, "Archive");
    await m.api.deleteVault(B, "Archive");
    await m.api.shares("n1");
    await m.api.createShare("n1", 7);
    await m.api.createShare("n1", null);
    await m.api.revokeShare("s1");
    const calls = fake.fetches.map((f) => `${f.init?.method ?? "GET"} ${f.url} ${f.init?.body ?? ""}`.trim());
    expect(calls).toEqual([
      "GET /api/vaults",
      'POST /api/vaults {"name":"Work"}',
      `PATCH /api/vaults/${B} {"name":"Archive"}`,
      `DELETE /api/vaults/${B} {"confirm":"Archive"}`,
      "GET /api/notes/n1/share",
      'POST /api/notes/n1/share {"expiresInDays":7}',
      'POST /api/notes/n1/share {"expiresInDays":null}',
      "DELETE /api/shares/s1",
    ]);
  });
});
