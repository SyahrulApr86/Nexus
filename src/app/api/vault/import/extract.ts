import { inflateRawSync } from "node:zlib";
import { Unzip, UnzipPassThrough, type UnzipFile } from "fflate";
import { ALLOWED_EXTENSIONS, extensionOf } from "@/lib/attachments/sniff";
import { HttpError } from "@/lib/session";

/*
 * Zip extraction for vault import, safe on a shared event loop.
 *
 * Nothing in a zip's headers is trusted as a limit on work: entry counts and sizes are what the
 * attacker wrote. Instead:
 * - The archive is walked as a stream of local file headers (fflate `Unzip`), so the central
 *   directory (ZIP64 entry counts, many entries pointing at one blob) is never read.
 * - Every entry is counted, kept or not, and the walk stops past `maxEntries`.
 * - Deflate data of a kept entry is collected compressed and inflated by zlib with
 *   `maxOutputLength`, which stops decoding as soon as the output passes the per-file cap, so the
 *   CPU spent follows the bytes actually produced. Stored entries are counted chunk by chunk.
 * - Real decompressed bytes are added to a per-request total.
 * - The input is pushed in small slices, yielding to the event loop every MiB, under a wall-clock
 *   budget.
 */

export type ExtractLimits = {
  /** Entries of any kind (folders, attachments, skipped files included). */
  maxEntries: number;
  /** Files kept (notes and attachments). */
  maxFiles: number;
  /** Decompressed bytes of one kept note. */
  maxFileBytes: number;
  /**
   * Decompressed bytes of one kept attachment (an allowed extension, see attachments/sniff.ts).
   * Leave out to skip attachments.
   */
  maxAttachmentBytes?: number;
  /** Decompressed bytes of all kept files of this request (shared across uploads via `budget`). */
  maxTotalBytes: number;
  /** Characters in an entry name. */
  maxNameLength: number;
  /** Wall-clock milliseconds for this archive. */
  timeoutMs: number;
};

export type ExtractBudget = { totalBytes: number; files: number };

const SLICE = 16 * 1024;
const YIELD_EVERY = 1024 * 1024;

/** Deflate entries are passed through compressed; `finish` inflates them with a hard output cap. */
class RawDeflate extends UnzipPassThrough {
  static compression = 8;
}

export function isIgnored(name: string) {
  return name.split("/").some((seg) => seg.startsWith(".") || seg === "__MACOSX");
}

const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/** The kept `.md` entries of `zip` as `{ name, content }` (attachments skipped). See extractVault. */
export async function extractMarkdown(
  zip: Uint8Array,
  limits: ExtractLimits,
  budget: ExtractBudget = { totalBytes: 0, files: 0 },
): Promise<{ name: string; content: string }[]> {
  return (await extractVault(zip, { ...limits, maxAttachmentBytes: undefined }, budget)).notes;
}

export type ExtractedVault = {
  notes: { name: string; content: string }[];
  /** Raw bytes of kept attachments; their type is checked by the importer, not here. */
  files: { name: string; data: Uint8Array }[];
  /** Attachments left out because they are over `maxAttachmentBytes`. */
  skipped: { name: string; reason: string }[];
};

/**
 * The kept `.md` entries of `zip` as `{ name, content }` and, when `limits.maxAttachmentBytes` is
 * set, entries with an attachment extension as `{ name, data }`. Throws HttpError(413) when a limit
 * is passed and HttpError(400) for an archive that cannot be read.
 */
export async function extractVault(
  zip: Uint8Array,
  limits: ExtractLimits,
  budget: ExtractBudget = { totalBytes: 0, files: 0 },
): Promise<ExtractedVault> {
  const deadline = Date.now() + limits.timeoutMs;
  const out: ExtractedVault["notes"] = [];
  const files: ExtractedVault["files"] = [];
  const skipped: ExtractedVault["skipped"] = [];
  const decoder = new TextDecoder();
  let entries = 0;
  let failure: unknown = null;

  const fail = (err: unknown) => {
    failure ??= err;
  };

  const take = (name: string, data: Uint8Array, note: boolean) => {
    budget.totalBytes += data.byteLength;
    if (budget.totalBytes > limits.maxTotalBytes) throw new HttpError(413, "Vault too large");
    if (note) out.push({ name, content: decoder.decode(data) });
    // zlib hands back a Buffer; callers get a plain Uint8Array view of the same bytes.
    else files.push({ name, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) });
  };

  const onFile = (file: UnzipFile) => {
    if (failure) return;
    entries++;
    if (entries > limits.maxEntries) return fail(new HttpError(413, "Too many files in the archive"));
    const name = file.name;
    if (name.endsWith("/") || name.length > limits.maxNameLength) return;
    if (isIgnored(name)) return;
    const note = /\.(md|canvas)$/i.test(name); // canvas track: .canvas files are notes too
    if (!note && !(limits.maxAttachmentBytes && ALLOWED_EXTENSIONS.has(extensionOf(name)))) return;
    if (file.compression !== 0 && file.compression !== 8) return; // unsupported method: skip
    budget.files++;
    if (budget.files > limits.maxFiles) return fail(new HttpError(413, "Too many files"));

    const parts: Uint8Array[] = [];
    let seen = 0;
    let dropped = false;
    const cap = note ? limits.maxFileBytes : limits.maxAttachmentBytes!;
    const tooLarge = note ? `A note is larger than ${cap / 1024 / 1024} MiB` : `An attachment is larger than ${cap / 1024 / 1024} MiB`;
    // A note over the cap fails the import; an attachment over it is skipped and reported.
    const oversize = () => {
      if (note) throw new HttpError(413, tooLarge);
      dropped = true;
      skipped.push({ name, reason: tooLarge });
    };
    file.ondata = (err, chunk, final) => {
      if (failure || dropped) return;
      if (err) return fail(new HttpError(400, "The archive could not be read"));
      seen += chunk.byteLength;
      // Stored data is the content; deflate data never needs to be much larger than its output cap
      // (stored blocks add 5 bytes per 64 KiB), so either way more than that is refused at once.
      if (seen > cap + Math.ceil(cap / 8192) + 1024) {
        file.terminate();
        try {
          oversize();
        } catch (e) {
          fail(e);
        }
        return;
      }
      parts.push(chunk.slice()); // fflate may reuse its buffer between pushes
      if (!final) return;
      try {
        const raw = concat(parts, seen);
        if (file.compression === 0) {
          if (raw.byteLength > cap) oversize();
          else take(name, raw, note);
        } else {
          const room = Math.min(cap, limits.maxTotalBytes - budget.totalBytes);
          let data: Uint8Array | null = null;
          try {
            data = inflateRawSync(raw, { maxOutputLength: Math.max(room, 0) + 1 });
          } catch (e) {
            if ((e as { code?: string }).code !== "ERR_BUFFER_TOO_LARGE") throw new HttpError(400, "The archive could not be read");
          }
          if (data && data.byteLength <= room) take(name, data, note);
          else if (room < cap) throw new HttpError(413, "Vault too large");
          else oversize();
        }
      } catch (e) {
        fail(e);
      }
    };
    file.start();
  };

  const unzip = new Unzip(onFile);
  unzip.register(UnzipPassThrough);
  unzip.register(RawDeflate);

  let sinceYield = 0;
  try {
    for (let at = 0; at < zip.byteLength; at += SLICE) {
      const end = Math.min(at + SLICE, zip.byteLength);
      unzip.push(zip.subarray(at, end), end === zip.byteLength);
      if (failure) throw failure;
      sinceYield += end - at;
      if (sinceYield >= YIELD_EVERY) {
        sinceYield = 0;
        await yieldToLoop();
        if (Date.now() > deadline) throw new HttpError(413, "The archive took too long to read");
      }
    }
    if (zip.byteLength === 0) unzip.push(new Uint8Array(0), true);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "The archive could not be read");
  }
  if (failure) throw failure;
  if (entries === 0) throw new HttpError(400, "The archive is empty or not a zip file");
  return { notes: out, files, skipped };
}

function concat(parts: Uint8Array[], size: number): Uint8Array {
  if (parts.length === 1) return parts[0];
  const buf = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    buf.set(p, at);
    at += p.byteLength;
  }
  return buf;
}

/** If every file sits under one top-level folder (typical zip of a vault), strip it. */
export function commonRoot(names: string[]) {
  if (!names.length) return "";
  const first = names[0].split("/")[0];
  return names.every((n) => n.includes("/") && n.split("/")[0] === first) ? `${first}/` : "";
}
