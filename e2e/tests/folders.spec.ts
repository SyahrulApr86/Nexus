import { expect, test, type Page } from "@playwright/test";
import {
  expectNoA11yViolations,
  register,
  uniqueEmail,
} from "./helpers.js";

const sidebar = (page: Page) => page.locator('[aria-label="Folders and notes"]');

async function createFolder(page: Page, name: string) {
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(folderButton(page, name)).toBeVisible();
}

function folderButton(page: Page, name: string) {
  return sidebar(page).getByRole("button", { name: new RegExp(`^${name}`) });
}

/** Create a note and safely wait through navigation before typing the title. */
async function newNoteTitled(page: Page, title: string) {
  await page.getByRole("button", { name: /^new note$/i }).click();
  // Wait for the NEW note's empty editor before typing (avoids racing the
  // previous editor still on screen during navigation)
  await expect(page.getByLabel("Note title")).toHaveValue("", {
    timeout: 5000,
  });
  await page.getByLabel("Note title").fill(title);
  await expect(sidebar(page).getByRole("link", { name: title })).toBeVisible({
    timeout: 5000,
  });
}

async function createNoteInFolder(page: Page, folderName: string, title: string) {
  const row = folderButton(page, folderName).locator("xpath=ancestor::div[1]");
  await row.hover();
  await row
    .getByRole("button", { name: `Actions for folder ${folderName}` })
    .click();
  await page.getByRole("menuitem", { name: "New note here" }).click();
  await expect(page.getByLabel("Note title")).toHaveValue("", { timeout: 5000 });
  await page.getByLabel("Note title").fill(title);
  await expect(sidebar(page).getByRole("link", { name: title })).toBeVisible({
    timeout: 5000,
  });
}

test.describe("US3 — folders (independent test)", () => {
  test("create folders → notes inside → tree hierarchy → persists after reload", async ({
    page,
  }) => {
    await register(page, uniqueEmail("folder"));
    await createFolder(page, "Projects");
    await createNoteInFolder(page, "Projects", "Inside Note");

    const folder = folderButton(page, "Projects");
    await expect(folder).toHaveAttribute("aria-expanded", "true");
    await expect(
      sidebar(page).getByRole("link", { name: "Inside Note" }),
    ).toBeVisible();
    await expect(folder).toContainText("1");

    // Reload → structure persists
    await page.reload();
    const reloaded = folderButton(page, "Projects");
    await expect(reloaded).toBeVisible();
    await reloaded.click();
    await expect(
      sidebar(page).getByRole("link", { name: "Inside Note" }),
    ).toBeVisible();
  });

  test("move note between folders via keyboard-accessible menu (US3-S2 + SC-006)", async ({
    page,
  }) => {
    await register(page, uniqueEmail("move"));
    await createFolder(page, "Target");
    await newNoteTitled(page, "Wandering Note");

    const noteRow = sidebar(page)
      .getByRole("link", { name: "Wandering Note" })
      .locator("xpath=ancestor::div[1]");
    await noteRow.hover();
    await noteRow
      .getByRole("button", { name: "Actions for note Wandering Note" })
      .click();
    await page.getByRole("menuitem", { name: "Move to…" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /Target/ })
      .click();

    const folder = folderButton(page, "Target");
    await expect(folder).toContainText("1");
    await folder.click();
    await expect(
      sidebar(page).getByRole("link", { name: "Wandering Note" }),
    ).toBeVisible();
  });

  test("rename folder keeps notes; delete folder confirms and trashes contents (US3-S3/S4)", async ({
    page,
  }) => {
    await register(page, uniqueEmail("freen"));
    await createFolder(page, "Oldname");
    await createNoteInFolder(page, "Oldname", "Survivor");

    const row = folderButton(page, "Oldname").locator("xpath=ancestor::div[1]");
    await row.hover();
    await row.getByRole("button", { name: "Actions for folder Oldname" }).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await page.getByLabel("Folder name").fill("Newname");
    await page.getByRole("button", { name: "Rename", exact: true }).click();
    const renamed = folderButton(page, "Newname");
    await expect(renamed).toBeVisible();
    await expect(renamed).toContainText("1");

    const renamedRow = renamed.locator("xpath=ancestor::div[1]");
    await renamedRow.hover();
    await renamedRow
      .getByRole("button", { name: "Actions for folder Newname" })
      .click();
    await page.getByRole("menuitem", { name: "Delete folder" }).click();
    await page.getByRole("button", { name: "Move to trash" }).click();
    await expect(folderButton(page, "Newname")).toHaveCount(0);
    await expect(
      sidebar(page).getByRole("link", { name: "Survivor" }),
    ).toHaveCount(0);
  });

  test("sort toggle reorders notes (US3-S6)", async ({ page }) => {
    await register(page, uniqueEmail("sort"));
    for (const title of ["Banana", "Apple", "Cherry"]) {
      await newNoteTitled(page, title);
    }
    // Manual order first (creation order)
    const links = sidebar(page).getByRole("link");
    await expect(links).toHaveText(["Banana", "Apple", "Cherry"]);

    await page.getByRole("button", { name: "Sort root notes" }).click();
    await page.getByRole("menuitem", { name: "Title A-Z" }).click();
    await expect(links).toHaveText(["Apple", "Banana", "Cherry"]);

    await page.getByRole("button", { name: "Sort root notes" }).click();
    await page.getByRole("menuitem", { name: "Title Z-A" }).click();
    await expect(links).toHaveText(["Cherry", "Banana", "Apple"]);
  });

  test("keyboard reorder with Alt+Arrow persists (FR-007a + SC-006)", async ({
    page,
  }) => {
    await register(page, uniqueEmail("kreo"));
    for (const title of ["First", "Second"]) {
      await newNoteTitled(page, title);
    }
    const links = sidebar(page).getByRole("link");
    await expect(links).toHaveText(["First", "Second"]);
    await sidebar(page).getByRole("link", { name: "Second" }).focus();
    await page.keyboard.press("Alt+ArrowUp");
    await expect(links).toHaveText(["Second", "First"]);
    await page.reload();
    await expect(sidebar(page).getByRole("link")).toHaveText([
      "Second",
      "First",
    ]);
  });

  test("workspace with folder tree passes WCAG 2.1 AA (SC-010)", async ({
    page,
  }) => {
    await register(page, uniqueEmail("fa11y"));
    await createFolder(page, "Audit");
    await expectNoA11yViolations(page);
  });
});
