import "server-only";
import { createMcpHandler, type McpHttpHandler } from "@modelcontextprotocol/server";
import type { TokenPrincipal } from "@/lib/api-tokens";
import { authenticateBearer, unauthorized } from "@/lib/bearer";
import { clientIp } from "@/lib/shares";
import { HttpError, assertSameOrigin, logError, rateLimit, readJson } from "@/lib/session";
import { MCP_LIMITS } from "./format";
import { buildServer } from "./server";

/*
 * The /api/mcp request pipeline (Streamable HTTP, stateless: one server instance per request, so
 * any number of app instances can serve it). In order:
 * 1. Origin: a browser page on another site is refused (DNS-rebinding and CSRF defence; MCP clients
 *    send no Origin). No CORS headers are ever sent.
 * 2. Rate limit on failed authentications per client address.
 * 3. Bearer token (src/lib/bearer.ts): 401 with WWW-Authenticate otherwise. Cookies are ignored.
 * 4. Rate limit per token.
 * 5. Body: JSON only, at most MCP_LIMITS.bodyBytes, read here so the SDK never reads an unbounded body.
 * 6. The SDK serves the JSON-RPC exchange with a server built for this token's vault and scope.
 */

const PRINCIPAL = "nexusPrincipal";

let handler: McpHttpHandler | undefined;

function getHandler(): McpHttpHandler {
  return (handler ??= createMcpHandler(
    ({ authInfo }) => {
      const principal = authInfo?.extra?.[PRINCIPAL] as TokenPrincipal | undefined;
      // Unreachable: serveMcp always passes one. Never build a server without a principal.
      if (!principal) throw new Error("MCP request without a principal");
      return buildServer(principal);
    },
    {
      // Errors the SDK reports out of band: class and code only, never a message or payload.
      onerror: (err) => logError("mcp", err),
      maxRequestBodySize: MCP_LIMITS.bodyBytes,
    },
  ));
}

/** Refused-token counter per client address (in memory, one process, like rateLimit in session.ts). */
const failures = (() => {
  const hits = new Map<string, number[]>();
  const WINDOW = 60_000;
  const recent = (ip: string, now: number) => (hits.get(ip) ?? []).filter((t) => now - t < WINDOW);
  return {
    blocked(ip: string) {
      return recent(ip, Date.now()).length >= MCP_LIMITS.authFailuresPerMinute;
    },
    add(ip: string) {
      const now = Date.now();
      hits.set(ip, [...recent(ip, now), now]);
      if (hits.size > 10_000) for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW)) hits.delete(k);
    },
  };
})();

/** JSON-RPC shaped error answer for failures before the exchange reaches the SDK. */
function rpcError(status: number, message: string, headers?: Record<string, string>) {
  const code = status === 400 ? -32700 : status === 429 ? -32029 : -32000;
  return Response.json(
    { jsonrpc: "2.0", error: { code, message }, id: null },
    { status, headers: { "Cache-Control": "no-store", ...headers } },
  );
}

export async function serveMcp(req: Request): Promise<Response> {
  try {
    const h = req.headers;
    assertSameOrigin(h);

    const ip = clientIp(h);
    // An address with too many refused tokens gets no database lookup until the window passes.
    if (failures.blocked(ip)) return rpcError(429, "Too many failed authentications, try again later", { "Retry-After": "60" });
    const auth = await authenticateBearer(h);
    if (!auth.ok) {
      // Only refused credentials count: a client's first, token-less probe is the normal start of
      // the auth flow. 256-bit tokens cannot be guessed; the limit bounds the lookups.
      if (auth.reason === "invalid") failures.add(ip);
      return unauthorized(auth.reason);
    }
    const { principal } = auth;
    rateLimit(`mcp:${principal.tokenId}`, MCP_LIMITS.callsPerMinute, 60_000);

    const parsedBody = req.method === "POST" ? await readJson(req, MCP_LIMITS.bodyBytes) : undefined;
    return await getHandler().fetch(req, {
      parsedBody,
      authInfo: {
        // The token id, not the secret: nothing after this point needs the token itself.
        token: principal.tokenId,
        clientId: principal.tokenId,
        scopes: [principal.scope],
        expiresAt: principal.expiresAt ? Math.floor(principal.expiresAt.getTime() / 1000) : undefined,
        extra: { [PRINCIPAL]: principal },
      },
    });
  } catch (err) {
    if (err instanceof HttpError) return rpcError(err.status, err.message, err.status === 429 ? { "Retry-After": "60" } : undefined);
    logError("mcp", err);
    return rpcError(500, "Internal error");
  }
}
