import { test, expect, openVault } from "./support/fixtures";
import { editor, expectSaved, focusEditorEnd, openNote, openQuickSwitcher } from "./support/workspace";

test.describe("notes @smoke", () => {
  test("create a note, type, autosave, reload: the text persists", async ({ page, api }) => {
    await openVault(page);

    // Quick switcher, keyboard only: a name with no match offers to create it.
    const box = await openQuickSwitcher(page);
    await box.fill("Field notes");
    await expect(page.getByRole("option", { name: "Create “Field notes”" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(editor(page, "Field notes")).toBeVisible();

    await focusEditorEnd(page, "Field notes");
    await page.keyboard.type("The tide came in at noon.");
    // Autosave, without Ctrl+S.
    await expectSaved(page);
    await expect.poll(async () => (await api.noteByPath("Field notes"))?.content, { timeout: 15_000 }).toContain("The tide came in at noon.");

    await page.reload();
    await expect(page.locator("#workbench")).toBeVisible();
    await openNote(page, "Field notes");
    await expect(editor(page, "Field notes")).toContainText("The tide came in at noon.");
  });
});
