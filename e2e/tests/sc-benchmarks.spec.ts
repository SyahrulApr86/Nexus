import { expect, test, type Page } from "@playwright/test";
import { fetchResetLink, GOOD_PW, register, uniqueEmail } from "./helpers.js";

const sidebar = (page: Page) => page.locator('[aria-label="Folders and notes"]');

/**
 * Measurable success criteria from PRD §6 that need a real browser.
 * SC-004/005 live in perf.spec.ts; SC-008/011/012 are covered by the
 * server-side benchmark, and SC-007 is exercised here end to end.
 */

test("SC-001: register → login → create note → see preview in under 2 minutes", async ({
  page,
}) => {
  const email = uniqueEmail("sc001");
  const t0 = Date.now();

  await page.goto("/welcome");
  await page.getByRole("main").getByRole("link", { name: "Create your vault" }).first().click();
  await page.getByLabel("Username").fill("firstuser");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(GOOD_PW);
  await page.getByLabel("Confirm password").fill(GOOD_PW);
  await page.getByRole("button", { name: /create account/i }).click();

  await page.getByRole("button", { name: /^new note$/i }).click();
  await expect(page.getByLabel("Note title")).toHaveValue("");
  await page.getByLabel("Note title").fill("First Note");
  await page.getByRole("textbox", { name: "Note content" }).click();
  await page.keyboard.type("# Hello");
  await expect(
    page.getByTestId("preview").getByRole("heading", { name: "Hello" }),
  ).toBeVisible();

  const elapsed = Date.now() - t0;
  expect(elapsed).toBeLessThan(120_000);
});

test("SC-001a: password reset request → new password → login in under 3 minutes", async ({
  page,
}) => {
  const email = uniqueEmail("sc001a");
  const NEW_PW = "N3w$ecret!";
  await register(page, email);
  await page.getByRole("button", { name: /log out/i }).click();

  const t0 = Date.now();
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: /send reset link/i }).click();
  await expect(page.getByRole("status")).toContainText("If that email is registered");

  const link = await fetchResetLink(email);
  await page.goto(link);
  await page.getByLabel("New password").fill(NEW_PW);
  await page.getByRole("button", { name: /update password/i }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(NEW_PW);
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByText(email.split("@")[0]!)).toBeVisible();

  expect(Date.now() - t0).toBeLessThan(180_000);
});

test("SC-002: preview updates within 100ms of a keystroke", async ({ page }) => {
  await register(page, uniqueEmail("sc002"));
  await page.getByRole("button", { name: /^new note$/i }).click();
  await expect(page.getByLabel("Note title")).toHaveValue("");
  const editor = page.getByRole("textbox", { name: "Note content" });
  await editor.click();
  await page.keyboard.type("warmup content so the pipeline is hot");
  await expect(page.getByTestId("preview")).toContainText("warmup");

  // Measure in-page: time from the final input event to the preview DOM
  // carrying the new text (React render + markdown parse).
  const latencies = await page.evaluate(async () => {
    const preview = document.querySelector('[data-testid="preview"]')!;
    const results: number[] = [];
    for (let i = 0; i < 5; i++) {
      const marker = `LatencyProbe${i}`;
      const done = new Promise<number>((resolve) => {
        const start = performance.now();
        const observer = new MutationObserver(() => {
          if (preview.textContent?.includes(marker)) {
            observer.disconnect();
            resolve(performance.now() - start);
          }
        });
        observer.observe(preview, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      });
      const cm = document.querySelector(".cm-content") as HTMLElement;
      cm.focus();
      document.execCommand("insertText", false, ` ${marker}`);
      results.push(await done);
      await new Promise((r) => setTimeout(r, 60));
    }
    return results;
  });

  const worst = Math.max(...latencies);
  console.log(`SC-002 preview latency ms: ${latencies.map((l) => l.toFixed(1)).join(", ")}`);
  expect(worst).toBeLessThan(100);
});

test("SC-003: full-text search across 5,000 notes returns in under 1 second", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await register(page, uniqueEmail("sc003"));
  const seed = await page.request.post("/api/dev/seed", {
    data: { notes: 5_000, withLinks: false },
  });
  expect(seed.ok()).toBeTruthy();

  // Server-side latency for the same query the UI issues
  const timings: number[] = [];
  for (const q of ["Seeded", "benchmarks", "Note 4321", "recieve"]) {
    const t0 = Date.now();
    const res = await page.request.get(`/api/search?q=${encodeURIComponent(q)}`);
    expect(res.ok()).toBeTruthy();
    timings.push(Date.now() - t0);
  }
  console.log(`SC-003 search latency ms: ${timings.join(", ")}`);
  expect(Math.max(...timings)).toBeLessThan(1000);

  // And the UI surfaces results for the same corpus
  await page.reload();
  await page.getByRole("combobox", { name: "Search notes" }).fill("Seed Note 4321");
  await expect(page.getByRole("option").first()).toBeVisible({ timeout: 5000 });
});

test("SC-007: a save on device A is visible on device B within 5 seconds", async ({
  browser,
}) => {
  const email = uniqueEmail("sc007");
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await register(pageA, email);

  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.goto("/login");
  await pageB.getByLabel("Email").fill(email);
  await pageB.getByLabel("Password", { exact: true }).fill(GOOD_PW);
  await pageB.getByRole("button", { name: /^log in$/i }).click();
  await expect(pageB.getByText(email.split("@")[0]!)).toBeVisible();

  await pageA.getByRole("button", { name: /^new note$/i }).click();
  await expect(pageA.getByLabel("Note title")).toHaveValue("");
  const t0 = Date.now();
  await pageA.getByLabel("Note title").fill("Propagation Probe");
  await expect(
    sidebar(pageB).getByRole("link", { name: "Propagation Probe" }),
  ).toBeVisible({ timeout: 5000 });
  const elapsed = Date.now() - t0;
  console.log(`SC-007 cross-device propagation: ${elapsed}ms`);
  expect(elapsed).toBeLessThan(5000);

  await ctxA.close();
  await ctxB.close();
});
