import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import remarkRehype from "remark-rehype";
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import rehypeStringify from "rehype-stringify";
import { maskCode, splitFrontmatter } from "./parse";
import { stripComments } from "./comments";
import { scanMath } from "./math";
import { CALLOUT_TYPES, remarkCallouts } from "./callouts";
import { embedLinkMarkdown, isBlockEmbed, rehypeEmbeds } from "./embeds";

const callouts = [...CALLOUT_TYPES];

const schema: SanitizeSchema = {
  ...defaultSchema,
  // remark-rehype already prefixes footnote ids with "user-content-"; a second prefix
  // here broke every footnote link. Raw HTML is dropped before sanitising, so every
  // id comes from generated markup.
  clobberPrefix: "",
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), "wikilink", "tag", "embed"],
  },
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), ["className", "ghost", "data-footnote-backref"]],
    code: [["className", /^language-./, "math-inline", "math-display"]],
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      ["className", "callout", "callout-title", "callout-content"],
      ["dataCallout", ...callouts],
    ],
    details: [["className", "callout"], ["dataCallout", ...callouts], "open"],
    summary: [...(defaultSchema.attributes?.summary ?? []), ["className", "callout-title"]],
  },
};

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkCallouts)
  .use(remarkRehype)
  .use(rehypeSanitize, schema)
  // Trusted transforms run after sanitising: embed blocks from sanitised links, and
  // KaTeX (trust off, so \href, \url and \html* stay disabled).
  .use(rehypeEmbeds)
  .use(rehypeKatex, { trust: false, strict: "warn", maxSize: 20, maxExpand: 500, errorColor: "var(--negative)" })
  .use(rehypeStringify);

// Link text: brackets, backslashes, dollars and "<" are literal (so a note named like a tag shows as text).
const esc = (s: string) => s.replace(/[[\]\\$<]/g, (c) => `\\${c}`);

/**
 * Turn Obsidian syntax into plain markdown before parsing:
 *   [[Note|Alias]]  -> [Alias](wikilink:Note)
 *   ![[Note]]       -> an embed block when alone on its line, otherwise [↳ Note](wikilink:Note)
 *   #tag            -> [#tag](tag:tag)
 *   ==text==        -> <mark>text</mark> (via private-use markers, since raw HTML is stripped)
 *   stray $         -> \$ (only real formulas reach remark-math)
 * Code spans, code blocks and formulas are left untouched.
 */
function preprocess(md: string, exists: (target: string) => boolean): string {
  const { escapes, blanked } = scanMath(maskCode(md));
  const stray = new Set(escapes);
  // Original text of a range, with stray dollars escaped (formulas stay intact).
  const original = (from: number, to: number) => {
    let out = "";
    for (let i = from; i < to; i++) out += stray.has(i) ? "\\$" : md[i];
    return out;
  };
  const edits: { from: number; to: number; text: string }[] = escapes.map((i) => ({ from: i, to: i + 1, text: "\\$" }));

  for (const m of blanked.matchAll(/(!?)\[\[([^\[\]\n]+?)\]\]/g)) {
    const from = m.index!;
    const to = from + m[0].length;
    const inner = md.slice(from + m[1].length + 2, to - 2);
    const [targetPart, alias] = inner.split("|");
    const [target, heading] = targetPart.split("#");
    const label = alias ?? (heading ? `${target}${target ? " › " : ""}${heading}` : target);
    const ghost = !!target.trim() && !exists(target.trim());
    if (m[1] && target.trim() && isBlockEmbed(md, from, to, target)) {
      edits.push({ from, to, text: embedLinkMarkdown(`↳ ${esc(label.trim())}`, targetPart.trim(), ghost) });
      continue;
    }
    const href = `wikilink:${encodeURIComponent(target.trim())}${heading ? `#${encodeURIComponent(heading)}` : ""}`;
    const text = `[${m[1] ? "↳ " : ""}${esc(label.trim())}](${href}${ghost ? ' "ghost"' : ""})`;
    edits.push({ from, to, text });
  }
  for (const m of blanked.matchAll(/(^|[\s(])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu)) {
    const start = m.index! + m[1].length;
    edits.push({ from: start, to: start + 1 + m[2].length, text: `[#${m[2]}](tag:${encodeURIComponent(m[2])})` });
  }
  for (const m of blanked.matchAll(/==([^=\n]+)==/g)) {
    const from = m.index!;
    const to = from + m[0].length;
    edits.push({ from, to, text: `${original(from + 2, to - 2)}` });
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
  const html = String(processor.processSync(preprocess(stripComments(body), exists)));
  // Mark dangling links (title="ghost" survives sanitize) with a class.
  const marked = html
    .replace(/<a href="wikilink:([^"]*)" title="ghost">/g, '<a href="wikilink:$1" class="ghost">')
    .replace(/([\s\S]*?)/g, "<mark>$1</mark>");
  const fm = yaml ? `<div class="frontmatter">${escapeHtml(yaml)}</div>` : "";
  return fm + marked;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
