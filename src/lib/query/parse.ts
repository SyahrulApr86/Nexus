/*
 * Parser for ```query blocks: a small, documented language in the spirit of Obsidian's Dataview
 * (not all of it). The grammar, informally:
 *
 *   query   := (LIST | TABLE column ("," column)* | TASK) clause*
 *   column  := field (AS name)?
 *   clause  := FROM source | WHERE condition | SORT key ("," key)* | LIMIT n     (each once, any order)
 *   source  := #tag | "folder" | source and source | source or source | not source | -source | ( source )
 *   condition := field op value | field exists | condition and condition | condition or condition
 *              | not condition | !condition | ( condition )
 *   op      := = | != | < | > | <= | >= | contains
 *   value   := "text" | 'text' | number | true | false | YYYY-MM-DD[THH:MM[:SS]] | today | now
 *              | (date) (+|-) N(d|w|h) | bare-word (taken as text)
 *   key     := field (asc | desc)?
 *   field   := file.name | file.path | file.folder | file.mtime | file.ctime | file.tags
 *              | completed | text (TASK only) | any frontmatter property name
 *
 * Keywords are case-insensitive. AND binds tighter than OR. Every error names the line and column
 * where it was found, counted from the first line of the block.
 */
import {
  QUERY_LIMITS,
  QuerySyntaxError,
  type Condition,
  type Field,
  type Operator,
  type Position,
  type Query,
  type SortKey,
  type Source,
  type Value,
} from "./types";

type TokenType = "word" | "string" | "number" | "date" | "duration" | "tag" | "punct" | "eof";
type Token = { type: TokenType; text: string; value: string; at: number };

const KEYWORDS = new Set(["list", "table", "task", "from", "where", "sort", "limit"]);
const CLAUSES = new Set(["from", "where", "sort", "limit"]);
const FILE_FIELDS = ["name", "path", "folder", "mtime", "ctime", "tags"] as const;
const PROP_NAME = /^[A-Za-z0-9_-]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?/;

const quoteName = (s: string) => `“${s.length > 40 ? `${s.slice(0, 39)}…` : s}”`;

/** Tokens one at a time, so an error is reported where the parser stops, not at the first odd character. */
function* tokenize(src: string, pos: (at: number) => Position): Generator<Token> {
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const rest = src.slice(i, i + 64);
    let m: RegExpExecArray | null;
    if (c === '"' || c === "'") {
      let j = i + 1;
      let value = "";
      while (j < src.length && src[j] !== c && src[j] !== "\n") {
        if (src[j] === "\\" && j + 1 < src.length && src[j + 1] !== "\n") j++;
        value += src[j++];
      }
      if (src[j] !== c) throw new QuerySyntaxError("This text has no closing quote", pos(i));
      const tok: Token = { type: "string", text: src.slice(i, j + 1), value, at: i };
      i = j + 1;
      yield tok;
    } else if (c === "#") {
      m = /^#([\p{L}\p{N}_\-/]+)/u.exec(src.slice(i, i + 256));
      if (!m) throw new QuerySyntaxError("Expected a tag name after #", pos(i));
      const tok: Token = { type: "tag", text: m[0], value: m[1], at: i };
      i += m[0].length;
      yield tok;
    } else if ((m = DATE.exec(rest)) && !/[\w.]/.test(src[i + m[0].length] ?? "")) {
      const tok: Token = { type: "date", text: m[0], value: m[0], at: i };
      i += m[0].length;
      yield tok;
    } else if ((m = /^(\d+)([dwh])(?![\w.])/.exec(rest))) {
      const tok: Token = { type: "duration", text: m[0], value: m[0], at: i };
      i += m[0].length;
      yield tok;
    } else if ((m = /^\d+(?:\.\d+)?(?![\w.])/.exec(rest))) {
      const tok: Token = { type: "number", text: m[0], value: m[0], at: i };
      i += m[0].length;
      yield tok;
    } else if ((m = /^[\p{L}_](?:[\p{L}\p{N}_.]|-(?!\d))*/u.exec(src.slice(i, i + 256)))) {
      // A trailing "-" or "." belongs to what follows ("today-7d" is not one word).
      const word = m[0].replace(/[.-]+$/, "");
      const tok: Token = { type: "word", text: word, value: word, at: i };
      i += word.length;
      yield tok;
    } else if ((m = /^(?:!=|<=|>=|[=<>!(),+-])/.exec(rest))) {
      const tok: Token = { type: "punct", text: m[0], value: m[0], at: i };
      i += m[0].length;
      yield tok;
    } else {
      throw new QuerySyntaxError(`Unexpected character ${quoteName(c)}`, pos(i));
    }
  }
  yield { type: "eof", text: "", value: "", at: src.length };
}

/** Today (UTC) as YYYY-MM-DD. */
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** `date` moved by a duration such as "7d", "2w", "12h". Day precision unless hours are involved. */
function shift(date: Value & { type: "date" }, sign: 1 | -1, duration: string): Value {
  const n = Number(duration.slice(0, -1));
  const unit = duration.slice(-1);
  const ms = n * (unit === "h" ? 3_600_000 : unit === "w" ? 7 * 86_400_000 : 86_400_000);
  const base = Date.parse(date.day ? `${date.value}T00:00:00Z` : date.value);
  const moved = new Date(base + sign * ms);
  const day = date.day && unit !== "h";
  return { type: "date", value: day ? dayOf(moved) : moved.toISOString(), day };
}

export type ParseOptions = { now?: Date };

/** Parses a query block's source. Throws QuerySyntaxError with the position of the problem. */
export function parseQuery(source: string, options: ParseOptions = {}): Query {
  const now = options.now ?? new Date();
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") lineStarts.push(i + 1);
  const pos = (at: number): Position => {
    let line = 0;
    while (line + 1 < lineStarts.length && lineStarts[line + 1] <= at) line++;
    return { line: line + 1, column: at - lineStarts[line] + 1 };
  };
  if (source.length > QUERY_LIMITS.source)
    throw new QuerySyntaxError(`This query is longer than ${QUERY_LIMITS.source} characters`, { line: 1, column: 1 });

  const lexer = tokenize(source, pos);
  const tokens: Token[] = [];
  const at = (n: number): Token => {
    while (tokens.length <= n) {
      const r = lexer.next();
      tokens.push(r.done ? { type: "eof", text: "", value: "", at: source.length } : r.value);
    }
    return tokens[n];
  };
  let k = 0;
  let terms = 0;
  const peek = () => at(k);
  const next = () => at(k++);
  const fail = (message: string, t: Token = peek()): never => {
    throw new QuerySyntaxError(message, pos(t.at));
  };
  const isWord = (t: Token, ...words: string[]) => t.type === "word" && words.includes(t.value.toLowerCase());
  const isPunct = (t: Token, ...p: string[]) => t.type === "punct" && p.includes(t.value);
  const describe = (t: Token) => (t.type === "eof" ? "the end of the query" : quoteName(t.text));
  const countTerm = (t: Token) => {
    if (++terms > QUERY_LIMITS.terms) fail(`A query can have at most ${QUERY_LIMITS.terms} conditions and sources`, t);
  };
  const atClauseEnd = (t: Token) => t.type === "eof" || (t.type === "word" && CLAUSES.has(t.value.toLowerCase()));

  /* -------- header -------- */
  const head = next();
  if (!isWord(head, "list", "table", "task"))
    fail(`A query starts with LIST, TABLE or TASK, not ${describe(head)}`, head);
  const mode = head.value.toLowerCase() as Query["mode"];

  const field = (purpose: "where" | "column" | "sort"): { field: Field; token: Token } => {
    const t = next();
    if (t.type !== "word") fail(`Expected a field name, found ${describe(t)}`, t);
    const raw = t.value;
    const lower = raw.toLowerCase();
    if (KEYWORDS.has(lower)) fail(`${quoteName(raw)} is a keyword; expected a field name`, t);
    if (lower.startsWith("file.")) {
      const name = lower.slice(5) as (typeof FILE_FIELDS)[number];
      if (!FILE_FIELDS.includes(name))
        fail(`Unknown field ${quoteName(raw)}. File fields are ${FILE_FIELDS.map((f) => `file.${f}`).join(", ")}`, t);
      return { field: { kind: "file", name }, token: t };
    }
    if (mode === "task" && (lower === "completed" || lower === "text")) {
      if (purpose === "sort") fail(`Tasks keep their order in the note; sort by a note field instead of ${quoteName(raw)}`, t);
      return { field: { kind: "task", name: lower }, token: t };
    }
    if (!PROP_NAME.test(raw)) fail(`${quoteName(raw)} is not a property name (letters, digits, - and _ only)`, t);
    return { field: { kind: "prop", name: raw }, token: t };
  };

  const columns: Query["columns"] = [];
  if (mode === "table") {
    if (atClauseEnd(peek())) fail("TABLE needs at least one field, for example TABLE status, due");
    for (;;) {
      if (columns.length >= QUERY_LIMITS.columns) fail(`A table can have at most ${QUERY_LIMITS.columns} columns`);
      const { field: f, token } = field("column");
      let label = token.value;
      if (isWord(peek(), "as")) {
        next();
        const name = next();
        if (name.type !== "string" && name.type !== "word") fail(`Expected a column name after AS, found ${describe(name)}`, name);
        label = name.value.trim() || label;
      }
      columns.push({ field: f, label: label.slice(0, 80) });
      if (!isPunct(peek(), ",")) break;
      next();
    }
  }

  /* -------- FROM -------- */
  const sourceExpr = (depth: number): Source => {
    if (depth > QUERY_LIMITS.depth) fail("This FROM is nested too deeply");
    const or: Source[] = [sourceAnd(depth)];
    while (isWord(peek(), "or")) {
      next();
      or.push(sourceAnd(depth));
    }
    return or.length === 1 ? or[0] : { type: "or", children: or };
  };
  const sourceAnd = (depth: number): Source => {
    const and: Source[] = [sourceUnary(depth)];
    while (isWord(peek(), "and")) {
      next();
      and.push(sourceUnary(depth));
    }
    return and.length === 1 ? and[0] : { type: "and", children: and };
  };
  const sourceUnary = (depth: number): Source => {
    if (depth > QUERY_LIMITS.depth) fail("This FROM is nested too deeply");
    const t = next();
    countTerm(t);
    if (isWord(t, "not") || isPunct(t, "-", "!")) return { type: "not", child: sourceUnary(depth + 1) };
    if (isPunct(t, "(")) {
      const inner = sourceExpr(depth + 1);
      if (!isPunct(next(), ")")) fail("Expected ) to close this group", t);
      return inner;
    }
    if (t.type === "tag") {
      const tag = t.value.toLowerCase().replace(/\/+$/, "");
      if (!tag) fail("Expected a tag name after #", t);
      return { type: "tag", tag };
    }
    if (t.type === "string") {
      const folder = t.value.trim().replace(/^\/+|\/+$/g, "");
      if (folder.split("/").some((s) => s === "." || s === ".."))
        fail(`${quoteName(t.value)} is not a folder in this vault`, t);
      return { type: "folder", folder };
    }
    return fail(`Expected a #tag or a "folder" in quotes, found ${describe(t)}`, t);
  };

  /* -------- WHERE -------- */
  const literal = (f: Field, op: Operator, ft: Token): Value => {
    const t = next();
    let v: Value;
    if (t.type === "string") v = { type: "string", value: t.value };
    else if (t.type === "number") v = { type: "number", value: Number(t.value) };
    else if (isPunct(t, "-") && peek().type === "number") v = { type: "number", value: -Number(next().value) };
    else if (t.type === "date") {
      const day = t.value.length === 10;
      const iso = day ? t.value : t.value.replace(" ", "T");
      const ms = Date.parse(day ? `${iso}T00:00:00Z` : /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`);
      if (Number.isNaN(ms) || (day && dayOf(new Date(ms)) !== iso)) fail(`${quoteName(t.text)} is not a valid date`, t);
      v = { type: "date", value: day ? iso : new Date(ms).toISOString(), day };
    } else if (isWord(t, "true", "false")) v = { type: "boolean", value: t.value.toLowerCase() === "true" };
    else if (isWord(t, "today")) v = { type: "date", value: dayOf(now), day: true };
    else if (isWord(t, "now")) v = { type: "date", value: now.toISOString(), day: false };
    else if (t.type === "word" && !KEYWORDS.has(t.value.toLowerCase()) && !isWord(t, "and", "or", "not"))
      v = { type: "string", value: t.value };
    else if (t.type === "tag") v = { type: "string", value: t.value };
    else return fail(`Expected a value after ${quoteName(op)}, found ${describe(t)}`, t);

    if (v.type === "date" && isPunct(peek(), "+", "-")) {
      const sign = next().value === "+" ? 1 : -1;
      const d = next();
      if (d.type !== "duration") fail(`Expected a duration such as 7d, 2w or 12h, found ${describe(d)}`, d);
      v = shift(v, sign, d.value);
    }

    // What each kind of field can be compared with.
    const name = f.kind === "file" ? `file.${f.name}` : f.name;
    if (f.kind === "file" && (f.name === "mtime" || f.name === "ctime")) {
      if (v.type !== "date") fail(`${name} compares with a date, such as 2026-01-31 or today - 7d`, t);
      if (op === "contains") fail(`${name} is a date; use =, !=, <, >, <= or >=`, ft);
    } else if (f.kind === "file" && f.name === "tags") {
      if (!["=", "!=", "contains"].includes(op)) fail("file.tags takes contains, = or !=, for example file.tags contains #project", ft);
      v = { type: "string", value: t.text.replace(/^#/, "").replace(/^["']|["']$/g, "") };
    } else if (f.kind === "task" && f.name === "completed") {
      if (v.type !== "boolean" || (op !== "=" && op !== "!=")) fail("completed takes = true or = false", t);
    } else if (f.kind === "task" && f.name === "text") {
      if (!["=", "!=", "contains"].includes(op)) fail("Task text takes contains, = or !=", ft);
      if (v.type !== "string") v = { type: "string", value: t.text };
    } else if (f.kind === "file") {
      // name, path, folder: always text.
      if (v.type !== "string") v = { type: "string", value: v.type === "date" ? v.value : t.text };
    } else if (v.type === "boolean" && op !== "=" && op !== "!=") {
      fail(`${quoteName(t.text)} can only be compared with = or !=`, t);
    } else if (op === "contains" && v.type !== "string") {
      v = { type: "string", value: t.text };
    }
    return v;
  };

  const condition = (depth: number): Condition => {
    if (depth > QUERY_LIMITS.depth) fail("This WHERE is nested too deeply");
    const at = pos(peek().at);
    const or: Condition[] = [conditionAnd(depth)];
    while (isWord(peek(), "or")) {
      next();
      or.push(conditionAnd(depth));
    }
    return or.length === 1 ? or[0] : { type: "or", children: or, at };
  };
  const conditionAnd = (depth: number): Condition => {
    const at = pos(peek().at);
    const and: Condition[] = [conditionUnary(depth)];
    while (isWord(peek(), "and")) {
      next();
      and.push(conditionUnary(depth));
    }
    return and.length === 1 ? and[0] : { type: "and", children: and, at };
  };
  const conditionUnary = (depth: number): Condition => {
    if (depth > QUERY_LIMITS.depth) fail("This WHERE is nested too deeply");
    const t = peek();
    const at = pos(t.at);
    if (isWord(t, "not") || isPunct(t, "!")) {
      next();
      return { type: "not", child: conditionUnary(depth + 1), at };
    }
    if (isPunct(t, "(")) {
      next();
      const inner = condition(depth + 1);
      if (!isPunct(next(), ")")) fail("Expected ) to close this group", t);
      return inner;
    }
    countTerm(t);
    const { field: f, token } = field("where");
    const o = next();
    if (isWord(o, "exists")) return { type: "exists", field: f, at };
    let op: Operator;
    if (isWord(o, "contains")) op = "contains";
    else if (isPunct(o, "=", "!=", "<", ">", "<=", ">=")) op = o.value as Operator;
    else
      return fail(
        `Expected =, !=, <, >, <=, >=, contains or exists after ${quoteName(token.value)}, found ${describe(o)}`,
        o,
      );
    return { type: "compare", field: f, op, value: literal(f, op, o), at };
  };

  /* -------- clauses -------- */
  let from: Source | null = null;
  let where: Condition | null = null;
  let sort: SortKey[] | null = null;
  let limit: number | null = null;
  const seen = new Set<string>();
  while (peek().type !== "eof") {
    const t = next();
    const kw = t.type === "word" ? t.value.toLowerCase() : "";
    if (!CLAUSES.has(kw)) {
      if (mode !== "table" && isPunct(t, ",")) fail("Only TABLE takes a list of fields", t);
      fail(`Expected FROM, WHERE, SORT or LIMIT, found ${describe(t)}`, t);
    }
    if (seen.has(kw)) fail(`${kw.toUpperCase()} can appear only once`, t);
    seen.add(kw);
    if (atClauseEnd(peek())) fail(`${kw.toUpperCase()} needs something after it`, peek());
    if (kw === "from") from = sourceExpr(0);
    else if (kw === "where") where = condition(0);
    else if (kw === "sort") {
      sort = [];
      for (;;) {
        const { field: f, token } = field("sort");
        if (f.kind === "file" && f.name === "tags") fail("Notes can’t be sorted by file.tags", token);
        let desc = false;
        if (isWord(peek(), "asc", "desc")) desc = next().value.toLowerCase() === "desc";
        sort.push({ field: f, desc });
        if (sort.length > 4) fail("Sort by at most 4 fields", token);
        if (!isPunct(peek(), ",")) break;
        next();
      }
    } else {
      const n = next();
      const max = mode === "task" ? QUERY_LIMITS.tasks : QUERY_LIMITS.rows;
      if (n.type !== "number" || !Number.isInteger(Number(n.value)) || Number(n.value) < 1)
        fail(`LIMIT takes a whole number from 1 to ${max}`, n);
      if (Number(n.value) > max) fail(`LIMIT can be at most ${max}`, n);
      limit = Number(n.value);
    }
    const after = peek();
    if (!atClauseEnd(after)) {
      if (kw === "limit" || kw === "sort") fail(`Expected FROM, WHERE, SORT or LIMIT, found ${describe(after)}`, after);
      fail(`Expected AND, OR or a new clause, found ${describe(after)}`, after);
    }
  }

  return { mode, columns, from, where, sort: sort ?? [], limit };
}

/** True when the condition mentions a task field (completed, text). */
export function usesTaskFields(c: Condition): boolean {
  switch (c.type) {
    case "compare":
    case "exists":
      return c.field.kind === "task";
    case "not":
      return usesTaskFields(c.child);
    default:
      return c.children.some(usesTaskFields);
  }
}

/** True when the condition mentions a note field (anything but completed and text). */
export function usesNoteFields(c: Condition): boolean {
  switch (c.type) {
    case "compare":
    case "exists":
      return c.field.kind !== "task";
    case "not":
      return usesNoteFields(c.child);
    default:
      return c.children.some(usesNoteFields);
  }
}

/**
 * Splits a TASK query's WHERE into the part about notes (run in SQL) and the part about tasks
 * (checked on each task). They may be mixed only through a top-level AND.
 */
export function splitTaskWhere(where: Condition | null): { note: Condition | null; task: Condition | null } {
  if (!where) return { note: null, task: null };
  const parts = where.type === "and" ? where.children : [where];
  const note: Condition[] = [];
  const task: Condition[] = [];
  for (const p of parts) {
    const t = usesTaskFields(p);
    if (t && usesNoteFields(p))
      throw new QuerySyntaxError(
        "completed and text can be combined with other fields only by AND, not inside OR or NOT",
        p.at,
      );
    (t ? task : note).push(p);
  }
  const join = (cs: Condition[]): Condition | null =>
    cs.length === 0 ? null : cs.length === 1 ? cs[0] : { type: "and", children: cs, at: cs[0].at };
  return { note: join(note), task: join(task) };
}

/** Evaluates a condition that only mentions task fields against one task. */
export function matchesTask(c: Condition, task: { completed: boolean; text: string }): boolean {
  switch (c.type) {
    case "and":
      return c.children.every((x) => matchesTask(x, task));
    case "or":
      return c.children.some((x) => matchesTask(x, task));
    case "not":
      return !matchesTask(c.child, task);
    case "exists":
      return c.field.name === "completed" ? true : task.text.trim() !== "";
    case "compare": {
      if (c.field.name === "completed") {
        const eq = task.completed === (c.value.type === "boolean" && c.value.value);
        return c.op === "!=" ? !eq : eq;
      }
      const text = task.text.toLowerCase();
      const v = String(c.value.value).toLowerCase();
      if (c.op === "contains") return text.includes(v);
      const eq = text.trim() === v.trim();
      return c.op === "!=" ? !eq : eq;
    }
  }
}
