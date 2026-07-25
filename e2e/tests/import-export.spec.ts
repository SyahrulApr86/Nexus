import { expect, test, type Page } from "@playwright/test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
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
    await page.keyboard.press("Escape");
  }
  await expect(page.getByTestId("save-state")).toHaveText("Saved", {
    timeout: 5000,
  });
  await expect(sidebar(page).getByRole("link", { name: title })).toBeVisible();
}

test.describe("US11 — export vault (independent test)", () => {
  test("one-click export downloads ZIP with folder structure and content", async ({
    page,
  }) => {
    await register(page, uniqueEmail("export"));
    // Folder + note inside, plus a root note
    await page.getByRole("button", { name: "New folder" }).click();
    await page.getByLabel("Folder name").fill("Docs");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    const row = sidebar(page)
      .getByRole("button", { name: /^Docs/ })
      .locator("xpath=ancestor::div[1]");
    await row.hover();
    await row.getByRole("button", { name: "Actions for folder Docs" }).click();
    await page.getByRole("menuitem", { name: "New note here" }).click();
    await expect(page.getByLabel("Note title")).toHaveValue("");
    await page.getByLabel("Note title").fill("Inner");
    await page.getByRole("textbox", { name: "Note content" }).click();
    await page.keyboard.type("inner content with [[Root Note]] #tagged");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("save-state")).toHaveText("Saved");
    await newNoteTitled(page, "Root Note", "root content");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: /Export vault/ }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const zip = unzipSync(new Uint8Array(Buffer.concat(chunks)));

    expect(Object.keys(zip).sort()).toEqual(
      ["Docs/Inner.md", "Root Note.md"].sort(),
    );
    // Wikilinks/tags literal in plain text (US11-S2)
    expect(strFromU8(zip["Docs/Inner.md"]!)).toContain("[[Root Note]] #tagged");
  });
});

test.describe("US13 — import (independent test)", () => {
  test("single + bulk .md import; ZIP recreates folders; wikilinks functional", async ({
    page,
  }) => {
    await register(page, uniqueEmail("import"));

    // Bulk file import
    await page
      .getByLabel("Markdown files to import")
      .setInputFiles([
        {
          name: "First.md",
          mimeType: "text/markdown",
          buffer: Buffer.from("first content links [[Second]]"),
        },
        {
          name: "Second.md",
          mimeType: "text/markdown",
          buffer: Buffer.from("second #importedtag"),
        },
      ]);
    await expect(page.getByText("Imported 2 notes.")).toBeVisible();
    await expect(sidebar(page).getByRole("link", { name: "First" })).toBeVisible();

    // Wikilink functional post-import (US13-S4)
    await sidebar(page).getByRole("link", { name: "First" }).click();
    const link = page
      .getByTestId("preview")
      .locator("a.wikilink", { hasText: "Second" });
    await expect(link).toBeVisible();
    await expect(link).not.toHaveClass(/wikilink-broken/);
    await link.click();
    await expect(page.getByLabel("Note title")).toHaveValue("Second");

    // ZIP import with folder hierarchy (US13-S3)
    const zipData = zipSync({
      "Imported Folder/Deep.md": strToU8("deep note"),
      "Imported Folder/Sub/Leaf.md": strToU8("leaf note"),
      "Imported Folder/ignore.txt": strToU8("skip me"),
    });
    await page.getByLabel("ZIP archive to import").setInputFiles({
      name: "vault.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(zipData),
    });
    await expect(
      page.getByText(/Imported 2 notes, skipped 1 non-Markdown/),
    ).toBeVisible();

    const folderBtn = sidebar(page).getByRole("button", {
      name: /^Imported Folder/,
    });
    await expect(folderBtn).toBeVisible();
    await expect(async () => {
      if ((await folderBtn.getAttribute("aria-expanded")) !== "true") {
        await folderBtn.click();
      }
      await expect(
        sidebar(page).getByRole("link", { name: "Deep" }),
      ).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });

    await expectNoA11yViolations(page);
  });
});
