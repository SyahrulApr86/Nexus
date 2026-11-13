import { z } from "zod";
import { KiB, handle, readJson, requireUser } from "@/lib/session";
import { VaultName, deleteVault, renameVault } from "@/lib/vaults";

type Ctx = { params: Promise<{ id: string }> };

const Id = z.uuid();

/** PATCH { name }: rename one of the user's vaults. 404 for another user's vault. */
export async function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const id = Id.parse((await params).id);
    const { name } = z
      .object({ name: VaultName })
      .strict()
      .parse(await readJson(req, 4 * KiB));
    return renameVault(user.id, id, name);
  });
}

/**
 * DELETE { confirm: "<vault name>" }: delete the vault and everything in it. The name must match
 * exactly (400 otherwise) and the user's last vault is never deleted (409).
 */
export async function DELETE(req: Request, { params }: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const id = Id.parse((await params).id);
    const { confirm } = z
      .object({ confirm: z.string().max(1 * KiB) })
      .strict()
      .parse(await readJson(req, 4 * KiB));
    return deleteVault(user.id, id, confirm);
  });
}
