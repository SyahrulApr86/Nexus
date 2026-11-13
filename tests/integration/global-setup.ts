/**
 * Runs once, in the main Vitest process, when integration tests are selected
 * (vitest.config.mts, project "integration").
 *
 * Without TEST_DATABASE_URL the suites skip themselves (describeDb in
 * fixtures.ts) and this prints why. On CI a missing URL is an error instead,
 * so a misconfigured pipeline cannot go green with the suites skipped.
 */
import { testDatabaseUrl } from "./database";

export default function setup() {
  if (testDatabaseUrl()) return;
  const message =
    "TEST_DATABASE_URL is not set. Point it at a disposable Postgres database with migrations applied (README.md, section Tes).";
  if (process.env.CI) throw new Error(message);
  console.warn(`\n[integration] Skipping the integration tests: ${message}\n`);
}
