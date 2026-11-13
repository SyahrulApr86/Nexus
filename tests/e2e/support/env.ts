/**
 * Settings shared by playwright.config.ts, the global setup and the fixtures.
 *
 * The suite runs against its own Postgres database (nexus_e2e by default) and its own port, so it
 * can run next to `pnpm dev` without touching the development data.
 */
import path from "node:path";
import os from "node:os";

export const E2E_PORT = Number(process.env.E2E_PORT ?? 3104);
export const BASE_URL = `http://localhost:${E2E_PORT}`;

/**
 * The database the app under test connects to. On CI the workflow's Postgres service (trust auth,
 * no password); locally set E2E_DATABASE_URL (README, Testing).
 */
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://nexus@localhost:5432/nexus_e2e";

/** Attachment files written by the app under test; thrown away with the run. */
export const E2E_DATA_DIR = process.env.E2E_DATA_DIR ?? path.join(os.tmpdir(), "nexus-e2e-data");

/**
 * The only database names the suite will create, migrate and fill with throwaway users. Anything
 * else (above all the development database "nexus") is refused before a connection is opened.
 */
export function assertE2eDatabase(url: string) {
  let name: string;
  try {
    name = decodeURIComponent(new URL(url).pathname.slice(1));
  } catch {
    throw new Error("E2E_DATABASE_URL is not a valid postgres:// URL.");
  }
  if (!/^[a-z0-9_]*e2e[a-z0-9_]*$/.test(name))
    throw new Error(`Refusing to run the end-to-end suite against database "${name}": its name must contain "e2e" (for example nexus_e2e).`);
  return name;
}
