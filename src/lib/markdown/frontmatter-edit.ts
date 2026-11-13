/**
 * Read and rewrite a note's YAML frontmatter as a list of properties, losslessly.
 *
 * Only a small, safe subset of YAML is understood: top-level `key: scalar`, `key: [a, b]`,
 * `key:` followed by `- item` lines, comments and blank lines. Every entry keeps its source
 * lines; an edit rewrites only the lines of the entry it touches, so comments, ordering,
 * quoting and line endings elsewhere survive. Anything outside the subset is marked
 * read-only and is never rewritten.
 */

import { MAX_FRONTMATTER_CHARS } from "./parse";

export type PropType = "text" | "list" | "number" | "checkbox" | "date" | "datetime";
export type PropValue = string | number | boolean | string[] | null;
export const PROP_TYPES: PropType[] = ["text", "list", "number", "checkbox", "date", "datetime"];

export type Property = {
  key: string;
  /** The inferred type (or the caller's preferred one when the value fits it). */
  type: PropType;
  value: PropValue;
  /** False when the value uses YAML this module cannot rewrite safely. */
  editable: boolean;
  /** The entry's source lines, for showing a read-only value. */
  raw: string;
};

export type TextChange = { from: number; to: number; insert: string };

type Trivia = { kind: "trivia"; lines: string[] };
type Entry = {
  kind: "prop";
  key: string;
  lines: string[];
  value: PropValue;
  type: PropType;
  editable: boolean;
  /** Indent of block list items, kept when the list is rewritten. */
  listIndent?: string;
};
type Item = Trivia | Entry;

type Block = {
  /** The whole block: from the opening `---` to just after the closing delimiter's line break. */
  from: number;
  to: number;
  /** The YAML between the delimiters. */
  yamlFrom: number;
  yamlTo: number;
  eol: "\n" | "\r\n";
  items: Item[];
  /** False when the block as a whole cannot be rewritten (an unknown top-level construct). */
  editable: boolean;
};

/** Keys whose values are always lists, as in Obsidian. */
const LIST_KEYS = new Set(["tags", "aliases", "cssclasses"]);

const BLOCK_RE = /^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)\r?\n?/;
const KEY_RE = /^([^\s#'"?:,[\]{}&*!|>%@`-][^:\r\n]*?)[ \t]*:(?:[ \t]+(.*))?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const NUMBER_RE = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const BOOL_RE = /^(true|false|True|False|TRUE|FALSE)$/;
const NULL_RE = /^(null|Null|NULL|~)$/;

/* ------------------------------------------------------------------ */
/* Scalars                                                             */
/* ------------------------------------------------------------------ */

type Scalar = { text: string; quoted: boolean };

/** Parse one scalar with an optional trailing comment. Null when it is not a simple scalar. */
function readScalar(src: string): Scalar | null {
  const s = src.trim();
  // Nothing, or only a comment (`key: # note`): an empty value.
  if (!s || s[0] === "#") return { text: "", quoted: false };
  if (s[0] === '"') {
    let i = 1;
    for (; i < s.length; i++) {
      if (s[i] === "\\") i++;
      else if (s[i] === '"') break;
    }
    if (i >= s.length || !restIsComment(s.slice(i + 1))) return null;
    try {
      return { text: JSON.parse(s.slice(0, i + 1)) as string, quoted: true };
    } catch {
      return null;
    }
  }
  if (s[0] === "'") {
    let i = 1;
    for (; i < s.length; i++) {
      if (s[i] === "'") {
        if (s[i + 1] === "'") i++;
        else break;
      }
    }
    if (i >= s.length || !restIsComment(s.slice(i + 1))) return null;
    return { text: s.slice(1, i).replace(/''/g, "'"), quoted: true };
  }
  // Block scalars, anchors, aliases, tags, flow maps and directives are out of scope.
  if (/^[|>&*!{%@`]/.test(s)) return null;
  const hash = s.search(/\s#/);
  const plain = (hash === -1 ? s : s.slice(0, hash)).trimEnd();
  if (/:(\s|$)/.test(plain) || plain.startsWith("#")) return null;
  return { text: plain, quoted: false };
}

const restIsComment = (rest: string) => /^\s*(#.*)?$/.test(rest);

/** Items of a one-line flow sequence like `[a, "b, c"]`, or null when it is anything more. */
function readFlowList(src: string): string[] | null {
  const s = src.trim();
  if (s[0] !== "[") return null;
  const items: string[] = [];
  let i = 1;
  for (;;) {
    while (s[i] === " " || s[i] === "\t") i++;
    if (s[i] === "]") break;
    let end = i;
    if (s[i] === '"' || s[i] === "'") {
      const q = s[i];
      end = i + 1;
      for (; end < s.length; end++) {
        if (q === '"' && s[end] === "\\") end++;
        else if (s[end] === q) {
          if (q === "'" && s[end + 1] === "'") end++;
          else break;
        }
      }
      end++;
    } else {
      while (end < s.length && !",]".includes(s[end])) end++;
    }
    const raw = s.slice(i, end).trim();
    if (/^[[{]/.test(raw)) return null;
    const sc = readScalar(raw);
    if (!sc || (!sc.quoted && !sc.text)) return null;
    items.push(sc.text);
    i = end;
    while (s[i] === " " || s[i] === "\t") i++;
    if (s[i] === ",") i++;
    else if (s[i] !== "]") return null;
  }
  return restIsComment(s.slice(i + 1)) ? items : null;
}

/** Does a plain (unquoted) string read back as something other than the same string? */
function looksTyped(s: string) {
  return BOOL_RE.test(s) || NULL_RE.test(s) || /^[-+]?(\d|\.\d)/.test(s) || /^0[xo]/i.test(s) || /^[-+]?\.(inf|nan)$/i.test(s);
}

/**
 * A string as a YAML scalar, quoted only when it has to be. `strict` also quotes strings that
 * would read back as a number, boolean, null or date (text properties keep their type).
 */
export function yamlScalar(s: string, strict = true): string {
  const needs =
    s === "" ||
    /^\s|\s$/.test(s) ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(s) ||
    /:(\s|$)|\s#|[\x00-\x1f\x7f\u2028\u2029]/.test(s) ||
    NULL_RE.test(s) ||
    (strict && looksTyped(s));
  return needs ? JSON.stringify(s) : s;
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

function typeOf(sc: Scalar): { type: PropType; value: PropValue } {
  if (sc.quoted) return { type: "text", value: sc.text };
  const t = sc.text;
  if (!t || NULL_RE.test(t)) return { type: "text", value: null };
  if (BOOL_RE.test(t)) return { type: "checkbox", value: t.toLowerCase() === "true" };
  if (NUMBER_RE.test(t)) return { type: "number", value: Number(t) };
  if (DATE_RE.test(t)) return { type: "date", value: t };
  if (DATETIME_RE.test(t)) return { type: "datetime", value: t };
  return { type: "text", value: t };
}

/** Does `value` fit `type`, so it can be shown with that type's control? */
export function fits(type: PropType, value: PropValue): boolean {
  if (value === null) return true;
  switch (type) {
    case "text":
      return typeof value === "string";
    case "list":
      return Array.isArray(value);
    case "number":
      return typeof value === "number";
    case "checkbox":
      return typeof value === "boolean";
    case "date":
      return typeof value === "string" && DATE_RE.test(value);
    case "datetime":
      return typeof value === "string" && DATETIME_RE.test(value);
  }
}

/** Convert a value for a new type, keeping what carries over. */
export function convertValue(value: PropValue, to: PropType): PropValue {
  if (value === null) return to === "list" ? [] : null;
  const asText = Array.isArray(value) ? value.join(", ") : String(value);
  switch (to) {
    case "text":
      return asText;
    case "list":
      return Array.isArray(value) ? value : asText ? [asText] : [];
    case "number": {
      const n = Number(asText);
      return asText.trim() && Number.isFinite(n) ? n : null;
    }
    case "checkbox":
      return typeof value === "boolean" ? value : asText.trim().toLowerCase() === "true";
    case "date":
      return /^\d{4}-\d{2}-\d{2}/.test(asText) ? asText.slice(0, 10) : null;
    case "datetime":
      return DATETIME_RE.test(asText) ? asText : DATE_RE.test(asText) ? `${asText}T00:00` : null;
  }
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

function finishEntry(e: Entry, rest: string, cont: string[]) {
  if (cont.length === 0) {
    const flow = rest.trim().startsWith("[") ? readFlowList(rest) : undefined;
    if (flow !== undefined) {
      if (flow === null) e.editable = false;
      else {
        e.type = "list";
        e.value = flow;
      }
      return;
    }
    const sc = readScalar(rest);
    if (!sc) {
      e.editable = false;
      e.value = rest.trim();
      return;
    }
    Object.assign(e, typeOf(sc));
    return;
  }
  // Continuation lines: only a block list under an empty value.
  const items: string[] = [];
  let indent: string | undefined;
  const head = readScalar(rest);
  if (!head || head.text || head.quoted) {
    e.editable = false;
    e.value = null;
    return;
  }
  for (const line of cont) {
    const m = /^([ \t]*)-[ \t]+(.*)$/.exec(line);
    const sc = m ? readScalar(m[2]) : null;
    if (!m || (indent !== undefined && m[1] !== indent) || !sc || (!sc.quoted && (!sc.text || /^-(\s|$)/.test(sc.text)))) {
      e.editable = false;
      e.value = null;
      return;
    }
    indent = m[1];
    items.push(sc.text);
  }
  e.type = "list";
  e.value = items;
  e.listIndent = indent;
}

function parseBlock(md: string): Block | null {
  const m = BLOCK_RE.exec(md);
  if (!m) return null;
  const eol = /^---\r\n/.test(md) ? "\r\n" : "\n";
  const yamlFrom = md.indexOf("\n") + 1;
  const yamlTo = yamlFrom + m[1].length;
  const block: Block = { from: 0, to: m[0].length, yamlFrom, yamlTo, eol, items: [], editable: true };
  if (m[1].length > MAX_FRONTMATTER_CHARS) {
    block.editable = false;
    return block;
  }
  const lines = m[1] === "" ? [] : m[1].split(/\r?\n/);
  let cur: { e: Entry; rest: string; cont: string[] } | null = null;
  let trivia: string[] = [];
  const close = () => {
    if (cur) finishEntry(cur.e, cur.rest, cur.cont);
    cur = null;
  };
  const flushTrivia = () => {
    if (trivia.length) block.items.push({ kind: "trivia", lines: trivia });
    trivia = [];
  };
  for (const line of lines) {
    if (/^\s*(#.*)?$/.test(line)) {
      trivia.push(line);
      continue;
    }
    const indented = /^[ \t]/.test(line) || /^-(\s|$)/.test(line);
    if (indented) {
      if (!cur) {
        block.editable = false;
        trivia.push(line);
        continue;
      }
      const c = cur as { e: Entry; rest: string; cont: string[] };
      if (trivia.length) {
        // A comment or blank line inside a value: keep it, but do not rewrite that value.
        c.e.lines.push(...trivia);
        c.e.editable = false;
        trivia = [];
      }
      c.e.lines.push(line);
      c.cont.push(line);
      continue;
    }
    const kv = KEY_RE.exec(line);
    close();
    flushTrivia();
    if (!kv) {
      block.editable = false;
      block.items.push({ kind: "trivia", lines: [line] });
      continue;
    }
    const e: Entry = { kind: "prop", key: kv[1], lines: [line], value: null, type: "text", editable: true };
    block.items.push(e);
    cur = { e, rest: kv[2] ?? "", cont: [] };
  }
  close();
  flushTrivia();
  // Duplicate keys mean the YAML is ambiguous: show it, never rewrite it.
  const seen = new Set<string>();
  for (const it of block.items) {
    if (it.kind !== "prop") continue;
    if (seen.has(it.key)) block.editable = false;
    seen.add(it.key);
  }
  return block;
}

/* ------------------------------------------------------------------ */
/* Public reading API                                                  */
/* ------------------------------------------------------------------ */

/** The frontmatter block's offsets, from the opening `---` to after the closing line break. */
export function frontmatterRange(md: string): { from: number; to: number } | null {
  const m = BLOCK_RE.exec(md);
  return m ? { from: 0, to: m[0].length } : null;
}

/** The raw frontmatter block (delimiters included), or "" when there is none. */
export function frontmatterSource(md: string): string {
  const m = BLOCK_RE.exec(md);
  return m ? m[0] : "";
}

export type Properties = {
  /** The note has a frontmatter block. */
  exists: boolean;
  /** The block can be rewritten. When false, every property is read-only. */
  editable: boolean;
  properties: Property[];
};

/**
 * The note's properties, in source order. `preferred` maps keys to the type the person picked
 * (like Obsidian's types.json); it applies when the value fits that type.
 */
export function readProperties(md: string, preferred: Record<string, PropType> = {}): Properties {
  const b = parseBlock(md);
  if (!b) return { exists: false, editable: true, properties: [] };
  const properties = b.items
    .filter((it): it is Entry => it.kind === "prop")
    .map((e) => {
      let type = e.type;
      let value = e.value;
      const want = Object.prototype.hasOwnProperty.call(preferred, e.key) ? preferred[e.key] : LIST_KEYS.has(e.key.toLowerCase()) ? "list" : undefined;
      if (e.editable && want && want !== type) {
        if (fits(want, value)) type = want;
        else if (want === "list" && typeof value === "string") {
          // `tags: one` reads as a one-item list, as in Obsidian.
          type = "list";
          value = [value];
        }
      }
      if (e.editable && value === null) value = type === "list" ? [] : null;
      return { key: e.key, type, value, editable: b.editable && e.editable, raw: e.lines.join("\n") };
    });
  return { exists: true, editable: b.editable, properties };
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

/** The source lines of one property. */
export function propertyLines(key: string, type: PropType, value: PropValue, listIndent = "  "): string[] {
  if (type === "list") {
    const items = Array.isArray(value) ? value : value === null || value === "" ? [] : [String(value)];
    if (!items.length) return [`${key}: []`];
    return [`${key}:`, ...items.map((it) => `${listIndent}- ${yamlScalar(it, false)}`)];
  }
  if (value === null || value === "" || (Array.isArray(value) && !value.length)) return [`${key}:`];
  const v = Array.isArray(value) ? value.join(", ") : value;
  switch (type) {
    case "number":
      return typeof v === "number" && Number.isFinite(v) ? [`${key}: ${v}`] : [`${key}: ${yamlScalar(String(v))}`];
    case "checkbox":
      return [`${key}: ${v === true || v === "true" ? "true" : "false"}`];
    case "date":
      return [`${key}: ${DATE_RE.test(String(v)) ? v : yamlScalar(String(v))}`];
    case "datetime":
      return [`${key}: ${DATETIME_RE.test(String(v)) ? v : yamlScalar(String(v))}`];
    default:
      return [`${key}: ${yamlScalar(String(v))}`];
  }
}

/** A key that can be written as a plain YAML key, or a sentence saying why not. */
export function keyProblem(key: string, existing: string[] = []): string | null {
  const k = key.trim();
  if (!k) return "Enter a property name.";
  if (/[:#\r\n]/.test(k)) return "Property names can’t contain “:” or “#”.";
  if (/^[\s'"?,[\]{}&*!|>%@`-]/.test(k)) return "Start the name with a letter or a number.";
  if (existing.some((e) => e === k)) return `A property named “${k}” already exists.`;
  return null;
}

function write(md: string, b: Block, items: Item[]): string {
  if (!items.some((it) => it.kind === "prop" || it.lines.some((l) => l.trim()))) {
    // Nothing left but blank lines: drop the block.
    return md.slice(b.to);
  }
  const yaml = items.flatMap((it) => it.lines).join(b.eol);
  return md.slice(0, b.yamlFrom) + yaml + md.slice(b.yamlTo);
}

const eolOf = (md: string): "\n" | "\r\n" => (/\r\n/.test(md) ? "\r\n" : "\n");

/** A new block in front of the note, replacing an empty `---`/`---` pair if the note starts with one. */
function prepend(md: string, lines: string[]): string {
  const eol = eolOf(md);
  const body = md.replace(/^---\r?\n---(\r?\n|$)/, "");
  return `---${eol}${lines.join(eol)}${eol}---${eol}${body}`;
}

/** Set a property's value (and type), adding it at the end when it is new. Unsafe YAML is left alone. */
export function setProperty(md: string, key: string, value: PropValue, type: PropType): string {
  const b = parseBlock(md);
  if (!b) return prepend(md, propertyLines(key, type, value));
  if (!b.editable) return md;
  const i = b.items.findIndex((it) => it.kind === "prop" && it.key === key);
  const items = [...b.items];
  if (i === -1) {
    items.push({ kind: "prop", key, lines: propertyLines(key, type, value), value, type, editable: true });
    return write(md, b, trailingTriviaLast(items));
  }
  const e = items[i] as Entry;
  if (!e.editable) return md;
  const lines = propertyLines(key, type, value, e.listIndent);
  // A comment after a one-line value (`status: draft # still moving`) stays with it.
  const note = e.lines.length === 1 ? trailingComment(e.lines[0], e.key) : "";
  if (note) lines[0] += note;
  items[i] = { ...e, lines };
  return write(md, b, items);
}

/** The ` # comment` after a one-line value (with its leading space), or "". */
function trailingComment(line: string, key: string): string {
  const rest = line.slice(line.indexOf(":", key.length) + 1);
  const s = rest.trimStart();
  let from = rest.length - s.length;
  if (s[0] === '"' || s[0] === "'") {
    const q = s[0];
    let i = 1;
    for (; i < s.length; i++) {
      if (q === '"' && s[i] === "\\") i++;
      else if (s[i] === q) {
        if (q === "'" && s[i + 1] === "'") i++;
        else break;
      }
    }
    from += i + 1;
  } else if (s[0] === "[") {
    const close = s.lastIndexOf("]");
    if (close === -1) return "";
    from += close + 1;
  }
  const m = /\s#.*$/.exec(rest.slice(from));
  return m ? m[0] : "";
}

/** Blank lines that ended the block stay at the end after an append. */
function trailingTriviaLast(items: Item[]): Item[] {
  const added = items[items.length - 1];
  const before = items[items.length - 2];
  if (before?.kind === "trivia" && before.lines.every((l) => !l.trim())) {
    return [...items.slice(0, -2), added, before];
  }
  return items;
}

/** Rename a property, keeping its value lines. Fails (returns `md`) when the new key is taken or invalid. */
export function renameProperty(md: string, from: string, to: string): string {
  const k = to.trim();
  const b = parseBlock(md);
  if (!b || !b.editable || from === k) return md;
  const keys = b.items.flatMap((it) => (it.kind === "prop" ? [it.key] : []));
  if (keyProblem(k, keys)) return md;
  const items = b.items.map((it) => {
    if (it.kind !== "prop" || it.key !== from) return it;
    const [first, ...rest] = it.lines;
    return { ...it, key: k, lines: [k + first.slice(it.key.length), ...rest] };
  });
  return write(md, b, items);
}

/** Remove a property and its lines. Removing the last one removes the block. */
export function removeProperty(md: string, key: string): string {
  const b = parseBlock(md);
  if (!b || !b.editable) return md;
  const items = b.items.filter((it) => it.kind !== "prop" || it.key !== key);
  if (items.length === b.items.length) return md;
  return write(md, b, items);
}

/**
 * Merge a template's frontmatter into a note's: template keys the note lacks are added with
 * their source lines; keys the note already has keep the note's value.
 */
export function mergeFrontmatter(md: string, template: string): string {
  const t = parseBlock(template);
  if (!t) return md;
  const add = t.items.filter((it): it is Entry => it.kind === "prop");
  if (!add.length) return md;
  const b = parseBlock(md);
  if (!b) return prepend(md, add.flatMap((e) => e.lines));
  if (!b.editable) return md;
  const have = new Set(b.items.flatMap((it) => (it.kind === "prop" ? [it.key] : [])));
  const fresh = add.filter((e) => !have.has(e.key));
  if (!fresh.length) return md;
  let items: Item[] = [...b.items];
  for (const e of fresh) items = trailingTriviaLast([...items, e]);
  return write(md, b, items);
}

/** The smallest single edit that turns `a` into `b`. */
export function diffText(a: string, b: string): TextChange {
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  let end = 0;
  while (end < max - start && a.charCodeAt(a.length - 1 - end) === b.charCodeAt(b.length - 1 - end)) end++;
  return { from: start, to: a.length - end, insert: b.slice(start, b.length - end) };
}
