import { beforeEach, describe, expect, it } from "vitest";
import { api, GOOD_PW, resetDb, sessionCookie } from "./helpers.js";
import { prisma } from "../src/db.js";
import { redis } from "../src/redis.js";

beforeEach(resetDb);

async function register(body: Record<string, unknown>) {
  return api("/auth/register", { method: "POST", body: JSON.stringify(body) });
}

async function login(body: Record<string, unknown>) {
  return api("/auth/login", { method: "POST", body: JSON.stringify(body) });
}

describe("username registration", () => {
  it("stores the chosen username lowercased", async () => {
    const res = await register({
      email: "dana@example.com",
      username: "DanaWrites",
      password: GOOD_PW,
    });
    expect(res.status).toBe(201);
    expect((await res.json() as any).user.username).toBe("danawrites");
  });

  it("derives a username from the email when none is given", async () => {
    const res = await register({
      email: "Karin.Reads@example.com",
      password: GOOD_PW,
    });
    expect(res.status).toBe(201);
    expect((await res.json() as any).user.username).toBe("karinreads");
  });

  it("suffixes a derived username that is already taken", async () => {
    await register({ email: "dana@one.com", password: GOOD_PW });
    const second = await register({ email: "dana@two.com", password: GOOD_PW });
    expect(second.status).toBe(201);
    expect((await second.json() as any).user.username).toBe("dana2");
  });

  it("rejects a taken username, case-insensitively, with a clear error", async () => {
    await register({
      email: "first@example.com",
      username: "dana",
      password: GOOD_PW,
    });
    const res = await register({
      email: "second@example.com",
      username: "DANA",
      password: GOOD_PW,
    });
    expect(res.status).toBe(409);
    expect((await res.json() as any).error).toMatch(/username/i);
  });

  it("rejects malformed usernames", async () => {
    for (const username of ["ab", "has space", "email@like", "x".repeat(31)]) {
      const res = await register({
        email: `u${Math.random()}@example.com`,
        username,
        password: GOOD_PW,
      });
      expect(res.status, username).toBe(400);
    }
  });
});

describe("login by username or email", () => {
  beforeEach(async () => {
    await register({
      email: "dana@example.com",
      username: "dana",
      password: GOOD_PW,
    });
  });

  it("accepts the username", async () => {
    const res = await login({ identifier: "dana", password: GOOD_PW });
    expect(res.status).toBe(200);
    const me = await api("/auth/me", { cookie: sessionCookie(res) });
    expect((await me.json() as any).user.email).toBe("dana@example.com");
  });

  it("accepts the username in any case", async () => {
    const res = await login({ identifier: "DaNa", password: GOOD_PW });
    expect(res.status).toBe(200);
  });

  it("still accepts the email", async () => {
    const res = await login({
      identifier: "dana@example.com",
      password: GOOD_PW,
    });
    expect(res.status).toBe(200);
  });

  it("gives the same generic error for a bad password and an unknown name", async () => {
    const badPassword = await login({ identifier: "dana", password: "Wrong1!x" });
    const unknown = await login({ identifier: "ghost", password: GOOD_PW });
    expect(badPassword.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await badPassword.text()).toBe(await unknown.text());
  });

  it("locks the account whichever identifier the attacker uses (FR-002b)", async () => {
    // Three failures by username, two by email — same account, so the fifth
    // attempt must trip the lock rather than resetting a separate counter.
    for (const identifier of ["dana", "dana", "dana", "dana@example.com"]) {
      await login({ identifier, password: "Bad1!bad" });
    }
    const fifth = await login({
      identifier: "dana@example.com",
      password: "Bad1!bad",
    });
    expect(fifth.status).toBe(423);

    const correct = await login({ identifier: "dana", password: GOOD_PW });
    expect(correct.status).toBe(423);
  });

  it("keeps usernames and emails in separate namespaces", async () => {
    // A username that looks like someone else's email must not log them in
    await register({
      email: "someone@else.com",
      username: "other",
      password: GOOD_PW,
    });
    const res = await login({ identifier: "other", password: GOOD_PW });
    expect(res.status).toBe(200);
    const me = await api("/auth/me", { cookie: sessionCookie(res) });
    expect((await me.json() as any).user.email).toBe("someone@else.com");
  });
});

describe("username is exposed to the client", () => {
  it("returns it from /auth/me", async () => {
    const reg = await register({
      email: "dana@example.com",
      username: "dana",
      password: GOOD_PW,
    });
    const me = await api("/auth/me", { cookie: sessionCookie(reg) });
    expect((await me.json() as any).user.username).toBe("dana");
    await redis.flushdb();
    expect(await prisma.user.count()).toBe(1);
  });
});
