import { z } from "zod";
import { listRevisions } from "@/lib/history";
import { handle, requireVault } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

/** GET: revisions of this note, newest first: { id, createdAt, reason, size, preview }[]. */
export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const id = z.uuid().parse((await params).id);
    return listRevisions(vaultId, id);
  });
}
