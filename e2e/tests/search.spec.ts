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
  if (content) {
    await page.getByRole("textbox", { name: "Note content" }).click();
    await page.keyboard.type(content);
  }
  await expect(page.getByTestId("save-state")).toHaveText("Saved", {
    timeout: 5000,
  });
  await expect(sidebar(page).getByRole("link", { name: title })).toBeVisible();
}

test.describe("US5 — full-text search (independent test)", () => {
  test("search finds by keyword, opens result, updates in real time", async ({
    page,
  }) => {
    await register(page, uniqueEmail("search"));
    await newNoteWithContent(page, "Quantum Physics", "wave particle duality");
    await newNoteWithContent(page, "Groceries", "milk quantum eggs");

    const box = page.getByRole("combobox", { name: "Search notes" });
    await box.fill("quantum");

    const options = page.getByRole("option");
    await expect(options).toHaveCount(2, { timeout: 5000 });
    // Title match ranked first (FR-013)
    await expect(options.first()).toContainText("Quantum Physics");

    // Real-time update as query changes (US5-S3): narrow to content-only term
    await box.fill("duality");
    await expect(options).toHaveCount(1, { timeout: 5000 });
    await expect(options.first()).toContainText("Quantum Physics");

    // Open via keyboard (US5-S2 + SC-006)
    await box.press("ArrowDown");
    await box.press("Enter");
    await expect(page.getByLabel("Note title")).toHaveValue("Quantum Physics");
  });

  test("fuzzy search tolerates misspelling (US5-S1)", async ({ page }) => {
    await register(page, uniqueEmail("fuzzy"));
    await newNoteWithContent(page, "Receive Payments", "");
    const box = page.getByRole("combobox", { name: "Search notes" });
    await box.fill("recieve");
    await expect(page.getByRole("option").first()).toContainText(
      "Receive Payments",
      { timeout: 5000 },
    );
  });

  test("empty state and short-query signal (US5-S4/S6)", async ({ page }) => {
    await register(page, uniqueEmail("empty"));
    await newNoteWithContent(page, "Only Note", "");
    const box = page.getByRole("combobox", { name: "Search notes" });

    await box.fill("zzznothing");
    await expect(page.getByText("No notes found")).toBeVisible({
      timeout: 5000,
    });

    await box.fill("on");
    await expect(page.getByText(/short query/i)).toBeVisible({ timeout: 5000 });
    // 1-2 chars still returns results (US5-S6)
    await expect(page.getByRole("option").first()).toContainText("Only Note");
  });

  test("search panel passes axe (SC-010)", async ({ page }) => {
    await register(page, uniqueEmail("sa11y"));
    await newNoteWithContent(page, "Audit Note", "content");
    await page.getByRole("combobox", { name: "Search notes" }).fill("audit");
    await expect(page.getByRole("option").first()).toBeVisible({
      timeout: 5000,
    });
    await expectNoA11yViolations(page);
  });
});
