import { test, expect, openVault } from "./support/fixtures";
import { runCommand } from "./support/workspace";

type CanvasDoc = { nodes: { type: string; text?: string }[]; edges: unknown[] };

test("create a canvas and add a text card", async ({ page, api }) => {
  await openVault(page);
  await runCommand(page, "Create new canvas");

  const tools = page.getByRole("toolbar", { name: "Canvas tools" });
  await expect(tools).toBeVisible();
  await expect.poll(async () => (await api.tree()).notes.map((n) => n.path)).toContain("Untitled.canvas");

  await tools.getByRole("button", { name: "Add text card" }).click();
  // A new text card opens for typing.
  const card = page.getByRole("textbox").filter({ visible: true }).last();
  await expect(card).toBeFocused();
  await page.keyboard.type("Survey the north pier");
  await page.keyboard.press("Escape");

  await expect
    .poll(async () => {
      const canvas = await api.noteByPath("Untitled.canvas");
      const doc = JSON.parse(canvas?.content || "{}") as CanvasDoc;
      return doc.nodes?.filter((n) => n.type === "text").map((n) => n.text);
    }, { timeout: 15_000 })
    .toEqual(["Survey the north pier"]);

  // The card is still there after a reload.
  await page.reload();
  await expect(page.getByText("Survey the north pier")).toBeVisible();
});
