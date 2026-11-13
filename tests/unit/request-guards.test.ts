import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { HttpError, assertSameOrigin, handle, logError, rateLimit, readBody, readJson } from "@/lib/session";
import { assertSecureBaseUrl, authOptions, trustedProxies } from "@/lib/auth";
import nextConfig, { contentSecurityPolicy } from "../../next.config";
import { ATTACHMENT_CSP } from "@/lib/attachments/headers";

/** Better Auth's own client-IP resolver (the rate-limit key), which it does not export publicly. */
type GetIP = (req: Headers, options: unknown) => string | null;
async function loadGetIP(): Promise<GetIP> {
  // The installed better-auth/ folder sits next to its @better-auth/core dependency in pnpm's store.
  const pkg = realpathSync(join(process.cwd(), "node_modules", "better-auth"));
  const file = join(dirname(pkg), "@better-auth", "core", "dist", "utils", "ip.mjs");
  return (await import(pathToFileURL(file).href)).getIP;
}

async function status(fn: () => unknown) {
  try {
    await fn();
    return 200;
  } catch (e) {
    expect(e).toBeInstanceOf(HttpError);
    return (e as HttpError).status;
  }
}

/** A request whose body arrives in chunks without a Content-Length (chunked transfer). */
function chunked(bytes: number, type = "application/json") {
  const chunk = new Uint8Array(64 * 1024).fill(32);
  let sent = 0;
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      pulls++;
      if (sent >= bytes) return c.close();
      sent += chunk.byteLength;
      c.enqueue(chunk);
    },
  });
  const req = new Request("http://app.test/api/notes", {
    method: "POST",
    body,
    headers: { "content-type": type },
    duplex: "half",
  } as RequestInit);
  return { req, pulls: () => pulls };
}

describe("readBody / readJson (request size limits)", () => {
  it("refuses a declared Content-Length above the limit without reading", async () => {
    const req = new Request("http://app.test/x", {
      method: "POST",
      body: "x".repeat(100),
      headers: { "content-type": "application/json", "content-length": "100" },
    });
    expect(await status(() => readBody(req, 10))).toBe(413);
    expect(req.bodyUsed).toBe(false);
  });

  it("stops reading a chunked body as soon as it passes the limit", async () => {
    const { req, pulls } = chunked(50 * 1024 * 1024);
    expect(await status(() => readBody(req, 256 * 1024))).toBe(413);
    expect(pulls()).toBeLessThan(10);
  });

  it("parses JSON within the limit", async () => {
    const req = new Request("http://app.test/x", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
      headers: { "content-type": "application/json; charset=utf-8" },
    });
    expect(await readJson(req, 1024)).toEqual({ a: 1 });
  });

  it("answers 415 for a JSON route called without application/json (no-preflight CSRF)", async () => {
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", ""]) {
      const req = new Request("http://app.test/x", { method: "POST", body: "{}", headers: type ? { "content-type": type } : {} });
      expect(await status(() => readJson(req, 1024))).toBe(415);
    }
  });

  it("answers 400 for malformed JSON", async () => {
    const req = new Request("http://app.test/x", { method: "POST", body: "{", headers: { "content-type": "application/json" } });
    expect(await status(() => readJson(req, 1024))).toBe(400);
  });
});

describe("assertSameOrigin (CSRF defence in depth)", () => {
  beforeEach(() => {
    vi.stubEnv("BETTER_AUTH_URL", "https://notes.example.com");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  const check = (h: Record<string, string>) => status(() => assertSameOrigin(new Headers(h)));

  it("allows same-origin browser requests and non-browser clients", async () => {
    expect(await check({ "sec-fetch-site": "same-origin", origin: "https://notes.example.com" })).toBe(200);
    expect(await check({ "sec-fetch-site": "none" })).toBe(200);
    expect(await check({})).toBe(200);
  });

  it("refuses cross-site and same-site (sibling subdomain) requests", async () => {
    expect(await check({ "sec-fetch-site": "cross-site", origin: "https://evil.test" })).toBe(403);
    expect(await check({ "sec-fetch-site": "same-site", origin: "https://blog.example.com" })).toBe(403);
    expect(await check({ origin: "https://blog.example.com" })).toBe(403);
    expect(await check({ origin: "null" })).toBe(403);
  });

  it("falls back to the Host header when no origin is configured", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "");
    expect(await check({ origin: "http://localhost:3000", host: "localhost:3000" })).toBe(200);
    expect(await check({ origin: "http://evil.test", host: "localhost:3000" })).toBe(403);
  });
});

describe("rateLimit", () => {
  it("allows max calls per window, then 429", async () => {
    const key = `test:${Math.random()}`;
    for (let i = 0; i < 3; i++) rateLimit(key, 3, 60_000);
    expect(await status(() => rateLimit(key, 3, 60_000))).toBe(429);
  });
});

describe("logError (no note content in logs)", () => {
  it("logs the error class and code, never the message or bound parameters", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(new Error("Failed query: insert ...\nparams: SECRET NOTE BODY"), {
      name: "DrizzleQueryError",
      cause: Object.assign(new Error("invalid byte sequence"), { code: "22021" }),
    });
    logError("api", err);
    const logged = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    expect(logged).toContain("DrizzleQueryError");
    expect(logged).toContain("22021");
    expect(logged).not.toContain("SECRET NOTE BODY");
    expect(logged).not.toContain("Failed query");
  });
});

describe("auth hardening", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("closes self-registration unless NEXUS_ALLOW_SIGNUP=true", () => {
    vi.stubEnv("NEXUS_ALLOW_SIGNUP", "");
    expect(authOptions().emailAndPassword.disableSignUp).toBe(true);
    vi.stubEnv("NEXUS_ALLOW_SIGNUP", "1");
    expect(authOptions().emailAndPassword.disableSignUp).toBe(true);
    vi.stubEnv("NEXUS_ALLOW_SIGNUP", "true");
    expect(authOptions().emailAndPassword.disableSignUp).toBe(false);
  });

  it("sets explicit sign-in and sign-up rate limits", () => {
    const rules = authOptions().rateLimit.customRules;
    expect(rules["/sign-in/email"].max).toBeLessThanOrEqual(5);
    expect(rules["/sign-up/email"].max).toBeLessThanOrEqual(5);
  });

  it("refuses an http:// base URL in production, except localhost", () => {
    expect(() => assertSecureBaseUrl("http://notes.example.com", "production")).toThrow();
    // A missing URL must throw whatever the shell exports (a dev .env sets an http://localhost URL).
    vi.stubEnv("BETTER_AUTH_URL", "");
    expect(() => assertSecureBaseUrl(undefined, "production")).toThrow();
    expect(() => assertSecureBaseUrl("", "production")).toThrow();
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    expect(() => assertSecureBaseUrl("", "production")).toThrow();
    expect(() => assertSecureBaseUrl("https://notes.example.com", "production")).not.toThrow();
    expect(() => assertSecureBaseUrl("http://localhost:3000", "production")).not.toThrow();
    expect(() => assertSecureBaseUrl("http://notes.example.com", "development")).not.toThrow();
  });

  it("keys the rate limit on the hop the trusted proxy appended, not on a client-chosen value", async () => {
    const getIP = await loadGetIP();
    const opts = (proxies: string[]) => ({ advanced: { ipAddress: { ipAddressHeaders: ["x-forwarded-for"], trustedProxies: proxies } } });
    const ip = (xff: string, proxies: string[]) => getIP(new Headers({ "x-forwarded-for": xff }), opts(proxies));
    // Proxy appends the real peer after whatever the client sent: the spoofed values rotate, the key does not.
    expect(ip("1.1.1.1, 203.0.113.9", trustedProxies("127.0.0.1"))).toBe("203.0.113.9");
    expect(ip("2.2.2.2, 203.0.113.9", trustedProxies("127.0.0.1"))).toBe("203.0.113.9");
    expect(ip("2.2.2.2, 203.0.113.9, 10.231.47.1", trustedProxies("127.0.0.1, 10.231.47.0/24"))).toBe("203.0.113.9");
    // No trusted proxies: a multi-hop header is never used as the key (Better Auth falls back to a
    // shared bucket in production, to localhost in tests), so the client value cannot pick it.
    expect(ip("1.1.1.1, 203.0.113.9", [])).not.toBe("1.1.1.1");
    expect(ip("1.1.1.1, 203.0.113.9", [])).not.toBe("203.0.113.9");
  });
});

describe("security headers (next.config.ts)", () => {
  it("disables X-Powered-By", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("sends CSP, framing, sniffing, referrer and permissions headers on every route", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/(.*)")!;
    const names = all.headers.map((h) => h.key);
    for (const h of [
      "Content-Security-Policy",
      "X-Frame-Options",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
    ])
      expect(names).toContain(h);
    const api = rules.find((r) => r.source.startsWith("/api/"))!;
    expect(api.headers).toContainEqual({ key: "Cache-Control", value: "private, no-store" });
    // Every API path but the attachment file route (which sets its own private caching).
    const re = new RegExp(`^/api/${api.source.slice("/api/:path".length)}$`);
    expect(re.test("/api/notes")).toBe(true);
    expect(re.test("/api/attachments")).toBe(true);
    expect(re.test("/api/attachments/file/x")).toBe(true);
    expect(re.test("/api/attachments/file")).toBe(false);
  });

  it("production CSP forbids framing, eval, plugins and foreign connections", () => {
    const csp = contentSecurityPolicy(false);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/connect-src[^;]*ws:/);
  });

  it("gives attachment files the sandbox policy, after (so instead of) the page policy", async () => {
    const rules = await nextConfig.headers!();
    const at = rules.findIndex((r) => r.source === "/api/attachments/file");
    expect(at).toBeGreaterThan(rules.findIndex((r) => r.source === "/(.*)"));
    expect(rules[at].headers).toEqual([{ key: "Content-Security-Policy", value: ATTACHMENT_CSP }]);
    expect(ATTACHMENT_CSP).toMatch(/^sandbox;/);
    expect(ATTACHMENT_CSP).not.toMatch(/script-src|allow-scripts/);
  });

  it("keeps images and media same-origin, so a note cannot load remote trackers", () => {
    const csp = contentSecurityPolicy(false);
    expect(csp).toContain("img-src 'self' data: blob:;");
    expect(csp).toContain("media-src 'self'");
    expect(csp).not.toMatch(/img-src[^;]*https:/);
  });
});

describe("handle", () => {
  it("sends an HttpError body as is, so a 409 can carry the current note", async () => {
    const note = { id: "n1", content: "theirs", updatedAt: "2026-01-01T00:00:00.000Z" };
    const res = await handle(async () => {
      throw new HttpError(409, "conflict", { error: "conflict", note });
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "conflict", note });
  });

  it("keeps { error: message } for an HttpError without a body", async () => {
    const res = await handle(async () => {
      throw new HttpError(404, "Note not found");
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Note not found" });
  });
});
