import { expect, test } from "@playwright/test";
import {
  expectNoA11yViolations,
  GOOD_PW,
  register,
  uniqueEmail,
} from "./helpers.js";

test.describe("Settings (FR-003 idle timeout, FR-021/022 theme)", () => {
  test("idle timeout persists across sessions and rejects out-of-range values", async ({
    page,
  }) => {
    const email = uniqueEmail("settings");
    await register(page, email);

    await page.getByRole("button", { name: "Settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await expect(dialog).toBeVisible();

    const timeout = dialog.getByLabel("Sign out after inactivity");
    await expect(timeout).toHaveValue("30");
    await timeout.fill("15");
    await timeout.blur();

    // Out-of-range input is clamped, never sent as-is
    await timeout.fill("500");
    await timeout.blur();
    await expect(timeout).toHaveValue("120");

    await dialog.getByRole("button", { name: "Done" }).click();

    // Persists across a fresh login
    await page.getByRole("button", { name: /log out/i }).click();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(GOOD_PW);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(
      page.getByRole("dialog", { name: "Settings" }).getByLabel(
        "Sign out after inactivity",
      ),
    ).toHaveValue("120");
  });

  test("theme select drives the applied theme", async ({ page }) => {
    await register(page, uniqueEmail("settheme"));
    await page.getByRole("button", { name: "Settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await dialog.getByLabel("Theme").selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await dialog.getByLabel("Theme").selectOption("light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("settings dialog is keyboard-reachable and passes axe (SC-006/SC-010)", async ({
    page,
  }) => {
    await register(page, uniqueEmail("seta11y"));
    // Reachable from the command palette, keyboard only
    await page.keyboard.press("ControlOrMeta+p");
    await page
      .getByRole("combobox", { name: "Type a command" })
      .fill("Open settings");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
