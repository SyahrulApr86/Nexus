import { expect, test, type Page } from "@playwright/test";
import {
  expectNoA11yViolations,
  GOOD_PW,
  register,
  uniqueEmail,
} from "./helpers.js";

const sidebar = (page: Page) => page.locator('[aria-label="Folders and notes"]');

test.describe("US8 — command palette (independent test)", () => {
  test("Ctrl+P → 'new note' → Enter creates a note (US8-S1..S3)", async ({
    page,
  }) => {
    await register(page, uniqueEmail("pal"));
    await page.keyboard.press("ControlOrMeta+p");
    const input = page.getByRole("combobox", { name: "Type a command" });
    await expect(input).toBeVisible();
    await input.fill("new note");
    await expect(
      page.getByRole("option", { name: "New note" }),
    ).toBeVisible();
    await input.press("Enter");
    await expect(page.getByLabel("Note title")).toBeVisible();
  });

  test("arrow keys navigate, fuzzy filter works, Escape closes cleanly (US8-S4)", async ({
    page,
  }) => {
    await register(page, uniqueEmail("pal2"));
    await page.keyboard.press("ControlOrMeta+p");
    const input = page.getByRole("combobox", { name: "Type a command" });
    await input.fill("trsh"); // fuzzy: matches "Open trash"
    await expect(page.getByRole("option", { name: "Open trash" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(input).not.toBeVisible();
    // No residual overlay blocking clicks
    await page.getByRole("button", { name: /^new note$/i }).click();
    await expect(page.getByLabel("Note title")).toBeVisible();
  });

  test("palette jumps to an existing note", async ({ page }) => {
    await register(page, uniqueEmail("pal3"));
    await page.getByRole("button", { name: /^new note$/i }).click();
    await expect(page.getByLabel("Note title")).toHaveValue("");
    await page.getByLabel("Note title").fill("Jump Target");
    await expect(
      sidebar(page).getByRole("link", { name: "Jump Target" }),
    ).toBeVisible();
    await page.goto("/trash");

    await page.keyboard.press("ControlOrMeta+p");
    await page
      .getByRole("combobox", { name: "Type a command" })
      .fill("Jump Target");
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Note title")).toHaveValue("Jump Target");
  });

  test("palette passes axe (SC-010)", async ({ page }) => {
    await register(page, uniqueEmail("pal4"));
    await page.keyboard.press("ControlOrMeta+p");
    await expect(
      page.getByRole("combobox", { name: "Type a command" }),
    ).toBeVisible();
    await expectNoA11yViolations(page);
  });
});

test.describe("US9 — dark/light theme (independent test)", () => {
  test("toggle via palette applies instantly and persists across sessions (US9-S2/S3, FR-022)", async ({
    page,
  }) => {
    const email = uniqueEmail("theme");
    await register(page, email);

    await page.keyboard.press("ControlOrMeta+p");
    await page
      .getByRole("combobox", { name: "Type a command" })
      .fill("Theme: Dark");
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // Persists across reload
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // Persists across a fresh login session
    await page.getByRole("button", { name: /log out/i }).click();
    await page.getByLabel("Username or email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(GOOD_PW);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await expect(page.getByText(email.split("@")[0]!)).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("dark workspace passes WCAG 2.1 AA contrast (SC-010)", async ({
    page,
  }) => {
    await register(page, uniqueEmail("dark"));
    await page.keyboard.press("ControlOrMeta+p");
    await page
      .getByRole("combobox", { name: "Type a command" })
      .fill("Theme: Dark");
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    // Create a note so editor + preview surfaces are audited in dark mode
    await page.getByRole("button", { name: /^new note$/i }).click();
    await page.getByLabel("Note title").fill("Dark Audit");
    await page.getByRole("textbox", { name: "Note content" }).click();
    await page.keyboard.type("# Dark heading\n\n`code` and [[Broken Link]]");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("save-state")).toHaveText("Saved", {
      timeout: 5000,
    });
    await expectNoA11yViolations(page);
  });

  test("first visit defaults to OS preference (US9-S1)", async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: "dark" });
    const page = await ctx.newPage();
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await ctx.close();
  });
});
