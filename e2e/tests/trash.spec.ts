import { expect, test, type Page } from "@playwright/test";
import {
  expectNoA11yViolations,
  register,
  uniqueEmail,
} from "./helpers.js";

const sidebar = (page: Page) => page.locator('[aria-label="Folders and notes"]');

async function newNoteTitled(page: Page, title: string, content = "") {
  await page.getByRole("button", { name: /^new note$/i }).click();
  await expect(page.getByLabel("Note title")).toHaveValue("", { timeout: 5000 });
  await page.getByLabel("Note title").fill(title);
  if (content) {
    await page.getByRole("textbox", { name: "Note content" }).click();
    await page.keyboard.type(content);
  }
  await expect(page.getByTestId("save-state")).toHaveText("Saved", {
    timeout: 5000,
  });
  await expect(sidebar(page).getByRole("link", { name: title })).toBeVisible();
}

async function trashNoteFromSidebar(page: Page, title: string) {
  const row = sidebar(page)
    .getByRole("link", { name: title })
    .locator("xpath=ancestor::div[1]");
  await row.hover();
  await row.getByRole("button", { name: `Actions for note ${title}` }).click();
  await page.getByRole("menuitem", { name: "Move to trash" }).click();
  await expect(sidebar(page).getByRole("link", { name: title })).toHaveCount(0);
}

test.describe("US12 — trash & version history (independent test)", () => {
  test("delete → trash shows note + versions → restore intact → permanent delete irrecoverable", async ({
    page,
  }) => {
    await register(page, uniqueEmail("trash"));
    await newNoteTitled(page, "Precious", "version one");
    // Second version
    await page.getByRole("textbox", { name: "Note content" }).click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("version two");
    await expect(page.getByTestId("save-state")).toHaveText("Saved", {
      timeout: 5000,
    });

    await trashNoteFromSidebar(page, "Precious");

    // Trash view lists it (FR-028)
    await page.getByRole("link", { name: "Trash" }).click();
    await expect(page.getByText("Precious")).toBeVisible();

    // Version history preview, read-only (FR-032 / US12-S6)
    await page.getByRole("button", { name: "Versions" }).click();
    const versionList = page.getByLabel(/Version history/);
    await expect(versionList.getByRole("button", { name: /Latest/ })).toBeVisible();
    await expect(
      page.getByTestId("version-preview").getByText("version two"),
    ).toBeVisible();
    // An earlier version still holds the previous content (exact version count
    // depends on autosave cadence — scan for it)
    const versionButtons = versionList
      .getByLabel("Versions")
      .getByRole("button");
    const count = await versionButtons.count();
    let foundOld = false;
    for (let i = 1; i < count && !foundOld; i++) {
      await versionButtons.nth(i).click();
      foundOld = await page
        .getByTestId("version-preview")
        .getByText("version one")
        .waitFor({ state: "visible", timeout: 1500 })
        .then(() => true)
        .catch(() => false);
    }
    expect(foundOld).toBe(true);
    await versionList.getByRole("button", { name: "Close" }).click();

    // Restore (FR-030 / US12-S3)
    await page.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByText(/restored to its original location/)).toBeVisible();
    await sidebar(page).getByRole("link", { name: "Precious" }).click();
    await expect(
      page.getByRole("textbox", { name: "Note content" }),
    ).toContainText("version two");

    // Delete again + permanent delete (FR-031 / US12-S4)
    await trashNoteFromSidebar(page, "Precious");
    await page.getByRole("link", { name: "Trash" }).click();
    await page.getByRole("button", { name: "Delete forever" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete forever" })
      .click();
    await expect(page.getByText("Trash is empty.")).toBeVisible();
    await expect(sidebar(page).getByRole("link", { name: "Precious" })).toHaveCount(0);
  });

  test("deleted folder trashes contents; restore brings structure back (US12-S2)", async ({
    page,
  }) => {
    await register(page, uniqueEmail("ftrash"));
    // Folder + note inside via UI
    await page.getByRole("button", { name: "New folder" }).click();
    await page.getByLabel("Folder name").fill("Bundle");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    const folderBtn = sidebar(page).getByRole("button", { name: /^Bundle/ });
    const row = folderBtn.locator("xpath=ancestor::div[1]");
    await row.hover();
    await row.getByRole("button", { name: "Actions for folder Bundle" }).click();
    await page.getByRole("menuitem", { name: "New note here" }).click();
    await expect(page.getByLabel("Note title")).toHaveValue("", { timeout: 5000 });
    await page.getByLabel("Note title").fill("Inside");
    await expect(sidebar(page).getByRole("link", { name: "Inside" })).toBeVisible();

    // Delete folder
    await row.hover();
    await row.getByRole("button", { name: "Actions for folder Bundle" }).click();
    await page.getByRole("menuitem", { name: "Delete folder" }).click();
    await page.getByRole("button", { name: "Move to trash" }).click();
    await expect(folderBtn).toHaveCount(0);

    // Restore from trash
    await page.getByRole("link", { name: "Trash" }).click();
    await expect(page.getByText("Bundle")).toBeVisible();
    await page.getByRole("button", { name: "Restore" }).click();
    const bundleBtn = sidebar(page).getByRole("button", { name: /^Bundle/ });
    await expect(bundleBtn).toBeVisible();
    // Tree refetches can swallow a click — toggle until expanded
    await expect(async () => {
      if ((await bundleBtn.getAttribute("aria-expanded")) !== "true") {
        await bundleBtn.click();
      }
      await expect(
        sidebar(page).getByRole("link", { name: "Inside" }),
      ).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });
  });

  test("trash page passes axe (SC-010) and is keyboard-operable", async ({
    page,
  }) => {
    await register(page, uniqueEmail("ta11y"));
    await newNoteTitled(page, "Trashable");
    await trashNoteFromSidebar(page, "Trashable");
    // Navigate to trash via keyboard
    await page.getByRole("link", { name: "Trash" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Trashable")).toBeVisible();
    await expectNoA11yViolations(page);
    // Restore via keyboard
    await page.getByRole("button", { name: "Restore" }).focus();
    await page.keyboard.press("Enter");
    await expect(sidebar(page).getByRole("link", { name: "Trashable" })).toBeVisible();
  });
});
