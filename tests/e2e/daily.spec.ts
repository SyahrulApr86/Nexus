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

  // The exit control hands keyboard focus to the note, not to the page body.
  await openVault(page);
  await pressUntilVisible(page, "ControlOrMeta+Shift+Enter", exit);
  await exit.focus();
  await page.keyboard.press("Enter");
  await expect(exit).toHaveCount(0);
  await expect(page.locator("#left-sidebar")).toBeVisible();
  expect(await page.evaluate(() => document.activeElement !== document.body && !!document.activeElement?.closest("#workbench"))).toBe(true);

  await runCommand(page, "Turn on typewriter mode");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("nexus-focus"))).toContain('"typewriter":true');
});

test("offline, a daily note opens even when its template is not on this device", async ({ page, api, context }) => {
  await api.createNote("Templates/Daily", "## Plan for {{title}}\n");
  await openVault(page);
  const registered = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    return Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 15_000))]);
  });
  test.skip(!registered, "The service worker did not register under this harness (it needs the production build).");
  await page.evaluate(() => localStorage.setItem("nexus-templates", JSON.stringify({ dailyTemplate: "Templates/Daily" })));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  // A day in the month the calendar shows: yesterday, or tomorrow on the 1st.
  const offset = (await page.evaluate(() => new Date().getDate())) === 1 ? 1 : -1;
  const other = String(await page.evaluate(isoDay(offset)));
  await runCommand(page, "Show calendar");
  const day = page.getByRole("grid").locator(`[data-day="${other}"]`);
  await expect(day).toBeVisible();

  await context.setOffline(true);
  try {
    await day.click();
    // The template was never opened here: the note opens empty and says why.
    await expect(page).toHaveTitle(new RegExp(`^${other}`));
    await expect(page.getByText("Daily note template is not available offline")).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
