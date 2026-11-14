/*
 * Text for ```query results: counts, cells and task labels. Pure functions, shared by the
 * widget (element.ts) and the MCP tool's text answer, and unit tested.
 */
import type { Cell, QueryResult } from "@/lib/query/types";

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

/** The caption above the results: "4 notes", "6 tasks in 3 notes", "No notes match". */
export function describeResult(r: QueryResult): string {
  if (r.kind === "task") {
    const tasks = r.groups.reduce((n, g) => n + g.tasks.length, 0);
    if (!tasks) return "No tasks match";
    const s = `${plural(tasks, "task")} in ${plural(r.groups.length, "note")}`;
    return r.truncated ? `First ${s}` : s;
  }
  if (!r.rows.length) return "No notes match";
  return r.truncated ? `First ${plural(r.rows.length, "note")}` : plural(r.rows.length, "note");
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const dateFmt = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** A TABLE cell as text. Timestamps (file.mtime, file.ctime) read as "Nov 14, 2026". */
export function formatCell(c: Cell): string {
  if (c === null) return "";
  if (Array.isArray(c)) return c.join(", ");
  if (typeof c === "number") return c.toLocaleString("en");
  if (ISO_TIME.test(c)) return dateFmt.format(new Date(c));
  return c;
}

/** A cell that is one [[wikilink]]: its target and label. */
export function cellLink(c: Cell): { target: string; label: string } | null {
  if (typeof c !== "string") return null;
  const m = /^\s*\[\[([^\[\]|#\n]+)(?:#[^\[\]|\n]*)?(?:\|([^\[\]\n]+))?\]\]\s*$/.exec(c);
  return m ? { target: m[1].trim(), label: (m[2] ?? m[1]).trim() } : null;
}

/** A task's text for display: wikilinks show their label, emphasis marks and code ticks drop. */
export function taskLabel(text: string): string {
  return text
    .replace(/!?\[\[([^\[\]|\n]+?)(?:\|([^\[\]\n]+))?\]\]/g, (_, t: string, a?: string) => (a ?? t).trim())
    .replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, "$1")
    .replace(/(\*\*|__|~~|==|`)(.+?)\1/g, "$2")
    .trim();
}

/** "Projects/Nexus/Roadmap" -> "Projects/Nexus"; "" at the vault root. */
export const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
