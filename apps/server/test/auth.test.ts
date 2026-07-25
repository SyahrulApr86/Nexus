import { beforeEach, describe, expect, it } from "vitest";
import {
  api,
  GOOD_PW,
  registerAndLogin,
  resetDb,
  sessionCookie,
} from "./helpers.js";
import { prisma } from "../src/db.js";
import { redis } from "../src/redis.js";

beforeEach(resetDb);

describe("FR-001 registration", () => {
  it("creates account + vault and starts a session (US1-S1)", async () => {
    const res = await api("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email: "new@example.com", password: GOOD_PW }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.user.email).toBe("new@example.com");
    expect(res.headers.get("set-cookie")).toContain("nexus_session=");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");

    const vault = await prisma.vault.findFirst({
      where: { user: { email: "new@example.com" } },
    });
    expect(vault).not.toBeNull();
  });

  it("rejects weak password with specific per-rule feedback (US1-S2)", async () => {
    const res = await api("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email: "new@example.com", password: "abcdefgh" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    const messages = JSON.stringify(body);
    expect(messages).toContain("uppercase");
    expect(messages).toContain("digit");
    expect(messages).toContain("special character");
    expect(messages).not.toContain("8 characters");
  });

  it("rejects duplicate email with clear error (edge case)", async () => {
    await registerAndLogin("dup@example.com");
    const res = await api("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email: "dup@example.com", password: GOOD_PW }),
    });
    expect(res.status).toBe(409);
    const body = await res.json() as any;
    expect(body.error).toMatch(/already registered/i);
  });

  it("never stores the plaintext password", async () => {
    await registerAndLogin("hash@example.com");
    const user = await prisma.user.findUnique({
      where: { email: "hash@example.com" },
    });
    expect(user!.passwordHash).not.toContain(GOOD_PW);
    expect(user!.passwordHash).toMatch(/^\$argon2/);
  });
});

describe("FR-002 login", () => {
  beforeEach(async () => {
    await registerAndLogin("login@example.com");
  });

  it("authenticates with correct credentials (US1-S3)", async () => {
    const res = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "login@example.com", password: GOOD_PW }),
    });
    expect(res.status).toBe(200);
    const me = await api("/auth/me", { cookie: sessionCookie(res) });
    expect(me.status).toBe(200);
    expect((await me.json() as any).user.email).toBe("login@example.com");
  });

  it("returns a generic error for wrong password AND unknown email (US1-S4)", async () => {
    const wrongPw = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "login@example.com", password: "Wrong1!x" }),
    });
    const unknown = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "ghost@example.com", password: GOOD_PW }),
    });
    expect(wrongPw.status).toBe(401);
    expect(unknown.status).toBe(401);
    // Anti-enumeration: identical bodies
    expect(await wrongPw.text()).toBe(await unknown.text());
  });
});

describe("FR-002b account lockout", () => {
  beforeEach(async () => {
    await registerAndLogin("lock@example.com");
  });

  async function failLogin(n: number) {
    let last: Response | undefined;
    for (let i = 0; i < n; i++) {
      last = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "lock@example.com", password: "Bad1!bad" }),
      });
    }
    return last!;
  }

  it("locks after 5 consecutive failures (US1b-S4)", async () => {
    const fifth = await failLogin(5);
    expect(fifth.status).toBe(423);
    expect((await fifth.json() as any).error).toMatch(/locked/i);

    // Even correct credentials are rejected while locked
    const correct = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "lock@example.com", password: GOOD_PW }),
    });
    expect(correct.status).toBe(423);
  });

  it("does not lock at 4 failures and resets counter on success", async () => {
    await failLogin(4);
    const ok = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "lock@example.com", password: GOOD_PW }),
    });
    expect(ok.status).toBe(200);
    // Counter reset: 4 more failures still don't lock
    const fourth = await failLogin(4);
    expect(fourth.status).toBe(401);
  });
});

describe("FR-003 sessions", () => {
  it("logout destroys the session (US1-S5)", async () => {
    const { cookie } = await registerAndLogin();
    const out = await api("/auth/logout", { method: "POST", cookie });
    expect(out.status).toBe(200);
    const me = await api("/auth/me", { cookie });
    expect(me.status).toBe(401);
  });

  it("expired session returns SESSION_EXPIRED code (US1-S6)", async () => {
    const { cookie } = await registerAndLogin();
    // Simulate idle expiry by removing the redis session
    const keys = await redis.keys("sess:*");
    expect(keys.length).toBeGreaterThan(0);
    await redis.del(...keys);
    const me = await api("/auth/me", { cookie });
    expect(me.status).toBe(401);
    expect((await me.json() as any).code).toBe("SESSION_EXPIRED");
  });

  it("unauthenticated request (no cookie) gets UNAUTHENTICATED code", async () => {
    const me = await api("/auth/me");
    expect(me.status).toBe(401);
    expect((await me.json() as any).code).toBe("UNAUTHENTICATED");
  });

  it("session TTL follows the user's idle timeout preference", async () => {
    const { cookie } = await registerAndLogin();
    await api("/auth/preferences", {
      method: "PATCH",
      cookie,
      body: JSON.stringify({ idleTimeoutMinutes: 5 }),
    });
    // Next authed request re-touches the session with the new TTL
    await api("/auth/me", { cookie });
    const keys = await redis.keys("sess:*");
    const ttl = await redis.ttl(keys[0]!);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(5 * 60);
  });

  it("rejects idle timeout outside 5-120 range", async () => {
    const { cookie } = await registerAndLogin();
    for (const bad of [4, 121, 0]) {
      const res = await api("/auth/preferences", {
        method: "PATCH",
        cookie,
        body: JSON.stringify({ idleTimeoutMinutes: bad }),
      });
      expect(res.status).toBe(400);
    }
  });
});

describe("theme preference (FR-022)", () => {
  it("persists theme across sessions", async () => {
    const { cookie } = await registerAndLogin("theme@example.com");
    await api("/auth/preferences", {
      method: "PATCH",
      cookie,
      body: JSON.stringify({ theme: "dark" }),
    });
    // New login, fresh session
    const login = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "theme@example.com", password: GOOD_PW }),
    });
    const me = await api("/auth/me", { cookie: sessionCookie(login) });
    expect((await me.json() as any).user.theme).toBe("dark");
  });
});
