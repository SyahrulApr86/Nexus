import { listTags, notesByTag } from "@/lib/notes";
import { handle, requireVault } from "@/lib/session";

/** GET /api/tags → all tags with counts; GET /api/tags?tag=x → notes with that tag (incl. nested). */
export async function GET(req: Request) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const t = new URL(req.url).searchParams.get("tag");
    return t ? notesByTag(vaultId, t.slice(0, 200)) : listTags(vaultId);
  });
}
