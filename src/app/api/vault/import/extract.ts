import { inflateRawSync } from "node:zlib";
import { Unzip, UnzipPassThrough, type UnzipFile } from "fflate";
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
  /** Markdown files kept. */
  maxFiles: number;
  /** Decompressed bytes of one kept file. */
  maxFileBytes: number;
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

/**
 * The kept `.md` entries of `zip` as `{ name, content }`. Throws HttpError(413) when a limit is
 * passed and HttpError(400) for an archive that cannot be read.
 */
export async function extractMarkdown(
  zip: Uint8Array,
  limits: ExtractLimits,
  budget: ExtractBudget = { totalBytes: 0, files: 0 },
): Promise<{ name: string; content: string }[]> {
  const deadline = Date.now() + limits.timeoutMs;
  const out: { name: string; content: string }[] = [];
  const decoder = new TextDecoder();
  let entries = 0;
  let failure: unknown = null;

  const fail = (err: unknown) => {
    failure ??= err;
  };

  const take = (name: string, data: Uint8Array) => {
    budget.totalBytes += data.byteLength;
    if (budget.totalBytes > limits.maxTotalBytes) throw new HttpError(413, "Vault too large");
    out.push({ name, content: decoder.decode(data) });
  };

  const onFile = (file: UnzipFile) => {
    if (failure) return;
    entries++;
    if (entries > limits.maxEntries) return fail(new HttpError(413, "Too many files in the archive"));
    const name = file.name;
    if (name.endsWith("/") || name.length > limits.maxNameLength) return;
    if (!/\.md$/i.test(name) || isIgnored(name)) return;
    if (file.compression !== 0 && file.compression !== 8) return; // unsupported method: skip
    budget.files++;
    if (budget.files > limits.maxFiles) return fail(new HttpError(413, "Too many files"));

    const parts: Uint8Array[] = [];
    let seen = 0;
    const cap = limits.maxFileBytes;
    file.ondata = (err, chunk, final) => {
      if (failure) return;
      if (err) return fail(new HttpError(400, "The archive could not be read"));
      seen += chunk.byteLength;
      // Stored data is the content; deflate data never needs to be larger than its output cap
      // (plus a little framing), so either way more than the cap is refused at once.
      if (seen > cap + 1024) {
        file.terminate();
        return fail(new HttpError(413, `A note is larger than ${limits.maxFileBytes / 1024 / 1024} MiB`));
      }
      parts.push(chunk.slice()); // fflate may reuse its buffer between pushes
      if (!final) return;
      try {
        const raw = concat(parts, seen);
        if (file.compression === 0) {
          if (raw.byteLength > limits.maxFileBytes) throw new HttpError(413, "A note is too large");
          take(name, raw);
        } else {
          const room = Math.min(limits.maxFileBytes, limits.maxTotalBytes - budget.totalBytes);
          let data: Uint8Array;
          try {
            data = inflateRawSync(raw, { maxOutputLength: Math.max(room, 0) + 1 });
          } catch (e) {
            if ((e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE")
              throw new HttpError(413, room < limits.maxFileBytes ? "Vault too large" : "A note is too large");
            throw new HttpError(400, "The archive could not be read");
          }
          if (data.byteLength > room)
            throw new HttpError(413, room < limits.maxFileBytes ? "Vault too large" : "A note is too large");
          take(name, data);
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
  return out;
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
