import { Prisma } from "@prisma/client";
import { extractTags } from "@nexus/shared";
import { prisma } from "../db.js";
import { env } from "../env.js";

/**
 * FR-026: note content is encrypted at rest with pgcrypto (pgp_sym_encrypt).
 * This module is the ONLY path that touches Note.contentEnc / NoteVersion.contentEnc.
 */

const KEY = env.CONTENT_ENCRYPTION_KEY;

export async function encryptContent(
  content: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const rows = await prisma.$queryRaw<{ enc: Buffer }[]>`
    SELECT pgp_sym_encrypt(${content}, ${KEY}) AS enc`;
  return new Uint8Array(rows[0]!.enc);
}

export async function decryptContent(contentEnc: Uint8Array): Promise<string> {
  const rows = await prisma.$queryRaw<{ dec: string }[]>`
    SELECT pgp_sym_decrypt(${Buffer.from(contentEnc)}, ${KEY}) AS dec`;
  return rows[0]!.dec;
}

/** Decrypt a note's content by id inside the DB (single round-trip). */
export async function readNoteContent(noteId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ dec: string }[]>`
    SELECT pgp_sym_decrypt("contentEnc", ${KEY}) AS dec
    FROM "Note" WHERE id = ${noteId}::uuid`;
  return rows[0]?.dec ?? null;
}

export async function readVersionContent(
  versionId: string,
): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ dec: string }[]>`
    SELECT pgp_sym_decrypt("contentEnc", ${KEY}) AS dec
    FROM "NoteVersion" WHERE id = ${versionId}::uuid`;
  return rows[0]?.dec ?? null;
}

/**
 * Refresh the derived search index for a note (SC-003 fallback design).
 * 'simple' config: no stemming surprises, CJK strings kept as whole tokens
 * (matched via prefix queries).
 */
export async function updateSearchIndex(
  noteId: string,
  content: string,
): Promise<void> {
  const tags = [...new Set(extractTags(content).map((t) => t.name))];
  await prisma.$executeRaw`
    UPDATE "Note"
    SET "contentTsv" = to_tsvector('simple', LEFT(${content}, 200000)),
        "tags" = ${tags}
    WHERE id = ${noteId}::uuid`;
}

export const sql = Prisma.sql;
