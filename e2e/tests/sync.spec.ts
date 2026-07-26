import { expect, test, type Page } from "@playwright/test";
import { GOOD_PW, register, uniqueEmail } from "./helpers.js";

const sidebar = (page: Page) => page.locator('[aria-label="Folders and notes"]');

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Username or email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(GOOD_PW);
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByText(email.split("@")[0]!)).toBeVisible();
}

test.describe("US10 — multi-device sync (independent test)", () => {
  test("edit on device A appears on device B without reload, <5s (SC-007)", async ({
    browser,
  }) => {
    const email = uniqueEmail("sync2");
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await register(pageA, email);

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await login(pageB, email);

    // A creates a note — B's sidebar updates live via WebSocket
    await pageA.getByRole("button", { name: /^new note$/i }).click();
    await expect(pageA.getByLabel("Note title")).toHaveValue("");
    await pageA.getByLabel("Note title").fill("Live Sync Note");
    await expect(
      sidebar(pageB).getByRole("link", { name: "Live Sync Note" }),
    ).toBeVisible({ timeout: 5000 });

    // A renames — B sees the new title live
    await pageA.getByLabel("Note title").fill("Renamed Live");
    await expect(
      sidebar(pageB).getByRole("link", { name: "Renamed Live" }),
    ).toBeVisible({ timeout: 5000 });

    await ctxA.close();
    await ctxB.close();
  });

  test("offline indicator appears and edits sync after reconnect (US10-S3)", async ({
    browser,
  }) => {
    const email = uniqueEmail("offline");
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await register(page, email);
    await page.getByRole("button", { name: /^new note$/i }).click();
    await page.getByLabel("Note title").fill("Offline Note");
    await expect(page.getByTestId("save-state")).toHaveText("Saved", {
      timeout: 5000,
    });

    await ctx.setOffline(true);
    await expect(page.getByRole("status").filter({ hasText: "Offline" })).toBeVisible({
      timeout: 10_000,
    });

    // Type while offline — autosave fails, state stays dirty
    await page.getByRole("textbox", { name: "Note content" }).click();
    await page.keyboard.type("written while offline");
    await expect(page.getByTestId("save-state")).not.toHaveText("Saved", {
      timeout: 3000,
    });

    await ctx.setOffline(false);
    // Reconnect flushes the queued change (US10-S3)
    await page.getByRole("textbox", { name: "Note content" }).click();
    await page.keyboard.type(" and online");
    await expect(page.getByTestId("save-state")).toHaveText("Saved", {
      timeout: 8000,
    });
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "Note content" }),
    ).toContainText("written while offline and online");
    await ctx.close();
  });
});
