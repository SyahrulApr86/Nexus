import { ATTACHMENT_LIMITS, importVault, previewVaultImport } from "@/lib/attachments";
import { HttpError, MiB, handle, rateLimit, readForm, requireVault } from "@/lib/session";
import { commonRoot, extractVault, type ExtractBudget } from "./extract";

const MAX_ZIP = 50 * MiB; // compressed upload
const MAX_REQUEST = MAX_ZIP + 1 * MiB; // whole multipart body
const MAX_PARTS = 500;
const MAX_NAME = 1024;
const LIMITS = {
  maxEntries: 100_000,
  maxFiles: 20_000,
  maxFileBytes: 5 * MiB,
  maxAttachmentBytes: ATTACHMENT_LIMITS.fileBytes,
  maxTotalBytes: 200 * MiB,
  maxNameLength: MAX_NAME,
  timeoutMs: 15_000,
};

/**
 * POST multipart/form-data with field "file": either a .zip of an Obsidian vault or one or more
 * .md (or .canvas) files. From a zip, notes (.md), canvases (.canvas) and attachments (images, PDFs, audio and video, the upload
 * allowlist of src/lib/attachments/sniff.ts) are imported; .obsidian/ config and other files are
 * skipped. Limits (all enforced on real bytes, before anything is written): 51 MiB request, 500
 * parts, 5 MiB per note, 25 MiB per attachment (a larger one is skipped), 200 MiB and 20,000 files
 * per import (notes and attachments together), 10 imports per user per hour, and the vault quotas.
 * Notes and attachments are written in one transaction.
 * Returns { created, updated, skipped: [{ path, reason }], attachments: { created, updated } }
 * (created/updated count notes).
 *
 * With ?dryRun=1 the same body is parsed under the same limits but nothing is written: returns
 * { conflicts: string[] (paths that already hold a note or attachment; attachments keep their
 * extension), attachmentConflicts: string[], total: number (notes it would write), attachments:
 * number }. Dry runs have their own, looser cap (30 per user per hour) and do not count as imports.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const { user, vaultId } = await requireVault();
    const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
    if (dryRun) rateLimit(`import-preview:${user.id}`, 30, 60 * 60_000);
    else rateLimit(`import:${user.id}`, 10, 60 * 60_000);
    const form = await readForm(req, MAX_REQUEST);
    const all = form.getAll("file");
    if (all.length > MAX_PARTS) throw new HttpError(413, "Too many files in one upload");
    const uploads = all.filter((f): f is File => f instanceof File);
    if (!uploads.length) throw new HttpError(400, "No file uploaded");
    if (uploads.filter((u) => u.size > LIMITS.maxFileBytes).length > 1)
      throw new HttpError(413, "Upload one archive at a time");

    const notes: { path: string; content: string }[] = [];
    const files: { path: string; data: Uint8Array }[] = [];
    const tooLarge: { path: string; reason: string }[] = [];
    const budget: ExtractBudget = { totalBytes: 0, files: 0 };
    for (const up of uploads) {
      if (up.size > MAX_ZIP) throw new HttpError(413, "File too large");
      if (up.name.length > MAX_NAME) throw new HttpError(400, "File name too long");
      if (up.name.toLowerCase().endsWith(".zip")) {
        const vault = await extractVault(new Uint8Array(await up.arrayBuffer()), LIMITS, budget);
        const root = commonRoot([...vault.notes, ...vault.files, ...vault.skipped].map((e) => e.name));
        for (const e of vault.notes) notes.push({ path: e.name.slice(root.length), content: e.content });
        for (const e of vault.files) files.push({ path: e.name.slice(root.length), data: e.data });
        for (const e of vault.skipped) tooLarge.push({ path: e.name.slice(root.length), reason: e.reason });
      } else if (/\.(md|canvas)$/i.test(up.name)) { // canvas track: a loose .canvas file imports like a note
        if (up.size > LIMITS.maxFileBytes) throw new HttpError(413, "A note is larger than 5 MiB");
        budget.totalBytes += up.size;
        budget.files++;
        if (budget.totalBytes > LIMITS.maxTotalBytes) throw new HttpError(413, "Vault too large");
        if (budget.files > LIMITS.maxFiles) throw new HttpError(413, "Too many files");
        notes.push({ path: up.name, content: await up.text() });
      }
    }
    if (dryRun) return previewVaultImport(vaultId, notes, files);
    const res = await importVault(vaultId, notes, files);
    return { ...res, skipped: [...res.skipped, ...tooLarge] };
  });
}
