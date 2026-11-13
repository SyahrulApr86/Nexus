import { z } from "zod";
import { createNote, listTree } from "@/lib/notes";
import { handle, requireVault } from "@/lib/session";

export async function GET() {
  return handle(async () => {
    const { vaultId } = await requireVault();
    return listTree(vaultId);
  });
}

const CreateBody = z.object({
  path: z.string().max(500),
  content: z.string().max(5_000_000).optional(),
});

export async function POST(req: Request) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const body = CreateBody.parse(await req.json());
    return createNote(vaultId, body.path, body.content ?? "");
  });
}
