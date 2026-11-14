import { describe, expect, it } from "vitest";
import { matchesTask, parseQuery, splitTaskWhere } from "@/lib/query/parse";
import { QUERY_LIMITS, QuerySyntaxError } from "@/lib/query/types";
import { renderQueryBlocks } from "@/lib/query/markup";
import { resultText } from "@/lib/query/text";
import { cellLink, describeResult, formatCell, taskLabel } from "@/components/workspace/query/format";
import { renderMarkdown } from "@/lib/markdown/render";

const now = new Date("2026-11-14T10:30:00Z");
const parse = (s: string) => parseQuery(s, { now });
const errorOf = (s: string) => {
  try {
    parse(s);
  } catch (e) {
    if (e instanceof QuerySyntaxError) return { message: e.message, ...e.position };
    throw e;
  }
  throw new Error("expected a syntax error");
};

describe("parseQuery: headers and clauses", () => {
  it("parses LIST, TABLE and TASK with every clause, in any order and any case", () => {
    expect(parse("LIST")).toEqual({ mode: "list", columns: [], from: null, where: null, sort: [], limit: null });
    const q = parse('table status, due AS "Due date", file.mtime\nsort due desc, file.name\nfrom #project and not "Archive"\nwhere status = active\nlimit 10');
    expect(q.mode).toBe("table");
    expect(q.columns).toEqual([
      { field: { kind: "prop", name: "status" }, label: "status" },
      { field: { kind: "prop", name: "due" }, label: "Due date" },
      { field: { kind: "file", name: "mtime" }, label: "file.mtime" },
    ]);
    expect(q.from).toEqual({
      type: "and",
      children: [{ type: "tag", tag: "project" }, { type: "not", child: { type: "folder", folder: "Archive" } }],
    });
    expect(q.where).toMatchObject({ type: "compare", field: { kind: "prop", name: "status" }, op: "=", value: { type: "string", value: "active" } });
    expect(q.sort).toEqual([
      { field: { kind: "prop", name: "due" }, desc: true },
      { field: { kind: "file", name: "name" }, desc: false },
    ]);
    expect(q.limit).toBe(10);
    expect(parse("TASK").mode).toBe("task");
  });

  it("FROM: tags (nested, lowercased), folders, or/and/not/- and groups", () => {
    expect(parse('LIST FROM #Work/Meetings or "Projects/Nexus/"').from).toEqual({
      type: "or",
      children: [{ type: "tag", tag: "work/meetings" }, { type: "folder", folder: "Projects/Nexus" }],
    });
    expect(parse("LIST FROM -#draft").from).toEqual({ type: "not", child: { type: "tag", tag: "draft" } });
    expect(parse('LIST FROM (#a or #b) and "X"').from).toMatchObject({ type: "and", children: [{ type: "or" }, { type: "folder" }] });
  });

  it("WHERE: AND binds tighter than OR; not and ! negate; parentheses group", () => {
    const w = parse("LIST WHERE a = 1 or b = 2 and not c exists").where!;
    expect(w.type).toBe("or");
    if (w.type !== "or") return;
    expect(w.children[1]).toMatchObject({ type: "and", children: [{ type: "compare" }, { type: "not", child: { type: "exists" } }] });
    expect(parse("LIST WHERE !(a = 1 or b = 2)").where).toMatchObject({ type: "not", child: { type: "or" } });
  });

  it("values: text, numbers, booleans, dates, today/now with offsets", () => {
    const value = (s: string) => {
      const w = parse(`LIST WHERE x ${s}`).where!;
      return w.type === "compare" ? w.value : null;
    };
    expect(value('= "in progress"')).toEqual({ type: "string", value: "in progress" });
    expect(value("= 'it\\'s'")).toEqual({ type: "string", value: "it's" });
    expect(value(">= 3.5")).toEqual({ type: "number", value: 3.5 });
    expect(value("> -2")).toEqual({ type: "number", value: -2 });
    expect(value("= true")).toEqual({ type: "boolean", value: true });
    expect(value("< 2026-01-31")).toEqual({ type: "date", value: "2026-01-31", day: true });
    expect(value("< 2026-01-31T09:15")).toEqual({ type: "date", value: "2026-01-31T09:15:00.000Z", day: false });
    expect(value("= today")).toEqual({ type: "date", value: "2026-11-14", day: true });
    expect(value("> today - 7d")).toEqual({ type: "date", value: "2026-11-07", day: true });
    expect(value("> today-2w")).toEqual({ type: "date", value: "2026-10-31", day: true });
    expect(value("< now + 12h")).toEqual({ type: "date", value: "2026-11-14T22:30:00.000Z", day: false });
    expect(value("= done")).toEqual({ type: "string", value: "done" });
  });

  it("file fields and task fields", () => {
    expect(parse("LIST WHERE file.tags contains #Work").where).toMatchObject({ field: { kind: "file", name: "tags" }, value: { value: "Work" } });
    expect(parse("LIST WHERE file.mtime > today - 7d").where).toMatchObject({ field: { kind: "file", name: "mtime" } });
    expect(parse("LIST WHERE file.name contains 2026").where).toMatchObject({ value: { type: "string", value: "2026" } });
    expect(parse("TASK WHERE completed = false and text contains call").where).toMatchObject({ type: "and" });
    // Outside TASK, completed and text are ordinary properties.
    expect(parse("LIST WHERE completed = true").where).toMatchObject({ field: { kind: "prop", name: "completed" } });
  });
});

describe("parseQuery: errors carry a position", () => {
  it.each([
    ["", 1, 1, /starts with LIST, TABLE or TASK/],
    ["SELECT *", 1, 1, /starts with LIST, TABLE or TASK, not “SELECT”/],
    ["TABLE", 1, 6, /needs at least one field/],
    ["LIST\nWHERE status", 2, 13, /Expected =, !=, <, >, <=, >=, contains or exists after “status”/],
    ["LIST\nWHERE status = ", 2, 16, /Expected a value/],
    ['LIST FROM "Projects', 1, 11, /no closing quote/],
    ["LIST FROM status", 1, 11, /Expected a #tag or a "folder"/],
    ["LIST WHERE file.size > 3", 1, 12, /Unknown field “file.size”/],
    ["LIST WHERE file.mtime > 3", 1, 25, /compares with a date/],
    ["LIST WHERE due < 2026-02-30", 1, 18, /not a valid date/],
    ["LIST LIMIT 0", 1, 12, /whole number/],
    [`LIST LIMIT ${QUERY_LIMITS.rows + 1}`, 1, 12, /at most 200/],
    ["LIST WHERE a = 1 WHERE b = 2", 1, 18, /WHERE can appear only once/],
    ["LIST WHERE (a = 1", 1, 12, /Expected \) to close/],
    ["LIST WHERE a = 1 b = 2", 1, 18, /Expected AND, OR or a new clause/],
    ["LIST WHERE a ~ 1", 1, 14, /Unexpected character “~”/],
    ["TASK SORT completed", 1, 11, /sort by a note field/],
    ["LIST SORT file.tags", 1, 11, /can’t be sorted by file.tags/],
    ["LIST WHERE flag > true", 1, 19, /only be compared with = or !=/],
    ["LIST, status", 1, 5, /Only TABLE takes a list of fields/],
  ])("%j -> line %i, column %i", (src, line, column, message) => {
    const e = errorOf(src);
    expect(e.message).toMatch(message);
    expect([e.line, e.column]).toEqual([line, column]);
  });

  it("bounds the source length, the number of terms and the nesting", () => {
    expect(errorOf("LIST " + "x".repeat(QUERY_LIMITS.source)).message).toMatch(/longer than/);
    const many = Array.from({ length: QUERY_LIMITS.terms + 1 }, (_, i) => `a${i} = 1`).join(" or ");
    expect(errorOf(`LIST WHERE ${many}`).message).toMatch(/at most 64 conditions/);
    expect(errorOf(`LIST WHERE ${"not ".repeat(20)}a = 1`).message).toMatch(/nested too deeply/);
  });
});

describe("TASK conditions", () => {
  it("splits note and task conditions at the top-level AND", () => {
    const q = parse("TASK WHERE status = active and completed = false and (text contains a or text contains b)");
    const { note, task } = splitTaskWhere(q.where);
    expect(note).toMatchObject({ type: "compare", field: { name: "status" } });
    expect(task).toMatchObject({ type: "and", children: [{ type: "compare" }, { type: "or" }] });
  });

  it("refuses task and note fields mixed under OR, with the position", () => {
    const q = parse("TASK WHERE status = x\n  and (completed = true or due exists)");
    expect(() => splitTaskWhere(q.where)).toThrow(QuerySyntaxError);
    try {
      splitTaskWhere(q.where);
    } catch (e) {
      expect((e as QuerySyntaxError).position).toEqual({ line: 2, column: 8 });
    }
  });

  it("evaluates task conditions", () => {
    const t = { completed: false, text: "Call **Ana** about [[Budget]]" };
    const where = (s: string) => splitTaskWhere(parse(`TASK WHERE ${s}`).where).task!;
    expect(matchesTask(where("completed = false"), t)).toBe(true);
    expect(matchesTask(where("completed != false"), t)).toBe(false);
    expect(matchesTask(where("text contains ana"), t)).toBe(true);
    expect(matchesTask(where("not text contains budget"), t)).toBe(false);
    expect(matchesTask(where("completed = true or text contains call"), t)).toBe(true);
  });
});

describe("result text", () => {
  const list = { kind: "list" as const, rows: [{ id: "1", path: "A/B", name: "B" }], truncated: false };
  it("describes results", () => {
    expect(describeResult(list)).toBe("1 note");
    expect(describeResult({ ...list, rows: [] })).toBe("No notes match");
    expect(describeResult({ ...list, truncated: true })).toBe("First 1 note");
    const tasks = { kind: "task" as const, groups: [{ note: list.rows[0], tasks: [{ offset: 3, completed: false, text: "x" }, { offset: 9, completed: true, text: "y" }] }], truncated: false };
    expect(describeResult(tasks)).toBe("2 tasks in 1 note");
    expect(resultText(tasks)).toBe("A/B\n- [ ] x\n- [x] y");
  });

  it("formats cells, links and task labels", () => {
    expect(formatCell(null)).toBe("");
    expect(formatCell(["a", "b"])).toBe("a, b");
    expect(formatCell(1200)).toBe("1,200");
    expect(formatCell("2026-11-14T10:30:00.000Z")).toBe("Nov 14, 2026");
    expect(formatCell("2026-11-14")).toBe("2026-11-14");
    expect(cellLink("[[Projects/Plan|the plan]]")).toEqual({ target: "Projects/Plan", label: "the plan" });
    expect(cellLink("see [[Plan]]")).toBeNull();
    expect(taskLabel("Call **Ana** about [[Budget|the budget]] and `x`")).toBe("Call Ana about the budget and x");
  });

  it("formats a table for the MCP tool", () => {
    expect(
      resultText({ kind: "table", columns: ["status"], rows: [{ id: "1", path: "P", name: "P", cells: ["a|b"] }], truncated: true }),
    ).toBe("| Note | status |\n| --- | --- |\n| P | a b |\n(More match; add LIMIT, FROM or WHERE to narrow the query.)");
  });
});

describe("render hook", () => {
  it("wraps ```query blocks in <nexus-query>, keeping the code inside", () => {
    const html = renderMarkdown("Intro\n\n```query\nLIST FROM #a\n```\n\n```js\nx\n```", () => true);
    expect(html).toContain('<nexus-query class="query-block"><pre><code class="language-query">LIST FROM #a\n</code></pre></nexus-query>');
    expect(html).toContain('<pre><code class="language-js">x\n</code></pre>');
    expect(html.match(/<nexus-query/g)).toHaveLength(1);
  });

  it("leaves other HTML alone and escapes the query text", () => {
    expect(renderQueryBlocks("<p>x</p>")).toBe("<p>x</p>");
    const html = renderMarkdown('```query\nLIST WHERE a = "<b>"\n```', () => true);
    expect(html).toContain("&#x3C;b>");
    expect(html).not.toContain("<b>");
  });
});
