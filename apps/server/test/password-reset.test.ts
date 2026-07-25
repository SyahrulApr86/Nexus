import { beforeEach, describe, expect, it } from "vitest";
import { api, GOOD_PW, registerAndLogin, resetDb } from "./helpers.js";
import { getSentMailForTests, clearSentMailForTests } from "../src/lib/mail.js";
import { prisma } from "../src/db.js";

beforeEach(async () => {
  await resetDb();
  clearSentMailForTests();
});

const NEW_PW = "N3w$ecret!";

async function requestReset(email: string) {
  return api("/auth/request-password-reset", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

function extractToken(): string {
  const mail = getSentMailForTests().at(-1);
  if (!mail) throw new Error("no mail sent");
  const m = mail.text.match(/token=([A-Za-z0-9_-]+)/);
  if (!m) throw new Error(`no token in mail: ${mail.text}`);
  return m[1]!;
}

describe("FR-002a password reset", () => {
  beforeEach(async () => {
    await registerAndLogin("reset@example.com");
  });

  it("acknowledges request identically for registered and unknown emails (US1b-S1)", async () => {
    const known = await requestReset("reset@example.com");
    const unknown = await requestReset("ghost@example.com");
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await known.text()).toBe(await unknown.text());
    // Mail only actually sent for the registered address
    expect(getSentMailForTests()).toHaveLength(1);
  });

  it("full reset flow: new password works, old rejected, link single-use (US1b-S2)", async () => {
    await requestReset("reset@example.com");
    const token = extractToken();

    const reset = await api("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password: NEW_PW }),
    });
    expect(reset.status).toBe(200);

    const oldLogin = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "reset@example.com", password: GOOD_PW }),
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "reset@example.com", password: NEW_PW }),
    });
    expect(newLogin.status).toBe(200);

    // Single-use: same token again fails
    const reuse = await api("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password: "An0ther$1x" }),
    });
    expect(reuse.status).toBe(400);
    expect((await reuse.json() as any).error).toMatch(/invalid/i);
  });

  it("rejects expired token (US1b-S3)", async () => {
    await requestReset("reset@example.com");
    const token = extractToken();
    await prisma.passwordResetToken.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await api("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password: NEW_PW }),
    });
    expect(res.status).toBe(400);
  });

  it("enforces password policy on the new password", async () => {
    await requestReset("reset@example.com");
    const token = extractToken();
    const res = await api("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password: "weak" }),
    });
    expect(res.status).toBe(400);
  });

  it("reset clears an active lockout (PRD edge case)", async () => {
    for (let i = 0; i < 5; i++) {
      await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "reset@example.com", password: "Bad1!bad" }),
      });
    }
    await requestReset("reset@example.com");
    const token = extractToken();
    await api("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password: NEW_PW }),
    });
    const login = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "reset@example.com", password: NEW_PW }),
    });
    expect(login.status).toBe(200);
  });
});
