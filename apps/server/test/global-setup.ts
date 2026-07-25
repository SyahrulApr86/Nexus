import { execSync } from "node:child_process";

const TEST_DB_URL = "postgresql://nexus:nexus_dev@localhost:5433/nexus_test";

export default function setup() {
  execSync("pnpm prisma db push --skip-generate --accept-data-loss", {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: "pipe",
  });
}
