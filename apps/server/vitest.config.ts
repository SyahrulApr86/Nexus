import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    setupFiles: ["./test/setup-env.ts"],
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["src/**"],
      // PRD §8.3: ≥80% line / ≥70% branch
      thresholds: { lines: 80, branches: 70 },
    },
  },
});
