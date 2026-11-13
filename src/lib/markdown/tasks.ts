import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import { stripComments } from "./comments";
import { splitFrontmatter } from "./parse";

type MdNode = {
  type: string;
  checked?: boolean | null;
  position?: { start: { offset?: number } };
  children?: MdNode[];
};

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkFrontmatter, ["yaml"]);

/**
 * Source offsets of every task box (`[ ]` / `[x]`), in the order the reading view
 * renders checkboxes. Uses the same markdown parse as the renderer, on the note with
 * comments blanked (same length), so tasks in callouts, quotes and nested lists line
 * up, and tasks inside comments or code never count.
 */
export function taskOffsets(md: string): number[] {
  // Comments are blanked in the body only, as the renderer does: a `%%` in frontmatter
  // must not hide the tasks below it. Comments keep their length, so offsets hold.
  // The renderer also drops the private-use <mark> markers (U+E000, U+E001) from the body
  // before parsing, so `- [\uE000 ] a` renders as a task; drop them the same way and map
  // each offset back, so every rendered checkbox has a source offset that toggles it.
  const { offset } = splitFrontmatter(md);
  const removed: number[] = [];
  const body = md.slice(offset).replace(/[\uE000\uE001]/g, (_, i: number) => {
    removed.push(i);
    return "";
  });
  const text = md.slice(0, offset) + stripComments(body);
  const toSource = (p: number) => {
    let i = p - offset;
    for (const r of removed) if (r <= i) i++;
    return i + offset;
  };
  const tree = parser.parse(text) as unknown as MdNode;
  const out: number[] = [];
  const walk = (n: MdNode) => {
    if (n.type === "listItem" && typeof n.checked === "boolean") {
      const start = n.position?.start.offset ?? 0;
      const m = /\[[ xX]\]/.exec(text.slice(start, start + 64));
      if (m) out.push(toSource(start + m.index + 1));
    }
    n.children?.forEach(walk);
  };
  walk(tree);
  return out;
}

/** Flip the nth rendered task box in the source; unchanged when there is no such task. */
export function toggleTask(md: string, nth: number): string {
  const at = taskOffsets(md)[nth];
  if (at === undefined) return md;
  return md.slice(0, at) + (md[at] === " " ? "x" : " ") + md.slice(at + 1);
}

/**
 * Flip the task box at source offset `at` (the `data-task-offset` the reading view puts
 * on each task item). Unchanged unless `at` is a real task box in `md`, so a stale or
 * forged offset can never edit other text.
 */
export function toggleTaskAt(md: string, at: number): string {
  if (!Number.isInteger(at) || !taskOffsets(md).includes(at)) return md;
  return md.slice(0, at) + (md[at] === " " ? "x" : " ") + md.slice(at + 1);
}
