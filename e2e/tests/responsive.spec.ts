import { expect, test, type Page } from "@playwright/test";
import { register, uniqueEmail } from "./helpers.js";

const narrow = { width: 390, height: 844 };

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
}

test.describe("narrow viewports (PRD §10: tablet is a target)", () => {
  test("sidebar becomes a drawer and closes on navigation", async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ viewport: narrow });
    const page = await ctx.newPage();
    await register(page, uniqueEmail("drawer"));

    // Navigation is off-canvas until asked for
    const nav = page.getByRole("complementary", { name: "Vault navigation" });
    await expect(nav).not.toBeInViewport();

    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(nav).toBeInViewport();

    // Creating a note navigates — the drawer gets out of the way
    await page.getByRole("button", { name: /^new note$/i }).click();
    await expect(page.getByLabel("Note title")).toHaveValue("");
    await expect(nav).not.toBeInViewport();

    await noOverflow(page);
    await ctx.close();
  });

  test("editor shows one pane at a time, switchable between write and preview", async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ viewport: narrow });
    const page = await ctx.newPage();
    await register(page, uniqueEmail("panes"));
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("button", { name: /^new note$/i }).click();
    await expect(page.getByLabel("Note title")).toHaveValue("");
    await page.getByLabel("Note title").fill("Narrow note");

    const editor = page.getByRole("textbox", { name: "Note content" });
    await editor.click();
    await page.keyboard.type("# Narrow heading");

    // Write pane is the default; preview is hidden until selected
    await expect(editor).toBeVisible();
    await expect(page.getByTestId("preview")).toBeHidden();

    await page.getByRole("button", { name: "preview", exact: true }).click();
    await expect(
      page.getByTestId("preview").getByRole("heading", { name: "Narrow heading" }),
    ).toBeVisible();
    await expect(editor).toBeHidden();

    await page.getByRole("button", { name: "write", exact: true }).click();
    await expect(editor).toBeVisible();

    await noOverflow(page);
    await ctx.close();
  });

  test("both panes stay side by side on a desktop viewport", async ({
    page,
  }) => {
    await register(page, uniqueEmail("wide"));
    await page.getByRole("button", { name: /^new note$/i }).click();
    await expect(page.getByLabel("Note title")).toHaveValue("");
    await page.getByRole("textbox", { name: "Note content" }).click();
    await page.keyboard.type("# Wide heading");

    await expect(
      page.getByRole("textbox", { name: "Note content" }),
    ).toBeVisible();
    await expect(
      page.getByTestId("preview").getByRole("heading", { name: "Wide heading" }),
    ).toBeVisible();
    // The pane switcher is a narrow-screen affordance only
    await expect(
      page.getByRole("button", { name: "preview", exact: true }),
    ).toBeHidden();
  });
});
