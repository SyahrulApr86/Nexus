// Creates the end-to-end database when it is missing, then applies the migrations.
// Run by the Playwright web server command before the app starts, and again by the global setup
// (both are idempotent). Usage: node tests/e2e/support/prepare-db.mjs <postgres-url>
import { spawnSync } from "node:child_process";
import postgres from "postgres";

const url = process.argv[2] ?? process.env.E2E_DATABASE_URL;
if (!url) {
  console.error("prepare-db: pass the database URL (E2E_DATABASE_URL).");
  process.exit(1);
}

const target = new URL(url);
const name = decodeURIComponent(target.pathname.slice(1));
// Same guard as tests/e2e/support/env.ts: never the development or integration database.
if (!/^[a-z0-9_]*e2e[a-z0-9_]*$/.test(name)) {
  console.error(`prepare-db: refusing database "${name}"; its name must contain "e2e".`);
  process.exit(1);
}

const admin = new URL(url);
admin.pathname = "/postgres";
const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
try {
  const [row] = await sql`select 1 as found from pg_database where datname = ${name}`;
  if (!row) {
    // Identifier quoting: the name passed the guard above, so it only holds [a-z0-9_].
    await sql.unsafe(`create database "${name}"`);
    console.log(`prepare-db: created database ${name}`);
  }
} finally {
  await sql.end();
}

const migrate = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
});
process.exit(migrate.status ?? 1);
