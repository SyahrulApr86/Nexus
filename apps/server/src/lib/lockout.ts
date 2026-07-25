import { redis } from "../redis.js";

/**
 * FR-002b: 5 consecutive failed logins within 15 minutes locks the account
 * for 15 minutes. Counters live in Redis so they survive restarts and are
 * shared across instances.
 */

const WINDOW_SECONDS = 15 * 60;
const LOCK_SECONDS = 15 * 60;
const MAX_FAILURES = 5;

const failKey = (email: string) => `lockfail:${email}`;
const lockKey = (email: string) => `lock:${email}`;

export async function isLocked(email: string): Promise<boolean> {
  return (await redis.exists(lockKey(email))) === 1;
}

/** Returns true if this failure triggered a lock. */
export async function recordFailure(email: string): Promise<boolean> {
  const key = failKey(email);
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, WINDOW_SECONDS);
  if (count >= MAX_FAILURES) {
    await redis.set(lockKey(email), "1", "EX", LOCK_SECONDS);
    await redis.del(key);
    return true;
  }
  return false;
}

export async function clearFailures(email: string): Promise<void> {
  await redis.del(failKey(email), lockKey(email));
}
