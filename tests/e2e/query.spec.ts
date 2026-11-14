import { test, expect, openVault } from "./support/fixtures";
import { openNote, pressUntilVisible } from "./support/workspace";

/* ```query blocks: live results in the reading view and Live Preview (src/components/workspace/query). */

test("query block: a table, a list and tasks in the reading view; tasks toggle in their own note", async ({ page, api }) => {
  await api.createNote("Projects/Roadmap", "---\nstatus: active\npriority: 2\n---\n#project\n\n- [ ] Ship query blocks\n");
  await api.createNote("Projects/Atlas", "---\nstatus: paused\npriority: 10\n---\n#project\n");
  const inbox = await api.createNote("Inbox", "- [ ] Buy milk\n");
  await api.createNote(
    "Dashboard",
    "# Dashboard\n\n```query\nTABLE status, priority FROM #project SORT priority desc\n```\n\n```query\nLIST FROM \"Projects\"\n```\n\n```query\nTASK WHERE completed = false\n```\n\n```query\nLIST WHERE status\n```\n",
  );
  await openVault(page);
  await openNote(page, "Dashboard");
  const pane = page.getByRole("tabpanel", { name: "Dashboard" });
  await pressUntilVisible(page, "ControlOrMeta+E", pane.getByRole("button", { name: "Switch to editing view" }));

  const blocks = pane.locator("nexus-query");
  await expect(blocks).toHaveCount(4);
  const table = blocks.nth(0);
  await expect(table.getByText("2 notes")).toBeVisible();
  await expect(table.getByRole("columnheader")).toHaveText(["Note", "status", "priority"]);
  await expect(table.getByRole("row").nth(1)).toContainText("Atlas");
  await expect(blocks.nth(1).getByRole("link")).toHaveText(["Atlas", "Roadmap"]);
  // Errors name the position.
  await expect(blocks.nth(3)).toContainText("Line 1, column 18: Expected =, !=, <, >, <=, >=, contains or exists after “status”");

  // A task in another note toggles there, by keyboard.
  const milk = blocks.nth(2).getByRole("checkbox", { name: "Buy milk" });
  await milk.focus();
  await page.keyboard.press("Space");
  await expect.poll(async () => (await api.getNote(inbox.id)).content).toBe("- [x] Buy milk\n");
  await expect(blocks.nth(2).getByRole("checkbox", { name: "Buy milk" })).toHaveCount(0);

  // Result links open the note.
  await blocks.nth(1).getByRole("link", { name: "Roadmap" }).click();
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Roadmap");
});

test("query block: Live Preview shows results, and the source when the caret enters", async ({ page, api }) => {
  await api.createNote("Atlas", "#project\n");
  await api.createNote("Plan", "Intro\n\n```query\nLIST FROM #project\n```\n\nAfter\n");
  await openVault(page);
  await openNote(page, "Plan");
  const pane = page.getByRole("tabpanel", { name: "Plan" });
  const widget = pane.locator(".cm-query-widget");
  await expect(widget.getByRole("link", { name: "Atlas" })).toBeVisible();

  // Keyboard: ArrowDown from the line above steps into the block and shows its source.
  await pane.locator(".cm-line", { hasText: "Intro" }).click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(widget).toHaveCount(0);
  await expect(pane.locator(".cm-line", { hasText: "LIST FROM #project" })).toBeVisible();

  // Leaving the block draws the results again; Edit query puts the caret back in.
  await page.keyboard.press("ControlOrMeta+End");
  await expect(widget).toHaveCount(1);
  await widget.getByRole("button", { name: "Edit query" }).click();
  await expect(widget).toHaveCount(0);
});

test("query block: a task toggled in Live Preview from its own note's query updates the editor and the next edit keeps it", async ({ page, api }) => {
  const self = await api.createNote("Self", "- [ ] Self task\n\n```query\nTASK WHERE file.name = \"Self\"\n```\n\nEnd");
  await openVault(page);
  await openNote(page, "Self");
  const pane = page.getByRole("tabpanel", { name: "Self" });
  await pane.locator(".cm-line", { hasText: "End" }).click();
  const fromQuery = pane.locator(".cm-query-widget").getByRole("checkbox", { name: "Self task" });
  await fromQuery.click();
  await expect.poll(async () => (await api.getNote(self.id)).content).toMatch(/^- \[x\] Self task/);
  // The editor's own box follows: the editor holds its own copy of the text.
  await expect(pane.locator(".cm-content input[type=checkbox]").first()).toBeChecked();

  // The next keystroke saves on top of the toggle: no conflict, and the box stays ticked.
  await pane.locator(".cm-line", { hasText: "End" }).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" more");
  await expect.poll(async () => (await api.getNote(self.id)).content).toContain("End more");
  expect((await api.getNote(self.id)).content).toMatch(/^- \[x\] Self task/);
  await expect(page.getByText(/conflict|Couldn.t save/i)).toHaveCount(0);
});
