import "server-only";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

/*
 * Attachment bytes on disk, content-addressed:
 *
 *   <NEXUS_DATA_DIR>/attachments/<vaultId>/<sha256>
 *
 * NEXUS_DATA_DIR defaults to ./data (relative to the working directory) in development; the Docker
 * image sets /data, a named volume (docker-compose.yml). A blob is written once per vault and
 * content (dedup), atomically: to a temp file in the same directory, fsynced, then renamed into
 * place, so a reader never sees a half-written file. Which rows still use a blob is the caller's
 * business (src/lib/attachments.ts), under a per-vault lock.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

export function dataDir(): string {
  return path.resolve(/* turbopackIgnore: true */ process.env.NEXUS_DATA_DIR || "data");
}

function vaultDir(vaultId: string) {
  if (!UUID.test(vaultId)) throw new Error("Invalid vault id");
  return path.join(dataDir(), "attachments", vaultId.toLowerCase());
}

/** Absolute path of a blob. Both parts are checked, so no input can point outside the data dir. */
export function blobPath(vaultId: string, sha256: string): string {
  if (!SHA256.test(sha256)) throw new Error("Invalid sha256");
  return path.join(vaultDir(vaultId), sha256);
}

export async function blobExists(vaultId: string, sha256: string): Promise<boolean> {
  try {
    return (await stat(blobPath(vaultId, sha256))).isFile();
  } catch {
    return false;
  }
}

/** Stores `bytes` under its hash unless the blob is already there. Returns true when it wrote one. */
export async function writeBlob(vaultId: string, sha256: string, bytes: Uint8Array): Promise<boolean> {
  if (await blobExists(vaultId, sha256)) return false;
  const dir = vaultDir(vaultId);
  await mkdir(dir, { recursive: true, mode: 0o750 });
  const tmp = path.join(dir, `.${sha256}.${randomUUID()}.tmp`);
  const fh = await open(tmp, "wx", 0o640);
  try {
    await fh.writeFile(bytes);
    await fh.sync();
  } catch (err) {
    await fh.close().catch(() => {});
    await unlink(tmp).catch(() => {});
    throw err;
  }
  await fh.close();
  try {
    await rename(tmp, blobPath(vaultId, sha256));
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
  return true;
}

export async function deleteBlob(vaultId: string, sha256: string): Promise<void> {
  try {
    await unlink(blobPath(vaultId, sha256));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/** A web stream of the blob's bytes `start`..`end` (inclusive), or the whole file. */
export function readBlob(vaultId: string, sha256: string, range?: { start: number; end: number }): ReadableStream<Uint8Array> {
  const stream = createReadStream(blobPath(vaultId, sha256), range ? { start: range.start, end: range.end } : {});
  // Readable.toWeb keeps backpressure: a slow client never makes the server buffer the file.
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
}

/** The whole blob in memory (export, at most the per-file limit). */
export async function readBlobBytes(vaultId: string, sha256: string): Promise<Uint8Array> {
  const fh = await open(blobPath(vaultId, sha256), "r");
  try {
    return new Uint8Array(await fh.readFile());
  } finally {
    await fh.close();
  }
}
