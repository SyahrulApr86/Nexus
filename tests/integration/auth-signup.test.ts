import { randomBytes, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { db } from "@/db";
import { session, user } from "@/db/schema";
import { describeDb } from "./fixtures";

const ORIGIN = "http://localhost:3000";
const emails: string[] = [];

/** POSTs to the real Better Auth handler, the same one /api/auth/[...all] serves. */
async function signUp(email: string, password: string) {
  const { getAuth } = await import("@/lib/auth");
  const res = await getAuth().handler(
    new Request(`${ORIGIN}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name: "Vitest" }),
    }),
  );
  return { status: res.status, cookie: res.headers.get("set-cookie"), body: await res.json() };
}

/** Field names at every level, so two bodies can be compared by shape without their values. */
function shape(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value === null ? "null" : typeof value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((k) => [k, shape((value as Record<string, unknown>)[k])]),
  );
}

describeDb("sign-up does not reveal registered emails", () => {
  beforeAll(() => {
    process.env.NEXUS_ALLOW_SIGNUP = "true";
    process.env.BETTER_AUTH_URL = ORIGIN;
    process.env.BETTER_AUTH_SECRET ??= randomBytes(32).toString("base64");
  });

  afterAll(async () => {
    if (emails.length) await db.delete(user).where(inArray(user.email, emails));
  });

  it("answers a new and a registered email with the same status and body shape, and no session", async () => {
    const email = `vitest-${randomUUID()}@example.test`;
    emails.push(email);

    const created = await signUp(email, "first password 1");
    const duplicate = await signUp(email, "other password 2");
    const duplicateCased = await signUp(email.toUpperCase(), "other password 3");

    expect(created.status).toBe(200);
    for (const res of [duplicate, duplicateCased]) {
      expect(res.status).toBe(created.status);
      expect(shape(res.body)).toEqual(shape(created.body));
      expect(res.body.token).toBeNull();
      expect(res.body.user.email).toBe(email);
    }
    expect(created.body.token).toBeNull();

    // Neither answer signs anyone in: no cookie, and no session row for the account.
    expect(created.cookie).toBeNull();
    expect(duplicate.cookie).toBeNull();
    expect(duplicateCased.cookie).toBeNull();
    const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
    expect(await db.select().from(session).where(eq(session.userId, owner.id))).toHaveLength(0);

    // The duplicate answer carries nothing from the stored account.
    expect(duplicate.body.user.id).not.toBe(owner.id);
    expect(duplicate.body.user.id).not.toBe(created.body.user.id);
  });
});
