import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { db } from "@/db";
import { note } from "@/db/schema";
import { createToken } from "@/lib/api-tokens";
import { createNote, updateContent } from "@/lib/notes";
import { toggleTaskAt } from "@/lib/markdown/tasks";
import { clearQueryCache, runQuery } from "@/lib/query/run";
import type { QueryResponse, QueryResult } from "@/lib/query/types";
import * as mcpRoute from "@/app/api/mcp/route";
import { describeDb, useVaults } from "./fixtures";

/* ```query blocks (src/lib/query/run.ts) against a real database, and the MCP tool query_notes. */

const NOW = new Date("2026-11-14T10:00:00Z");

function result(r: QueryResponse): QueryResult {
  if (!r.ok) throw new Error(`query failed: ${r.error.message}`);
  if ("unchanged" in r) throw new Error("unexpected unchanged");
  return r.result;
}

describeDb("query blocks", () => {
  const v = useVaults();
  const run = async (vault: string, src: string) => result(await runQuery(vault, src, undefined, NOW));
  const names = async (src: string) => {
    const r = await run(v.a, src);
    if (r.kind === "task") throw new Error("not a list");
    return r.rows.map((n) => n.name);
  };

  beforeEach(async () => {
    clearQueryCache();
    await createNote(v.a, "Projects/Nexus/Roadmap", "---\nstatus: active\npriority: 2\ndue: 2026-11-20\ntags: [project, work]\n---\n# Roadmap\n- [ ] Ship query blocks\n- [x] Write the parser\n");
    await createNote(v.a, "Projects/Atlas", "---\nstatus: paused\npriority: 10\ndue: 2026-12-24\n---\nAtlas plan #project\n- [ ] Call Ana about [[Budget]]\n");
    await createNote(v.a, "Projects/Old/Legacy", "---\nstatus: done\npriority: high\ndue: someday\n---\nOld #project/archived\n");
    await createNote(v.a, "Inbox", "Loose thoughts #idea\n```\n- [ ] not a task, in code\n```\n- [ ] Buy milk\n");
    await createNote(v.a, "Archive/Projects note", "Not in the Projects folder #project\n");
    await createNote(v.b, "Projects/Other vault", "---\nstatus: active\n---\n#project\n");
  });

  it("LIST FROM tags (nested) and folders, with and/or/not", async () => {
    expect(await names("LIST FROM #project")).toEqual(["Atlas", "Legacy", "Projects note", "Roadmap"]);
    expect(await names('LIST FROM "Projects"')).toEqual(["Atlas", "Legacy", "Roadmap"]);
    expect(await names('LIST FROM "projects/nexus"')).toEqual(["Roadmap"]);
    expect(await names('LIST FROM #project and not "Projects/Old"')).toEqual(["Atlas", "Projects note", "Roadmap"]);
    expect(await names("LIST FROM #idea or #project/archived")).toEqual(["Inbox", "Legacy"]);
    expect(await names("LIST FROM -#project")).toEqual(["Inbox"]);
  });

  it("WHERE on properties: text, numbers, dates, lists, exists, and NOT with missing values", async () => {
    expect(await names("LIST WHERE status = Active")).toEqual(["Roadmap"]);
    expect(await names("LIST WHERE status != active")).toEqual(["Atlas", "Inbox", "Legacy", "Projects note"]);
    expect(await names("LIST WHERE priority > 3")).toEqual(["Atlas"]);
    expect(await names("LIST WHERE priority <= 10 and priority >= 2")).toEqual(["Atlas", "Roadmap"]);
    expect(await names("LIST WHERE due < 2026-12-01")).toEqual(["Roadmap"]);
    expect(await names("LIST WHERE due < today + 7d")).toEqual(["Roadmap"]);
    expect(await names("LIST WHERE due = 2026-12-24")).toEqual(["Atlas"]);
    expect(await names("LIST WHERE tags contains work")).toEqual(["Roadmap"]);
    expect(await names("LIST WHERE tags = PROJECT")).toEqual(["Roadmap"]);
    expect(await names("LIST WHERE status contains us")).toEqual(["Atlas"]);
    expect(await names("LIST WHERE due exists")).toEqual(["Atlas", "Legacy", "Roadmap"]);
    expect(await names("LIST WHERE not due exists")).toEqual(["Inbox", "Projects note"]);
    expect(await names("LIST WHERE not (status = active or status = paused)")).toEqual(["Inbox", "Legacy", "Projects note"]);
  });

  it("WHERE on file fields", async () => {
    expect(await names("LIST WHERE file.name contains road")).toEqual(["Roadmap"]);
    expect(await names('LIST WHERE file.folder = "Projects"')).toEqual(["Atlas"]);
    expect(await names('LIST WHERE file.path contains "old/"')).toEqual(["Legacy"]);
    expect(await names("LIST WHERE file.tags contains #project")).toEqual(["Atlas", "Legacy", "Projects note", "Roadmap"]);
    expect(await names("LIST WHERE file.tags != project and file.tags exists")).toEqual(["Inbox"]);
    expect(await names("LIST WHERE file.mtime > 2000-01-01")).toHaveLength(5);
    expect(await names("LIST WHERE file.ctime < 2000-01-01")).toEqual([]);
  });

  it("SORT by typed values and LIMIT, with truncation reported only without LIMIT", async () => {
    expect(await names("LIST WHERE priority exists SORT priority desc")).toEqual(["Atlas", "Roadmap", "Legacy"]);
    expect(await names("LIST WHERE due exists SORT due")).toEqual(["Roadmap", "Atlas", "Legacy"]);
    expect(await names("LIST FROM #project SORT file.name desc LIMIT 2")).toEqual(["Roadmap", "Projects note"]);
    const r = await run(v.a, "LIST LIMIT 1");
    expect(r.truncated).toBe(false);
  });

  it("TABLE returns cells for properties and file fields", async () => {
    const r = await run(v.a, 'TABLE status AS "State", priority, file.tags, file.folder FROM "Projects" SORT file.name');
    expect(r.kind).toBe("table");
    if (r.kind !== "table") return;
    expect(r.columns).toEqual(["State", "priority", "file.tags", "file.folder"]);
    expect(r.rows.map((x) => [x.name, ...x.cells])).toEqual([
      ["Atlas", "paused", "10", ["project"], "Projects"],
      ["Legacy", "done", "high", ["project/archived"], "Projects/Old"],
      ["Roadmap", "active", "2", ["project", "work"], "Projects/Nexus"],
    ]);
  });

  it("TASK lists tasks with offsets that toggle the right box, skipping code", async () => {
    const r = await run(v.a, "TASK WHERE completed = false");
    expect(r.kind).toBe("task");
    if (r.kind !== "task") return;
    expect(r.groups.map((g) => [g.note.name, g.tasks.map((t) => t.text)])).toEqual([
      ["Atlas", ["Call Ana about [[Budget]]"]],
      ["Inbox", ["Buy milk"]],
      ["Roadmap", ["Ship query blocks"]],
    ]);
    const roadmap = r.groups.find((g) => g.note.name === "Roadmap")!;
    const [row] = await db.select({ content: note.content }).from(note).where(eq(note.id, roadmap.note.id));
    const next = toggleTaskAt(row.content, roadmap.tasks[0].offset);
    expect(next).toContain("- [x] Ship query blocks");
    await updateContent(v.a, roadmap.note.id, next);
    const after = await run(v.a, 'TASK FROM "Projects/Nexus"');
    expect(after.kind === "task" && after.groups[0].tasks.map((t) => t.completed)).toEqual([true, true]);
  });

  it("TASK mixes note and task conditions with AND, and LIMIT counts tasks", async () => {
    const r = await run(v.a, 'TASK FROM "Projects" WHERE status = active and text contains parser');
    expect(r.kind === "task" && r.groups.flatMap((g) => g.tasks.map((t) => t.text))).toEqual(["Write the parser"]);
    const limited = await run(v.a, "TASK LIMIT 2");
    expect(limited.kind === "task" && limited.groups.flatMap((g) => g.tasks)).toHaveLength(2);
  });

  it("stays inside the vault", async () => {
    const r = await run(v.b, "LIST FROM #project");
    expect(r.kind === "list" && r.rows.map((x) => x.name)).toEqual(["Other vault"]);
    expect(await names('LIST WHERE file.name = "Other vault"')).toEqual([]);
  });

  it("binds every value: quotes, LIKE wildcards and SQL in values and property names change nothing", async () => {
    expect(await names(`LIST WHERE status = "x' or '1'='1"`)).toEqual([]);
    expect(await names('LIST FROM "%"')).toEqual([]);
    expect(await names('LIST FROM "Projects_Nexus"')).toEqual([]);
    expect(await names('LIST WHERE file.name contains "%"')).toEqual([]);
    expect(await names("LIST FROM #proj_ct")).toEqual([]);
    expect(await names("LIST WHERE drop-table exists")).toEqual([]);
  });

  it("reports syntax errors with a position, and unchanged results by stamp", async () => {
    const bad = await runQuery(v.a, "LIST\nWHERE status", undefined, NOW);
    expect(bad).toEqual({ ok: false, error: expect.objectContaining({ line: 2, column: 13 }) });
    const first = await runQuery(v.a, "LIST", undefined, NOW);
    expect(first.ok).toBe(true);
    const stamp = first.ok ? first.stamp : "";
    expect(await runQuery(v.a, "LIST", stamp, NOW)).toEqual({ ok: true, stamp, unchanged: true });
    await createNote(v.a, "New one", "");
    const again = await runQuery(v.a, "LIST", stamp, NOW);
    expect(again.ok && "result" in again && again.result.kind === "list" && again.result.rows).toHaveLength(6);
  });
});

/* ---------------------------- MCP tool ---------------------------- */

describeDb("MCP tool query_notes", () => {
  const v = useVaults();
  let token = "";
  const clients: Client[] = [];

  beforeAll(async () => {
    token = (await createToken(v.userId, v.a, { name: "q", scope: "read" })).token;
  });
  beforeEach(async () => {
    clearQueryCache();
    await createNote(v.a, "Projects/Roadmap", "---\nstatus: active\n---\n- [ ] Ship it #project\n");
    await createNote(v.b, "Projects/Hidden", "---\nstatus: active\n---\n#project\n");
  });
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close().catch(() => {})));
  });

  async function call(args: Record<string, unknown>) {
    const client = new Client({ name: "vitest", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL("http://app.test/api/mcp"), {
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const r = new Request(input, init);
        const headers = new Headers(r.headers);
        headers.set("x-forwarded-for", `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`);
        const req = new Request(r, { headers });
        return req.method === "POST" ? mcpRoute.POST(req) : req.method === "GET" ? mcpRoute.GET(req) : mcpRoute.DELETE(req);
      },
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    await client.connect(transport);
    clients.push(client);
    const r = await client.callTool({ name: "query_notes", arguments: args });
    return { isError: r.isError === true, data: (r.structuredContent ?? {}) as Record<string, unknown>, text: (r.content as { text: string }[])[0]?.text ?? "" };
  }

  it("runs a query with a read token, in the token's vault only", async () => {
    const r = await call({ query: "TABLE status FROM #project" });
    expect(r.isError).toBe(false);
    expect(r.text).toBe("| Note | status |\n| --- | --- |\n| Projects/Roadmap | active |");
    expect(JSON.stringify(r.data)).not.toContain("Hidden");
    const tasks = await call({ query: "TASK" });
    expect(tasks.text).toBe("Projects/Roadmap\n- [ ] Ship it #project");
  });

  it("answers a syntax error as a tool error with the position", async () => {
    const r = await call({ query: "LIST WHERE" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/^Line 1, column 11: /);
    expect(r.data).toMatchObject({ error: "invalid", line: 1, column: 11 });
  });

  it("refuses unknown arguments", async () => {
    const r = await call({ query: "LIST", extra: 1 });
    expect(r.isError).toBe(true);
  });
});
