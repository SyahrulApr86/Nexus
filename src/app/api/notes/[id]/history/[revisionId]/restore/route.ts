import { z } from "zod";
import { getRevision } from "@/lib/history";
import { updateContent } from "@/lib/notes";
import { handle, requireVault } from "@/lib/session";

type Ctx = { params: Promise<{ id: string; revisionId: string }> };

const Params = z.object({ id: z.uuid(), revisionId: z.uuid() });

/**
 * POST: put this revision back as the note's content. The content it replaces
 * is kept as a revision (reason "restore"), and links and tags are reindexed.
 * Returns { id, updatedAt }.
 */
export async function POST(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const { id, revisionId } = Params.parse(await params);
    const revision = await getRevision(vaultId, id, revisionId);
    return updateContent(vaultId, id, revision.content, "restore");
  });
}
