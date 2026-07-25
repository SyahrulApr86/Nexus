import { Hono } from "hono";
import type { GraphDataDto, GraphEdgeDto, GraphNodeDto } from "@nexus/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const graphRoutes = new Hono()
  .use("*", requireAuth)

  // FR-015: all nodes/edges for the vault's wikilink network
  .get("/", async (c) => {
    const vaultId = c.get("vaultId");
    const [notes, refs] = await Promise.all([
      prisma.note.findMany({
        where: { vaultId, isTrashed: false },
        select: { id: true, title: true },
      }),
      prisma.wikilinkRef.findMany({
        where: {
          source: { vaultId, isTrashed: false },
          targetNoteId: { not: null },
          target: { isTrashed: false },
        },
        select: { sourceNoteId: true, targetNoteId: true },
      }),
    ]);

    const linkCount = new Map<string, number>();
    const edges: GraphEdgeDto[] = refs.map((r) => {
      linkCount.set(r.sourceNoteId, (linkCount.get(r.sourceNoteId) ?? 0) + 1);
      linkCount.set(r.targetNoteId!, (linkCount.get(r.targetNoteId!) ?? 0) + 1);
      return { sourceId: r.sourceNoteId, targetId: r.targetNoteId! };
    });
    const nodes: GraphNodeDto[] = notes.map((n) => ({
      id: n.id,
      title: n.title || "Untitled",
      linkCount: linkCount.get(n.id) ?? 0,
    }));
    const data: GraphDataDto = {
      nodes,
      edges,
      orphanCount: nodes.filter((n) => n.linkCount === 0).length,
    };
    return c.json(data);
  });
