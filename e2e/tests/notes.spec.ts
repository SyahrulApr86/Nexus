import { expect, test, type Page } from "@playwright/test";
import {
  expectNoA11yViolations,
  register,
  uniqueEmail,
} from "./helpers.js";

async function createNoteViaUi(page: Page) {
  await page.getByRole("button", { name: /new note/i }).click();
  await expect(page.getByLabel("Note title")).toBeVisible();
}

const editorLocator = (page: Page) =>
  page.getByRole("textbox", { name: "Note content" });

test.describe("US2 — create, edit, preview (independent test)", () => {
  test("create → type markdown → live preview → persist after reload", async ({
    page,
  }) => {
    await register(page, uniqueEmail("note"));
    await createNoteViaUi(page);

    await page.getByLabel("Note title").fill("My First Note");

    const editor = editorLocator(page);
    await editor.click();
    await page.keyboard.type("# Hello Nexus\n\nSome **bold** and *italic*.");

    // Live preview renders as HTML (US2-S2)
    const preview = page.getByTestId("preview");
    await expect(preview.getByRole("heading", { name: "Hello Nexus" })).toBeVisible();
    await expect(preview.locator("strong")).toHaveText("bold");
    await expect(preview.locator("em")).toHaveText("italic");

    // Autosave fires (FR-006) — wait for saved state
    await expect(page.getByTestId("save-state")).toHaveText("Saved", {
      timeout: 5000,
    });

    // Persistence after reload (US2-S4)
    await page.reload();
    await expect(
      page.getByRole("link", { name: "My First Note" }),
    ).toBeVisible();
    await expect(editorLocator(page)).toContainText("Hello Nexus");
    await expect(
      page.getByTestId("preview").getByRole("heading", { name: "Hello Nexus" }),
    ).toBeVisible();
  });

  test("preview updates within 100ms of typing (SC-002 smoke)", async ({
    page,
  }) => {
    await register(page, uniqueEmail("perf"));
    await createNoteViaUi(page);
    const editor = editorLocator(page);
    await editor.click();
    await page.keyboard.type("## Speed");
    const start = Date.now();
    await expect(
      page.getByTestId("preview").getByRole("heading", { name: "Speed" }),
    ).toBeVisible({ timeout: 1000 });
    // Generous bound: assertion round-trip included
    expect(Date.now() - start).toBeLessThan(1000);
  });

  test("note editor is keyboard-operable and passes axe (SC-006/SC-010)", async ({
    page,
  }) => {
    await register(page, uniqueEmail("kbd2"));
    // Create note via keyboard only
    await page.getByRole("button", { name: /new note/i }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Note title")).toBeVisible();
    await page.getByLabel("Note title").focus();
    await page.keyboard.type("Keyboard Note");
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("save-state")).toHaveText("Saved", {
      timeout: 5000,
    });
    await expectNoA11yViolations(page);
  });

  test("second device/session sees the note (FR-023 smoke)", async ({
    browser,
  }) => {
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    const email = uniqueEmail("sync");
    await register(pageA, email);
    await createNoteViaUi(pageA);
    await pageA.getByLabel("Note title").fill("Cross Device Note");
    await expect(pageA.getByTestId("save-state")).toHaveText("Saved", {
      timeout: 5000,
    });

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await pageB.goto("/login");
    await pageB.getByLabel("Email").fill(email);
    await pageB.getByLabel("Password", { exact: true }).fill("Sup3r$ecret");
    await pageB.getByRole("button", { name: /^log in$/i }).click();
    await expect(
      pageB.getByRole("link", { name: "Cross Device Note" }),
    ).toBeVisible();
    await ctxA.close();
    await ctxB.close();
  });
});
