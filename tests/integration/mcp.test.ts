import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { db } from "@/db";
import { apiToken, note, user, vault } from "@/db/schema";
import { createToken } from "@/lib/api-tokens";
import { createNote } from "@/lib/notes";
import { MCP_LIMITS } from "@/lib/mcp/format";
import * as route from "@/app/api/mcp/route";
import { describeDb, linksOf, tagsOf } from "./fixtures";

/*
 * The MCP endpoint end to end, through the official SDK client. The client's fetch calls the route
 * handlers in process, so the whole pipeline runs: origin check, bearer auth, rate limits, body
 * limit and the SDK transport.
 */

const URL_ = "http://app.test/api/mcp";
let ipSeq = 0;

/** A fetch that serves /api/mcp from the route module, from one client address. */
function routeFetch(ip = `10.0.0.${++ipSeq}`) {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const r = new Request(input, init);
    const headers = new Headers(r.headers);
    headers.set("x-forwarded-for", ip);
    const req = new Request(r, { headers });
    const handler = req.method === "POST" ? route.POST : req.method === "GET" ? route.GET : route.DELETE;
    return handler(req);
  };
}

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close().catch(() => {})));
});

async function connect(token: string) {
  const client = new Client({ name: "vitest", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(URL_), {
    fetch: routeFetch(),
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  clients.push(client);
  return client;
}

type Structured = Record<string, unknown> & { [k: string]: unknown };
async function tool(c: Client, name: string, args: Record<string, unknown> = {}) {
  const r = await c.callTool({ name, arguments: args });
  return { isError: r.isError === true, data: (r.structuredContent ?? {}) as Structured, text: JSON.stringify(r.content) };
}

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "1" } },
};
function raw(headers: Record<string, string>, body: string = JSON.stringify(INIT), ip?: string) {
  return routeFetch(ip)(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body,
  });
}

describeDb("MCP endpoint", () => {
  const U = `vitest-mcp-${randomUUID()}`;
  const V = `vitest-mcp-v-${randomUUID()}`;
  let a = "";
  let b = "";
  let other = "";
  let write = "";
  let read = "";
  let writeB = "";
  let foreign = "";

  beforeAll(async () => {
    for (const id of [U, V]) await db.insert(user).values({ id, name: id, email: `${id}@example.test` });
    [{ id: a }] = await db.insert(vault).values({ ownerId: U, name: "A" }).returning({ id: vault.id });
    [{ id: b }] = await db.insert(vault).values({ ownerId: U, name: "B" }).returning({ id: vault.id });
    [{ id: other }] = await db.insert(vault).values({ ownerId: V, name: "Other user" }).returning({ id: vault.id });
    write = (await createToken(U, a, { name: "w", scope: "write" })).token;
    read = (await createToken(U, a, { name: "r", scope: "read" })).token;
    writeB = (await createToken(U, b, { name: "wb", scope: "write" })).token;
    foreign = (await createToken(V, other, { name: "v", scope: "write" })).token;
  });

  beforeAll(async () => {
    await createNote(a, "Projects/Roadmap", "---\nstatus: active\n---\n# Roadmap\n\nShip [[MCP]] soon. #project/nexus\n");
    await createNote(a, "Projects/MCP", "# MCP\n\nSee [[Roadmap]] and [[Missing]]. #ai\n");
    await createNote(a, "Templates/Meeting", "---\ntype: meeting\n---\n# {{title}}\n\n## Notes\n");
    await createNote(b, "Private/B only", "Vault B secret roadmap. #b\n");
    await createNote(other, "Theirs", "Another user's roadmap.\n");
  });

  afterAll(async () => {
    await db.delete(user).where(inArray(user.id, [U, V]));
  });

  /* ------------------------------ auth ------------------------------ */

  it("answers 401 with a Bearer challenge without a token, with a cookie only, or with another scheme", async () => {
    const cases: Record<string, string>[] = [{}, { cookie: "better-auth.session_token=abc.def" }, { authorization: `Basic ${write}` }];
    for (const headers of cases) {
      const r = await raw(headers);
      expect(r.status).toBe(401);
      expect(r.headers.get("www-authenticate")).toBe('Bearer realm="nexus"');
    }
  });

  it("refuses revoked, expired and unknown tokens the same way", async () => {
    const revoked = await createToken(U, a, { name: "rev", scope: "write" });
    await db.update(apiToken).set({ revokedAt: new Date() }).where(eq(apiToken.id, revoked.id));
    const expired = await createToken(U, a, { name: "exp", scope: "write", expiresInDays: 1 });
    await db.update(apiToken).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(apiToken.id, expired.id));
    for (const t of [revoked.token, expired.token, `nxs_${"x".repeat(43)}`, "nope"]) {
      const r = await raw({ authorization: `Bearer ${t}` });
      expect(r.status).toBe(401);
      expect(r.headers.get("www-authenticate")).toContain('error="invalid_token"');
    }
  });

  it("refuses a foreign browser origin, non-JSON bodies and oversized bodies", async () => {
    expect((await raw({ authorization: `Bearer ${write}`, origin: "https://evil.example" })).status).toBe(403);
    expect((await raw({ authorization: `Bearer ${write}`, "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await raw({ authorization: `Bearer ${write}`, "content-type": "text/plain" })).status).toBe(415);
    expect((await raw({ authorization: `Bearer ${write}` }, "{oops")).status).toBe(400);
    const big = JSON.stringify({ ...INIT, params: { ...INIT.params, pad: "x".repeat(MCP_LIMITS.bodyBytes) } });
    expect((await raw({ authorization: `Bearer ${write}` }, big)).status).toBe(413);
    const ok = await raw({ authorization: `Bearer ${write}` });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rate limits refused tokens per client address before looking them up", async () => {
    const ip = "198.51.100.7";
    for (let i = 0; i < MCP_LIMITS.authFailuresPerMinute; i++)
      expect((await raw({ authorization: `Bearer nxs_${"y".repeat(43)}` }, undefined, ip)).status).toBe(401);
    expect((await raw({ authorization: `Bearer ${write}` }, undefined, ip)).status).toBe(429);
    expect((await raw({ authorization: `Bearer ${write}` }, undefined, "198.51.100.8")).status).toBe(200);
  });

  it("rate limits calls per token", async () => {
    const t = (await createToken(U, a, { name: "busy", scope: "read" })).token;
    const statuses: number[] = [];
    for (let i = 0; i <= MCP_LIMITS.callsPerMinute; i++) statuses.push((await raw({ authorization: `Bearer ${t}` })).status);
    expect(statuses.slice(0, -1).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  /* ------------------------------ tools ----------------------------- */

  it("lists the tools: reads and writes, no delete", async () => {
    const c = await connect(write);
    expect(c.getServerVersion()?.name).toBe("nexus");
    const names = (await c.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "append_to_note",
      "create_note",
      "get_backlinks",
      "get_recent_notes",
      "list_folders",
      "list_notes",
      "list_tags",
      "move_note",
      "query_notes",
      "read_note",
      "search_notes",
      "update_note",
    ]);
  });

  it("searches with the app's operators and reads notes with properties, tags and paging", async () => {
    const c = await connect(read);
    const s = await tool(c, "search_notes", { query: "roadmap" });
    // Vault A only: B's and the other user's "roadmap" notes never show.
    expect((s.data.results as { path: string }[]).map((r) => r.path).sort()).toEqual(["Projects/MCP", "Projects/Roadmap"]);
    const t = await tool(c, "search_notes", { query: "tag:#project" });
    expect((t.data.results as { path: string }[]).map((r) => r.path)).toEqual(["Projects/Roadmap"]);

    const r = await tool(c, "read_note", { path: "Projects/Roadmap" });
    expect(r.data).toMatchObject({ path: "Projects/Roadmap", properties: { status: "active" }, tags: ["project/nexus"] });
    expect(r.text).toContain("user data");
    const byName = await tool(c, "read_note", { path: "roadmap" });
    expect(byName.data.id).toBe(r.data.id);
    const part = await tool(c, "read_note", { id: r.data.id, offset: 4, limit: 6 });
    expect(part.data).toMatchObject({ content: "status", offset: 4, nextOffset: 10 });
    expect(part.text).toContain("offset=10");
  });

  it("lists notes, folders, tags, recent notes and links", async () => {
    const c = await connect(read);
    const p1 = await tool(c, "list_notes", { folder: "Projects", limit: 1 });
    expect(p1.data.nextCursor).toBe("Projects/MCP");
    const p2 = await tool(c, "list_notes", { folder: "Projects", cursor: p1.data.nextCursor });
    expect(p2.data).toMatchObject({ nextCursor: null, notes: [{ path: "Projects/Roadmap" }] });
    expect((await tool(c, "list_folders")).data.folders).toEqual(["Projects", "Templates"]);
    const tags = await tool(c, "list_tags");
    expect(tags.data.tags).toEqual([
      { tag: "ai", count: 1 },
      { tag: "project/nexus", count: 1 },
    ]);
    expect((await tool(c, "list_tags", { tag: "#project" })).data.notes).toMatchObject([{ path: "Projects/Roadmap" }]);
    expect(((await tool(c, "get_recent_notes", { limit: 2 })).data.notes as unknown[]).length).toBe(2);
    const links = await tool(c, "get_backlinks", { path: "Projects/MCP" });
    expect(links.data.backlinks).toMatchObject([{ path: "Projects/Roadmap" }]);
    expect(links.data.outgoing).toEqual([
      { target: "missing", embed: false, note: null },
      { target: "roadmap", embed: false, note: expect.objectContaining({ path: "Projects/Roadmap" }) },
    ]);
  });

  it("refuses every write with a read-scope token and changes nothing", async () => {
    const c = await connect(read);
    const before = await db.select({ id: note.id }).from(note).where(eq(note.vaultId, a));
    const r = await tool(c, "read_note", { path: "Projects/MCP" });
    for (const [name, args] of [
      ["create_note", { path: "Inbox/x", content: "x" }],
      ["update_note", { path: "Projects/MCP", content: "x", baseUpdatedAt: r.data.updatedAt }],
      ["append_to_note", { path: "Projects/MCP", content: "x" }],
      ["move_note", { path: "Projects/MCP", newPath: "Elsewhere" }],
    ] as const) {
      const res = await tool(c, name, args);
      expect(res.isError).toBe(true);
      expect(res.data.error).toBe("read_only");
    }
    expect(await db.select({ id: note.id }).from(note).where(eq(note.vaultId, a))).toHaveLength(before.length);
    expect((await tool(c, "read_note", { path: "Projects/MCP" })).data.updatedAt).toBe(r.data.updatedAt);
  });

  it("creates notes (with templates), indexes their links and tags, refuses taken paths and canvases", async () => {
    const c = await connect(write);
    const made = await tool(c, "create_note", { path: "Inbox/Agent note", content: "Links [[Roadmap]]. #agent" });
    expect(made.isError).toBe(false);
    expect(await tagsOf(made.data.id as string)).toEqual(["agent"]);
    expect(await linksOf(made.data.id as string)).toEqual([{ target: "roadmap", embed: false }]);
    expect((await tool(c, "create_note", { path: "Inbox/Agent note" })).isError).toBe(true);
    expect((await tool(c, "create_note", { path: "Boards/X.canvas", content: "{}" })).isError).toBe(true);

    const m = await tool(c, "create_note", { path: "Meetings/Kickoff", template: "templates/meeting", content: "Agenda" });
    const body = await tool(c, "read_note", { id: m.data.id });
    expect(body.data.properties).toEqual({ type: "meeting" });
    expect(body.data.content).toContain("# Kickoff");
    expect(body.data.content).toContain("Agenda");
    expect((await tool(c, "create_note", { path: "Meetings/Y", template: "Templates/None" })).isError).toBe(true);
  });

  it("updates with optimistic concurrency: a stale baseUpdatedAt is a conflict naming the current version", async () => {
    const c = await connect(write);
    const r = await tool(c, "read_note", { path: "Projects/MCP" });
    const up = await tool(c, "update_note", { path: "Projects/MCP", content: "# MCP\n\nNow [[Roadmap]] only. #ai", baseUpdatedAt: r.data.updatedAt });
    expect(up.isError).toBe(false);
    expect(up.data.updatedAt).not.toBe(r.data.updatedAt);
    const stale = await tool(c, "update_note", { path: "Projects/MCP", content: "lost", baseUpdatedAt: r.data.updatedAt });
    expect(stale.isError).toBe(true);
    expect(stale.data).toEqual({ error: "conflict", currentUpdatedAt: up.data.updatedAt });
    expect(stale.text).not.toContain("Now [[Roadmap]]"); // the conflict never echoes the note
    expect((await tool(c, "read_note", { path: "Projects/MCP" })).data.content).toBe("# MCP\n\nNow [[Roadmap]] only. #ai");
  });

  it("appends on a new line and moves notes, rewriting links like the app", async () => {
    const c = await connect(write);
    await tool(c, "append_to_note", { path: "Projects/MCP", content: "- appended" });
    expect((await tool(c, "read_note", { path: "Projects/MCP" })).data.content).toBe("# MCP\n\nNow [[Roadmap]] only. #ai\n- appended");
    const mv = await tool(c, "move_note", { path: "Projects/Roadmap", newPath: "Archive/Plan" });
    expect(mv.data).toMatchObject({ from: "Projects/Roadmap", path: "Archive/Plan" });
    expect((mv.data.updatedLinks as number) >= 1).toBe(true);
    expect((await tool(c, "read_note", { path: "Projects/MCP" })).data.content).toContain("[[Plan]]");
  });

  it("isolates vaults: a token sees and changes only its own vault", async () => {
    const inA = await db.select({ id: note.id, updatedAt: note.updatedAt }).from(note).where(eq(note.vaultId, a)).limit(1);
    for (const t of [writeB, foreign]) {
      const c = await connect(t);
      const s = await tool(c, "search_notes", { query: "roadmap" });
      expect((s.data.results as { path: string }[]).every((h) => !h.path.startsWith("Projects/") && !h.path.startsWith("Archive/"))).toBe(true);
      expect((await tool(c, "read_note", { id: inA[0].id })).isError).toBe(true);
      const up = await tool(c, "update_note", { id: inA[0].id, content: "pwned", baseUpdatedAt: inA[0].updatedAt.toISOString() });
      expect(up.isError).toBe(true);
      expect((await tool(c, "append_to_note", { id: inA[0].id, content: "pwned" })).isError).toBe(true);
      expect((await tool(c, "move_note", { id: inA[0].id, newPath: "Stolen" })).isError).toBe(true);
      await expect(c.readResource({ uri: "nexus://note/Projects/MCP" })).rejects.toThrow();
    }
    const [after] = await db.select({ content: note.content }).from(note).where(eq(note.id, inA[0].id));
    expect(after.content).not.toContain("pwned");
  });

  it("serves notes as resources", async () => {
    const c = await connect(read);
    const list = await c.listResources();
    expect(list.resources.map((r) => r.uri)).toContain("nexus://note/Projects/MCP");
    const res = await c.readResource({ uri: "nexus://note/Projects/MCP" });
    expect((res.contents[0] as { text: string }).text).toContain("# MCP");
  });
});
