/**
 * Obsidian block references: a `^blockid` at the end of a line names the block it ends.
 *
 *   A paragraph that can be linked. ^intro
 *   - A list item ^step-1
 *
 *   | a | b |
 *   |---|---|
 *
 *   ^table          (on its own line: names the block just above)
 *
 * `[[Note#^intro]]` links to the block, `![[Note#^intro]]` embeds it. Pure string functions,
 * shared by the renderer, the embed loader, the editor's "Copy block link" and autocomplete.
 */

import { maskCode, matchHeading, splitFrontmatter } from "./parse";

/** Characters Obsidian allows in a block id. */
export const BLOCK_ID_CHARS = /^[A-Za-z0-9-]+$/;

/** A `^id` at the end of a line: after whitespace, or alone on the line. */
const TRAILING = /(^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/;

/** The id at the end of `line`, or null. */
export function blockIdOf(line: string): string | null {
  return TRAILING.exec(line)?.[2] ?? null;
}

/** `line` without its trailing `^id` (and the space before it). */
export function stripBlockId(line: string): string {
  return line.replace(TRAILING, "");
}

const blank = (s: string) => !s.trim();
const LIST_ITEM = /^(\s*(?:>\s?)*)\s*(?:[-*+]|\d{1,9}[.)])\s+/;
const FENCE = /^\s*(?:>\s?)*\s*(```|~~~)/;
const indentOf = (s: string) => /^[ \t]*/.exec(s)![0].replace(/\t/g, "    ").length;

/** Lines inside code fences and frontmatter: never blocks with ids. */
function codeLines(lines: string[]): boolean[] {
  const out = lines.map(() => false);
  let inFence = false;
  let i = 0;
  if (lines[0] === "---") {
    const end = lines.findIndex((l, k) => k > 0 && (l === "---" || l === "..."));
    if (end > 0) for (; i <= end; i++) out[i] = true;
  }
  for (; i < lines.length; i++) {
    if (FENCE.test(lines[i])) {
      out[i] = true;
      inFence = !inFence;
      continue;
    }
    out[i] = inFence;
  }
  return out;
}

export type BlockInfo = { id: string; line: number; text: string };

/** Every block id in the note, in order, with a short text preview (for autocomplete). */
export function extractBlockIds(md: string): BlockInfo[] {
  const lines = md.split("\n");
  const code = codeLines(lines);
  const out: BlockInfo[] = [];
  const seen = new Set<string>();
  lines.forEach((line, i) => {
    if (code[i]) return;
    const id = blockIdOf(line);
    if (!id || seen.has(id)) return;
    seen.add(id);
    const own = stripBlockId(line).trim();
    // An id alone on its line names the block above: preview that block's last line.
    let text = own;
    for (let k = i - 1; !text && k >= 0; k--) if (!blank(lines[k])) text = lines[k].trim();
    out.push({ id, line: i, text: text.replace(/^(?:>\s?)*\s*(?:[-*+]|\d{1,9}[.)])?\s*(?:\[[ xX]\]\s+)?/, "").slice(0, 80) });
  });
  return out;
}

/** First and last line (inclusive) of the paragraph or quote around `line`. */
function paragraphAround(lines: string[], line: number, code: boolean[]): [number, number] {
  const stop = (k: number) => blank(lines[k]) || code[k] || !!matchHeading(lines[k]);
  let a = line;
  while (a > 0 && !stop(a - 1) && !LIST_ITEM.test(lines[a])) a--;
  let b = line;
  while (b + 1 < lines.length && !stop(b + 1) && !LIST_ITEM.test(lines[b + 1])) b++;
  return [a, b];
}

/** Last line (inclusive) of the list item at `line`: its continuation and more-indented children. */
function listItemEnd(lines: string[], line: number): number {
  const base = indentOf(lines[line]);
  let end = line;
  for (let k = line + 1; k < lines.length; k++) {
    if (blank(lines[k])) {
      // A blank line continues the item only when an indented line follows it.
      const next = lines.slice(k + 1).findIndex((l) => !blank(l));
      if (next === -1 || indentOf(lines[k + 1 + next]) <= base) break;
      continue;
    }
    if (indentOf(lines[k]) <= base && (LIST_ITEM.test(lines[k]) || indentOf(lines[k]) < base + 2)) break;
    end = k;
  }
  return end;
}

/**
 * The markdown of the block named `^id`, its marker included (the renderer hides it), or null.
 * A list item comes with its nested items; a paragraph or quote whole; an id on its own line
 * stands for the block right above it (a table, a quote, a code block).
 */
export function extractBlock(md: string, id: string): string | null {
  const want = id.replace(/^\^/, "").trim();
  if (!BLOCK_ID_CHARS.test(want)) return null;
  const { body } = splitFrontmatter(md);
  const lines = body.split("\n");
  const code = codeLines(lines);
  const at = lines.findIndex((l, i) => !code[i] && blockIdOf(l) === want);
  if (at === -1) return null;
  if (blank(stripBlockId(lines[at]))) {
    let end = at - 1;
    while (end >= 0 && blank(lines[end])) end--;
    if (end < 0) return null;
    let start = end;
    if (code[end]) {
      // A fenced code block: back to its opening fence.
      while (start > 0 && !(FENCE.test(lines[start]) && start !== end)) start--;
    } else {
      while (start > 0 && !blank(lines[start - 1]) && !code[start - 1]) start--;
    }
    return lines.slice(start, end + 1).join("\n");
  }
  if (LIST_ITEM.test(lines[at])) {
    // Only this item and its children; drop the indent they share so it renders as a list.
    const end = listItemEnd(lines, at);
    const cut = indentOf(lines[at]);
    return lines
      .slice(at, end + 1)
      .map((l) => l.slice(Math.min(cut, indentOf(l))))
      .join("\n");
  }
  if (matchHeading(lines[at])) return lines[at];
  const [a, b] = paragraphAround(lines, at, code);
  return lines.slice(a, b + 1).join("\n");
}

export type BlockTarget =
  | { kind: "heading"; text: string }
  | { kind: "block"; id: string | null; line: number }
  | { kind: "none" };

/**
 * What "Copy block link" links to from 0-based `line` of `md`: a heading links by its text; a
 * paragraph, quote or list item links by its id, `line` being where a new ` ^id` goes when it has
 * none (the end of the block). Blank lines, code and frontmatter give "none".
 */
export function blockTargetAt(md: string, line: number): BlockTarget {
  const lines = md.split("\n");
  if (line < 0 || line >= lines.length) return { kind: "none" };
  const code = codeLines(lines);
  if (code[line] || blank(lines[line])) return { kind: "none" };
  const masked = maskCode(lines[line]);
  const h = matchHeading(masked);
  if (h) return { kind: "heading", text: stripBlockId(h.text).trim() };
  let end: number;
  if (LIST_ITEM.test(lines[line])) end = line;
  else {
    // A continuation line of a list item belongs to that item.
    let item = -1;
    for (let k = line - 1; k >= 0 && !blank(lines[k]) && !code[k]; k--)
      if (LIST_ITEM.test(lines[k])) {
        item = k;
        break;
      }
    end = item !== -1 && indentOf(lines[line]) > indentOf(lines[item]) ? item : paragraphAround(lines, line, code)[1];
  }
  return { kind: "block", id: blockIdOf(lines[end]), line: end };
}

/** A fresh, short block id that is not already used in `md`. */
export function newBlockId(md: string, random: () => number = Math.random): string {
  const used = new Set(extractBlockIds(md).map((b) => b.id));
  for (;;) {
    let id = "";
    for (let i = 0; i < 6; i++) id += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(random() * 36)];
    if (!used.has(id)) return id;
  }
}
