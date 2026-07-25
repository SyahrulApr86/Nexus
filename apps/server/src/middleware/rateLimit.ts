import type { Context, Next } from "hono";
import { redis } from "../redis.js";
import { env } from "../env.js";

/**
 * Fixed-window rate limiter backed by Redis. Applied to unauthenticated
 * auth endpoints (login/register/reset) to slow credential stuffing and
 * reset-email flooding. Account lockout (FR-002b) is separate and stricter.
 */
export function rateLimit(opts: {
  name: string;
  limit: number;
  windowSeconds: number;
}) {
  return async (c: Context, next: Next) => {
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "local";
    const key = `rl:${opts.name}:${ip}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, opts.windowSeconds);
    // RATE_LIMIT_SCALE loosens dev/test environments; production leaves it at 1
    if (count > opts.limit * env.RATE_LIMIT_SCALE) {
      return c.json(
        { error: "Too many requests. Please try again shortly." },
        429,
      );
    }
    await next();
  };
}
