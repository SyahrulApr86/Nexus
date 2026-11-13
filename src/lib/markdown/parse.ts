/**
 * Lightweight, dependency-free extraction of Obsidian-style metadata.
 * Shared by server (indexing) and client (outline, autocomplete).
 */

export type WikiLink = {
  raw: string; // full "[[...]]" text
  target: string; // note name/path as written, no heading/alias
  heading?: string;
  alias?: string;
  embed: boolean;
  from: number;
  to: number;
};

export type Heading = { level: number; text: string; line: number };

const FENCE_RE = /^(```|~~~)/;

/** Replace fenced + inline code with spaces so offsets stay stable. */
export function maskCode(md: string): string {
  const lines = md.split("\n");
  let inFence = false;
  const out = lines.map((line) => {
    if (FENCE_RE.test(line.trimStart())) {
      inFence = !inFence;
      return " ".repeat(line.length);
    }
    if (inFence) return " ".repeat(line.length);
    return line.replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length));
  });
  return out.join("\n");
}

export function splitFrontmatter(md: string): { yaml: string | null; body: string; offset: number } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (!m) return { yaml: null, body: md, offset: 0 };
  return { yaml: m[1], body: md.slice(m[0].length), offset: m[0].length };
}

/** Minimal YAML subset: `key: value`, `key: [a, b]`, and `key:\n  - a`. Enough for tags/aliases. */
export function parseFrontmatter(yaml: string | null): Record<string, unknown> {
  if (!yaml) return {};
  // Null prototype: a `__proto__:` or `constructor:` key stays an ordinary field.
  const out: Record<string, unknown> = Object.create(null);
  let listKey: string | null = null;
  for (const raw of yaml.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "");
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (out[listKey] as unknown[]).push(unquote(item[1]));
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, val] = kv;
    if (val === "") {
      out[key] = [];
      listKey = key;
    } else if (/^\[.*\]$/.test(val)) {
      out[key] = val
        .slice(1, -1)
        .split(",")
        .map((s) => unquote(s.trim()))
        .filter(Boolean);
      listKey = null;
    } else {
      out[key] = unquote(val);
      listKey = null;
    }
  }
  return out;
}

function unquote(s: string): string {
  return s.replace(/^["'](.*)["']$/, "$1");
}

const WIKILINK_RE = /(!?)\[\[([^\[\]\n]+?)\]\]/g;

export function extractWikiLinks(md: string): WikiLink[] {
  const masked = maskCode(md);
  const links: WikiLink[] = [];
  for (const m of masked.matchAll(WIKILINK_RE)) {
    const inner = m[2];
    const [targetPart, alias] = splitOnce(inner, "|");
    const [target, heading] = splitOnce(targetPart, "#");
    links.push({
      raw: m[0],
      target: target.trim(),
      heading: heading?.trim() || undefined,
      alias: alias?.trim() || undefined,
      embed: m[1] === "!",
      from: m.index!,
      to: m.index! + m[0].length,
    });
  }
  return links;
}

function splitOnce(s: string, sep: string): [string, string | undefined] {
  const i = s.indexOf(sep);
  return i === -1 ? [s, undefined] : [s.slice(0, i), s.slice(i + 1)];
}

// #tag, #nested/tag — not headings ("# "), not inside words, not pure numbers.
const TAG_RE = /(^|[\s(])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;

export function extractTags(md: string): string[] {
  const { yaml, body } = splitFrontmatter(md);
  const fm = parseFrontmatter(yaml);
  const tags = new Set<string>();
  const fmTags = fm.tags ?? fm.tag;
  if (Array.isArray(fmTags)) fmTags.forEach((t) => tags.add(String(t).replace(/^#/, "").toLowerCase()));
  else if (typeof fmTags === "string")
    fmTags.split(/[,\s]+/).filter(Boolean).forEach((t) => tags.add(t.replace(/^#/, "").toLowerCase()));
  const masked = maskCode(body);
  for (const m of masked.matchAll(TAG_RE)) tags.add(m[2].toLowerCase());
  return [...tags];
}

/**
 * An ATX heading line as { level, text }, or null. Linear time: the optional closing
 * #s are trimmed with string operations instead of a backtracking pattern.
 */
export function matchHeading(line: string): { level: number; text: string } | null {
  const m = /^(#{1,6})[ \t]+(.+)$/.exec(line);
  if (!m) return null;
  const text = m[2].trimEnd().replace(/(?<=\s)#+$/, "").trimEnd();
  return text ? { level: m[1].length, text } : null;
}

export function extractHeadings(md: string): Heading[] {
  const masked = maskCode(md);
  const out: Heading[] = [];
  masked.split("\n").forEach((line, i) => {
    const h = matchHeading(line);
    if (h) out.push({ ...h, line: i });
  });
  return out;
}

/** Normalized key for resolving links: last path segment, no .md, lowercase. */
export function linkKey(target: string): string {
  const noExt = target.replace(/\.md$/i, "");
  return noExt.toLowerCase().trim();
}

export function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/** Clean a user-typed note path: trim, collapse slashes, strip .md and illegal chars. */
export function normalizePath(p: string): string {
  return p
    .replace(/\\/g, "/")
    .split("/")
    .map((s) => s.trim().replace(/[<>:"|?*\x00-\x1f]/g, ""))
    .filter((s) => s && s !== "." && s !== "..")
    .join("/")
    .replace(/\.md$/i, "");
}
