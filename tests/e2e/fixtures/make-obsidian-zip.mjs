// Rebuilds obsidian-vault.zip, the small Obsidian vault the import spec uploads.
// Run from the repository root: node tests/e2e/fixtures/make-obsidian-zip.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { zipSync, strToU8 } from "fflate";

const here = new URL(".", import.meta.url);
const files = {
  "Harbour vault/Welcome.md": strToU8("# Welcome\n\nImported from Obsidian. See [[Moorings]].\n"),
  "Harbour vault/Logistics/Moorings.md": strToU8(
    "---\ntags: [imported]\n---\n# Moorings\n\nBerth 4 is free until spring. #harbour\n\n![[tide-chart.png]]\n",
  ),
  "Harbour vault/tide-chart.png": readFileSync(new URL("tide-chart.png", here)),
  // Obsidian's own settings are skipped by the import.
  "Harbour vault/.obsidian/app.json": strToU8('{"livePreview":true}\n'),
};
// A fixed date keeps the archive byte-identical between runs.
const mtime = new Date("2026-01-01T00:00:00Z");
writeFileSync(new URL("obsidian-vault.zip", here), zipSync(files, { mtime }));
