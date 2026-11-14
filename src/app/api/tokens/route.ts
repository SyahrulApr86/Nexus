import { headers } from "next/headers";
import { API_TOKEN_LIMITS, CreateTokenBody, createToken, listTokens } from "@/lib/api-tokens";
import { KiB, VAULT_HEADER, handle, rateLimit, readJson, requireUser, resolveVaultId } from "@/lib/session";

/*
 * Personal API tokens for the MCP endpoint. Signed-in (cookie) routes with the app's usual guards:
 * same-origin check, JSON-only bodies with a size limit. A bearer token can never manage tokens.
 */

/** GET /api/tokens → the user's live tokens, newest first, without secrets. */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    return listTokens(user.id);
  });
}

/**
 * POST /api/tokens { name, scope: "read" | "write", vaultId?, expiresInDays? } → 201 with the token,
 * shown this once. `vaultId` absent: the active vault (X-Nexus-Vault). 404 for a vault that is not
 * the user's; 409 at the live-token limit; 429 past the creation rate limit.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = CreateTokenBody.parse(await readJson(req, 4 * KiB));
    rateLimit(`api-token-create:${user.id}`, API_TOKEN_LIMITS.createsPerHour, 60 * 60_000);
    const vaultId = await resolveVaultId(user.id, body.vaultId ?? (await headers()).get(VAULT_HEADER));
    const created = await createToken(user.id, vaultId, body);
    return Response.json(created, { status: 201, headers: { "Cache-Control": "no-store" } });
  });
}
