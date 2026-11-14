import { z } from "zod";
import { revertHunks } from "@/components/workspace/history/diff";
import { currentOf, getRevision } from "@/lib/history";
import { updateContent } from "@/lib/notes";
import { handle, HttpError, KiB, readJson, requireVault } from "@/lib/session";

type Ctx = { params: Promise<{ id: string; revisionId: string }> };

const Params = z.object({ id: z.uuid(), revisionId: z.uuid() });

/**
 * Optional JSON body. `baseUpdatedAt`: the note's version the client looked at; a newer one
 * answers 409 with the server's note. `hunks`: restore only these changes, numbered as
 * hunksOf(revision, current) numbers them (src/components/workspace/history/diff.ts); they need
 * `baseUpdatedAt`, since the numbering is only meaningful against one version of the note.
 */
const Body = z
  .object({
    hunks: z.array(z.int().min(0)).min(1).max(1000).optional(),
    baseUpdatedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict()
  .refine((b) => !b.hunks || b.baseUpdatedAt, { message: "hunks need baseUpdatedAt", path: ["baseUpdatedAt"] });

/**
 * POST: put this revision back as the note's content, whole or only some of its changes. The
 * content it replaces is kept as a revision (reason "restore"), and links and tags are reindexed.
 * Returns { id, updatedAt }.
 */
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const { id, revisionId } = Params.parse(await params);
    // No body (the original form of this call): restore the whole revision.
    const body = req.headers.has("content-type") ? Body.parse(await readJson(req, 16 * KiB)) : {};
    const revision = await getRevision(vaultId, id, revisionId);
    const base = body.baseUpdatedAt ? new Date(body.baseUpdatedAt) : undefined;
    if (!body.hunks) return updateContent(vaultId, id, revision.content, "restore", base);
    const current = await currentOf(vaultId, id);
    if (base && current.updatedAt.getTime() !== base.getTime())
      throw new HttpError(409, "The note changed since it was loaded", { error: "conflict", note: current });
    let next: string;
    try {
      next = revertHunks(revision.content, current.content, body.hunks);
    } catch (e) {
      if (e instanceof RangeError) throw new HttpError(400, "That change is not in this version");
      throw e;
    }
    // The stamp read above guards the write too: a save landing in between answers 409.
    return updateContent(vaultId, id, next, "restore", current.updatedAt);
  });
}
