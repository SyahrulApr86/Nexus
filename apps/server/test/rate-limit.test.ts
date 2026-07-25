import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { rateLimit } from "../src/middleware/rateLimit.js";
import { env } from "../src/env.js";
import { resetDb } from "./helpers.js";

const originalScale = env.RATE_LIMIT_SCALE;

beforeEach(async () => {
  await resetDb();
  env.RATE_LIMIT_SCALE = 1;
});

afterEach(() => {
  env.RATE_LIMIT_SCALE = originalScale;
});

describe("auth rate limiting (hardening)", () => {
  it("allows up to the limit then returns 429 within the window", async () => {
    const app = new Hono()
      .use("/x", rateLimit({ name: "test", limit: 3, windowSeconds: 60 }))
      .get("/x", (c) => c.json({ ok: true }));

    const hit = () =>
      app.request("/x", { headers: { "x-forwarded-for": "10.1.2.3" } });

    for (let i = 0; i < 3; i++) {
      expect((await hit()).status).toBe(200);
    }
    const blocked = await hit();
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as { error: string }).error).toMatch(
      /too many/i,
    );
  });

  it("tracks clients separately by IP", async () => {
    const app = new Hono()
      .use("/x", rateLimit({ name: "test2", limit: 1, windowSeconds: 60 }))
      .get("/x", (c) => c.json({ ok: true }));

    expect(
      (await app.request("/x", { headers: { "x-forwarded-for": "10.0.0.1" } }))
        .status,
    ).toBe(200);
    expect(
      (await app.request("/x", { headers: { "x-forwarded-for": "10.0.0.1" } }))
        .status,
    ).toBe(429);
    expect(
      (await app.request("/x", { headers: { "x-forwarded-for": "10.0.0.2" } }))
        .status,
    ).toBe(200);
  });
});
