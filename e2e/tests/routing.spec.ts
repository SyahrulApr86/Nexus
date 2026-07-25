import { expect, test } from "@playwright/test";
import {
  expectNoA11yViolations,
  register,
  uniqueEmail,
} from "./helpers.js";

test.describe("routing and error states", () => {
  test("unknown URL shows a 404 page with a way back (guest)", async ({
    page,
  }) => {
    await page.goto("/this/does/not/exist");
    await expect(
      page.getByRole("heading", { name: /doesn't exist/i }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("unknown URL while signed in offers workspace and trash", async ({
    page,
  }) => {
    await register(page, uniqueEmail("nf-auth"));
    await page.goto("/nope-not-a-route");
    await expect(
      page.getByRole("heading", { name: /doesn't exist/i }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Back to workspace" }).click();
    await expect(page.getByRole("button", { name: /^new note$/i })).toBeVisible();
  });

  test("404 page passes axe (SC-010)", async ({ page }) => {
    await page.goto("/definitely-missing");
    await expect(
      page.getByRole("heading", { name: /doesn't exist/i }),
    ).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("a note id that does not exist explains itself instead of hanging", async ({
    page,
  }) => {
    await register(page, uniqueEmail("nf-note"));
    await page.goto("/notes/00000000-0000-4000-8000-000000000000");
    await expect(page.getByText("Note not available")).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: "Open trash" }).click();
    await expect(page.getByRole("heading", { name: "Trash" })).toBeVisible();
  });

  test("a deleted note's deep link degrades gracefully", async ({ page }) => {
    await register(page, uniqueEmail("nf-deleted"));
    await page.getByRole("button", { name: /^new note$/i }).click();
    await expect(page.getByLabel("Note title")).toHaveValue("");
    await page.getByLabel("Note title").fill("Doomed Deep Link");
    const url = page.url();

    const row = page
      .locator('[aria-label="Folders and notes"]')
      .getByRole("link", { name: "Doomed Deep Link" })
      .locator("xpath=ancestor::div[1]");
    await row.hover();
    await row
      .getByRole("button", { name: "Actions for note Doomed Deep Link" })
      .click();
    await page.getByRole("menuitem", { name: "Move to trash" }).click();

    await page.goto(url);
    await expect(page.getByText("Note not available")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("an unused tag URL shows an empty state, not an error", async ({
    page,
  }) => {
    await register(page, uniqueEmail("nf-tag"));
    await page.goto("/tags/nothing-here");
    await expect(
      page.getByRole("heading", { name: /nothing-here/ }),
    ).toBeVisible();
    await expect(page.getByText("No notes carry this tag.")).toBeVisible();
  });

  test("browser back and forward move between notes (History API)", async ({
    page,
  }) => {
    await register(page, uniqueEmail("nf-hist"));
    for (const title of ["History One", "History Two"]) {
      await page.getByRole("button", { name: /^new note$/i }).click();
      await expect(page.getByLabel("Note title")).toHaveValue("");
      await page.getByLabel("Note title").fill(title);
      await expect(
        page
          .locator('[aria-label="Folders and notes"]')
          .getByRole("link", { name: title }),
      ).toBeVisible();
    }
    await expect(page.getByLabel("Note title")).toHaveValue("History Two");

    await page.goBack();
    await expect(page.getByLabel("Note title")).toHaveValue("History One");
    await page.goForward();
    await expect(page.getByLabel("Note title")).toHaveValue("History Two");
  });

  test("deep-linking a note while signed out routes through login", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await register(page, uniqueEmail("nf-guard"));
    await page.getByRole("button", { name: /^new note$/i }).click();
    await expect(page.getByLabel("Note title")).toHaveValue("");
    await page.getByLabel("Note title").fill("Guarded Note");
    const noteUrl = page.url();
    await ctx.clearCookies();

    await page.goto(noteUrl);
    await expect(page).toHaveURL(/\/welcome/);
    await ctx.close();
  });
});
