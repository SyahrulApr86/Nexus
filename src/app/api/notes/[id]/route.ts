import { z } from "zod";
import { deleteNote, getNote, renameNote, updateContent } from "@/lib/notes";
import { handle, requireVault } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

const Id = z.uuid();

export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const id = Id.parse((await params).id);
    return getNote(vaultId, id);
  });
}

const PatchBody = z
  .object({
    content: z.string().max(5_000_000).optional(),
    path: z.string().max(500).optional(),
  })
  .refine((b) => b.content !== undefined || b.path !== undefined, "Nothing to update");

export async function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const id = Id.parse((await params).id);
    const body = PatchBody.parse(await req.json());
    const result: Record<string, unknown> = { id };
    if (body.content !== undefined) Object.assign(result, await updateContent(vaultId, id, body.content));
    if (body.path !== undefined) Object.assign(result, await renameNote(vaultId, id, body.path));
    return result;
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const id = Id.parse((await params).id);
    await deleteNote(vaultId, id);
    return { ok: true };
  });
}
