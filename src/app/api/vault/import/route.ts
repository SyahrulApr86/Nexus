import { strFromU8, unzipSync } from "fflate";
import { importNotes } from "@/lib/notes";
import { HttpError, handle, requireVault } from "@/lib/session";

const MAX_ZIP = 50 * 1024 * 1024; // 50 MB compressed
const MAX_TOTAL = 200 * 1024 * 1024; // 200 MB uncompressed (zip-bomb guard)
const MAX_FILES = 20_000;

/**
 * POST multipart/form-data with field "file": either a .zip of an Obsidian
 * vault or one or more .md files. Only .md files are imported for now;
 * .obsidian/ config and attachments are skipped.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const form = await req.formData();
    const uploads = form.getAll("file").filter((f): f is File => f instanceof File);
    if (!uploads.length) throw new HttpError(400, "No file uploaded");

    const out: { path: string; content: string }[] = [];
    let total = 0;
    for (const up of uploads) {
      if (up.size > MAX_ZIP) throw new HttpError(413, "File too large");
      if (up.name.toLowerCase().endsWith(".zip")) {
        const entries = unzipSync(new Uint8Array(await up.arrayBuffer()), {
          filter: (f) => {
            if (!/\.md$/i.test(f.name) || isIgnored(f.name)) return false;
            total += f.originalSize;
            if (total > MAX_TOTAL) throw new HttpError(413, "Vault too large");
            return true;
          },
        });
        const names = Object.keys(entries);
        const root = commonRoot(names);
        for (const name of names) out.push({ path: name.slice(root.length), content: strFromU8(entries[name]) });
      } else if (/\.md$/i.test(up.name)) {
        out.push({ path: up.name, content: await up.text() });
      }
      if (out.length > MAX_FILES) throw new HttpError(413, "Too many files");
    }
    return importNotes(vaultId, out);
  });
}

function isIgnored(name: string) {
  return name.split("/").some((seg) => seg.startsWith(".") || seg === "__MACOSX");
}

/** If every file sits under one top-level folder (typical zip of a vault), strip it. */
function commonRoot(names: string[]) {
  if (!names.length) return "";
  const first = names[0].split("/")[0];
  return names.every((n) => n.includes("/") && n.split("/")[0] === first) ? `${first}/` : "";
}
