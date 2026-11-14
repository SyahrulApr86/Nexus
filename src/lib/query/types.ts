/*
 * Query blocks: types shared by the parser (parse.ts), the server executor (run.ts) and the
 * client widget (src/components/workspace/query). Pure data, no runtime code beyond constants.
 */

/** Limits that keep a query cheap. The README's "Query blocks" section documents them. */
export const QUERY_LIMITS = {
  /** Characters in one query's source. */
  source: 4_000,
  /** Notes a LIST or TABLE returns at most (also the largest LIMIT). */
  rows: 200,
  /** Tasks a TASK query returns at most (also its largest LIMIT). */
  tasks: 500,
  /** Notes a TASK query reads, and the characters of note text it reads in total. */
  taskNotes: 500,
  taskChars: 4_000_000,
  /** Columns in a TABLE. */
  columns: 12,
  /** Conditions and sources in one query, so a pathological query cannot build a huge SQL tree. */
  terms: 64,
  /** Nesting of parentheses and not. */
  depth: 16,
} as const;

/** Where a token starts in the query source: 1-based line and column. */
export type Position = { line: number; column: number };

export class QuerySyntaxError extends Error {
  constructor(
    message: string,
    public position: Position,
  ) {
    super(message);
    this.name = "QuerySyntaxError";
  }
}

/** FROM: a tag (with nested tags) or a folder, combined with and/or/not. */
export type Source =
  | { type: "tag"; tag: string }
  | { type: "folder"; folder: string }
  | { type: "and" | "or"; children: Source[] }
  | { type: "not"; child: Source };

/**
 * A field: `file.name`, `file.path`, `file.folder`, `file.mtime`, `file.ctime`, `file.tags`,
 * a frontmatter property (any other name), or, in TASK queries, `completed` and `text`.
 */
export type Field =
  | { kind: "file"; name: "name" | "path" | "folder" | "mtime" | "ctime" | "tags" }
  | { kind: "task"; name: "completed" | "text" }
  | { kind: "prop"; name: string };

/** A literal on the right of a comparison. Dates are UTC; `day` when no time was given. */
export type Value =
  | { type: "string"; value: string }
  | { type: "number"; value: number }
  | { type: "boolean"; value: boolean }
  | { type: "date"; value: string; day: boolean };

export type Operator = "=" | "!=" | "<" | ">" | "<=" | ">=" | "contains";

export type Condition =
  | { type: "compare"; field: Field; op: Operator; value: Value; at: Position }
  | { type: "exists"; field: Field; at: Position }
  | { type: "and" | "or"; children: Condition[]; at: Position }
  | { type: "not"; child: Condition; at: Position };

export type SortKey = { field: Field; desc: boolean };

export type Query = {
  mode: "list" | "table" | "task";
  /** TABLE columns, in order. `label` is the header (the field as written, or its AS name). */
  columns: { field: Field; label: string }[];
  from: Source | null;
  where: Condition | null;
  sort: SortKey[];
  limit: number | null;
};

/* ---------------------------- results ---------------------------- */

export type ResultNote = { id: string; path: string; name: string };

/** A TABLE cell: text, a number, a list of text, or nothing. Dates come as ISO 8601 text. */
export type Cell = string | number | string[] | null;

export type QueryTask = {
  /** Source offset of the task's box character (what toggleTaskAt takes). */
  offset: number;
  completed: boolean;
  /** The task's text as written, after the box. */
  text: string;
};

export type QueryResult =
  | { kind: "list"; rows: ResultNote[]; truncated: boolean }
  | { kind: "table"; columns: string[]; rows: (ResultNote & { cells: Cell[] })[]; truncated: boolean }
  | { kind: "task"; groups: { note: ResultNote; tasks: QueryTask[] }[]; truncated: boolean };

/** What POST /api/query answers. `stamp` changes whenever the vault's notes do. */
export type QueryResponse =
  | { ok: true; stamp: string; result: QueryResult }
  | { ok: true; stamp: string; unchanged: true }
  | { ok: false; error: { message: string; line: number | null; column: number | null } };
