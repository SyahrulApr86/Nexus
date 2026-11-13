/**
 * Obsidian callouts as a remark plugin:
 *
 *   > [!warning]+ Optional title
 *   > Body…
 *
 * becomes `<div class="callout" data-callout="warning">` (or `<details>` when the type is
 * followed by `+` (open) or `-` (closed)) with a `callout-title` and a `callout-content`.
 * The title and body stay markdown, so they are sanitised like the rest of the note.
 */

type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
};

export const CALLOUT_TYPES = [
  "note",
  "abstract",
  "info",
  "todo",
  "tip",
  "success",
  "question",
  "warning",
  "failure",
  "danger",
  "bug",
  "example",
  "quote",
] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

const ALIASES: Record<string, CalloutType> = {
  summary: "abstract",
  tldr: "abstract",
  hint: "tip",
  important: "tip",
  check: "success",
  done: "success",
  help: "question",
  faq: "question",
  caution: "warning",
  attention: "warning",
  fail: "failure",
  missing: "failure",
  error: "danger",
  cite: "quote",
};

const MARKER = /^\[!([A-Za-z][\w-]*)\]([+-]?)[ \t]*/;

export function calloutType(raw: string): CalloutType {
  const k = raw.toLowerCase();
  if ((CALLOUT_TYPES as readonly string[]).includes(k)) return k as CalloutType;
  return ALIASES[k] ?? "note";
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const blank = (n: MdNode) => n.type === "text" && !(n.value ?? "").trim();

function transform(bq: MdNode) {
  const first = bq.children?.[0];
  if (!first || first.type !== "paragraph" || !first.children?.length) return;
  const head = first.children[0];
  if (head.type !== "text" || !head.value) return;
  const m = MARKER.exec(head.value);
  if (!m) return;

  const raw = m[1];
  const type = calloutType(raw);
  const fold = m[2];
  const foldable = fold === "+" || fold === "-";

  // Split the first paragraph at its first line break: title before, body after.
  const inline: MdNode[] = [{ ...head, value: head.value.slice(m[0].length) }, ...first.children.slice(1)];
  const title: MdNode[] = [];
  const body: MdNode[] = [];
  let inTitle = true;
  for (const n of inline) {
    if (!inTitle) {
      body.push(n);
      continue;
    }
    if (n.type === "break") {
      inTitle = false;
      continue;
    }
    if (n.type === "text" && n.value?.includes("\n")) {
      const k = n.value.indexOf("\n");
      if (k > 0) title.push({ ...n, value: n.value.slice(0, k) });
      const after = n.value.slice(k + 1);
      if (after) body.push({ ...n, value: after });
      inTitle = false;
      continue;
    }
    title.push(n);
  }

  const titleChildren = title.every(blank) ? [{ type: "text", value: capitalize(raw) }] : title;
  const content: MdNode[] = [];
  if (body.length && !body.every(blank)) content.push({ type: "paragraph", children: body });
  content.push(...(bq.children ?? []).slice(1));

  bq.data = {
    hName: foldable ? "details" : "div",
    hProperties: { className: ["callout"], dataCallout: type, ...(fold === "+" ? { open: true } : {}) },
  };
  const titleNode: MdNode = {
    type: "paragraph",
    children: titleChildren,
    data: { hName: foldable ? "summary" : "div", hProperties: { className: ["callout-title"] } },
  };
  const contentNode: MdNode = {
    type: "blockquote",
    children: content,
    data: { hName: "div", hProperties: { className: ["callout-content"] } },
  };
  bq.children = content.length ? [titleNode, contentNode] : [titleNode];
}

function walk(node: MdNode) {
  for (const child of node.children ?? []) {
    // Generated callout content carries data.hName; never turn it into a callout again.
    if (child.type === "blockquote" && !child.data?.hName) transform(child);
    walk(child); // callouts may nest inside callouts and lists
  }
}

export function remarkCallouts() {
  return (tree: unknown) => walk(tree as MdNode);
}
