import { z } from "zod";
import { linkMention, unlinkedMentions } from "@/lib/notes";
import { handle, requireVault } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

/** GET: notes that mention this note's name without linking to it. */
export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const id = z.uuid().parse((await params).id);
    return unlinkedMentions(vaultId, id);
  });
}

/** POST { sourceId }: convert the first unlinked mention in that note into a [[link]]. */
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const id = z.uuid().parse((await params).id);
    const { sourceId } = z.object({ sourceId: z.uuid() }).parse(await req.json());
    return linkMention(vaultId, id, sourceId);
  });
}
