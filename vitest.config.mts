// .mts, not .ts: package.json has no "type": "module", so Vite would load a .ts
// config as CommonJS and warn that its import syntax will stop working there.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // Same mapping as tsconfig "paths": "@/*" -> "./src/*".
      { find: /^@\//, replacement: fromRoot("./src/") },
      // The real package throws outside the react-server bundle.
      { find: /^server-only$/, replacement: fromRoot("./tests/stubs/server-only.ts") },
    ],
  },
  test: {
    environment: "node",
    // Inline projects inherit the root options above (Vitest 5 default).
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          // Once per run: explains a skip, fails on CI without a database.
          globalSetup: ["tests/integration/global-setup.ts"],
          // Before every file: points src/db at TEST_DATABASE_URL.
          setupFiles: ["tests/integration/setup.ts"],
          // Every file creates its own user and vaults; running files one at a
          // time keeps the load on a shared local Postgres predictable.
          fileParallelism: false,
          hookTimeout: 30_000,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
