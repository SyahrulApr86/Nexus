import { MAX_QUERY_LENGTH, search } from "@/lib/search";
import { handle, requireVault } from "@/lib/session";

/** GET /api/search?q=… → [{ id, path, name, snippet }]. Operators: see src/lib/search.ts. */
export async function GET(req: Request) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, MAX_QUERY_LENGTH);
    return search(vaultId, q);
  });
}
