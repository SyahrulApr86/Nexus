import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, E2E_DATABASE_URL, E2E_DATA_DIR, E2E_PORT, assertE2eDatabase } from "./tests/e2e/support/env";

/*
 * End-to-end suite (tests/e2e). Runs the production build (`next build` + `next start`) on its own
 * port against its own database, never the development database "nexus". README, Testing.
 *
 * Projects:
 * - desktop-light: every flow, Chromium at 1440x900.
 * - desktop-dark, phone-light, phone-dark: the flows tagged @smoke (auth, editing, accessibility)
 *   in dark mode and at 390x844 with touch, so layout and colour regressions show up without
 *   running the whole suite four times.
 */

assertE2eDatabase(E2E_DATABASE_URL);

// One secret per run is enough: the database is disposable and sessions do not outlive the run.
process.env.E2E_AUTH_SECRET ??= randomBytes(32).toString("base64");

const CI = !!process.env.CI;
const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } };
const phone = {
  ...devices["Desktop Chrome"],
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};
const smoke = /@smoke/;

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/e2e",
  globalSetup: "./tests/e2e/support/global-setup.ts",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : Number(process.env.E2E_WORKERS ?? 2),
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    locale: "en-US",
    timezoneId: "UTC",
  },
  projects: [
    { name: "desktop-light", use: { ...desktop, colorScheme: "light" } },
    { name: "desktop-dark", grep: smoke, use: { ...desktop, colorScheme: "dark" } },
    { name: "phone-light", grep: smoke, use: { ...phone, colorScheme: "light" } },
    { name: "phone-dark", grep: smoke, use: { ...phone, colorScheme: "dark" } },
  ],
  webServer: {
    // The database is created and migrated before the app starts; E2E_SKIP_BUILD=1 reuses .next.
    command: `node tests/e2e/support/prepare-db.mjs && ${process.env.E2E_SKIP_BUILD ? "" : "pnpm build && "}pnpm start --port ${E2E_PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: !CI,
    timeout: 240_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      DATABASE_URL: E2E_DATABASE_URL,
      E2E_DATABASE_URL,
      BETTER_AUTH_SECRET: process.env.E2E_AUTH_SECRET,
      BETTER_AUTH_URL: BASE_URL,
      NEXT_PUBLIC_APP_URL: BASE_URL,
      // Every test signs up its own throwaway user.
      NEXUS_ALLOW_SIGNUP: "true",
      NEXUS_DATA_DIR: E2E_DATA_DIR,
    },
  },
});
