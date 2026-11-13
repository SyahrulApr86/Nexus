import { z } from "zod";
import { createFolder, deleteFolder, renameFolder } from "@/lib/notes";
import { handle, requireVault } from "@/lib/session";

const P = z.string().min(1).max(500);

export async function POST(req: Request) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const { path } = z.object({ path: P }).parse(await req.json());
    return createFolder(vaultId, path);
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const { from, to } = z.object({ from: P, to: P }).parse(await req.json());
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
