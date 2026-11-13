import { test, expect, openVault } from "./support/fixtures";
import { openCommandPalette, openQuickSwitcher } from "./support/workspace";

test.describe("keyboard @smoke", () => {
  test("quick switcher finds and opens notes", async ({ page, api }) => {
    await api.createNote("Projects/Roadmap 2027", "Milestones.");
    await api.createNote("Reading list", "Books.");
    await openVault(page);

    const box = await openQuickSwitcher(page);
    await box.fill("road");
    const first = page.getByRole("option").first();
    await expect(first).toContainText("Roadmap 2027");
    await expect(first).toHaveAttribute("aria-selected", "true");
    // The combobox points at the selected option.
    await expect(box).toHaveAttribute("aria-activedescendant", (await first.getAttribute("id"))!);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Roadmap 2027");

    // Escape closes without opening anything and focus goes back to the page.
    const again = await openQuickSwitcher(page);
    await again.fill("Reading");
    await page.keyboard.press("Escape");
    await expect(again).toBeHidden();
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Roadmap 2027");
  });

  test("command palette runs commands by keyboard", async ({ page, account }) => {
    void account; // signed in
    await openVault(page);
    const box = await openCommandPalette(page);
    await box.fill("theme dark");
    await expect(page.getByRole("option").first()).toHaveText(/Theme: dark/);
    await page.keyboard.press("Enter");
    await expect(box).toBeHidden();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // Arrow keys move the selection; Enter runs the selected command.
    const box2 = await openCommandPalette(page);
    await box2.fill("Theme:");
    const options = page.getByRole("option");
    await expect(options).toHaveCount(3);
    await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(options.nth(1)).toHaveText(/Theme: light/);
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    const box3 = await openCommandPalette(page);
    await box3.fill("zzzz no such command");
    await expect(page.getByText("No matching commands")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(box3).toBeHidden();
  });
});
