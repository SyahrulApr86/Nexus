import { search } from "@/lib/notes";
import { handle, requireVault } from "@/lib/session";

export async function GET(req: Request) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 200);
    return search(vaultId, q);
  });
}
