import { z } from "zod";
import { QUERY_LIMITS } from "./types";

/** Short syntax reference for the MCP tool's description (the README has the full one). */
export const QUERY_SYNTAX = [
  "Syntax: LIST | TABLE field, field | TASK, then optional clauses:",
  'FROM #tag or "folder" (combine with and, or, not);',
  "WHERE field op value (ops: =, !=, <, >, <=, >=, contains, exists; and/or/not; values: \"text\", numbers, true/false, dates like 2026-01-31, today, now, today - 7d);",
  "SORT field asc|desc; LIMIT n.",
  "Fields: frontmatter property names, file.name, file.path, file.folder, file.mtime, file.ctime, file.tags; in TASK queries also completed and text.",
  'Example: TABLE status, due FROM #project and not "Archive" WHERE due < today + 7d SORT due asc LIMIT 20',
].join(" ");

export const QueryNotesInput = z
  .object({
    query: z.string().min(1).max(QUERY_LIMITS.source).describe("The query, for example: LIST FROM #project WHERE status = active SORT file.mtime desc"),
  })
  .strict();
