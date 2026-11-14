/*
 * Client calls for personal API tokens (/api/tokens). Same-origin fetches with the session cookie;
 * bodies are JSON, as the server requires. Kept here (not in workspace/api.ts) so the MCP feature
 * stays self-contained.
 */

export type TokenScope = "read" | "write";

export type ApiTokenInfo = {
  id: string;
  name: string;
  /** First characters of the token, for recognising it ("nxs_AbCd1234"). */
  prefix: string;
  scope: TokenScope;
  vaultId: string;
  vaultName: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
};

/** The creation answer: the only time the token itself is ever sent. */
export type CreatedToken = Omit<ApiTokenInfo, "vaultName"> & { token: string };

export class TokensError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      credentials: "same-origin",
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    });
  } catch {
    throw new TokensError("You appear to be offline. Check your connection and try again.", 0);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    const message =
      res.status === 401
        ? "Your session ended. Sign in again."
        : res.status >= 500
          ? "Nexus couldn’t finish that. Try again in a moment."
          : res.status === 400
            ? "Check the name and options, then try again."
            : (data.error ?? "That didn’t work. Try again.");
    throw new TokensError(message, res.status);
  }
  return data as T;
}

export const tokensApi = {
  list: () => call<ApiTokenInfo[]>("/api/tokens"),
  create: (body: { name: string; scope: TokenScope; vaultId: string; expiresInDays: number | null }) =>
    call<CreatedToken>("/api/tokens", { method: "POST", body: JSON.stringify(body) }),
  revoke: (id: string) => call<{ ok: true }>(`/api/tokens/${encodeURIComponent(id)}`, { method: "DELETE" }),
  vaults: () => call<{ id: string; name: string; isDefault: boolean }[]>("/api/vaults"),
};

/** The MCP endpoint as clients reach it: this page's own origin. */
export function mcpEndpoint(origin: string): string {
  return `${origin}/api/mcp`;
}

/** Claude Code: verified against `claude mcp add --help` (HTTP transport with --header). */
export function claudeCodeSnippet(origin: string, token: string): string {
  return `claude mcp add --transport http nexus ${mcpEndpoint(origin)} --header "Authorization: Bearer ${token}"`;
}

/**
 * Claude Desktop: its config file starts local (stdio) servers, so a remote server with a bearer
 * header goes through the third-party mcp-remote bridge (checked on npm: 0.16.6, MIT). The header
 * is split around ":" without spaces and the value sits in env, as mcp-remote's README advises.
 */
export function claudeDesktopSnippet(origin: string, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        nexus: {
          command: "npx",
          args: ["-y", "mcp-remote@0.16.6", mcpEndpoint(origin), "--header", "Authorization:${NEXUS_AUTH}"],
          env: { NEXUS_AUTH: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}
