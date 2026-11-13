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
