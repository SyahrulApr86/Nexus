import AxeBuilder from "@axe-core/playwright";
import { test, expect, openVault } from "./support/fixtures";
import { editor, pressUntilVisible, runCommand } from "./support/workspace";

/** "YYYY-MM-DD" for a day in the page's own time zone, `offset` days from today. */
const isoDay = (offset = 0) =>
  `(() => { const d = new Date(); d.setDate(d.getDate() + ${offset}); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-"); })()`;

test("open today's daily note from the keyboard and walk the calendar", async ({ page, api }) => {
  await api.createNote("Templates/Daily", "## Plan for {{title}}\n");
  await openVault(page);
  await page.evaluate(() => localStorage.setItem("nexus-templates", JSON.stringify({ dailyTemplate: "Templates/Daily" })));
  await page.reload();
  const today = String(await page.evaluate(isoDay(0)));
  const yesterday = String(await page.evaluate(isoDay(-1)));

  // Pressed again until the workspace has hydrated; opening today's note twice is harmless.
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+Shift+D");
    await expect(page).toHaveTitle(new RegExp(`^${today}`), { timeout: 1500 });
  }).toPass();
  await expect(editor(page, today)).toContainText(`Plan for ${today}`);

  // The calendar marks today, shows the note, and moves by keyboard with one tab stop.
  await runCommand(page, "Show calendar");
  const grid = page.getByRole("grid");
  const todayButton = grid.locator(`[data-day="${today}"]`);
  await expect(todayButton).toHaveAttribute("aria-current", "date");
  await expect(todayButton).toHaveAttribute("aria-label", /daily note$/);
  await expect(grid.locator('[data-day][tabindex="0"]')).toHaveCount(1);
  const { violations } = await new AxeBuilder({ page })
    .include("#right-sidebar")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  await todayButton.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(grid.locator(`[data-day="${yesterday}"]`)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveTitle(new RegExp(`^${yesterday}`));

  // Previous and next walk the daily notes that exist.
  await runCommand(page, "Open next daily note");
  await expect(page).toHaveTitle(new RegExp(`^${today}`));
  await runCommand(page, "Open previous daily note");
  await expect(page).toHaveTitle(new RegExp(`^${yesterday}`));
});

test("focus mode hides the workspace chrome until Escape", async ({ page, account }) => {
  void account; // signed in first
  await openVault(page);
  const exit = page.getByRole("button", { name: "Exit focus mode" });
  await pressUntilVisible(page, "ControlOrMeta+Shift+Enter", exit);
  await expect(page.getByRole("navigation", { name: "Ribbon" })).toBeHidden();
  await expect(page.locator("#left-sidebar")).toBeHidden();

  // Kept on this device.
  await page.reload();
  await expect(page.locator("#left-sidebar")).toBeHidden();

  await page.keyboard.press("Escape");
  await expect(page.locator("#left-sidebar")).toBeVisible();
  await expect(exit).toHaveCount(0);

  await runCommand(page, "Turn on typewriter mode");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("nexus-focus"))).toContain('"typewriter":true');
});
