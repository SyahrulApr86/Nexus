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

/** Symbols in the query that tsvector cannot index (emoji, arrows, …). */
function querySymbols(q: string): string {
  const matches = q.match(/[^\p{L}\p{N}\s\p{P}]/gu);
  return matches ? [...new Set(matches)].join("") : "";
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
    // to_tsquery('') is a syntax error, so an all-symbol query passes NULL.
    const tsq = prefixQuery(q) || null;
    // An all-symbol query ("🎉") produces no tsquery terms; matching on the
    // symbol column is what makes those searchable at all.
    const symbols = querySymbols(q);
    const symbolPattern = symbols ? `%${symbols}%` : null;

    const rows = await prisma.$queryRaw<Row[]>`
      WITH hits AS (
        SELECT id, title,
               word_similarity(${q}, title)::float AS title_sim,
               (title ILIKE ${"%" + q + "%"})      AS title_sub,
               ((${tsq}::text IS NOT NULL
                  AND "contentTsv" @@ to_tsquery('simple', ${tsq}))
                 OR (${symbolPattern}::text IS NOT NULL
                     AND "contentSymbols" ILIKE ${symbolPattern})) AS content_hit
        FROM "Note"
        WHERE "vaultId" = ${vaultId}::uuid AND "isTrashed" = false
          AND (title ILIKE ${"%" + q + "%"}
            OR word_similarity(${q}, title) > 0.35
            OR (${tsq}::text IS NOT NULL
                AND "contentTsv" @@ to_tsquery('simple', ${tsq}))
            OR (${symbolPattern}::text IS NOT NULL
                AND "contentSymbols" ILIKE ${symbolPattern}))
        LIMIT 100
      )
      SELECT h.*, LEFT(pgp_sym_decrypt(n."contentEnc", ${KEY}), 300) AS snippet
      FROM hits h JOIN "Note" n ON n.id = h.id`;

    const results: SearchResultDto[] = rows
      .map((r) => {
        // Tiers, strongest first: the query appearing in the title beats a
        // content hit, which beats a merely similar-looking title — otherwise
        // "Party" would outrank a note that actually contains "(parens)".
        const titleMatch = r.title_sub || r.title_sim > 0.6;
        let score: number;
        if (r.title_sub) score = 100 + r.title_sim;
        else if (r.title_sim > 0.6) score = 70 + r.title_sim;
        else if (r.content_hit) score = 50;
        else score = 10 + r.title_sim;
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
