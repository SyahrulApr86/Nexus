import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from "fflate";
import { exportAttachmentPage } from "@/lib/attachments";
import { readBlobBytes } from "@/lib/attachments/storage";
import { isUnsafePath } from "@/lib/markdown/parse";
import { exportPage } from "@/lib/notes";
import { isCanvasPath } from "@/lib/canvas"; // canvas track
import { HttpError, handle, logError, rateLimit, requireVault } from "@/lib/session";

/** Notes read per query; only this page's contents are in memory at a time. */
const PAGE = 200;
/** Attachment rows read per query. Their bytes are read one file per pull. */
const FILE_PAGE = 100;
/** Formats that are not compressed already; everything else is stored as is. */
const DEFLATE = /\.(svg|wav|pdf)$/i;
/** Vaults with an export in progress in this process: one at a time per vault. */
const running = new Set<string>();

/**
 * Download the whole vault as an Obsidian-compatible zip: notes as .md files (canvases as .canvas), then attachments at
 * their own paths (extension included).
 *
 * Streamed: notes are read in pages by path (keyset pagination), each note is deflated as it
 * is added, then attachments follow one file per pull, and the zip leaves as a ReadableStream, so
 * neither the vault nor the archive is ever held whole. One export per vault at a time (409) and 20 per user per hour (429). A stored path
 * with an empty, "." or ".." segment is never written as an entry name (zip-slip).
 */
export async function GET(req: Request) {
  return handle(async () => {
    const { user, vaultId } = await requireVault();
    if (running.has(vaultId)) throw new HttpError(409, "An export of this vault is already running");
    rateLimit(`export:${user.id}`, 20, 60 * 60_000);
    running.add(vaultId);

    let after: string | null = null;
    let phase: "notes" | "files" = "notes";
    let afterFile: string | null = null;
    let queue: { path: string; sha256: string }[] = [];
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
          if (phase === "notes") {
            const rows = await exportPage(vaultId, after, PAGE);
            for (const n of rows) {
              if (isUnsafePath(n.path)) continue;
              // canvas track: a canvas is stored with its extension and leaves as the .canvas file Obsidian opens.
              const entry = new ZipDeflate(isCanvasPath(n.path) ? n.path : `${n.path}.md`, { level: 6 });
              zip.add(entry);
              entry.push(strToU8(n.content), true);
            }
            if (rows.length < PAGE) phase = "files";
            else after = rows[rows.length - 1].path;
            return;
          }
          if (!queue.length) {
            queue = await exportAttachmentPage(vaultId, afterFile, FILE_PAGE);
            if (!queue.length) {
              zip.end();
              done();
              return;
            }
            afterFile = queue[queue.length - 1].path;
          }
          const f = queue.shift()!;
          if (isUnsafePath(f.path)) return;
          let bytes: Uint8Array;
          try {
            bytes = await readBlobBytes(vaultId, f.sha256);
          } catch (err) {
            // A blob lost on disk leaves the rest of the export intact.
            logError("export-attachment", err);
            return;
          }
          const entry = DEFLATE.test(f.path) ? new ZipDeflate(f.path, { level: 6 }) : new ZipPassThrough(f.path);
          zip.add(entry);
          entry.push(bytes, true);
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
