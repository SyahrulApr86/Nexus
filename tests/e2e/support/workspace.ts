/** Page helpers for the workspace (/vault). Locators follow the accessible names the UI exposes. */
import { expect, type Locator, type Page } from "@playwright/test";

/** The CodeMirror editor of the note shown in the focused tab. */
export function editor(page: Page, title?: string): Locator {
  const name = title ? `${title}, note text` : /, note text$/;
  return page.getByRole("textbox", { name }).first();
}

/** Puts the caret at the end of the note text. */
export async function focusEditorEnd(page: Page, title?: string) {
  const ed = editor(page, title);
  await ed.click();
  await page.keyboard.press("ControlOrMeta+End");
  return ed;
}

/**
 * Presses a shortcut until `target` shows. The workspace registers its hotkeys when it hydrates,
 * which can finish after the page looks ready.
 */
export async function pressUntilVisible(page: Page, key: string, target: Locator) {
  await expect(async () => {
    if (!(await target.isVisible())) await page.keyboard.press(key);
    await expect(target).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

/** Opens the command palette (Mod+P) and returns its input. */
export async function openCommandPalette(page: Page) {
  const box = page.getByRole("combobox", { name: "Search commands" });
  await pressUntilVisible(page, "ControlOrMeta+P", box);
  await expect(box).toBeFocused();
  return box;
}

/** Opens the quick switcher (Mod+O) and returns its input. */
export async function openQuickSwitcher(page: Page) {
  const box = page.getByRole("combobox", { name: "Find or create a note" });
  await pressUntilVisible(page, "ControlOrMeta+O", box);
  await expect(box).toBeFocused();
  return box;
}

/** Runs a command through the command palette, keyboard only. */
export async function runCommand(page: Page, label: string) {
  const box = await openCommandPalette(page);
  await box.fill(label);
  await expect(page.getByRole("option", { name: label, exact: true })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(box).toBeHidden();
}

/** Opens a note through the quick switcher, keyboard only. */
export async function openNote(page: Page, name: string) {
  const box = await openQuickSwitcher(page);
  await box.fill(name);
  // The best match is selected first; a note in a folder also shows its folder in the option.
  await expect(page.getByRole("option").first()).toContainText(name);
  await expect(page.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(box).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(name);
}

/**
 * Waits until every pending change has reached the server, as the status bar reports it. Phones
 * have no status bar: there the callers check the saved text through the API instead.
 */
export async function expectSaved(page: Page) {
  const bar = page.getByRole("contentinfo", { name: "Status bar" });
  if (!(await bar.isVisible())) return;
  await expect(bar.getByText("Saved", { exact: true })).toBeVisible({ timeout: 15_000 });
}

/** Opens the settings dialog with its keyboard shortcut. */
export async function openSettings(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await pressUntilVisible(page, "ControlOrMeta+Comma", dialog);
  return dialog;
}
