import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { requireAuth } from "../middleware/auth.js";

const seedSchema = z.object({
  notes: z.number().int().min(1).max(20000),
  withLinks: z.boolean().default(false),
});

/**
 * Dev/benchmark-only bulk seeding (ENABLE_DEV_SEED). Never mounted in
 * production: index.ts mounts this router solely when the flag is set.
 */
export const devRoutes = new Hono()
  .use("*", async (c, next) => {
    if (!env.ENABLE_DEV_SEED) return c.json({ error: "Not found" }, 404);
    await next();
  })
  .use("*", requireAuth)
  .post("/seed", zValidator("json", seedSchema), async (c) => {
    const vaultId = c.get("vaultId");
    const { notes, withLinks } = c.req.valid("json");
    const KEY = env.CONTENT_ENCRYPTION_KEY;

    await prisma.$executeRaw`
      INSERT INTO "Note" (id, "vaultId", title, "contentEnc", "contentTsv", position, "updatedAt")
      SELECT gen_random_uuid(), ${vaultId}::uuid,
             'Seed Note ' || i,
             pgp_sym_encrypt('Seeded content number ' || i || ' for benchmarks', ${KEY}),
             to_tsvector('simple', 'Seeded content number ' || i || ' for benchmarks'),
             i, now()
      FROM generate_series(1, ${notes}) AS i`;

    if (withLinks) {
      // Chain + some fan-out so the graph has structure
      await prisma.$executeRaw`
        WITH seeded AS (
          SELECT id, position,
                 lead(id) OVER (ORDER BY position) AS next_id
          FROM "Note"
          WHERE "vaultId" = ${vaultId}::uuid AND title LIKE 'Seed Note %'
        )
        INSERT INTO "WikilinkRef" (id, "sourceNoteId", "targetTitle", "targetNoteId")
        SELECT gen_random_uuid(), id, 'Seed Note ' || (position + 1), next_id
        FROM seeded WHERE next_id IS NOT NULL`;
    }
    return c.json({ ok: true, seeded: notes });
  });
