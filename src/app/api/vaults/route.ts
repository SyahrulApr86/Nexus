import { z } from "zod";
import { KiB, handle, rateLimit, readJson, requireUser } from "@/lib/session";
import { VaultName, createVault, listVaults } from "@/lib/vaults";

/** GET: the user's vaults, oldest first: { id, name, createdAt, isDefault, notes }[]. */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    return listVaults(user.id);
  });
}

/** POST { name }: create a vault (at most 20 per user, names unique per user, case-insensitive). 201. */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    rateLimit(`vault-create:${user.id}`, 10, 60_000);
    const { name } = z
      .object({ name: VaultName })
      .strict()
      .parse(await readJson(req, 4 * KiB));
    return Response.json(await createVault(user.id, name), { status: 201 });
  });
}
