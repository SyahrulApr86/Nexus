import { z } from "zod";
import { NoteContent, NotePath, deleteNote, getNote, renameNote, updateContent } from "@/lib/notes";
import { MiB, handle, readJson, requireVault } from "@/lib/session";

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
    content: NoteContent.optional(),
    path: NotePath.optional(),
    /** Optimistic concurrency: the updatedAt the client last saw; a different stored one is a 409. */
    baseUpdatedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((b) => b.content !== undefined || b.path !== undefined, "Nothing to update");

/** 5 MiB of note as JSON: escapes can double it, plus room for the path. */
const BODY_LIMIT = 12 * MiB;

export async function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const id = Id.parse((await params).id);
    const body = PatchBody.parse(await readJson(req, BODY_LIMIT));
    const base = body.baseUpdatedAt === undefined ? undefined : new Date(body.baseUpdatedAt);
    const result: Record<string, unknown> = { id };
    if (body.content !== undefined)
      Object.assign(result, await updateContent(vaultId, id, body.content, "autosave", base));
    // After a content write the stored updatedAt is the one just written, so the rename is not checked again.
    if (body.path !== undefined)
      Object.assign(result, await renameNote(vaultId, id, body.path, body.content === undefined ? base : undefined));
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
