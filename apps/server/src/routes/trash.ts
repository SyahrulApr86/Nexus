import { Hono } from "hono";
import { z } from "zod";
import type { TrashedItemDto } from "@nexus/shared";
import { prisma } from "../db.js";
import { readVersionContent } from "../lib/noteContent.js";
import { requireAuth } from "../middleware/auth.js";
import { relinkTargetsForTitles } from "./notes.js";
import { broadcastToVault } from "../lib/realtime.js";

const uuid = z.string().uuid();

async function ownedTrashedNote(vaultId: string, id: string) {
  if (!uuid.safeParse(id).success) return null;
  return prisma.note.findFirst({ where: { id, vaultId, isTrashed: true } });
}

async function ownedTrashedFolder(vaultId: string, id: string) {
  if (!uuid.safeParse(id).success) return null;
  return prisma.folder.findFirst({ where: { id, vaultId, isTrashed: true } });
}

export const trashRoutes = new Hono()
  .use("*", requireAuth)

  // FR-028: root-level trashed items (cascade children restore with their root)
  .get("/", async (c) => {
    const vaultId = c.get("vaultId");
    const [notes, folders] = await Promise.all([
      prisma.note.findMany({
        where: { vaultId, isTrashed: true, trashRootId: { equals: prisma.note.fields.id } },
      }),
      prisma.folder.findMany({
        where: {
          vaultId,
          isTrashed: true,
          trashRootId: { equals: prisma.folder.fields.id },
        },
      }),
    ]);
    const items: TrashedItemDto[] = [
      ...folders.map((f) => ({
        type: "folder" as const,
        id: f.id,
        title: f.name,
        trashedAt: f.trashedAt!.toISOString(),
        originalFolderId: f.parentId,
      })),
      ...notes.map((n) => ({
        type: "note" as const,
        id: n.id,
        title: n.title || "Untitled",
        trashedAt: n.trashedAt!.toISOString(),
        originalFolderId: n.folderId,
      })),
    ].sort((a, b) => b.trashedAt.localeCompare(a.trashedAt));
    return c.json({ items });
  })

  // FR-030: restore note (root item) to original location, versions intact
  .post("/note/:id/restore", async (c) => {
    const vaultId = c.get("vaultId");
    const note = await ownedTrashedNote(vaultId, c.req.param("id"));
    if (!note) return c.json({ error: "Not found" }, 404);

    // Original folder may be trashed or purged since (US12-S7)
    let restoredToRoot = false;
    let folderId = note.originalFolderId ?? note.folderId;
    if (folderId) {
      const folder = await prisma.folder.findFirst({
        where: { id: folderId, vaultId, isTrashed: false },
      });
      if (!folder) {
        folderId = null;
        restoredToRoot = true;
      }
    }
    await prisma.note.update({
      where: { id: note.id },
      data: {
        isTrashed: false,
        trashedAt: null,
        trashRootId: null,
        originalFolderId: null,
        folderId,
      },
    });
    // Links pointing at this title become valid again (FR-012)
    if (note.title) await relinkTargetsForTitles(vaultId, [note.title], note.id);
    broadcastToVault(vaultId, { type: "note:created", noteId: note.id });
    return c.json({ ok: true, restoredToRoot });
  })

  // FR-030: restore a folder root together with its cascaded subtree
  .post("/folder/:id/restore", async (c) => {
    const vaultId = c.get("vaultId");
    const folder = await ownedTrashedFolder(vaultId, c.req.param("id"));
    if (!folder) return c.json({ error: "Not found" }, 404);

    let restoredToRoot = false;
    let parentId = folder.parentId;
    if (parentId) {
      const parent = await prisma.folder.findFirst({
        where: { id: parentId, vaultId, isTrashed: false },
      });
      if (!parent) {
        parentId = null;
        restoredToRoot = true;
      }
    }
    const restoredNotes = await prisma.note.findMany({
      where: { vaultId, trashRootId: folder.id },
      select: { title: true, id: true },
    });
    await prisma.$transaction([
      prisma.folder.updateMany({
        where: { vaultId, trashRootId: folder.id },
        data: { isTrashed: false, trashedAt: null, trashRootId: null },
      }),
      prisma.note.updateMany({
        where: { vaultId, trashRootId: folder.id },
        data: { isTrashed: false, trashedAt: null, trashRootId: null },
      }),
      prisma.folder.update({
        where: { id: folder.id },
        data: { parentId },
      }),
    ]);
    for (const n of restoredNotes) {
      if (n.title) await relinkTargetsForTitles(vaultId, [n.title], n.id);
    }
    broadcastToVault(vaultId, { type: "folder:changed" });
    return c.json({ ok: true, restoredToRoot });
  })

  // FR-031: permanent delete (irreversible, versions included)
  .delete("/note/:id", async (c) => {
    const vaultId = c.get("vaultId");
    const note = await ownedTrashedNote(vaultId, c.req.param("id"));
    if (!note) return c.json({ error: "Not found" }, 404);
    await prisma.note.delete({ where: { id: note.id } });
    return c.json({ ok: true });
  })

  .delete("/folder/:id", async (c) => {
    const vaultId = c.get("vaultId");
    const folder = await ownedTrashedFolder(vaultId, c.req.param("id"));
    if (!folder) return c.json({ error: "Not found" }, 404);
    await prisma.$transaction([
      prisma.note.deleteMany({ where: { vaultId, trashRootId: folder.id } }),
      prisma.folder.deleteMany({ where: { vaultId, trashRootId: folder.id } }),
    ]);
    return c.json({ ok: true });
  })

  // FR-032: version list + read-only preview while trashed
  .get("/note/:id/versions", async (c) => {
    const vaultId = c.get("vaultId");
    const note = await ownedTrashedNote(vaultId, c.req.param("id"));
    if (!note) return c.json({ error: "Not found" }, 404);
    const versions = await prisma.noteVersion.findMany({
      where: { noteId: note.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, changeSummary: true },
    });
    return c.json({
      versions: versions.map((v) => ({
        ...v,
        createdAt: v.createdAt.toISOString(),
      })),
    });
  })

  .get("/note/:id/versions/:versionId", async (c) => {
    const vaultId = c.get("vaultId");
    const note = await ownedTrashedNote(vaultId, c.req.param("id"));
    if (!note) return c.json({ error: "Not found" }, 404);
    const versionId = c.req.param("versionId");
    if (!uuid.safeParse(versionId).success) {
      return c.json({ error: "Not found" }, 404);
    }
    const version = await prisma.noteVersion.findFirst({
      where: { id: versionId, noteId: note.id },
    });
    if (!version) return c.json({ error: "Not found" }, 404);
    const content = (await readVersionContent(version.id)) ?? "";
    return c.json({ content, createdAt: version.createdAt.toISOString() });
  });
