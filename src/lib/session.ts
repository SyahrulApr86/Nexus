import "server-only";
import { headers } from "next/headers";
import { asc, eq } from "drizzle-orm";
import { getAuth } from "@/lib/auth";
import { db } from "@/db";
import { vault } from "@/db/schema";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function getSessionUser() {
  // Read the request first: during prerender this is where rendering stops,
  // so auth/DB are never initialised at build time.
  const h = await headers();
  const s = await getAuth().api.getSession({ headers: h });
  return s?.user ?? null;
}

/** Returns the user's first vault, creating "My Vault" on first use. */
export async function getDefaultVaultId(userId: string): Promise<string> {
  const [existing] = await db
    .select({ id: vault.id })
    .from(vault)
    .where(eq(vault.ownerId, userId))
    .orderBy(asc(vault.createdAt))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(vault)
    .values({ ownerId: userId, name: "My Vault" })
    .returning({ id: vault.id });
  return created.id;
}

/** For API routes: authenticated user + vault, or throws 401. */
export async function requireVault() {
  const user = await getSessionUser();
  if (!user) throw new HttpError(401, "Unauthorized");
  const vaultId = await getDefaultVaultId(user.id);
  return { user, vaultId };
}

/** Wrap a route handler body: maps HttpError/validation errors to JSON responses. */
export async function handle<T>(fn: () => Promise<T>): Promise<Response> {
  try {
    const data = await fn();
    if (data instanceof Response) return data;
    return Response.json(data ?? { ok: true });
  } catch (err) {
    if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
    if (err && typeof err === "object" && "issues" in err)
      return Response.json({ error: "Invalid input", issues: (err as { issues: unknown }).issues }, { status: 400 });
    console.error(err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
