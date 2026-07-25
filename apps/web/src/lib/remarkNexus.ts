/**
 * Remark plugin rendering [[wikilinks]] (FR-011/012) and #tags (FR-017).
 * Operates on mdast text nodes only — code blocks and inline code are
 * separate node types, so exclusion (US4-S6) falls out naturally and matches
 * the shared parser's semantics.
 */

const WIKILINK = /\[\[([^\][]+)\]\]/g;
const TAG = /(?<![\p{L}\p{N}_#])#([\p{L}\p{N}_-]+)/gu;

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: Record<string, unknown>;
  url?: string;
}

interface Segment {
  start: number;
  end: number;
  node: MdNode;
}

function wikilinkNode(title: string, resolved: boolean): MdNode {
  return {
    type: "link",
    url: "#",
    data: {
      hProperties: {
        className: resolved ? "wikilink" : "wikilink wikilink-broken",
        "data-wikilink": title,
        "data-broken": resolved ? undefined : "true",
      },
    },
    children: [{ type: "text", value: title }],
  };
}

function tagNode(name: string): MdNode {
  return {
    type: "link",
    url: "#",
    data: {
      hName: "span",
      hProperties: { className: "tag-chip", "data-tag": name },
    },
    children: [{ type: "text", value: `#${name}` }],
  };
}

function splitText(
  value: string,
  resolve: (title: string) => boolean,
): MdNode[] {
  const segments: Segment[] = [];
  for (const m of value.matchAll(WIKILINK)) {
    const title = m[1]!.trim();
    if (!title) continue;
    segments.push({
      start: m.index,
      end: m.index + m[0].length,
      node: wikilinkNode(title, resolve(title)),
    });
  }
  for (const m of value.matchAll(TAG)) {
    const inside = segments.some(
      (s) => m.index >= s.start && m.index < s.end,
    );
    if (!inside) {
      segments.push({
        start: m.index,
        end: m.index + m[0].length,
        node: tagNode(m[1]!),
      });
    }
  }
  if (segments.length === 0) return [{ type: "text", value }];
  segments.sort((a, b) => a.start - b.start);
  const out: MdNode[] = [];
  let cursor = 0;
  for (const seg of segments) {
    if (seg.start > cursor) {
      out.push({ type: "text", value: value.slice(cursor, seg.start) });
    }
    out.push(seg.node);
    cursor = seg.end;
  }
  if (cursor < value.length) {
    out.push({ type: "text", value: value.slice(cursor) });
  }
  return out;
}

function walk(node: MdNode, resolve: (title: string) => boolean): void {
  if (!node.children) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && child.value) {
      next.push(...splitText(child.value, resolve));
    } else {
      walk(child, resolve);
      next.push(child);
    }
  }
  node.children = next;
}

export function remarkNexus(options: {
  resolve: (title: string) => boolean;
}) {
  return () => (tree: MdNode) => {
    walk(tree, options.resolve);
  };
}
