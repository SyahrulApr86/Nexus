import { test, expect, openVault } from "./support/fixtures";
import { pressUntilVisible } from "./support/workspace";

test("tags pane and search with operators", async ({ page, api }) => {
  await api.createNote("Projects/Alpha plan", "Kickoff for the harbour survey. #planning #work/meetings");
  await api.createNote("Projects/Beta draft", "Draft of the harbour budget. #planning #draft");
  await api.createNote("Journal/Monday", "Walked along the harbour. #personal");
  await openVault(page);

  // Tags pane: every tag with its note count; nested tags keep their parent.
  const right = page.getByRole("complementary", { name: "Right sidebar" });
  await right.getByRole("tab", { name: "Tags" }).click();
  const tagsPanel = right.getByRole("tabpanel", { name: "Tags" });
  await expect(tagsPanel).toContainText("planning");
  await expect(tagsPanel).toContainText("personal");

  // Search, opened with Mod+Shift+F.
  const input = page.getByRole("searchbox", { name: "Search notes" });
  await pressUntilVisible(page, "ControlOrMeta+Shift+F", input);
  await expect(input).toBeFocused();
  const left = page.getByRole("complementary", { name: "Left sidebar" });
  const results = left.getByRole("tabpanel", { name: "Search" }).getByRole("listitem");

  const search = async (query: string, expected: string[]) => {
    await input.fill(query);
    await expect(page.getByRole("status").filter({ hasText: query })).toBeAttached();
    await expect(results).toHaveCount(expected.length);
    for (const name of expected) await expect(results.filter({ hasText: name })).toHaveCount(1);
  };

  await search("harbour", ["Alpha plan", "Beta draft", "Monday"]);
  await search("harbour #planning", ["Alpha plan", "Beta draft"]);
  await search("harbour -#draft", ["Alpha plan", "Monday"]);
  await search("path:Journal harbour", ["Monday"]);
  await search("tag:work", ["Alpha plan"]); // a nested tag matches its parent
  await search('file:"Beta draft"', ["Beta draft"]);
  await search("harbour (budget OR survey)", ["Alpha plan", "Beta draft"]);

  // A hit opens the note; the search term is highlighted in the snippet.
  await input.fill("survey");
  await expect(results).toHaveCount(1);
  await expect(results.locator("mark")).toHaveText("survey");
  await results.getByRole("button").click();
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Alpha plan");
});
