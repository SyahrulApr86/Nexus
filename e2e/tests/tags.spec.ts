import { expect, test, type Page } from "@playwright/test";
import {
  expectNoA11yViolations,
  register,
  uniqueEmail,
} from "./helpers.js";

const sidebar = (page: Page) => page.locator('[aria-label="Folders and notes"]');

async function newNoteWithContent(page: Page, title: string, content: string) {
  await page.getByRole("button", { name: /^new note$/i }).click();
  await expect(page.getByLabel("Note title")).toHaveValue("", { timeout: 5000 });
  await page.getByLabel("Note title").fill(title);
  await page.getByRole("textbox", { name: "Note content" }).click();
  await page.keyboard.type(content);
  await expect(page.getByTestId("save-state")).toHaveText("Saved", {
    timeout: 5000,
  });
  await expect(sidebar(page).getByRole("link", { name: title })).toBeVisible();
}

test.describe("US7 — tags (independent test)", () => {
  test("#tag renders styled, appears in sidebar with count, click filters (US7-S1..S3)", async ({
    page,
  }) => {
    await register(page, uniqueEmail("tags"));
    await newNoteWithContent(page, "Alpha Work", "Working on #project-alpha today");
    await newNoteWithContent(page, "Other Note", "Nothing tagged here");

    // S1: styled tag element in preview
    const chip = page.getByTestId("preview").locator(".tag-chip");
    await expect(
      page.getByTestId("preview").getByText("Nothing tagged here"),
    ).toBeVisible();
    // Open the tagged note to see its chip
    await sidebar(page).getByRole("link", { name: "Alpha Work" }).click();
    await expect(chip).toHaveText("#project-alpha");

    // S2: tag list with count in sidebar
    const tagLink = page.getByRole("link", { name: /#project-alpha/ });
    await expect(tagLink).toBeVisible();
    await expect(tagLink).toContainText("1");

    // S3: click filters to tagged notes only
    await tagLink.click();
    await expect(
      page.getByRole("link", { name: /Alpha Work/ }).last(),
    ).toBeVisible();
    await expect(page.getByRole("main").getByText("Other Note")).toHaveCount(0);

    // Clicking the chip in preview also navigates to the filter
    await sidebar(page).getByRole("link", { name: "Alpha Work" }).click();
    await page.getByTestId("preview").locator(".tag-chip").click();
    await expect(page.getByRole("heading", { name: /project-alpha/ })).toBeVisible();
  });

  test("tag page passes axe (SC-010)", async ({ page }) => {
    await register(page, uniqueEmail("taga11y"));
    await newNoteWithContent(page, "Tagged", "#audit content");
    await page.getByRole("link", { name: /#audit/ }).click();
    await expect(page.getByRole("heading", { name: /audit/ })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
