import { z } from "zod";
import { NotePath, createNote, resolveLink } from "@/lib/notes";
import { KiB, handle, readJson, requireVault } from "@/lib/session";

/**
 * POST /api/resolve { target, create? }
 * Resolves a [[wikilink]] target to a note. With create=true, an unresolved
 * link creates the note (Obsidian behaviour when clicking a dangling link).
 */
export async function POST(req: Request) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const { target, create, content } = z
      .object({
        target: NotePath.pipe(z.string().min(1)),
        create: z.boolean().optional(),
        content: z
          .string()
          .max(100_000)
          .refine((s) => !s.includes("\u0000"), "Content must not contain NUL")
          .optional(),
      })
      .parse(await readJson(req, 512 * KiB));
    const hit = await resolveLink(vaultId, target);
    if (hit) return { ...hit, created: false };
    if (!create) return { id: null };
    return { ...(await createNote(vaultId, target, content ?? "")), created: true };
  });
}
