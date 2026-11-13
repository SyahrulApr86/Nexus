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
    ],
  },
});
