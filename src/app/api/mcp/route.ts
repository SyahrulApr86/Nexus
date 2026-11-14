import { serveMcp } from "@/lib/mcp/handler";

/*
 * MCP endpoint (Streamable HTTP, stateless). Authenticated by `Authorization: Bearer nxs_…` only,
 * never by the session cookie; see src/lib/mcp/handler.ts for the full request pipeline.
 * GET and DELETE go through the same checks; the stateless transport answers them itself.
 */

export async function POST(req: Request) {
  return serveMcp(req);
}

export async function GET(req: Request) {
  return serveMcp(req);
}

export async function DELETE(req: Request) {
  return serveMcp(req);
}
