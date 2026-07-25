import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, register, uniqueEmail } from "./helpers.js";

test.describe("Landing page", () => {
  test("guest visiting / sees the marketing page with working CTAs", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/welcome/);
    await expect(
      page.getByRole("heading", { name: /that know each other/ }),
    ).toBeVisible();
    await page
      .getByRole("main")
      .getByRole("link", { name: "Create your vault" })
      .first()
      .click();
    await expect(page).toHaveURL(/\/register/);
  });

  test("authenticated user visiting / goes straight to the workspace", async ({
    page,
  }) => {
    await register(page, uniqueEmail("land"));
    await page.goto("/");
    await expect(page.getByRole("button", { name: /^new note$/i })).toBeVisible();
    await expect(page).not.toHaveURL(/\/welcome/);
  });

  test("landing page passes WCAG 2.1 AA (SC-010), light and dark", async ({
    browser,
  }) => {
    for (const colorScheme of ["light", "dark"] as const) {
      const ctx = await browser.newContext({ colorScheme });
      const page = await ctx.newPage();
      await page.goto("/welcome");
      await expect(
        page.getByRole("heading", { name: /that know each other/ }),
      ).toBeVisible();
      await expectNoA11yViolations(page);
      await ctx.close();
    }
  });
});
