import { revokeToken } from "@/lib/api-tokens";
import { handle, requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/tokens/:id → revokes one of the user's tokens at once. Idempotent; 404 otherwise. */
export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    return revokeToken(user.id, (await params).id);
  });
}
