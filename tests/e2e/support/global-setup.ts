/**
 * Makes sure the end-to-end database exists and is migrated. The web server command does the same
 * before a fresh server starts; this covers a reused server (local runs) and is idempotent.
 */
import { execFileSync } from "node:child_process";
import { E2E_DATABASE_URL, assertE2eDatabase } from "./env";

export default function globalSetup() {
  assertE2eDatabase(E2E_DATABASE_URL);
  execFileSync(process.execPath, ["tests/e2e/support/prepare-db.mjs"], {
    stdio: "inherit",
    env: { ...process.env, E2E_DATABASE_URL },
  });
}
