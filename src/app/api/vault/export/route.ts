import { Zip, ZipDeflate, strToU8 } from "fflate";
import { isUnsafePath } from "@/lib/markdown/parse";
import { exportPage } from "@/lib/notes";
import { HttpError, handle, logError, rateLimit, requireVault } from "@/lib/session";

/** Notes read per query; only this page's contents are in memory at a time. */
const PAGE = 200;
/** Vaults with an export in progress in this process: one at a time per vault. */
const running = new Set<string>();

/**
 * Download the whole vault as an Obsidian-compatible zip of .md files.
 *
 * Streamed: notes are read in pages by path (keyset pagination), each note is deflated as it
 * is added, and the zip leaves as a ReadableStream, so neither the vault nor the archive is ever
 * held whole. One export per vault at a time (409) and 20 per user per hour (429). A stored path
 * with an empty, "." or ".." segment is never written as an entry name (zip-slip).
 */
export async function GET(req: Request) {
  return handle(async () => {
    const { user, vaultId } = await requireVault();
    if (running.has(vaultId)) throw new HttpError(409, "An export of this vault is already running");
    rateLimit(`export:${user.id}`, 20, 60 * 60_000);
    running.add(vaultId);

    let after: string | null = null;
    let zip: Zip;
    const done = () => running.delete(vaultId);
    // pull() runs only when the client has taken what was sent, so at most one page of notes
    // (and its compressed output) is in memory however slow the download is.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        zip = new Zip((err, chunk, final) => {
          if (err) return controller.error(err);
          controller.enqueue(chunk);
          if (final) controller.close();
        });
      },
      async pull(controller) {
        try {
          if (req.signal.aborted) throw new Error("aborted");
          const rows = await exportPage(vaultId, after, PAGE);
          for (const n of rows) {
            if (isUnsafePath(n.path)) continue;
            const entry = new ZipDeflate(`${n.path}.md`, { level: 6 });
            zip.add(entry);
            entry.push(strToU8(n.content), true);
          }
          if (rows.length < PAGE) {
            zip.end();
            done();
          } else after = rows[rows.length - 1].path;
        } catch (err) {
          if (!req.signal.aborted) logError("export", err);
          zip.terminate();
          done();
          controller.error(new Error("Export failed"));
        }
      },
      cancel() {
        zip.terminate();
        done();
      },
    });

    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(stream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="nexus-vault-${stamp}.zip"`,
        "Cache-Control": "private, no-store",
      },
    });
  });
}
