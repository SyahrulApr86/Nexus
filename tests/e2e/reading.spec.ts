import { test, expect, openVault } from "./support/fixtures";
import { openNote, pressUntilVisible } from "./support/workspace";

test("reading view: a task checkbox toggles the task in the note", async ({ page, api }) => {
  const note = await api.createNote(
    "Errands",
    "# Errands\n\n- [ ] Buy rope\n- [x] Book the ferry\n\n```ts\nconst knots = 3;\n```\n",
  );
  await openVault(page);
  await openNote(page, "Errands");

  // Mod+E switches to the reading view.
  const pane = page.getByRole("tabpanel", { name: "Errands" });
  await pressUntilVisible(page, "ControlOrMeta+E", pane.getByRole("button", { name: "Switch to editing view" }));
  const rope = pane.getByRole("listitem").filter({ hasText: "Buy rope" }).getByRole("checkbox");
  const ferry = pane.getByRole("listitem").filter({ hasText: "Book the ferry" }).getByRole("checkbox");
  await expect(rope).not.toBeChecked();
  await expect(ferry).toBeChecked();
  // The code block renders as code, not as text.
  await expect(pane.locator("pre code")).toContainText("const knots = 3;");

  // Keyboard: the checkbox takes focus and Space toggles it.
  await rope.focus();
  await page.keyboard.press("Space");
  await expect(rope).toBeChecked();
  await expect(rope).toBeFocused();
  await expect.poll(async () => (await api.getNote(note.id)).content).toContain("- [x] Buy rope");

  await ferry.click();
  await expect(ferry).not.toBeChecked();
  await expect.poll(async () => (await api.getNote(note.id)).content).toContain("- [ ] Book the ferry");
});
