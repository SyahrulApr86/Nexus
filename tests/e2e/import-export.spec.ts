import { readFileSync } from "node:fs";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { test, expect, openVault } from "./support/fixtures";
import { openNote, openSettings, runCommand } from "./support/workspace";

test("import an Obsidian vault .zip, confirming the note it replaces", async ({ page, api }) => {
  await api.createNote("Welcome", "My own welcome text.");
  await openVault(page);
  const settings = await openSettings(page);

  const chooser = page.waitForEvent("filechooser");
  await settings.getByRole("button", { name: "Choose files…" }).click();
  await (await chooser).setFiles(path.join(__dirname, "fixtures", "obsidian-vault.zip"));

  // "Welcome" exists already: nothing is replaced before the user confirms.
  const confirm = page.getByRole("alertdialog", { name: "Replace 1 existing note?" }).or(page.getByRole("dialog", { name: "Replace 1 existing note?" }));
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("“Welcome”");
  expect((await api.noteByPath("Welcome"))?.content).toBe("My own welcome text.");
  await confirm.getByRole("button", { name: "Replace note" }).click();

  await expect(page.getByText("Imported 1 new and 1 updated notes")).toBeVisible();
  const paths = (await api.tree()).notes.map((n) => n.path).sort();
  expect(paths).toEqual(["Logistics/Moorings", "Welcome"]);
  expect((await api.noteByPath("Welcome"))?.content).toContain("Imported from Obsidian.");
  // Attachments come along; .obsidian settings do not.
  const attachments = await page.request.get("/api/attachments");
  expect(attachments.ok()).toBe(true);
  expect(JSON.stringify(await attachments.json())).toContain("tide-chart.png");
  expect(JSON.stringify(await api.tree())).not.toContain(".obsidian");

  await page.keyboard.press("Escape");
  await openNote(page, "Moorings");
  await expect(page.getByRole("tabpanel", { name: "Moorings" })).toContainText("Berth 4 is free until spring.");
});

test("cancelling the import confirmation changes nothing", async ({ page, api }) => {
  await api.createNote("Welcome", "My own welcome text.");
  await openVault(page);
  const settings = await openSettings(page);
  const chooser = page.waitForEvent("filechooser");
  await settings.getByRole("button", { name: "Choose files…" }).click();
  await (await chooser).setFiles({
    name: "obsidian-vault.zip",
    mimeType: "application/zip",
    buffer: readFileSync(path.join(__dirname, "fixtures", "obsidian-vault.zip")),
  });
  const confirm = page.getByRole("alertdialog", { name: "Replace 1 existing note?" }).or(page.getByRole("dialog", { name: "Replace 1 existing note?" }));
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  expect((await api.tree()).notes.map((n) => n.path)).toEqual(["Welcome"]);
  expect((await api.noteByPath("Welcome"))?.content).toBe("My own welcome text.");
});

test("export downloads the vault as a .zip of markdown files", async ({ page, api }) => {
  await api.createNote("Projects/Alpha plan", "---\nstatus: draft\n---\n# Alpha\n\nSee [[Beta notes]]. #planning\n");
  await api.createNote("Beta notes", "Beta body.");
  await openVault(page);

  const download = page.waitForEvent("download");
  await runCommand(page, "Export vault as .zip");
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.zip$/);

  const entries = unzipSync(new Uint8Array(readFileSync(await file.path())));
  const names = Object.keys(entries).filter((n) => !n.endsWith("/"));
  expect(names.some((n) => n.endsWith("Projects/Alpha plan.md"))).toBe(true);
  expect(names.some((n) => n.endsWith("Beta notes.md"))).toBe(true);
  const alpha = names.find((n) => n.endsWith("Alpha plan.md"))!;
  expect(strFromU8(entries[alpha])).toBe("---\nstatus: draft\n---\n# Alpha\n\nSee [[Beta notes]]. #planning\n");
});
