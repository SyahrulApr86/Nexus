import { z } from "zod";
import { createNote, resolveLink } from "@/lib/notes";
import { handle, requireVault } from "@/lib/session";

/**
 * POST /api/resolve { target, create? }
 * Resolves a [[wikilink]] target to a note. With create=true, an unresolved
 * link creates the note (Obsidian behaviour when clicking a dangling link).
 */
export async function POST(req: Request) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const { target, create, content } = z
      .object({ target: z.string().min(1).max(500), create: z.boolean().optional(), content: z.string().max(100_000).optional() })
      .parse(await req.json());
    const hit = await resolveLink(vaultId, target);
    if (hit) return { ...hit, created: false };
    if (!create) return { id: null };
    return { ...(await createNote(vaultId, target, content ?? "")), created: true };
  });
}
