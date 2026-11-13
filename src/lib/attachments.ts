import "server-only";
import { createHash } from "node:crypto";
import { and, asc, count, eq, gt, inArray, like, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { attachment, folder } from "@/db/schema";
import { attachmentPathProblem, normalizeAttachmentPath, numberedPath } from "@/lib/attachments/path";
import { checkFile } from "@/lib/attachments/sniff";
import { deleteBlob, writeBlob } from "@/lib/attachments/storage";
import { importNotes, previewImport, type ImportPreview, type ImportResult } from "@/lib/notes";
import { MiB, HttpError } from "@/lib/session";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;

/** Policy values for attachments (see README, Attachments). */
export const ATTACHMENT_LIMITS = {
  /** Bytes in one file. */
  fileBytes: 25 * MiB,
  /** Bytes stored for one vault, each distinct file (blob) counted once. */
  vaultBytes: 1024 * MiB,
  /** Attachment rows in one vault. */
  vaultFiles: 20_000,
  /** Rows per page of GET /api/attachments. */
  pageSize: 500,
} as const;

export type AttachmentInfo = { id: string; path: string; mime: string; size: number };
export type AttachmentRow = AttachmentInfo & { sha256: string; createdAt: Date };

const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Serialises every attachment write of one vault (upload, delete, import) for the rest of `tx`, so
 * the quota check, the blob on disk and the rows that reference it always agree.
 */
async function lockVault(tx: Tx, vaultId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`attach:${vaultId}`}))`);
}

/** Files and stored bytes of a vault; a blob shared by several paths is counted once. */
async function usage(tx: Exec, vaultId: string) {
  const [files] = await tx.select({ n: count() }).from(attachment).where(eq(attachment.vaultId, vaultId));
  const [bytes] = await tx.execute<{ bytes: string | null }>(
    sql`select coalesce(sum(size), 0)::bigint as bytes from (
          select max(${attachment.size}) as size from ${attachment}
          where ${attachment.vaultId} = ${vaultId} group by ${attachment.sha256}) blobs`,
  );
  return { files: files.n, bytes: Number(bytes?.bytes ?? 0) };
}

async function shaInVault(tx: Exec, vaultId: string, sha: string) {
  const [row] = await tx
    .select({ id: attachment.id })
    .from(attachment)
    .where(and(eq(attachment.vaultId, vaultId), eq(attachment.sha256, sha)))
    .limit(1);
  return !!row;
}

/**
 * Deletes the blobs of `shas` that no row of the vault references any more. Runs after the
 * transaction that dropped the references has committed (a rollback must find its blobs), in its
 * own transaction under the vault lock, so an upload cannot start using a blob while it goes.
 */
export async function collectBlobs(vaultId: string, shas: Iterable<string>) {
  const list = [...new Set(shas)];
  if (!list.length) return;
  await db.transaction(async (tx) => {
    await lockVault(tx, vaultId);
    for (const sha of list) if (!(await shaInVault(tx, vaultId, sha))) await deleteBlob(vaultId, sha);
  });
}

async function ensureFolders(tx: Exec, vaultId: string, path: string) {
  const parts = path.split("/").slice(0, -1);
  const paths = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
  if (paths.length)
    await tx
      .insert(folder)
      .values(paths.map((p) => ({ vaultId, path: p })))
      .onConflictDoNothing();
}

/** `path`, or the first free "name N.ext", in one query. */
async function uniquePath(tx: Exec, vaultId: string, path: string) {
  const dot = path.lastIndexOf(".");
  const stem = path.slice(0, dot);
  const ext = path.slice(dot);
  const taken = await tx
    .select({ path: attachment.path })
    .from(attachment)
    .where(
      and(
        eq(attachment.vaultId, vaultId),
        or(eq(attachment.path, path), like(attachment.path, `${escapeLike(stem)} %${escapeLike(ext)}`)),
      ),
    );
  const used = new Set(taken.map((t) => t.path));
  if (!used.has(path)) return path;
  for (let i = 1; ; i++) if (!used.has(numberedPath(path, i))) return numberedPath(path, i);
}

function assertQuota(current: { files: number; bytes: number }, addFiles: number, addBytes: number) {
  if (current.files + addFiles > ATTACHMENT_LIMITS.vaultFiles)
    throw new HttpError(413, `A vault holds at most ${ATTACHMENT_LIMITS.vaultFiles} attachments`);
  if (current.bytes + addBytes > ATTACHMENT_LIMITS.vaultBytes)
    throw new HttpError(413, "The vault has no room for this file. Delete attachments to free space.");
}

/* ------------------------------------------------------------------ */
/* Upload, read, list, delete                                          */
/* ------------------------------------------------------------------ */

/**
 * Stores one uploaded file at `folder/name` (a taken path gets " 1", " 2"… before the extension).
 * Uploading the same bytes to the same path again returns the existing attachment. Refuses
 * (400/413/415) before anything is written.
 */
export async function uploadAttachment(
  vaultId: string,
  input: { name: string; folder?: string; bytes: Uint8Array },
): Promise<AttachmentInfo> {
  const clean = normalizeAttachmentPath(input.name, input.folder ?? "");
  const problem = attachmentPathProblem(clean);
  if (problem) throw new HttpError(problem === "Unsupported file type" ? 415 : 400, problem);
  if (input.bytes.byteLength > ATTACHMENT_LIMITS.fileBytes)
    throw new HttpError(413, `A file can be at most ${ATTACHMENT_LIMITS.fileBytes / MiB} MiB`);
  const sniffed = checkFile(input.bytes, clean);
  if (!sniffed.ok) throw new HttpError(415, sniffed.reason);
  const sha = sha256Hex(input.bytes);
  const size = input.bytes.byteLength;

  return db.transaction(async (tx) => {
    await lockVault(tx, vaultId);
    const [same] = await tx
      .select({ id: attachment.id, path: attachment.path, mime: attachment.mime, size: attachment.size, sha256: attachment.sha256 })
      .from(attachment)
      .where(and(eq(attachment.vaultId, vaultId), eq(attachment.path, clean)))
      .limit(1);
    if (same && same.sha256 === sha) return { id: same.id, path: same.path, mime: same.mime, size: same.size };

    const path = await uniquePath(tx, vaultId, clean);
    const problem = attachmentPathProblem(path);
    if (problem) throw new HttpError(400, problem);
    const shared = await shaInVault(tx, vaultId, sha);
    assertQuota(await usage(tx, vaultId), 1, shared ? 0 : size);

    const wrote = await writeBlob(vaultId, sha, input.bytes);
    try {
      await ensureFolders(tx, vaultId, path);
      const [row] = await tx
        .insert(attachment)
        .values({ vaultId, path, mime: sniffed.mime, size, sha256: sha })
        .returning({ id: attachment.id, path: attachment.path, mime: attachment.mime, size: attachment.size });
      return row;
    } catch (err) {
      // Still under the vault lock, so no other row can have started using a blob written just now.
      if (wrote) await deleteBlob(vaultId, sha).catch(() => {});
      throw err;
    }
  });
}

/** The attachment at exactly `rawPath`, or null. */
export async function getAttachment(vaultId: string, rawPath: string): Promise<AttachmentRow | null> {
  const path = normalizeAttachmentPath(rawPath);
  if (!path || attachmentPathProblem(path)) return null;
  const [row] = await db
    .select({
      id: attachment.id,
      path: attachment.path,
      mime: attachment.mime,
      size: attachment.size,
      sha256: attachment.sha256,
      createdAt: attachment.createdAt,
    })
    .from(attachment)
    .where(and(eq(attachment.vaultId, vaultId), eq(attachment.path, path)))
    .limit(1);
  return row ?? null;
}

/**
 * One page of the vault's attachments by path (keyset pagination: pass the last path as `after`).
 * `next` is the cursor for the following page, or null on the last one.
 */
export async function listAttachments(vaultId: string, after: string | null, limit: number = ATTACHMENT_LIMITS.pageSize) {
  const n = Math.max(1, Math.min(limit, ATTACHMENT_LIMITS.pageSize));
  const rows = await db
    .select({
      id: attachment.id,
      path: attachment.path,
      mime: attachment.mime,
      size: attachment.size,
      sha256: attachment.sha256,
      createdAt: attachment.createdAt,
    })
    .from(attachment)
    .where(and(eq(attachment.vaultId, vaultId), after === null ? undefined : gt(attachment.path, after)))
    .orderBy(asc(attachment.path))
    .limit(n + 1);
  const items = rows.slice(0, n);
  return { items, next: rows.length > n ? items[items.length - 1].path : null };
}

/** Deletes the attachment at `rawPath` (404 when there is none) and its blob once unused. */
export async function deleteAttachment(vaultId: string, rawPath: string) {
  const path = normalizeAttachmentPath(rawPath);
  if (!path) throw new HttpError(400, "Invalid path");
  const [gone] = await db
    .delete(attachment)
    .where(and(eq(attachment.vaultId, vaultId), eq(attachment.path, path)))
    .returning({ sha256: attachment.sha256 });
  if (!gone) throw new HttpError(404, "Attachment not found");
  await collectBlobs(vaultId, [gone.sha256]);
}

/* ------------------------------------------------------------------ */
/* Vault import / export                                               */
/* ------------------------------------------------------------------ */

export type PlannedAttachment = { data: Uint8Array; mime: string; sha256: string };
export type AttachmentPlan = { byPath: Map<string, PlannedAttachment>; skipped: { path: string; reason: string }[] };

/** The attachments an import would write, by normalised path, after the same checks as an upload. */
export function planAttachments(files: { path: string; data: Uint8Array }[]): AttachmentPlan {
  const byPath = new Map<string, PlannedAttachment>();
  const skipped: AttachmentPlan["skipped"] = [];
  for (const f of files) {
    const path = normalizeAttachmentPath(f.path);
    if (!path) continue;
    const problem = attachmentPathProblem(path);
    if (problem) {
      skipped.push({ path: f.path.slice(0, 200), reason: problem });
      continue;
    }
    if (f.data.byteLength > ATTACHMENT_LIMITS.fileBytes) {
      skipped.push({ path, reason: "File is too large" });
      continue;
    }
    const sniffed = checkFile(f.data, path);
    if (!sniffed.ok) {
      skipped.push({ path, reason: sniffed.reason });
      continue;
    }
    byPath.set(path, { data: f.data, mime: sniffed.mime, sha256: sha256Hex(f.data) });
  }
  return { byPath, skipped };
}

/** Paths of `paths` that already hold an attachment (dry run of an import). */
export async function existingAttachmentPaths(vaultId: string, paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < paths.length; i += 500) {
    const rows = await db
      .select({ path: attachment.path })
      .from(attachment)
      .where(and(eq(attachment.vaultId, vaultId), inArray(attachment.path, paths.slice(i, i + 500))));
    for (const r of rows) out.push(r.path);
  }
  return out;
}

/**
 * Writes an import's attachments inside the import's transaction: upsert by path (a file at an
 * existing path replaces it), then the quota check. When anything later in `tx` fails, the caller
 * runs `discard()` before the transaction ends (the vault lock is still held, so no other row can
 * have started using a blob written here). After commit it passes `replaced` to collectBlobs.
 */
export async function importAttachmentsTx(tx: Tx, vaultId: string, plan: AttachmentPlan["byPath"]) {
  const written: string[] = [];
  let created = 0;
  let updated = 0;
  const replaced = new Set<string>();
  if (!plan.size) return { created, updated, replaced, discard: async () => {} };
  await lockVault(tx, vaultId);
  const discard = async () => {
    for (const sha of written) await deleteBlob(vaultId, sha).catch(() => {});
  };
  try {
    const entries = [...plan];
    for (let i = 0; i < entries.length; i += 500) {
      const part = entries.slice(i, i + 500);
      const existing = await tx
        .select({ path: attachment.path, sha256: attachment.sha256 })
        .from(attachment)
        .where(and(eq(attachment.vaultId, vaultId), inArray(attachment.path, part.map(([p]) => p))));
      const before = new Map(existing.map((e) => [e.path, e.sha256]));
      for (const [path, f] of part) {
        const old = before.get(path);
        if (old === f.sha256) continue; // unchanged
        if (await writeBlob(vaultId, f.sha256, f.data)) written.push(f.sha256);
        await ensureFolders(tx, vaultId, path);
        await tx
          .insert(attachment)
          .values({ vaultId, path, mime: f.mime, size: f.data.byteLength, sha256: f.sha256 })
          .onConflictDoUpdate({
            target: [attachment.vaultId, attachment.path],
            set: { mime: sql`excluded.mime`, size: sql`excluded.size`, sha256: sql`excluded.sha256` },
          });
        if (old === undefined) created++;
        else {
          updated++;
          replaced.add(old);
        }
      }
    }
    assertQuota(await usage(tx, vaultId), 0, 0);
  } catch (err) {
    await discard();
    throw err;
  }
  return { created, updated, replaced, discard };
}

/** One page of attachments for a streaming export, by path after `afterPath`. */
export async function exportAttachmentPage(vaultId: string, afterPath: string | null, limit: number) {
  return db
    .select({ path: attachment.path, sha256: attachment.sha256 })
    .from(attachment)
    .where(and(eq(attachment.vaultId, vaultId), afterPath === null ? undefined : gt(attachment.path, afterPath)))
    .orderBy(asc(attachment.path))
    .limit(limit);
}

export type VaultImportResult = ImportResult & { attachments: { created: number; updated: number } };

/**
 * Imports notes and attachments in one transaction: either all of it lands or none of it does.
 * Skipped files of both kinds are listed in `skipped`.
 */
export async function importVault(
  vaultId: string,
  notes: { path: string; content: string }[],
  files: { path: string; data: Uint8Array }[],
): Promise<VaultImportResult> {
  const plan = planAttachments(files);
  let stats = { created: 0, updated: 0, replaced: new Set<string>() };
  const res = await importNotes(vaultId, notes, async (tx) => {
    const r = await importAttachmentsTx(tx, vaultId, plan.byPath);
    stats = r;
    return { discard: r.discard };
  });
  await collectBlobs(vaultId, stats.replaced);
  return {
    ...res,
    skipped: [...res.skipped, ...plan.skipped],
    attachments: { created: stats.created, updated: stats.updated },
  };
}

export type VaultImportPreview = ImportPreview & { attachments: number; attachmentConflicts: string[] };

/**
 * Dry run of importVault. `conflicts` lists every path that would be overwritten, notes (no
 * extension) and attachments (with theirs) together, sorted; `attachmentConflicts` repeats the
 * attachment ones. `total` counts notes, `attachments` the attachments it would write.
 */
export async function previewVaultImport(
  vaultId: string,
  notes: { path: string; content: string }[],
  files: { path: string; data: Uint8Array }[],
): Promise<VaultImportPreview> {
  const preview = await previewImport(vaultId, notes);
  const { byPath } = planAttachments(files);
  const attachmentConflicts = (await existingAttachmentPaths(vaultId, [...byPath.keys()])).sort();
  return {
    conflicts: [...preview.conflicts, ...attachmentConflicts].sort(),
    total: preview.total,
    attachments: byPath.size,
    attachmentConflicts,
  };
}
