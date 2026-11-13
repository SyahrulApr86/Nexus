import { z } from "zod";
import { handle, requireUser } from "@/lib/session";
import { revokeShare } from "@/lib/shares";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE: revoke a public link of any of the user's vaults. Idempotent; 404 for another user's link. */
export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const id = z.uuid().parse((await params).id);
    return revokeShare(user.id, id);
  });
}
