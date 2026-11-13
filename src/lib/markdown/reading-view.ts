/**
 * Trusted hast transforms that run after sanitising:
 * - task list items: the checkbox and its inline text go in a <label>, so each box is
 *   named by its own text and the text is clickable (nested lists stay outside);
 * - images load lazily, and Obsidian's `![alt|300]` / `![alt|300x200]` set the size;
 * - protocol-relative links (`//host`, `\\host`) lose their href, so a click can never
 *   navigate the app to another origin.
 */

type HNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HNode[];
};

const BLOCK = new Set(["ul", "ol", "p", "div", "blockquote", "pre", "table", "details", "section"]);

function classes(n: HNode): string[] {
  const c = n.properties?.className;
  return Array.isArray(c) ? (c as string[]) : [];
}

function labelTask(li: HNode) {
  const host =
    li.children?.find((c) => c.type === "element" && c.tagName === "p" && c.children?.some((k) => k.tagName === "input")) ?? li;
  const kids = host.children ?? [];
  const at = kids.findIndex((c) => c.type === "element" && c.tagName === "input");
  if (at === -1) return;
  let end = at + 1;
  while (end < kids.length && !(kids[end].type === "element" && BLOCK.has(kids[end].tagName ?? ""))) end++;
  const label: HNode = { type: "element", tagName: "label", properties: {}, children: kids.slice(at, end) };
  host.children = [...kids.slice(0, at), label, ...kids.slice(end)];
}

function sizeImage(img: HNode) {
  const p = (img.properties ??= {});
  p.loading = "lazy";
  p.decoding = "async";
  const alt = typeof p.alt === "string" ? p.alt : "";
  const m = /\|(\d{1,5})(?:x(\d{1,5}))?$/.exec(alt);
  if (!m) return;
  p.alt = alt.slice(0, m.index).trim();
  p.width = Number(m[1]);
  if (m[2]) p.height = Number(m[2]);
}

export function rehypeReadingView() {
  const visit = (n: HNode) => {
    if (n.type === "element") {
      if (n.tagName === "li" && classes(n).includes("task-list-item")) labelTask(n);
      else if (n.tagName === "img") sizeImage(n);
      else if (n.tagName === "a") {
        const href = String(n.properties?.href ?? "");
        if (/^\s*[/\\]{2}/.test(href)) delete n.properties!.href;
      }
    }
    n.children?.forEach(visit);
  };
  return (tree: unknown) => visit(tree as HNode);
}
