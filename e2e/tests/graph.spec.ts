import { expect, test, type Page } from "@playwright/test";
import {
  expectNoA11yViolations,
  register,
  uniqueEmail,
} from "./helpers.js";

const sidebar = (page: Page) => page.locator('[aria-label="Folders and notes"]');

async function newNoteWithContent(page: Page, title: string, content: string) {
  await page.getByRole("button", { name: /^new note$/i }).click();
  await expect(page.getByLabel("Note title")).toHaveValue("", { timeout: 5000 });
  await page.getByLabel("Note title").fill(title);
  if (content) {
    await page.getByRole("textbox", { name: "Note content" }).click();
    await page.keyboard.type(content);
    await page.keyboard.press("Escape");
  }
  await expect(page.getByTestId("save-state")).toHaveText("Saved", {
    timeout: 5000,
  });
  await expect(sidebar(page).getByRole("link", { name: title })).toBeVisible();
}

test.describe("US6 — graph view (independent test)", () => {
  test("linked notes render as graph; node click navigates (US6-S1/S3/S5)", async ({
    page,
  }) => {
    await register(page, uniqueEmail("graph"));
    await newNoteWithContent(page, "Hub", "links to [[Spoke]]");
    await newNoteWithContent(page, "Spoke", "");
    await newNoteWithContent(page, "Loner", "");

    await page.getByRole("link", { name: "Graph" }).click();
    await expect(page.getByText(/3 notes · 1 links · 1 unlinked/)).toBeVisible();
    await expect(page.getByTestId("graph-canvas")).toBeVisible();

    // Keyboard-accessible node list mirrors the canvas (SC-006)
    const nodeList = page.getByRole("navigation", { name: "Graph nodes" });
    await expect(nodeList.getByRole("link", { name: /Hub/ })).toBeVisible();
    await expect(nodeList.getByRole("link", { name: /Loner/ })).toBeVisible();

    // Click a node (via the accessible list) → editor opens (US6-S3)
    await nodeList.getByRole("link", { name: /Spoke/ }).click();
    await expect(page.getByLabel("Note title")).toHaveValue("Spoke");
  });

  test("pan and zoom do not break rendering (US6-S2 smoke)", async ({
    page,
  }) => {
    await register(page, uniqueEmail("graphpz"));
    await newNoteWithContent(page, "One", "[[Two]]");
    await newNoteWithContent(page, "Two", "");
    await page.getByRole("link", { name: "Graph" }).click();
    const canvas = page.getByTestId("graph-canvas");
    await expect(canvas).toBeVisible();

    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // Zoom via wheel, pan via drag
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -300);
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy + 60, { steps: 5 });
    await page.mouse.up();
    // Still interactive afterwards
    await expect(canvas).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Graph nodes" }),
    ).toBeVisible();
  });

  test("graph page passes axe (SC-010)", async ({ page }) => {
    await register(page, uniqueEmail("ga11y"));
    await newNoteWithContent(page, "Solo", "");
    await page.getByRole("link", { name: "Graph" }).click();
    await expect(page.getByTestId("graph-canvas")).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
