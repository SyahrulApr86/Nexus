import { graph } from "@/lib/notes";
import { handle, requireVault } from "@/lib/session";

export async function GET() {
  return handle(async () => {
    const { vaultId } = await requireVault();
    return graph(vaultId);
  });
}
