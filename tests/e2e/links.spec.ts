import { test, expect, openVault } from "./support/fixtures";
import { editor, expectSaved, focusEditorEnd, openNote } from "./support/workspace";

test("[[link]] autocomplete links notes, backlinks show it, rename rewrites the link", async ({ page, api }) => {
  const source = await api.createNote("Projects/Alpha plan", "# Alpha\n\nNext step: ");
  await api.createNote("Beta notes", "Beta body.");
  await openVault(page);
  await openNote(page, "Alpha plan");

  // Autocomplete, keyboard only.
  await focusEditorEnd(page, "Alpha plan");
  await page.keyboard.type("[[Bet");
  const suggestion = page.getByRole("listbox").getByRole("option", { name: /Beta notes/ });
  await expect(suggestion).toBeVisible();
  await expect(suggestion).toHaveAttribute("aria-selected", "true");
  // CodeMirror ignores Enter on a completion list younger than its interactionDelay (75 ms).
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  await expect(editor(page, "Alpha plan")).toContainText("Beta notes");
  await expectSaved(page);
  await expect.poll(async () => (await api.getNote(source.id)).content).toContain("[[Beta notes]]");

  // The target's backlinks list the source.
  await openNote(page, "Beta notes");
  const sidebar = page.getByRole("complementary", { name: "Right sidebar" });
  await sidebar.getByRole("tab", { name: "Backlinks" }).click();
  await expect(sidebar.getByRole("button", { name: /Linked mentions 1/ })).toBeVisible();
  await expect(sidebar.getByRole("listitem").filter({ hasText: "Alpha plan" })).toBeVisible();

  // Renaming the target from its title rewrites the link in the source.
  const title = page.getByRole("textbox", { name: "Note title" });
  await title.fill("Gamma notes");
  await title.press("Enter");
  await expect(page.getByText("Renamed. Updated links in 1 note")).toBeVisible();
  await expect.poll(async () => (await api.getNote(source.id)).content).toContain("[[Gamma notes]]");
  expect((await api.getNote(source.id)).content).not.toContain("[[Beta notes]]");

  await openNote(page, "Alpha plan");
  await expect(editor(page, "Alpha plan")).toContainText("Gamma notes");
});

// A phone has no right click, Menu key or Shift+F10: the command palette (the bottom bar's
// Commands button) reaches the editor menu's "Copy block link" too.
test("copy block link and link to heading from the command palette @smoke", async ({ page, api, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const n = await api.createNote("Runbook", "# Rollback\n\nVerify the deploy");
  await openVault(page);
  await openNote(page, "Runbook");
  const ed = await focusEditorEnd(page, "Runbook");

  const commands = page.getByRole("button", { name: "Commands" });
  const run = async (label: string) => {
    const box = page.getByRole("combobox", { name: "Search commands" });
    if (await commands.isVisible()) await commands.click();
    else await page.keyboard.press("ControlOrMeta+P");
    await expect(box).toBeVisible();
    await box.fill(label);
    const option = page.getByRole("option", { name: label, exact: true });
    await expect(option).toBeVisible();
    await option.click();
    await expect(box).toBeHidden();
  };

  // The caret is on the paragraph: it gets a block id, and the link to it is copied.
  await run("Copy block link");
  await expect(page.getByText("Block link copied")).toBeVisible();
  await expect.poll(async () => (await api.getNote(n.id)).content).toMatch(/^Verify the deploy \^[a-z0-9]{6}$/m);
  const id = (await api.getNote(n.id)).content.match(/\^([a-z0-9]{6})$/m)![1];
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`[[Runbook#^${id}]]`);

  // On a heading line the command names the heading.
  await ed.click();
  await page.keyboard.press("ControlOrMeta+Home");
  await run("Copy link to heading");
  await expect(page.getByText("Heading link copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("[[Runbook#Rollback]]");
});
