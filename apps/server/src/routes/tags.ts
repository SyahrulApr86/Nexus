import { Hono } from "hono";
import type { TagDto } from "@nexus/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const tagRoutes = new Hono()
  .use("*", requireAuth)

  // FR-018: all tags with counts + note ids, from the derived tags column
  .get("/", async (c) => {
    const vaultId = c.get("vaultId");
    const notes = await prisma.note.findMany({
      where: { vaultId, isTrashed: false, tags: { isEmpty: false } },
      select: { id: true, tags: true },
    });
    const byName = new Map<string, string[]>();
    for (const n of notes) {
      for (const tag of n.tags) {
        const list = byName.get(tag) ?? [];
        list.push(n.id);
        byName.set(tag, list);
      }
    }
    const tags: TagDto[] = [...byName.entries()]
      .map(([name, noteIds]) => ({ name, noteIds, noteCount: noteIds.length }))
      .sort((a, b) => b.noteCount - a.noteCount || a.name.localeCompare(b.name));
    return c.json({ tags });
  })

  // FR-019: notes carrying a tag
  .get("/:name/notes", async (c) => {
    const vaultId = c.get("vaultId");
    const name = c.req.param("name");
    const notes = await prisma.note.findMany({
      where: { vaultId, isTrashed: false, tags: { has: name } },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        folderId: true,
        position: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return c.json({
      notes: notes.map((n) => ({
        ...n,
        createdAt: n.createdAt.toISOString(),
        updatedAt: n.updatedAt.toISOString(),
      })),
    });
  });
