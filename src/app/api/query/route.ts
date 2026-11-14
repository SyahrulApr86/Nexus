import { z } from "zod";
import { runQuery } from "@/lib/query/run";
import { QUERY_LIMITS } from "@/lib/query/types";
import { KiB, handle, rateLimit, readJson, requireVault } from "@/lib/session";

/**
 * POST /api/query { source, since? } → QueryResponse (src/lib/query/types.ts).
 * Runs one ```query block in the active vault. A syntax error is a 200 with { ok: false, error }
 * (line and column), since the block shows it in place; a query that runs too long is a 503.
 * POST, not GET, so the same-origin and JSON-only guards of every other mutating route apply.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const { user, vaultId } = await requireVault();
    const { source, since } = z
      .object({
        source: z.string().max(QUERY_LIMITS.source),
        since: z.string().max(200).optional(),
      })
      .strict()
      .parse(await readJson(req, 16 * KiB));
    rateLimit(`query:${user.id}`, 240, 60_000);
    return runQuery(vaultId, source, since);
  });
}
