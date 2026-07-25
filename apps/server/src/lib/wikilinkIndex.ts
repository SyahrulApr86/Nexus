import { extractWikilinks } from "@nexus/shared";
import { prisma } from "../db.js";

/**
 * Server-side wikilink index (powers graph view + broken-link resolution).
 * Uses the same shared parser as the editor/preview (PRD §13 consistency).
 */
export async function reindexNoteLinks(
  noteId: string,
  vaultId: string,
  content: string,
) {
  const links = extractWikilinks(content);
  const uniqueTitles = [...new Set(links.map((l) => l.title))];

  const targets = uniqueTitles.length
    ? await prisma.note.findMany({
        where: { vaultId, title: { in: uniqueTitles }, isTrashed: false },
        select: { id: true, title: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const byTitle = new Map<string, string>();
  for (const t of targets) {
    if (!byTitle.has(t.title)) byTitle.set(t.title, t.id);
  }

  await prisma.$transaction([
    prisma.wikilinkRef.deleteMany({ where: { sourceNoteId: noteId } }),
    ...(uniqueTitles.length
      ? [
          prisma.wikilinkRef.createMany({
            data: uniqueTitles.map((title) => ({
              sourceNoteId: noteId,
              targetTitle: title,
              targetNoteId: byTitle.get(title) ?? null,
            })),
          }),
        ]
      : []),
  ]);
}
