import { expect, test, type Page } from "@playwright/test";
import {
  expectNoA11yViolations,
  register,
  uniqueEmail,
} from "./helpers.js";

const sidebar = (page: Page) => page.locator('[aria-label="Folders and notes"]');

async function newNoteTitled(page: Page, title: string) {
  await page.getByRole("button", { name: /^new note$/i }).click();
  await expect(page.getByLabel("Note title")).toHaveValue("", { timeout: 5000 });
  await page.getByLabel("Note title").fill(title);
  await expect(sidebar(page).getByRole("link", { name: title })).toBeVisible({
    timeout: 5000,
  });
}

const editor = (page: Page) =>
  page.getByRole("textbox", { name: "Note content" });

test.describe("US4 — wikilinks (independent test)", () => {
  test("autocomplete on [[ → select → link renders → click navigates", async ({
    page,
  }) => {
    await register(page, uniqueEmail("wiki"));
    await newNoteTitled(page, "Note Two");
    await newNoteTitled(page, "Note One");

    await editor(page).click();
    await page.keyboard.type("Go to [[Note T");

    // Autocomplete dropdown appears filtered (US4-S1)
    const option = page.locator(".cm-tooltip-autocomplete li").first();
    await expect(option).toContainText("Note Two", { timeout: 5000 });
    await page.keyboard.press("Enter"); // select (US4-S2)

    await expect(editor(page)).toContainText("Go to [[Note Two]]");

    // Preview renders clickable wikilink, styled distinct (US4-S3)
    const link = page
      .getByTestId("preview")
      .locator("a.wikilink", { hasText: "Note Two" });
    await expect(link).toBeVisible();
    await expect(link).not.toHaveClass(/wikilink-broken/);

    // Autosave, then click navigates to the note (US4-S4)
    await expect(page.getByTestId("save-state")).toHaveText("Saved", {
      timeout: 5000,
    });
    await link.click();
    await expect(page.getByLabel("Note title")).toHaveValue("Note Two");
  });

  test("broken wikilink styled distinctly; click offers create (US4-S5)", async ({
    page,
  }) => {
    await register(page, uniqueEmail("broken"));
    await newNoteTitled(page, "Source");
    await editor(page).click();
    await page.keyboard.type("See [[Ghost Note]]");
    await page.keyboard.press("Escape"); // dismiss any autocomplete
    await expect(page.getByTestId("save-state")).toHaveText("Saved", {
      timeout: 5000,
    });

    const broken = page
      .getByTestId("preview")
      .locator("a.wikilink-broken", { hasText: "Ghost Note" });
    await expect(broken).toBeVisible();

    await broken.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Ghost Note");
    await dialog.getByRole("button", { name: "Create note" }).click();
    // New note created with the missing title
    await expect(page.getByLabel("Note title")).toHaveValue("Ghost Note", {
      timeout: 5000,
    });
  });

  test("no autocomplete inside code blocks (US4-S6)", async ({ page }) => {
    await register(page, uniqueEmail("code"));
    await newNoteTitled(page, "Target");
    await newNoteTitled(page, "Coder");
    await editor(page).click();
    await page.keyboard.type("```\n[[Tar");
    await page.waitForTimeout(700);
    await expect(page.locator(".cm-tooltip-autocomplete")).toHaveCount(0);
  });

  test("editor with wikilinks passes axe (SC-010)", async ({ page }) => {
    await register(page, uniqueEmail("wa11y"));
    await newNoteTitled(page, "Axe Target");
    await newNoteTitled(page, "Axe Source");
    await editor(page).click();
    await page.keyboard.type("Valid [[Axe Target]] broken [[Nope]]");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("save-state")).toHaveText("Saved", {
      timeout: 5000,
    });
    await expectNoA11yViolations(page);
  });
});
