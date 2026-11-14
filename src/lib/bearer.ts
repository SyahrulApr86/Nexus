import "server-only";
import { verifyToken, type TokenPrincipal } from "@/lib/api-tokens";

/*
 * Bearer authentication for the MCP endpoint (/api/mcp), and only for it. It reads nothing but
 * the Authorization header: a session cookie never authenticates an MCP request, and a bearer
 * token never authenticates a cookie route (those go through requireVault/requireUser in
 * src/lib/session.ts, which this file does not touch).
 */

/** The credential in `Authorization: Bearer <token>`, or null when the header is absent or another scheme. */
export function bearerCredential(h: Headers): string | null {
  const value = h.get("authorization");
  if (!value) return null;
  // RFC 6750: the scheme is case-insensitive, one or more spaces, then the token (no spaces inside).
  const m = /^Bearer[ ]+([^\s]+)[ ]*$/i.exec(value);
  return m ? m[1] : null;
}

export type BearerResult =
  | { ok: true; principal: TokenPrincipal }
  /** `missing`: no bearer credential at all; `invalid`: one was sent and refused. */
  | { ok: false; reason: "missing" | "invalid" };

/** Authenticates a request by its bearer token alone. */
export async function authenticateBearer(h: Headers): Promise<BearerResult> {
  const token = bearerCredential(h);
  if (!token) return { ok: false, reason: "missing" };
  const principal = await verifyToken(token);
  return principal ? { ok: true, principal } : { ok: false, reason: "invalid" };
}

/**
 * The 401 for a request without a valid token (RFC 6750 section 3). No error code when no
 * credential was sent; `invalid_token` for an unknown, revoked or expired one, without saying which.
 */
export function unauthorized(reason: "missing" | "invalid"): Response {
  const challenge =
    reason === "missing"
      ? 'Bearer realm="nexus"'
      : 'Bearer realm="nexus", error="invalid_token", error_description="The token is invalid, revoked or expired"';
  return Response.json(
    {
      jsonrpc: "2.0",
      error: { code: -32001, message: reason === "missing" ? "Authentication required" : "Invalid token" },
      id: null,
    },
    { status: 401, headers: { "WWW-Authenticate": challenge, "Cache-Control": "no-store" } },
  );
}
