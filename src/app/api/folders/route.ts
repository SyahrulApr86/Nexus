import { z } from "zod";
import { NotePath, createFolder, deleteFolder, renameFolder } from "@/lib/notes";
import { KiB, handle, readJson, requireVault } from "@/lib/session";

const P = NotePath.pipe(z.string().min(1));
const BODY_LIMIT = 16 * KiB;

export async function POST(req: Request) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const { path } = z.object({ path: P }).parse(await readJson(req, BODY_LIMIT));
    return createFolder(vaultId, path);
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const { from, to } = z.object({ from: P, to: P }).parse(await readJson(req, BODY_LIMIT));
    return renameFolder(vaultId, from, to);
  });
}

export async function DELETE(req: Request) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const path = P.parse(new URL(req.url).searchParams.get("path"));
    await deleteFolder(vaultId, path);
    return { ok: true };
  });
}
