import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * "Export vault as .zip" must export the vault on screen: the default vault keeps a plain
 * navigation, any other vault is fetched with its X-Nexus-Vault header and saved from a blob.
 */

const A = "11111111-1111-4111-8111-111111111111";

type Env = { assigned: string[]; fetches: { url: string; init?: RequestInit }[]; clicks: { href: string; download: string }[]; revoked: string[] };

async function load(href: string, respond: () => Response) {
  vi.resetModules();
  const env: Env = { assigned: [], fetches: [], clicks: [], revoked: [] };
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal("window", {
    location: { href, search: new URL(href).search, origin: new URL(href).origin, assign: (u: string) => env.assigned.push(String(u)) },
    history: { state: null, replaceState: () => {} },
    localStorage: globalThis.localStorage,
  });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    env.fetches.push({ url, init });
    return respond();
  });
  vi.stubGlobal("document", {
    body: { append: () => {} },
    createElement: () => {
      const a = { href: "", download: "", rel: "", style: {} as Record<string, string>, click: () => env.clicks.push({ href: a.href, download: a.download }), remove: () => {} };
      return a;
    },
  });
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: () => "blob:x", revokeObjectURL: (u: string) => env.revoked.push(u) }));
  const api = await import("@/components/workspace/api");
  api.initActiveVault("someone@example.test");
  const mod = await import("@/components/workspace/vaults-export");
  return { env, mod };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("exportActiveVault", () => {
  it("navigates for the default vault", async () => {
    const { env, mod } = await load("http://localhost/vault", () => new Response(""));
    const notify = vi.fn(() => 1);
    await mod.exportActiveVault(notify);
    expect(env.assigned).toEqual(["http://localhost/api/vault/export"]);
    expect(env.fetches).toHaveLength(0);
  });

  it("fetches another vault with its header and downloads the blob", async () => {
    vi.useFakeTimers();
    const { env, mod } = await load(`http://localhost/vault?v=${A}`, () =>
      new Response(new Uint8Array([80, 75]), { headers: { "Content-Disposition": 'attachment; filename="nexus-vault-2026.zip"' } }),
    );
    const notify = vi.fn(() => 1);
    await mod.exportActiveVault(notify);
    expect(env.assigned).toEqual([]);
    expect(env.fetches).toHaveLength(1);
    expect(env.fetches[0].url).toBe("/api/vault/export");
    expect((env.fetches[0].init?.headers as Record<string, string>)["x-nexus-vault"]).toBe(A);
    expect(env.clicks).toEqual([{ href: "blob:x", download: "nexus-vault-2026.zip" }]);
    vi.runAllTimers();
    expect(env.revoked).toEqual(["blob:x"]);
  });

  it.each([
    [409, "An export of this vault is already running"],
    [429, "Too many requests"],
  ])("shows the server's error for %i", async (status, error) => {
    const { env, mod } = await load(`http://localhost/vault?v=${A}`, () => Response.json({ error }, { status }));
    const notify = vi.fn(() => 1);
    await mod.exportActiveVault(notify);
    expect(notify).toHaveBeenCalledWith(error, { tone: "error" });
    expect(env.clicks).toHaveLength(0);
  });
});

describe("zipFileName", () => {
  it("reads quoted, bare and encoded names and never returns a path", async () => {
    const { zipFileName } = await import("@/components/workspace/vaults-export");
    expect(zipFileName('attachment; filename="a.zip"')).toBe("a.zip");
    expect(zipFileName("attachment; filename=b.zip")).toBe("b.zip");
    expect(zipFileName("attachment; filename*=UTF-8''c%20d.zip")).toBe("c d.zip");
    expect(zipFileName('attachment; filename="../../etc/x.zip"')).toBe("x.zip");
    expect(zipFileName(null)).toBe("nexus-vault.zip");
  });
});
