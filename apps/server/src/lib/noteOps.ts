import { prisma } from "../db.js";
import { encryptContent, updateSearchIndex } from "./noteContent.js";
import { reindexNoteLinks, relinkTargetsForTitles } from "./wikilinkIndex.js";
import { broadcastToVault } from "./realtime.js";

const MAX_VERSIONS = 100;

export async function snapshotVersion(
  noteId: string,
  contentEnc: Uint8Array<ArrayBuffer>,
) {
  await prisma.noteVersion.create({ data: { noteId, contentEnc } });
  const count = await prisma.noteVersion.count({ where: { noteId } });
  if (count > MAX_VERSIONS) {
    const oldest = await prisma.noteVersion.findMany({
      where: { noteId },
      orderBy: { createdAt: "asc" },
      take: count - MAX_VERSIONS,
      select: { id: true },
    });
    await prisma.noteVersion.deleteMany({
      where: { id: { in: oldest.map((v) => v.id) } },
    });
  }
}

/**
 * Full note creation pipeline shared by the notes route and importers:
 * encrypt (FR-026), position, version snapshot, search/tag index, wikilink
 * index + broken-link re-resolution, realtime broadcast.
 */
export async function createNoteFull(
  vaultId: string,
  input: { title: string; content: string; folderId: string | null },
) {
  const contentEnc = await encryptContent(input.content);
  const max = await prisma.note.aggregate({
    where: { vaultId, folderId: input.folderId },
    _max: { position: true },
  });
  const note = await prisma.note.create({
    data: {
      vaultId,
      folderId: input.folderId,
      title: input.title,
      contentEnc,
      position: (max._max.position ?? -1) + 1,
    },
  });
  await snapshotVersion(note.id, contentEnc);
  await updateSearchIndex(note.id, input.content);
  await reindexNoteLinks(note.id, vaultId, input.content);
  if (input.title) {
    await relinkTargetsForTitles(vaultId, [input.title], note.id);
  }
  broadcastToVault(vaultId, { type: "note:created", noteId: note.id });
  return note;
}
