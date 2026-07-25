import { Prisma } from "@prisma/client";
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
 * Fuzzy content search, decrypt-in-SQL, strictly vault-scoped (FR-013/FR-025).
 * Returns note ids with a similarity score against the decrypted content.
 */
export async function searchDecryptedContent(
  vaultId: string,
  query: string,
): Promise<{ id: string; score: number; snippet: string }[]> {
  return prisma.$queryRaw`
    WITH decrypted AS (
      SELECT id, pgp_sym_decrypt("contentEnc", ${KEY}) AS content
      FROM "Note"
      WHERE "vaultId" = ${vaultId}::uuid AND "isTrashed" = false
    )
    SELECT id,
           GREATEST(similarity(content, ${query}),
                    CASE WHEN content ILIKE ${"%" + query + "%"} THEN 0.6 ELSE 0 END)::float AS score,
           LEFT(content, 200) AS snippet
    FROM decrypted
    WHERE similarity(content, ${query}) > 0.05
       OR content ILIKE ${"%" + query + "%"}
    ORDER BY score DESC
    LIMIT 50` as Promise<{ id: string; score: number; snippet: string }[]>;
}

export const sql = Prisma.sql;
