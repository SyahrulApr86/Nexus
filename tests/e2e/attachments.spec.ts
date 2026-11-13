import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, openVault } from "./support/fixtures";
import { focusEditorEnd, openNote, pressUntilVisible } from "./support/workspace";

const PNG = readFileSync(path.join(__dirname, "fixtures", "tide-chart.png")).toString("base64");

test("paste an image into a note: it uploads, embeds and renders", async ({ page, api }) => {
  const note = await api.createNote("Harbour log", "Morning chart:\n");
  await openVault(page);
  await openNote(page, "Harbour log");
  const ed = await focusEditorEnd(page, "Harbour log");

  // A pasted file, as the browser delivers a screenshot from the clipboard.
  await ed.evaluate((el, b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "tide-chart.png", { type: "image/png" }));
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, PNG);

  // The placeholder becomes an embed of the stored file.
  await expect.poll(async () => (await api.getNote(note.id)).content, { timeout: 15_000 }).toMatch(/!\[\[[^\]]*tide-chart[^\]]*\.png\]\]/);
  const embedded = (await api.getNote(note.id)).content.match(/!\[\[([^\]]+)\]\]/)![1];

  // The file is served to its owner.
  const file = await page.request.get(`/api/attachments/file?path=${encodeURIComponent(embedded)}`);
  expect(file.status()).toBe(200);
  expect(file.headers()["content-type"]).toContain("image/png");

  // Live preview shows the image; so does the reading view.
  const pane = page.getByRole("tabpanel", { name: "Harbour log" });
  const loaded = async (img: ReturnType<typeof pane.locator>) => {
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => (el.complete ? el.naturalWidth : 0))).toBe(48);
  };
  await loaded(pane.locator("img.cm-att-image"));
  await pressUntilVisible(page, "ControlOrMeta+E", pane.getByRole("button", { name: "Switch to editing view" }));
  await loaded(pane.locator(`img[alt]`).filter({ visible: true }).first());
});
