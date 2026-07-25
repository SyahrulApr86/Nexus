import { Hono } from "hono";
import type { SearchResultDto } from "@nexus/shared";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { requireAuth } from "../middleware/auth.js";

const KEY = env.CONTENT_ENCRYPTION_KEY;

interface Row {
  id: string;
  title: string;
  title_sim: number;
  title_sub: boolean;
  content_hit: boolean;
  snippet: string;
}

/** Build a prefix-AND tsquery from raw user input: "foo bar" -> foo:* & bar:* */
function prefixQuery(q: string): string {
  return q
    .split(/\s+/)
    .map((t) => t.replace(/['\\:&|!()]/g, ""))
    .filter(Boolean)
    .map((t) => `${t}:*`)
    .join(" & ");
}

export const searchRoutes = new Hono()
  .use("*", requireAuth)

  /**
   * FR-013: fuzzy full-text search, vault-scoped.
   * Titles (plaintext metadata): trigram fuzzy + substring — typo-tolerant.
   * Content: derived tsvector index (prefix word match) — the encrypted
   * column is only decrypted for the snippet of already-matched rows.
   */
  .get("/", async (c) => {
    const vaultId = c.get("vaultId");
    const q = (c.req.query("q") ?? "").trim();
    if (!q) return c.json({ results: [] });
    const tsq = prefixQuery(q);

    const rows = await prisma.$queryRaw<Row[]>`
      WITH hits AS (
        SELECT id, title,
               word_similarity(${q}, title)::float AS title_sim,
               (title ILIKE ${"%" + q + "%"})      AS title_sub,
               ("contentTsv" @@ to_tsquery('simple', ${tsq})) AS content_hit
        FROM "Note"
        WHERE "vaultId" = ${vaultId}::uuid AND "isTrashed" = false
          AND (title ILIKE ${"%" + q + "%"}
            OR word_similarity(${q}, title) > 0.35
            OR "contentTsv" @@ to_tsquery('simple', ${tsq}))
        LIMIT 100
      )
      SELECT h.*, LEFT(pgp_sym_decrypt(n."contentEnc", ${KEY}), 300) AS snippet
      FROM hits h JOIN "Note" n ON n.id = h.id`;

    const results: SearchResultDto[] = rows
      .map((r) => {
        const titleMatch = r.title_sub || r.title_sim > 0.35;
        const score = titleMatch
          ? 100 + (r.title_sub ? 1 : 0) + r.title_sim
          : 1;
        return {
          id: r.id,
          title: r.title,
          snippet: r.snippet.slice(0, 200),
          score,
          titleMatch,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);

    return c.json({ results, tooShort: q.length < 3 });
  });
