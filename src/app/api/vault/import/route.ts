import { importNotes } from "@/lib/notes";
import { HttpError, MiB, handle, rateLimit, readForm, requireVault } from "@/lib/session";
import { commonRoot, extractMarkdown, type ExtractBudget } from "./extract";

const MAX_ZIP = 50 * MiB; // compressed upload
const MAX_REQUEST = MAX_ZIP + 1 * MiB; // whole multipart body
const MAX_PARTS = 500;
const MAX_NAME = 1024;
const LIMITS = {
  maxEntries: 100_000,
  maxFiles: 20_000,
  maxFileBytes: 5 * MiB,
  maxTotalBytes: 200 * MiB,
  maxNameLength: MAX_NAME,
  timeoutMs: 15_000,
};

/**
 * POST multipart/form-data with field "file": either a .zip of an Obsidian
 * vault or one or more .md files. Only .md files are imported for now;
 * .obsidian/ config and attachments are skipped. Limits (all enforced on real
 * bytes, before any note is written): 51 MiB request, 500 parts, 5 MiB per note,
 * 200 MiB and 20,000 notes per import, 10 imports per user per hour.
 * Returns { created, updated, skipped: [{ path, reason }] }.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const { user, vaultId } = await requireVault();
    rateLimit(`import:${user.id}`, 10, 60 * 60_000);
    const form = await readForm(req, MAX_REQUEST);
    const all = form.getAll("file");
    if (all.length > MAX_PARTS) throw new HttpError(413, "Too many files in one upload");
    const uploads = all.filter((f): f is File => f instanceof File);
    if (!uploads.length) throw new HttpError(400, "No file uploaded");
    if (uploads.filter((u) => u.size > LIMITS.maxFileBytes).length > 1)
      throw new HttpError(413, "Upload one archive at a time");

    const out: { path: string; content: string }[] = [];
    const budget: ExtractBudget = { totalBytes: 0, files: 0 };
    for (const up of uploads) {
      if (up.size > MAX_ZIP) throw new HttpError(413, "File too large");
      if (up.name.length > MAX_NAME) throw new HttpError(400, "File name too long");
      if (up.name.toLowerCase().endsWith(".zip")) {
        const entries = await extractMarkdown(new Uint8Array(await up.arrayBuffer()), LIMITS, budget);
        const root = commonRoot(entries.map((e) => e.name));
        for (const e of entries) out.push({ path: e.name.slice(root.length), content: e.content });
      } else if (/\.md$/i.test(up.name)) {
        if (up.size > LIMITS.maxFileBytes) throw new HttpError(413, "A note is larger than 5 MiB");
        budget.totalBytes += up.size;
        budget.files++;
        if (budget.totalBytes > LIMITS.maxTotalBytes) throw new HttpError(413, "Vault too large");
        if (budget.files > LIMITS.maxFiles) throw new HttpError(413, "Too many files");
        out.push({ path: up.name, content: await up.text() });
      }
    }
    return importNotes(vaultId, out);
  });
}
