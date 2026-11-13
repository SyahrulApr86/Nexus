import { defineConfig } from "drizzle-kit";

// Node's own .env loader (no dotenv dependency). A missing .env is fine: DATABASE_URL may come
// from the environment. Any other error (a malformed file) is reported.
try {
  process.loadEnvFile();
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
