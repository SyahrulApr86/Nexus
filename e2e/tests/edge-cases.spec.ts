import { expect, test, type Page } from "@playwright/test";
import { register, uniqueEmail } from "./helpers.js";

const sidebar = (page: Page) => page.locator('[aria-label="Folders and notes"]');

/** PRD §4 edge cases that only a real browser can prove. */

test("a 50,000-word note stays responsive to type in (PRD §4)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await register(page, uniqueEmail("bignote"));
  await page.getByRole("button", { name: /^new note$/i }).click();
  await expect(page.getByLabel("Note title")).toHaveValue("");
  await page.getByLabel("Note title").fill("Very Large Note");

  // Build the body via the API so the test measures editing, not typing
  const noteId = page.url().split("/notes/")[1]!;
  const paragraph =
    "Systems accumulate stocks and regulate them through flows, and every " +
    "delay in that loop shows up later as an overshoot. ";
  const body = Array.from(
    { length: 900 },
    (_, i) => `## Section ${i}\n\n${paragraph.repeat(4)}`,
  ).join("\n\n");
  const wordCount = body.split(/\s+/).length;
  expect(wordCount).toBeGreaterThan(50_000);

  const res = await page.request.patch(`/api/notes/${noteId}`, {
    data: { content: body },
  });
  expect(res.ok()).toBeTruthy();

  await page.reload();
  const editor = page.getByRole("textbox", { name: "Note content" });
  await expect(editor).toContainText("Section 0", { timeout: 30_000 });

  // Typing lands in the editor immediately even at this size; the preview
  // is deferred so it never blocks input, and catches up shortly after.
  await editor.click();
  await page.keyboard.press("ControlOrMeta+Home"); // type at the top
  const t0 = Date.now();
  await page.keyboard.type("EDGE ");
  await expect(editor).toContainText("EDGE", { timeout: 2000 });
  const editorLatency = Date.now() - t0;
  expect(editorLatency).toBeLessThan(2000);

  // The preview catches up without blocking input, and is explicit that it
  // stops early on a document this size.
  await expect(page.getByTestId("preview")).toContainText("EDGE", {
    timeout: 15_000,
  });
  await expect(page.getByText(/Preview stops here/)).toBeVisible();

  await expect(page.getByTestId("save-state")).toHaveText("Saved", {
    timeout: 20_000,
  });
});

test("closing the tab with pending edits does not lose them (US2-S3)", async ({
  browser,
}) => {
  const email = uniqueEmail("tabclose");
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await register(page, email);
  await page.getByRole("button", { name: /^new note$/i }).click();
  await expect(page.getByLabel("Note title")).toHaveValue("");
  await page.getByLabel("Note title").fill("Unsaved Work");
  await expect(page.getByTestId("save-state")).toHaveText("Saved", {
    timeout: 5000,
  });
  const noteUrl = page.url();

  // Type, then close well inside the 1000ms autosave debounce. The short
  // wait only lets the browser deliver the last input event to the editor.
  await page.getByRole("textbox", { name: "Note content" }).click();
  await page.keyboard.type("rescued by the pagehide flush");
  await page.waitForTimeout(150);
  await page.close({ runBeforeUnload: true });

  const verify = await ctx.newPage();
  await verify.goto(noteUrl);
  await expect(
    verify.getByRole("textbox", { name: "Note content" }),
  ).toContainText("rescued by the pagehide flush", { timeout: 10_000 });
  await ctx.close();
});

test("duplicate titles in one folder stay distinct notes (PRD §4)", async ({
  page,
}) => {
  await register(page, uniqueEmail("dupes"));
  for (const body of ["first body", "second body"]) {
    await page.getByRole("button", { name: /^new note$/i }).click();
    await expect(page.getByLabel("Note title")).toHaveValue("");
    await page.getByLabel("Note title").fill("Same Title");
    await page.getByRole("textbox", { name: "Note content" }).click();
    await page.keyboard.type(body);
    await expect(page.getByTestId("save-state")).toHaveText("Saved", {
      timeout: 5000,
    });
  }
  await expect(
    sidebar(page).getByRole("link", { name: "Same Title" }),
  ).toHaveCount(2);

  // Each opens its own content — identity is the id, not the title
  await sidebar(page).getByRole("link", { name: "Same Title" }).first().click();
  await expect(page.getByTestId("preview")).toContainText("first body");
  await sidebar(page).getByRole("link", { name: "Same Title" }).nth(1).click();
  await expect(page.getByTestId("preview")).toContainText("second body");
});

test("unicode search: CJK, Cyrillic, emoji and regex characters (PRD §4)", async ({
  page,
}) => {
  await register(page, uniqueEmail("unicode"));
  const samples: [string, string][] = [
    ["Tokyo Trip", "東京タワーに行きたい"],
    ["Moscow", "Привет мир"],
    ["Party", "ship it 🎉 today"],
    ["Regex", "a+b* (parens) [brackets]"],
  ];
  for (const [title, content] of samples) {
    await page.getByRole("button", { name: /^new note$/i }).click();
    await expect(page.getByLabel("Note title")).toHaveValue("");
    await page.getByLabel("Note title").fill(title);
    await page.getByRole("textbox", { name: "Note content" }).click();
    await page.keyboard.type(content);
    await expect(page.getByTestId("save-state")).toHaveText("Saved", {
      timeout: 5000,
    });
  }

  const box = page.getByRole("combobox", { name: "Search notes" });
  for (const [expected, query] of [
    ["Tokyo Trip", "東京"],
    ["Moscow", "Привет"],
    ["Party", "🎉"],
    ["Regex", "(parens)"],
  ] as const) {
    await box.fill(query);
    await expect(page.getByRole("option").first()).toContainText(expected, {
      timeout: 5000,
    });
  }
});
