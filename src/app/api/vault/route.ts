import { eq } from "drizzle-orm";
import { db } from "@/db";
import { vault } from "@/db/schema";
import { handle, HttpError, requireVault } from "@/lib/session";

/** The signed-in user's default vault: its id and stored name. */
export async function GET() {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const [v] = await db.select({ id: vault.id, name: vault.name }).from(vault).where(eq(vault.id, vaultId)).limit(1);
    if (!v) throw new HttpError(404, "This vault no longer exists. Reload the page.");
    return v;
  });
}
