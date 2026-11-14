/*
 * Query results as plain text, for the MCP tool query_notes (src/lib/mcp/server.ts).
 */
import type { Cell, QueryResult } from "./types";

const cell = (c: Cell) => (c === null ? "" : Array.isArray(c) ? c.join(", ") : String(c)).replace(/[|\n]/g, " ");

export function resultText(r: QueryResult): string {
  const more = r.truncated ? "\n(More match; add LIMIT, FROM or WHERE to narrow the query.)" : "";
  if (r.kind === "list") return r.rows.length ? r.rows.map((n) => `- ${n.path}`).join("\n") + more : "No notes match.";
  if (r.kind === "table") {
    if (!r.rows.length) return "No notes match.";
    const head = `| Note | ${r.columns.join(" | ")} |\n|${" --- |".repeat(r.columns.length + 1)}`;
    return `${head}\n${r.rows.map((n) => `| ${n.path} | ${n.cells.map(cell).join(" | ")} |`).join("\n")}${more}`;
  }
  if (!r.groups.length) return "No tasks match.";
  return (
    r.groups
      .map((g) => `${g.note.path}\n${g.tasks.map((t) => `- [${t.completed ? "x" : " "}] ${t.text}`).join("\n")}`)
      .join("\n\n") + more
  );
}
