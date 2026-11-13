import { z } from "zod";
import { NoteContent, NotePath, createNote, listTree } from "@/lib/notes";
import { MiB, handle, readJson, requireVault } from "@/lib/session";

export async function GET() {
  return handle(async () => {
    const { vaultId } = await requireVault();
    return listTree(vaultId);
  });
}

const CreateBody = z.object({
  path: NotePath,
  content: NoteContent.optional(),
});
/** 5 MiB of note as JSON: escapes can double it, plus room for the path. */
const BODY_LIMIT = 12 * MiB;

export async function POST(req: Request) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const body = CreateBody.parse(await readJson(req, BODY_LIMIT));
    return createNote(vaultId, body.path, body.content ?? "");
  });
}
