import { describe, expect, it } from "vitest";
import { zipSync, strToU8, type Zippable } from "fflate";
import { extractMarkdown, extractVault, type ExtractLimits } from "@/app/api/vault/import/extract";
import { HttpError } from "@/lib/session";

const MiB = 1024 * 1024;
const limits: ExtractLimits = {
  maxEntries: 1_000,
  maxFiles: 100,
  maxFileBytes: 5 * MiB,
  maxTotalBytes: 20 * MiB,
  maxNameLength: 1024,
  timeoutMs: 15_000,
};

/** Overwrite every uncompressed-size field (local headers and central directory) with `size`. */
function lieAboutSizes(zip: Uint8Array, size: number) {
  const out = zip.slice();
  const view = new DataView(out.buffer);
  for (let i = 0; i + 4 <= out.length; i++) {
    const sig = view.getUint32(i, true);
    if (sig === 0x04034b50) view.setUint32(i + 22, size, true); // local file header
    if (sig === 0x02014b50) view.setUint32(i + 24, size, true); // central directory
  }
  return out;
}

async function status(p: Promise<unknown>) {
  try {
    await p;
    return 200;
  } catch (e) {
    expect(e).toBeInstanceOf(HttpError);
    return (e as HttpError).status;
  }
}

describe("extractMarkdown", () => {
  it("keeps .md files and skips hidden folders, attachments and directories", async () => {
    const zip = zipSync({
      "Vault/a.md": strToU8("# A [[b]]"),
      "Vault/sub/b.md": strToU8("b"),
      "Vault/.obsidian/app.md": strToU8("x"),
      "Vault/img.png": new Uint8Array([1, 2, 3]),
      "__MACOSX/Vault/a.md": strToU8("junk"),
    });
    const files = await extractMarkdown(zip, limits);
    expect(files.map((f) => f.name).sort()).toEqual(["Vault/a.md", "Vault/sub/b.md"]);
    expect(files.find((f) => f.name === "Vault/a.md")?.content).toBe("# A [[b]]");
  });

  it("reads stored (uncompressed) entries", async () => {
    const zip = zipSync({ "n.md": [strToU8("stored body"), { level: 0 }] } as Zippable);
    expect(await extractMarkdown(zip, limits)).toEqual([{ name: "n.md", content: "stored body" }]);
  });

  it("stops a deflate bomb by real output, whatever the header claims, and quickly", async () => {
    const bomb = zipSync({ "bomb.md": new Uint8Array(64 * MiB) }, { level: 9 });
    expect(bomb.byteLength).toBeLessThan(1 * MiB);
    for (const zip of [bomb, lieAboutSizes(bomb, 10)]) {
      const t = performance.now();
      expect(await status(extractMarkdown(zip, limits))).toBe(413);
      // zlib stops at maxOutputLength: far less than inflating 64 MiB.
      expect(performance.now() - t).toBeLessThan(1_500);
    }
  });

  it("counts real bytes against the per-request total across files", async () => {
    const four = new Uint8Array(4 * MiB).fill(97);
    const files: Zippable = {};
    for (let i = 0; i < 6; i++) files[`n${i}.md`] = four;
    const zip = lieAboutSizes(zipSync(files), 1);
    expect(await status(extractMarkdown(zip, limits))).toBe(413);
  });

  it("refuses a stored entry larger than the per-file cap even when the header says otherwise", async () => {
    const zip = lieAboutSizes(zipSync({ "big.md": [new Uint8Array(6 * MiB).fill(98), { level: 0 }] } as Zippable), 5);
    expect(await status(extractMarkdown(zip, limits))).toBe(413);
  });

  it("counts every entry, skipped ones too, against maxEntries", async () => {
    const files: Zippable = {};
    for (let i = 0; i < 1_200; i++) files[`img/${i}.png`] = new Uint8Array(1);
    expect(await status(extractMarkdown(zipSync(files), limits))).toBe(413);
  });

  it("caps the number of kept markdown files", async () => {
    const files: Zippable = {};
    for (let i = 0; i < 150; i++) files[`${i}.md`] = strToU8("x");
    expect(await status(extractMarkdown(zipSync(files), limits))).toBe(413);
  });

  it("skips entries with absurdly long names", async () => {
    const zip = zipSync({ [`${"d/".repeat(600)}x.md`]: strToU8("x"), "ok.md": strToU8("ok") });
    expect((await extractMarkdown(zip, limits)).map((f) => f.name)).toEqual(["ok.md"]);
  });

  it("answers 400 for something that is not a zip", async () => {
    expect(await status(extractMarkdown(strToU8("PK\u0003\u0004 definitely broken".repeat(10)), limits))).toBe(400);
  });

  it("yields to the event loop while reading a large archive", async () => {
    const files: Zippable = {};
    for (let i = 0; i < 40; i++) files[`${i}.md`] = [new Uint8Array(256 * 1024).map(() => (Math.random() * 256) | 0), { level: 0 }] as never;
    const zip = zipSync(files);
    let ticks = 0;
    const timer = setInterval(() => ticks++, 0);
    await extractMarkdown(zip, { ...limits, maxTotalBytes: 100 * MiB });
    clearInterval(timer);
    expect(ticks).toBeGreaterThan(0);
  });
});

describe("extractVault", () => {
  const withFiles: ExtractLimits = { ...limits, maxAttachmentBytes: 2 * MiB };

  it("keeps notes and allowlisted attachments, raw, and skips other files", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const zip = zipSync({
      "Vault/a.md": strToU8("![[img.png]]"),
      "Vault/Assets/img.png": png,
      "Vault/doc.PDF": strToU8("%PDF-1.7"),
      "Vault/page.html": strToU8("<script>"),
      "Vault/.obsidian/icon.png": png,
    });
    const out = await extractVault(zip, withFiles);
    expect(out.notes.map((n) => n.name)).toEqual(["Vault/a.md"]);
    expect(out.files.map((f) => f.name).sort()).toEqual(["Vault/Assets/img.png", "Vault/doc.PDF"]);
    expect(out.files.find((f) => f.name.endsWith("img.png"))?.data).toEqual(png);
    expect(out.skipped).toEqual([]);
  });

  it("skips (and reports) an attachment over its cap, stored or deflated, and keeps the rest", async () => {
    const big = new Uint8Array(3 * MiB).fill(7);
    for (const level of [0, 6] as const) {
      const zip = zipSync({ "big.png": [big, { level }], "small.png": strToU8("x"), "n.md": strToU8("n") } as Zippable);
      const out = await extractVault(zip, withFiles);
      expect(out.skipped).toEqual([{ name: "big.png", reason: "An attachment is larger than 2 MiB" }]);
      expect(out.files.map((f) => f.name)).toEqual(["small.png"]);
      expect(out.notes.map((n) => n.name)).toEqual(["n.md"]);
    }
  });

  it("counts attachment bytes against the per-request total", async () => {
    const files: Zippable = {};
    for (let i = 0; i < 12; i++) files[`f${i}.png`] = new Uint8Array(2 * MiB - 1).fill(i);
    expect(await status(extractVault(zipSync(files, { level: 0 }), withFiles))).toBe(413);
  });
});
