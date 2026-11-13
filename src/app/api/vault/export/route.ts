import { strToU8, zipSync } from "fflate";
import { exportVault } from "@/lib/notes";
import { handle, requireVault } from "@/lib/session";

/** Download the whole vault as an Obsidian-compatible zip of .md files. */
export async function GET() {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const notes = await exportVault(vaultId);
    const files: Record<string, Uint8Array> = {};
    for (const n of notes) files[`${n.path}.md`] = strToU8(n.content);
    const zip = zipSync(files, { level: 6 });
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="nexus-vault-${stamp}.zip"`,
      },
    });
  });
}
