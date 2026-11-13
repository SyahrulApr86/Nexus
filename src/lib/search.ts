import "server-only";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { note, tag } from "@/db/schema";

/*
 * Obsidian-style vault search.
 *
 * Syntax (case-insensitive):
 *   rea notes        every word must match, as a prefix ("rea" finds "reading")
 *   "reading list"   phrase: the words in order, the last one as a prefix
 *   -draft -"a b"    exclude; also works on operators and groups: -tag:old -(a OR b)
 *   a OR b           either side; AND (a space) binds tighter: `a b OR c` = `(a b) OR c`
 *   ( ... )          grouping
 *   file:text        note name contains text           file:"meeting notes"  file:(plan OR roadmap)
 *   path:text        note path contains text (folders) path:Projects/Nexus
 *   tag:#name        note has the tag or a nested one   tag:work also finds #work/meetings
 *   line:(a b)       all terms on the same line         line:"brown fox"  line:(mix -flour)
 *
 * The parser is lenient: an unclosed quote runs to the end, unbalanced parentheses, a lone "-",
 * a dangling OR and empty operators are ignored. A query with nothing left (or only operators)
 * returns the matching notes by path with an empty snippet.
 *
 * SQL mapping:
 * - Words and phrases become `to_tsquery('simple', ...)` matched against the generated
 *   `note.search` tsvector, one tsquery per AND/OR group of text terms, so the GIN index still
 *   drives word searches. Each word is reduced to letters (with their combining marks), digits,
 *   `_` and `-` first, so user text can never form tsquery syntax; the tsquery string and every
 *   other value from the query are bound parameters, never part of the SQL text.
 * - Negation is SQL `NOT (...)`, not `!` inside the tsquery: a word Postgres cannot index (e.g.
 *   "①") then excludes nothing instead of emptying the whole query.
 * - file:/path: are ILIKE with `\`, `%` and `_` escaped; tag: is an EXISTS on the tag table.
 * - line: runs in SQL. The content is split on newlines (`string_to_table`) and each line is
 *   tested with `to_tsvector('simple', line) @@ to_tsquery(...)`, so it follows exactly the word
 *   rules above (same parser, prefixes, phrases), needs no regex built from user text and ships
 *   no note content to the app. The words a match must contain are also checked against
 *   `note.search` first, so the GIN index narrows the candidates before lines are split.
 */

export const MAX_QUERY_LENGTH = 200;
const MAX_RESULTS = 50;
const MAX_TERMS = 32; // words, phrases and operator values kept per query
const MAX_WORDS = 16; // words kept per phrase
const MAX_DEPTH = 16; // nested parentheses; a deeper "(" is ignored

export type QueryNode =
  | { type: "and"; children: QueryNode[] }
  | { type: "or"; children: QueryNode[] }
  | { type: "not"; child: QueryNode }
  /** One word (prefix match) or a phrase (in order, last word as prefix). Case is folded by Postgres. */
  | { type: "text"; words: string[] }
  | { type: "file"; value: string }
  | { type: "path"; value: string }
  /** Lowercase, without "#" or a trailing "/". */
  | { type: "tag"; value: string }
  /** `child` holds only text, and, or and not nodes. */
  | { type: "line"; child: QueryNode };

export type SearchHit = { id: string; path: string; name: string; snippet: string };

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

type Operator = "file" | "path" | "tag" | "line";
type Mode = "root" | Operator;

type Token =
  | { t: "(" }
  | { t: ")" }
  | { t: "or" }
  | { t: "not" }
  | { t: "term"; raw: string }
  /** `group`: a "(" token follows. `raw`: the source text, read as a term where operators do not nest. */
  | { t: "op"; name: Operator; value: string; group: boolean; raw: string };

const OPERATOR_RE = /^(file|path|tag|line):/i;
const isSpace = (c: string | undefined) => c !== undefined && /\s/.test(c);

function tokenize(s: string): Token[] {
  const out: Token[] = [];
  const ends = (c: string | undefined) => c === undefined || isSpace(c) || c === "(" || c === ")" || c === '"';
  const bareEnd = (from: number) => {
    let j = from;
    while (!ends(s[j])) j++;
    return j;
  };
  /** `"..."` starting at `from`; an unclosed quote runs to the end of the input. */
  const quoted = (from: number): [string, number] => {
    const close = s.indexOf('"', from + 1);
    return close === -1 ? [s.slice(from + 1), s.length] : [s.slice(from + 1, close), close + 1];
  };

  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (isSpace(c)) {
      i++;
    } else if (c === "(" || c === ")") {
      out.push({ t: c });
      i++;
    } else if (c === '"') {
      const [raw, next] = quoted(i);
      out.push({ t: "term", raw });
      i = next;
    } else if (c === "-") {
      // Dashes glued to a term negate it; a lone "-" ("a - b", "-)") means nothing.
      let j = i;
      while (s[j] === "-") j++;
      if (j < s.length && !isSpace(s[j]) && s[j] !== ")") out.push({ t: "not" });
      i = j;
    } else {
      const op = OPERATOR_RE.exec(s.slice(i));
      if (op) {
        const name = op[1].toLowerCase() as Operator;
        const at = i + op[0].length;
        let value = "";
        let next = at;
        if (s[at] === '"') [value, next] = quoted(at);
        else if (s[at] !== "(") {
          next = bareEnd(at);
          value = s.slice(at, next);
        }
        out.push({ t: "op", name, value, group: s[at] === "(", raw: s.slice(i, next) });
        i = next;
      } else {
        const next = bareEnd(i);
        const raw = s.slice(i, next);
        // OR is an operator unless negated: "-or" excludes the word.
        const negated = out.length > 0 && out[out.length - 1].t === "not";
        out.push(raw.toLowerCase() === "or" && !negated ? { t: "or" } : { t: "term", raw });
        i = next;
      }
    }
  }
  return out;
}

/** tsquery-safe words: letters (with combining marks), digits, "_" and "-". Anything else splits. */
function toWords(raw: string): string[] {
  return raw
    .split(/[^\p{L}\p{M}\p{N}_-]+/u)
    .map((w) => w.replace(/^[-_]+|[-_]+$/g, ""))
    .filter((w) => /[\p{L}\p{N}]/u.test(w))
    .slice(0, MAX_WORDS);
}

function toValue(op: "file" | "path" | "tag", raw: string): string | null {
  let v = raw.trim();
  // Tags are stored lowercase without "#"; note names and paths are stored without ".md".
  v = op === "tag" ? v.replace(/^#+/, "").replace(/\/+$/, "").toLowerCase() : v.replace(/\.md$/i, "");
  return v.trim() || null;
}

function andNode(nodes: QueryNode[]): QueryNode {
  const flat = nodes.flatMap((n) => (n.type === "and" ? n.children : [n]));
  return flat.length === 1 ? flat[0] : { type: "and", children: flat };
}

function orNode(nodes: QueryNode[]): QueryNode | null {
  const flat = nodes.flatMap((n) => (n.type === "or" ? n.children : [n]));
  if (!flat.length) return null;
  return flat.length === 1 ? flat[0] : { type: "or", children: flat };
}

function notNode(node: QueryNode): QueryNode {
  return node.type === "not" ? node.child : { type: "not", child: node };
}

class Parser {
  private pos = 0;
  private terms = 0;

  constructor(private readonly tokens: Token[]) {}

  /** or := and ("OR" and)* ; and := unary+ . Stops at the ")" that closes the current group. */
  parseOr(mode: Mode, depth: number): QueryNode | null {
    const branches: QueryNode[] = [];
    let current: QueryNode[] = [];
    while (this.pos < this.tokens.length) {
      const tok = this.tokens[this.pos];
      if (tok.t === ")") {
        if (depth > 0) break;
        this.pos++; // stray ")"
        continue;
      }
      if (tok.t === "or") {
        this.pos++;
        if (current.length) branches.push(andNode(current));
        current = [];
        continue;
      }
      const start = this.pos;
      const node = this.parseUnary(mode, depth);
      if (node) current.push(node);
      if (this.pos === start) this.pos++; // always make progress
    }
    if (current.length) branches.push(andNode(current));
    return orNode(branches);
  }

  private parseUnary(mode: Mode, depth: number): QueryNode | null {
    const negated = this.tokens[this.pos].t === "not";
    if (negated) this.pos++;
    const node = this.parsePrimary(mode, depth);
    return node && negated ? notNode(node) : node;
  }

  private parsePrimary(mode: Mode, depth: number): QueryNode | null {
    const tok = this.tokens[this.pos];
    if (!tok || tok.t === ")" || tok.t === "or" || tok.t === "not") return null;
    this.pos++;
    if (tok.t === "(") return this.group(mode, depth);
    if (tok.t === "term") return this.leaf(mode, tok.raw);
    // Operators do not nest: inside file:( ), line:( ) and the like they are plain text.
    if (mode !== "root") return this.leaf(mode, tok.raw);
    let inner: QueryNode | null;
    if (tok.group) {
      this.pos++; // the "(" right after the colon
      inner = this.group(tok.name, depth);
    } else {
      inner = this.leaf(tok.name, tok.value);
    }
    return inner && tok.name === "line" ? { type: "line", child: inner } : inner;
  }

  /** The inside of a group whose "(" was just consumed. */
  private group(mode: Mode, depth: number): QueryNode | null {
    if (depth >= MAX_DEPTH) return null; // too deep: the "(" is dropped and its terms read in place
    const inner = this.parseOr(mode, depth + 1);
    if (this.tokens[this.pos]?.t === ")") this.pos++;
    return inner;
  }

  private leaf(mode: Mode, raw: string): QueryNode | null {
    if (this.terms >= MAX_TERMS) return null;
    let node: QueryNode | null = null;
    if (mode === "root" || mode === "line") {
      const words = toWords(raw);
      if (words.length) node = { type: "text", words };
    } else {
      const value = toValue(mode, raw);
      if (value) node = { type: mode, value };
    }
    if (node) this.terms++;
    return node;
  }
}

/** Parse a search box query into an AST. Returns null when nothing searchable is left. */
export function parseQuery(input: string): QueryNode | null {
  const s = input
    .slice(0, MAX_QUERY_LENGTH)
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cs}]/gu, " "); // control characters (NUL breaks Postgres text) and lone surrogates
  return new Parser(tokenize(s)).parseOr("root", 0);
}

/* ------------------------------------------------------------------ */
/* SQL                                                                 */
/* ------------------------------------------------------------------ */

const tsquery = (source: string) => sql`to_tsquery('simple', ${source})`;
const matches = (source: string) => sql`${note.search} @@ ${tsquery(source)}`;

/** `word:*`, or `(a <-> b <-> c:*)` for a phrase (`join` " & " relaxes it to "all words anywhere"). */
function termSource(words: string[], join = " <-> "): string {
  const parts = words.map((w, i) => (i === words.length - 1 ? `${w}:*` : w));
  return parts.length === 1 ? parts[0] : `(${parts.join(join)})`;
}

function combine(parts: string[], type: "and" | "or"): string {
  return parts.length === 1 ? parts[0] : `(${parts.join(type === "and" ? " & " : " | ")})`;
}

/** tsquery source for a subtree of text terms joined by AND/OR only; null otherwise. */
function textSource(node: QueryNode): string | null {
  if (node.type === "text") return termSource(node.words);
  if (node.type !== "and" && node.type !== "or") return null;
  const parts: string[] = [];
  for (const child of node.children) {
    const s = textSource(child);
    if (s === null) return null;
    parts.push(s);
  }
  return combine(parts, node.type);
}

/** tsquery source for the inside of line:( ), negation included (it applies per line). */
function lineSource(node: QueryNode): string | null {
  switch (node.type) {
    case "text":
      return termSource(node.words);
    case "not": {
      const s = lineSource(node.child);
      return s && `!(${s})`;
    }
    case "and":
    case "or": {
      const parts = node.children.map(lineSource).filter((s): s is string => s !== null);
      return parts.length ? combine(parts, node.type) : null;
    }
    default:
      return null;
  }
}

/**
 * Words a note must contain somewhere for `node` to match (phrases relaxed to AND), so the GIN
 * index can narrow the candidates. null when nothing is guaranteed (e.g. a negated term).
 */
function requiredSource(node: QueryNode): string | null {
  switch (node.type) {
    case "text":
      return termSource(node.words, " & ");
    case "and": {
      const parts = node.children.map(requiredSource).filter((s): s is string => s !== null);
      return parts.length ? combine(parts, "and") : null;
    }
    case "or": {
      const parts = node.children.map(requiredSource);
      return parts.every((s): s is string => s !== null) ? combine(parts as string[], "or") : null;
    }
    default:
      return null;
  }
}

/** The positive text terms (AND/OR kept), for ts_rank and the << >> snippet; null if there are none. */
function highlightSource(node: QueryNode, negated = false): string | null {
  switch (node.type) {
    case "text":
      return negated ? null : termSource(node.words);
    case "not":
      return highlightSource(node.child, !negated);
    case "line":
      return highlightSource(node.child, negated);
    case "and":
    case "or": {
      const parts = node.children.map((c) => highlightSource(c, negated)).filter((s): s is string => s !== null);
      return parts.length ? combine(parts, node.type) : null;
    }
    default:
      return null;
  }
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function lineCondition(child: QueryNode): SQL {
  const perLine = lineSource(child);
  if (!perLine) return sql`true`; // not reachable: the parser only puts text terms in line:( )
  const anyLine = sql`exists (select 1 from string_to_table(${note.content}, chr(10)) as l(line) where to_tsvector('simple', l.line) @@ ${tsquery(perLine)})`;
  const required = requiredSource(child);
  return required ? sql`(${matches(required)} and ${anyLine})` : anyLine;
}

function toCondition(node: QueryNode): SQL {
  switch (node.type) {
    case "text":
      return matches(termSource(node.words));
    case "file":
      return sql`${note.name} ilike ${`%${escapeLike(node.value)}%`}`;
    case "path":
      return sql`${note.path} ilike ${`%${escapeLike(node.value)}%`}`;
    case "tag":
      return sql`exists (select 1 from ${tag} where ${tag.noteId} = ${note.id} and (${tag.tag} = ${node.value} or ${tag.tag} like ${`${escapeLike(node.value)}/%`}))`;
    case "line":
      return lineCondition(node.child);
    case "not":
      return sql`not (${toCondition(node.child)})`;
    case "and":
    case "or": {
      // Text-only children share one tsquery so the GIN index sees a single @@.
      const text: string[] = [];
      const rest: SQL[] = [];
      for (const child of node.children) {
        const s = textSource(child);
        if (s === null) rest.push(toCondition(child));
        else text.push(s);
      }
      const parts = text.length ? [matches(combine(text, node.type)), ...rest] : rest;
      return sql`(${sql.join(parts, node.type === "and" ? sql` and ` : sql` or `)})`;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

/** Search one vault. Up to 50 hits; `snippet` marks matches with << >> and is "" without text terms. */
export async function search(vaultId: string, q: string): Promise<SearchHit[]> {
  const ast = parseQuery(q);
  const scope = eq(note.vaultId, vaultId);
  const where = ast ? and(scope, sql`(${toCondition(ast)})`) : scope;
  const highlight = ast && highlightSource(ast);

  if (!highlight) {
    const rows = await db
      .select({ id: note.id, path: note.path, name: note.name })
      .from(note)
      .where(where)
      .orderBy(asc(note.path))
      .limit(MAX_RESULTS);
    return rows.map((r) => ({ ...r, snippet: "" }));
  }

  const query = tsquery(highlight);
  return db
    .select({
      id: note.id,
      path: note.path,
      name: note.name,
      snippet: sql<string>`ts_headline('simple', ${note.content}, ${query}, 'MaxFragments=2, MaxWords=18, MinWords=6, StartSel=<<, StopSel=>>')`,
    })
    .from(note)
    .where(where)
    .orderBy(desc(sql`ts_rank(${note.search}, ${query})`), asc(note.path))
    .limit(MAX_RESULTS);
}
