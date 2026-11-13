import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkRehype from "remark-rehype";
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { maskCode, splitFrontmatter } from "./parse";

const schema: SanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), "wikilink", "tag"],
  },
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), ["className", "ghost"]],
  },
};

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkRehype)
  .use(rehypeSanitize, schema)
  .use(rehypeStringify);

const esc = (s: string) => s.replace(/[[\]\\]/g, (c) => `\\${c}`);

/**
 * Turn Obsidian syntax into plain markdown links before parsing:
 *   [[Note|Alias]] -> [Alias](wikilink:Note)
 *   ![[Note]]      -> [↳ Note](wikilink:Note)   (transclusion: later phase)
 *   #tag           -> [#tag](tag:tag)
 *   ==text==       -> <mark>text</mark> (via private-use markers, since raw HTML is stripped)
 * Code spans/blocks are left untouched.
 */
function preprocess(md: string, exists: (target: string) => boolean): string {
  const masked = maskCode(md);
  const edits: { from: number; to: number; text: string }[] = [];

  for (const m of masked.matchAll(/(!?)\[\[([^\[\]\n]+?)\]\]/g)) {
    const [targetPart, alias] = m[2].split("|");
    const [target, heading] = targetPart.split("#");
    const label = alias ?? (heading ? `${target}${target ? " › " : ""}${heading}` : target);
    const href = `wikilink:${encodeURIComponent(target.trim())}${heading ? `#${encodeURIComponent(heading)}` : ""}`;
    const ghost = target.trim() && !exists(target.trim());
    const text = `[${m[1] ? "↳ " : ""}${esc(label.trim())}](${href}${ghost ? ' "ghost"' : ""})`;
    edits.push({ from: m.index!, to: m.index! + m[0].length, text });
  }
  for (const m of masked.matchAll(/(^|[\s(])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu)) {
    const start = m.index! + m[1].length;
    edits.push({ from: start, to: start + 1 + m[2].length, text: `[#${m[2]}](tag:${encodeURIComponent(m[2])})` });
  }
  for (const m of masked.matchAll(/==([^=\n]+)==/g)) {
    edits.push({ from: m.index!, to: m.index! + m[0].length, text: `\uE000${m[1]}\uE001` });
  }

  edits.sort((a, b) => a.from - b.from);
  let out = "";
  let pos = 0;
  for (const e of edits) {
    if (e.from < pos) continue; // overlapping, skip
    out += md.slice(pos, e.from) + e.text;
    pos = e.to;
  }
  return out + md.slice(pos);
}

export function renderMarkdown(md: string, exists: (target: string) => boolean): string {
  const { yaml, body } = splitFrontmatter(md);
  const html = String(processor.processSync(preprocess(body, exists)));
  // Mark dangling links (title="ghost" survives sanitize) with a class.
  const marked = html
    .replace(/<a href="wikilink:([^"]*)" title="ghost">/g, '<a href="wikilink:$1" class="ghost">')
    .replace(/\uE000([\s\S]*?)\uE001/g, "<mark>$1</mark>");
  const fm = yaml ? `<div class="frontmatter">${escapeHtml(yaml)}</div>` : "";
  return fm + marked;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
