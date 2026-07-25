import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  createNoteSchema,
  moveNoteSchema,
  reorderSchema,
  updateNoteSchema,
  type NoteDto,
  type NoteSummaryDto,
} from "@nexus/shared";
import { z } from "zod";
import { prisma } from "../db.js";
import {
  encryptContent,
  readNoteContent,
  updateSearchIndex,
} from "../lib/noteContent.js";
import { requireAuth } from "../middleware/auth.js";
import {
  reindexNoteLinks,
  relinkTargetsForTitles,
} from "../lib/wikilinkIndex.js";
import { broadcastToVault } from "../lib/realtime.js";
import { createNoteFull, snapshotVersion } from "../lib/noteOps.js";

function toSummary(n: {
  id: string;
  title: string;
  folderId: string | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}): NoteSummaryDto {
  return {
    id: n.id,
    title: n.title,
    folderId: n.folderId,
    position: n.position,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  };
}

/** Every query in this file is scoped by vaultId (FR-025). */
async function findOwnedNote(vaultId: string, id: string) {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return null;
  return prisma.note.findFirst({ where: { id, vaultId } });
}

export const noteRoutes = new Hono()
  .use("*", requireAuth)

  .get("/", async (c) => {
    const vaultId = c.get("vaultId");
    const folderId = c.req.query("folderId") ?? null;
    const notes = await prisma.note.findMany({
      where: { vaultId, isTrashed: false, ...(folderId ? { folderId } : {}) },
      orderBy: [{ position: "asc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        title: true,
        folderId: true,
        position: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return c.json({ notes: notes.map(toSummary) });
  })

  .post("/", zValidator("json", createNoteSchema), async (c) => {
    const vaultId = c.get("vaultId");
    const { title, content, folderId } = c.req.valid("json");
    if (folderId) {
      const folder = await prisma.folder.findFirst({
        where: { id: folderId, vaultId },
      });
      if (!folder) return c.json({ error: "Folder not found" }, 404);
    }
    const note = await createNoteFull(vaultId, { title, content, folderId });
    const dto: NoteDto = { ...toSummary(note), content };
    return c.json({ note: dto }, 201);
  })

  // FR-010: autocomplete suggestions for [[ trigger (must precede /:id)
  .get("/suggestions", async (c) => {
    const vaultId = c.get("vaultId");
    const q = (c.req.query("q") ?? "").trim();
    const notes = await prisma.note.findMany({
      where: {
        vaultId,
        isTrashed: false,
        ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: { id: true, title: true },
    });
    return c.json({ suggestions: notes.filter((n) => n.title.length > 0) });
  })

  .get("/:id", async (c) => {
    const note = await findOwnedNote(c.get("vaultId"), c.req.param("id"));
    if (!note || note.isTrashed) return c.json({ error: "Not found" }, 404);
    const content = (await readNoteContent(note.id)) ?? "";
    const [versions, links] = await Promise.all([
      prisma.noteVersion.findMany({
        where: { noteId: note.id },
        orderBy: { createdAt: "desc" },
        select: { id: true, noteId: true, createdAt: true, changeSummary: true },
      }),
      prisma.wikilinkRef.findMany({
        where: { sourceNoteId: note.id },
        select: { targetTitle: true, targetNoteId: true },
      }),
    ]);
    const dto: NoteDto = { ...toSummary(note), content };
    return c.json({
      note: dto,
      versions: versions.map((v) => ({
        ...v,
        createdAt: v.createdAt.toISOString(),
      })),
      links,
    });
  })

  .patch("/:id", zValidator("json", updateNoteSchema), async (c) => {
    const vaultId = c.get("vaultId");
    const note = await findOwnedNote(vaultId, c.req.param("id"));
    if (!note || note.isTrashed) return c.json({ error: "Not found" }, 404);
    const { title, content, baseUpdatedAt } = c.req.valid("json");

    // Optimistic concurrency (US2-S5): stale base → conflict, nothing written
    if (
      baseUpdatedAt &&
      new Date(baseUpdatedAt).getTime() !== note.updatedAt.getTime()
    ) {
      const serverContent = (await readNoteContent(note.id)) ?? "";
      return c.json(
        {
          error: "This note was changed in another session.",
          code: "CONFLICT",
          note: { ...toSummary(note), content: serverContent },
        },
        409,
      );
    }

    let contentEnc: Uint8Array<ArrayBuffer> | undefined;
    if (content !== undefined) {
      const current = await readNoteContent(note.id);
      if (current !== content) {
        contentEnc = await encryptContent(content);
      }
    }
    const updated = await prisma.note.update({
      where: { id: note.id },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(contentEnc ? { contentEnc } : {}),
      },
    });
    if (contentEnc) {
      await snapshotVersion(note.id, contentEnc);
      await updateSearchIndex(note.id, content!);
      await reindexNoteLinks(note.id, vaultId, content!);
    }
    if (title !== undefined && title !== note.title) {
      // Retitling can resolve/break wikilinks pointing at either title
      await relinkTargetsForTitles(vaultId, [note.title, title], note.id);
    }
    broadcastToVault(vaultId, {
      type: "note:updated",
      noteId: note.id,
      updatedAt: updated.updatedAt.toISOString(),
    });
    const dto: NoteDto = {
      ...toSummary(updated),
      content: content ?? (await readNoteContent(note.id)) ?? "",
    };
    return c.json({ note: dto });
  })

  .delete("/:id", async (c) => {
    const vaultId = c.get("vaultId");
    const note = await findOwnedNote(vaultId, c.req.param("id"));
    if (!note || note.isTrashed) return c.json({ error: "Not found" }, 404);
    await prisma.$transaction([
      prisma.note.update({
        where: { id: note.id },
        data: {
          isTrashed: true,
          trashedAt: new Date(),
          trashRootId: note.id,
          originalFolderId: note.folderId,
        },
      }),
      // Links pointing here become broken; content stays recoverable in trash
      prisma.wikilinkRef.updateMany({
        where: { targetNoteId: note.id },
        data: { targetNoteId: null },
      }),
    ]);
    broadcastToVault(vaultId, { type: "note:deleted", noteId: note.id });
    return c.json({ ok: true });
  })

  .post("/:id/move", zValidator("json", moveNoteSchema), async (c) => {
    const vaultId = c.get("vaultId");
    const note = await findOwnedNote(vaultId, c.req.param("id"));
    if (!note || note.isTrashed) return c.json({ error: "Not found" }, 404);
    const { folderId } = c.req.valid("json");
    if (folderId) {
      const folder = await prisma.folder.findFirst({
        where: { id: folderId, vaultId, isTrashed: false },
      });
      if (!folder) return c.json({ error: "Folder not found" }, 404);
    }
    const max = await prisma.note.aggregate({
      where: { vaultId, folderId },
      _max: { position: true },
    });
    const updated = await prisma.note.update({
      where: { id: note.id },
      data: { folderId, position: (max._max.position ?? -1) + 1 },
    });
    broadcastToVault(vaultId, { type: "folder:changed" });
    return c.json({ note: toSummary(updated) });
  })

  .post("/:id/reorder", zValidator("json", reorderSchema), async (c) => {
    const vaultId = c.get("vaultId");
    const note = await findOwnedNote(vaultId, c.req.param("id"));
    if (!note || note.isTrashed) return c.json({ error: "Not found" }, 404);
    const { position } = c.req.valid("json");
    // Shift siblings at/after the target position (FR-007a)
    await prisma.$transaction([
      prisma.note.updateMany({
        where: {
          vaultId,
          folderId: note.folderId,
          isTrashed: false,
          position: { gte: position },
          id: { not: note.id },
        },
        data: { position: { increment: 1 } },
      }),
      prisma.note.update({
        where: { id: note.id },
        data: { position },
      }),
    ]);
    broadcastToVault(vaultId, { type: "folder:changed" });
    return c.json({ ok: true });
  });
