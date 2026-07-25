import { expect, test, type Page } from "@playwright/test";
import {
  expectNoA11yViolations,
  register,
  uniqueEmail,
} from "./helpers.js";

/** SC-010 release gate: WCAG 2.1 AA on every route, both themes. */

const GUEST_ROUTES = [
  "/welcome",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
];

for (const colorScheme of ["light", "dark"] as const) {
  test(`guest routes pass axe in ${colorScheme} mode`, async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme });
    const page = await ctx.newPage();
    for (const route of GUEST_ROUTES) {
      await page.goto(route);
      await expect(page.locator("main, form, h1").first()).toBeVisible();
      await expectNoA11yViolations(page);
    }
    await ctx.close();
  });
}

async function setTheme(page: Page, theme: "Dark" | "Light") {
  await page.keyboard.press("ControlOrMeta+p");
  await page
    .getByRole("combobox", { name: "Type a command" })
    .fill(`Theme: ${theme}`);
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    theme.toLowerCase(),
  );
}

for (const theme of ["Light", "Dark"] as const) {
  test(`authenticated routes pass axe in ${theme.toLowerCase()} mode`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await register(page, uniqueEmail(`sweep${theme}`));
    await setTheme(page, theme);

    // Workspace home (empty state)
    await expectNoA11yViolations(page);

    // Note editor with rich content
    await page.getByRole("button", { name: /^new note$/i }).click();
    await expect(page.getByLabel("Note title")).toHaveValue("");
    await page.getByLabel("Note title").fill("Sweep Note");
    await page.getByRole("textbox", { name: "Note content" }).click();
    await page.keyboard.type(
      "# Heading\n\ntext with [[Sweep Note]] and [[Missing]] plus #sweeptag\n\n`code`",
    );
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("save-state")).toHaveText("Saved", {
      timeout: 5000,
    });
    await expectNoA11yViolations(page);

    // Tag view
    await page.getByRole("link", { name: /#sweeptag/ }).click();
    await expect(page.getByRole("heading", { name: /sweeptag/ })).toBeVisible();
    await expectNoA11yViolations(page);

    // Graph
    await page.getByRole("link", { name: "Graph" }).click();
    await expect(page.getByTestId("graph-canvas")).toBeVisible();
    await expectNoA11yViolations(page);

    // Trash (with an item)
    const noteRow = page
      .locator('[aria-label="Folders and notes"]')
      .getByRole("link", { name: "Sweep Note" })
      .locator("xpath=ancestor::div[1]");
    await noteRow.hover();
    await noteRow
      .getByRole("button", { name: "Actions for note Sweep Note" })
      .click();
    await page.getByRole("menuitem", { name: "Move to trash" }).click();
    await page.getByRole("link", { name: "Trash" }).click();
    await expect(page.getByText("Sweep Note")).toBeVisible();
    await expectNoA11yViolations(page);

    // Command palette overlay
    await page.keyboard.press("ControlOrMeta+p");
    await expect(
      page.getByRole("combobox", { name: "Type a command" }),
    ).toBeVisible();
    await expectNoA11yViolations(page);
  });
}
