/**
 * Runs before every file in tests/integration (vitest.config.mts, project "integration").
 *
 * Points src/db at TEST_DATABASE_URL. src/db reads DATABASE_URL lazily on the
 * first query, so setting it here, before the test file runs, is early enough.
 * A DATABASE_URL inherited from the shell is dropped first: it usually points at
 * the development database. Without TEST_DATABASE_URL the suites are skipped
 * (describeDb in fixtures.ts, message from global-setup.ts).
 */
import { afterAll } from "vitest";
import { testDatabaseUrl } from "./database";

const url = testDatabaseUrl();
delete process.env.DATABASE_URL;

if (url) {
  process.env.DATABASE_URL = url;

  // Close the pool so the worker can exit once the file is done.
  afterAll(async () => {
    const { getDb } = await import("@/db");
    await getDb().$client.end();
  });
}
