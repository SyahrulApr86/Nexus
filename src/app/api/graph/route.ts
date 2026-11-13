import { graph } from "@/lib/notes";
import { handle, rateLimit, requireVault } from "@/lib/session";

export async function GET() {
  return handle(async () => {
    const { user, vaultId } = await requireVault();
    rateLimit(`graph:${user.id}`, 120, 60_000);
    return graph(vaultId);
  });
}
