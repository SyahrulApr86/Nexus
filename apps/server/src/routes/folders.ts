import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  createFolderSchema,
  moveFolderSchema,
  renameFolderSchema,
  type FolderDto,
} from "@nexus/shared";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { broadcastToVault } from "../lib/realtime.js";

/** Every query here is vault-scoped (FR-025). */
async function findOwnedFolder(vaultId: string, id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  return prisma.folder.findFirst({
    where: { id, vaultId, isTrashed: false },
  });
}

/** Collect ids of a folder subtree (children of any depth, not trashed). */
export async function collectSubtreeIds(
  vaultId: string,
  rootId: string,
): Promise<string[]> {
  const all = await prisma.folder.findMany({
    where: { vaultId, isTrashed: false },
    select: { id: true, parentId: true },
  });
  const childrenOf = new Map<string | null, string[]>();
  for (const f of all) {
    const list = childrenOf.get(f.parentId) ?? [];
    list.push(f.id);
    childrenOf.set(f.parentId, list);
  }
  const out: string[] = [];
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    out.push(id);
    for (const c of childrenOf.get(id) ?? []) stack.push(c);
  }
  return out;
}

export const folderRoutes = new Hono()
  .use("*", requireAuth)

  .get("/tree", async (c) => {
    const vaultId = c.get("vaultId");
    const [folders, counts] = await Promise.all([
      prisma.folder.findMany({
        where: { vaultId, isTrashed: false },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      }),
      prisma.note.groupBy({
        by: ["folderId"],
        where: { vaultId, isTrashed: false },
        _count: { id: true },
      }),
    ]);
    const countByFolder = new Map(
      counts.map((c) => [c.folderId, c._count.id]),
    );
    const dtoById = new Map<string, FolderDto>();
    for (const f of folders) {
      dtoById.set(f.id, {
        id: f.id,
        name: f.name,
        parentId: f.parentId,
        position: f.position,
        noteCount: countByFolder.get(f.id) ?? 0,
        children: [],
      });
    }
    const roots: FolderDto[] = [];
    for (const dto of dtoById.values()) {
      const parent = dto.parentId ? dtoById.get(dto.parentId) : undefined;
      if (parent) parent.children.push(dto);
      else roots.push(dto);
    }
    return c.json({ tree: roots });
  })

  .post("/", zValidator("json", createFolderSchema), async (c) => {
    const vaultId = c.get("vaultId");
    const { name, parentId } = c.req.valid("json");
    if (parentId) {
      const parent = await findOwnedFolder(vaultId, parentId);
      if (!parent) return c.json({ error: "Parent folder not found" }, 404);
    }
    const max = await prisma.folder.aggregate({
      where: { vaultId, parentId: parentId ?? null },
      _max: { position: true },
    });
    const folder = await prisma.folder.create({
      data: {
        vaultId,
        name,
        parentId,
        position: (max._max.position ?? -1) + 1,
      },
    });
    broadcastToVault(vaultId, { type: "folder:changed" });
    return c.json({ folder }, 201);
  })

  .patch("/:id", zValidator("json", renameFolderSchema), async (c) => {
    const vaultId = c.get("vaultId");
    const folder = await findOwnedFolder(vaultId, c.req.param("id"));
    if (!folder) return c.json({ error: "Not found" }, 404);
    const { name } = c.req.valid("json");
    const updated = await prisma.folder.update({
      where: { id: folder.id },
      data: { name },
    });
    broadcastToVault(vaultId, { type: "folder:changed" });
    return c.json({ folder: updated });
  })

  .post("/:id/move", zValidator("json", moveFolderSchema), async (c) => {
    const vaultId = c.get("vaultId");
    const folder = await findOwnedFolder(vaultId, c.req.param("id"));
    if (!folder) return c.json({ error: "Not found" }, 404);
    const { parentId } = c.req.valid("json");
    if (parentId) {
      const parent = await findOwnedFolder(vaultId, parentId);
      if (!parent) return c.json({ error: "Parent folder not found" }, 404);
      // Cycle guard: target parent must not be inside this folder's subtree
      const subtree = await collectSubtreeIds(vaultId, folder.id);
      if (subtree.includes(parentId)) {
        return c.json(
          { error: "Cannot move a folder into its own subfolder" },
          400,
        );
      }
    }
    const max = await prisma.folder.aggregate({
      where: { vaultId, parentId: parentId ?? null },
      _max: { position: true },
    });
    const updated = await prisma.folder.update({
      where: { id: folder.id },
      data: { parentId, position: (max._max.position ?? -1) + 1 },
    });
    broadcastToVault(vaultId, { type: "folder:changed" });
    return c.json({ folder: updated });
  })

  .delete("/:id", async (c) => {
    const vaultId = c.get("vaultId");
    const folder = await findOwnedFolder(vaultId, c.req.param("id"));
    if (!folder) return c.json({ error: "Not found" }, 404);
    // Cascade soft-delete: whole subtree + contained notes (US12-S2)
    const subtreeIds = await collectSubtreeIds(vaultId, folder.id);
    const now = new Date();
    const containedNotes = await prisma.note.findMany({
      where: { folderId: { in: subtreeIds }, vaultId, isTrashed: false },
      select: { id: true },
    });
    const noteIds = containedNotes.map((n) => n.id);
    await prisma.$transaction([
      prisma.folder.updateMany({
        where: { id: { in: subtreeIds }, vaultId },
        data: { isTrashed: true, trashedAt: now, trashRootId: folder.id },
      }),
      prisma.note.updateMany({
        where: { id: { in: noteIds } },
        data: { isTrashed: true, trashedAt: now, trashRootId: folder.id },
      }),
      // Wikilinks to trashed notes become broken (PRD edge case)
      prisma.wikilinkRef.updateMany({
        where: { targetNoteId: { in: noteIds } },
        data: { targetNoteId: null },
      }),
    ]);
    broadcastToVault(vaultId, { type: "folder:changed" });
    return c.json({ ok: true });
  });
