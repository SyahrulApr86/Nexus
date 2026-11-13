import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import remarkRehype from "remark-rehype";
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { maskCode, splitFrontmatter } from "./parse";
import { stripComments } from "./comments";
import { blankSpans, scanMath } from "./math";
import { CALLOUT_TYPES, remarkCallouts } from "./callouts";
import { embedLinkMarkdown, isBlockEmbed, rehypeEmbeds } from "./embeds";
import { rehypeReadingView } from "./reading-view";

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
    // Formulas stay as code here; math-client.ts renders them with KaTeX on demand.
    code: [["className", /^language-./, "math-inline", "math-display"]],
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      ["className", "callout", "callout-title", "callout-content"],
      ["dataCallout", ...callouts],
    ],
    details: [["className", "callout"], ["dataCallout", ...callouts], "open"],
    // Source offset of a task's box, so a click toggles that exact task (see tasks.ts).
    li: [...(defaultSchema.attributes?.li ?? []), ["dataTaskOffset", /^\d+$/]],
    summary: [...(defaultSchema.attributes?.summary ?? []), ["className", "callout-title"]],
  },
};

type TaskNode = {
  type: string;
  checked?: boolean | null;
  position?: { start: { offset?: number } };
  data?: { hProperties?: Record<string, unknown> };
  children?: TaskNode[];
};

/**
 * Put each task item's source offset (of its `[ ]` box, in the original note) on the
 * rendered <li>. Rendered order is not source order (footnote definitions move to the
 * end, unused ones vanish), so a click is mapped by this offset, never by position.
 */
function remarkTaskOffsets() {
  return (tree: TaskNode, file: { value: unknown; data: object }) => {
    const text = String(file.value);
    const toSource = (file.data as { toSource?: (pos: number) => number }).toSource;
    if (!toSource) return;
    const walk = (n: TaskNode) => {
      if (n.type === "listItem" && typeof n.checked === "boolean") {
        const start = n.position?.start.offset ?? 0;
        const m = /\[[ xX]\]/.exec(text.slice(start, start + 64));
        if (m) {
          n.data ??= {};
          n.data.hProperties = { ...n.data.hProperties, dataTaskOffset: String(toSource(start + m.index + 1)) };
        }
      }
      n.children?.forEach(walk);
    };
    walk(tree);
  };
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkTaskOffsets)
  .use(remarkCallouts)
  .use(remarkRehype)
  .use(rehypeSanitize, schema)
  // Trusted transforms on the sanitised tree: embed blocks, task labels, image
  // loading and sizes, and dropping protocol-relative links.
  .use(rehypeEmbeds)
  .use(rehypeReadingView)
  .use(rehypeStringify);

// Link text: brackets, backslashes, dollars and "<" are literal (so a note named like a tag shows as text).
const esc = (s: string) => s.replace(/[[\]\\$<]/g, (c) => `\\${c}`);

// Private-use markers that stand for <mark>; user text may not contain them.
const MARK_OPEN = "";
const MARK_CLOSE = "";

/**
 * Turn Obsidian syntax into plain markdown before parsing:
 *   [[Note|Alias]]  -> [Alias](wikilink:Note)
 *   ![[Note]]       -> an embed block when it stands on its own line, otherwise [↳ Note](wikilink:Note)
 *   #tag            -> [#tag](tag:tag)
 *   ==text==        -> <mark>text</mark> (via private-use markers, since raw HTML is stripped)
 *   stray $         -> \$ (only real formulas reach remark-math)
 * Code spans, code blocks and formulas are left untouched.
 */
function preprocess(md: string, exists: (target: string) => boolean): { text: string; toInput: (pos: number) => number } {
  const code = maskCode(md);
  const { escapes, spans } = scanMath(code);
  const blanked = blankSpans(code, spans);
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
    edits.push({ from, to, text: `${MARK_OPEN}${original(from + 2, to - 2)}${MARK_CLOSE}` });
  }

  edits.sort((a, b) => a.from - b.from);
  let out = "";
  let pos = 0;
  // Where each applied edit ends, in output and input coordinates (for toInput).
  const ends: { out: number; src: number }[] = [];
  for (const e of edits) {
    if (e.from < pos) continue; // overlapping, skip
    out += md.slice(pos, e.from) + e.text;
    pos = e.to;
    ends.push({ out: out.length, src: pos });
  }
  // An output offset outside every edit, back in `md` coordinates.
  const toInput = (p: number) => {
    let lo = 0;
    let hi = ends.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ends[mid].out <= p) lo = mid + 1;
      else hi = mid;
    }
    const last = lo ? ends[lo - 1] : { out: 0, src: 0 };
    return p - last.out + last.src;
  };
  return { text: out + md.slice(pos), toInput };
}

export function renderMarkdown(md: string, exists: (target: string) => boolean): string {
  const { yaml, body, offset } = splitFrontmatter(md);
  // Markers typed by the user are removed first, so only our own pairs remain.
  const removed: number[] = [];
  const clean = body.replace(/[]/g, (_, i: number) => {
    removed.push(i);
    return "";
  });
  const { text, toInput } = preprocess(stripComments(clean), exists);
  // Preprocessed offset -> offset in `md` (comments keep their length when blanked).
  const toSource = (p: number) => {
    let i = toInput(p);
    for (const r of removed) if (r <= i) i++;
    return i + offset;
  };
  const html = String(processor.processSync({ value: text, data: { toSource } }));
  const marked = html
    // Mark dangling links (title="ghost" survives sanitize) with a class.
    .replace(/<a href="wikilink:([^"]*)" title="ghost">/g, '<a href="wikilink:$1" class="ghost">')
    // Linear: a marker pair can never contain another marker.
    .replace(/([^]*)/g, "<mark>$1</mark>")
    .replace(/[]/g, "");
  const fm = yaml ? `<div class="frontmatter">${escapeHtml(yaml)}</div>` : "";
  return fm + marked;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
