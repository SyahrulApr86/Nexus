import { z } from "zod";
import { getRevision } from "@/lib/history";
import { handle, requireVault } from "@/lib/session";

type Ctx = { params: Promise<{ id: string; revisionId: string }> };

const Params = z.object({ id: z.uuid(), revisionId: z.uuid() });

/** GET: one revision with its full content: { id, createdAt, reason, content }. */
export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const { id, revisionId } = Params.parse(await params);
    return getRevision(vaultId, id, revisionId);
  });
}
