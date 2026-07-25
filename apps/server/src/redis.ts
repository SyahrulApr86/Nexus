import { Redis } from "ioredis";
import { env } from "./env.js";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  // Keep reconnecting instead of giving up: a Redis blip should degrade
  // requests (500s on session lookups), never take the API process down.
  retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
});

// ioredis emits 'error' on every failed connection attempt; without a listener
// Node treats it as an unhandled error event and kills the process.
redis.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT") {
    // Connection-level noise while the server is down — the retry strategy
    // handles it, so log once per state change rather than per attempt.
    return;
  }
  console.error("redis error:", err.message);
});
