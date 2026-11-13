import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect, openVault } from "./support/fixtures";
import { openNote, openSettings } from "./support/workspace";

/**
 * Known violations, reported to the app owners and listed here so the suite still catches every new
 * one. Each match is noted as an annotation in the report; remove the entry once the app is fixed.
 * Empty: the last entry (target-size on .props-chip-x) was fixed by sizing the button 24x24 px.
 */
const KNOWN: { id: string; target: string; projects: RegExp }[] = [];

/**
 * Accessibility smoke test: axe-core with the WCAG 2.x A and AA rules (2.2 included) on the main
 * screens, in every project (light and dark, desktop and phone). Serious and critical violations
 * fail the test; the rest are attached to the report.
 */
async function audit(page: Page, name: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const summary = violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
  }));
  await test.info().attach(`axe ${name}`, { body: JSON.stringify(summary, null, 2), contentType: "application/json" });
  const project = test.info().project.name;
  const known = (v: (typeof summary)[number]) =>
    KNOWN.some((k) => k.id === v.id && k.projects.test(project) && v.targets.every((t) => t === k.target));
  for (const v of summary.filter(known))
    test.info().annotations.push({ type: "known a11y issue", description: `${v.id} on ${v.targets.join(", ")} (${name})` });
  const blocking = summary.filter((v) => (v.impact === "serious" || v.impact === "critical") && !known(v));
  expect(blocking, `serious or critical axe violations on ${name}`).toEqual([]);
}

test.describe("accessibility @smoke", () => {
  test("landing page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("main")).toBeVisible();
    await audit(page, "landing");
  });

  test("sign-in page", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in to your vault" })).toBeVisible();
    await audit(page, "sign-in");
  });

  test("workspace with a note open", async ({ page, api }) => {
    await api.createNote(
      "Projects/Quarterly harbour maintenance review with the operations and finance teams",
      "---\nstatus: draft\ntags: [work]\n---\n# Review\n\nSee [[Crew roster]]. #planning\n\n- [ ] Paint bollards\n- [x] Order rope\n\n```ts\nconst berths = 12;\n```\n",
    );
    await api.createNote("Crew roster", "Links back to [[Quarterly harbour maintenance review with the operations and finance teams]].");
    await openVault(page);
    await openNote(page, "Quarterly harbour maintenance review with the operations and finance teams");
    await audit(page, "workspace");
  });

  test("settings dialog", async ({ page, account }) => {
    void account; // signed in
    await openVault(page);
    const dialog = await openSettings(page);
    await expect(dialog.getByRole("heading", { name: "Settings" })).toBeVisible();
    await audit(page, "settings");
  });
});
