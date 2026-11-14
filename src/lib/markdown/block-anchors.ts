/**
 * Block ids in rendered notes. The preprocessor (render.ts) turns a trailing `^id` into
 * BLOCK_OPEN id BLOCK_CLOSE; after sanitising, this plugin removes those markers from the text and
 * puts `data-block="id"` on the block that holds them (paragraph, list item, heading, cell…). A
 * paragraph left empty (an id on its own line) is dropped and its id moves to the block above it.
 * The id is never shown, but heading and block links can find their target by it.
 */

export const BLOCK_OPEN = "";
export const BLOCK_CLOSE = "";
const MARKER = /[ \t]*([A-Za-z0-9-]+)/g;

type HNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HNode[];
};

const HOLDERS = new Set(["p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th", "blockquote", "summary", "div", "details", "dd", "dt"]);

const isBlank = (n: HNode): boolean =>
  (n.type === "text" && !(n.value ?? "").trim()) || (n.type === "element" && n.tagName === "br");

export function rehypeBlockIds() {
  /** Strips markers under `node`; returns the ids found that no holder inside it claimed. */
  const visit = (node: HNode): string[] => {
    const loose: string[] = [];
    const kids = node.children;
    if (!kids) return loose;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (k.type === "text" && k.value?.includes(BLOCK_OPEN)) {
        k.value = k.value.replace(MARKER, (_m, id: string) => {
          loose.push(id);
          return "";
        });
        continue;
      }
      if (k.type !== "element") continue;
      const ids = visit(k);
      if (!ids.length) continue;
      if (HOLDERS.has(k.tagName ?? "")) {
        if (k.tagName === "p" && (k.children ?? []).every(isBlank)) {
          // `^id` alone on its line: the id belongs to the block before this paragraph.
          kids.splice(i, 1);
          i--;
          let prev = i;
          while (prev >= 0 && kids[prev].type !== "element") prev--;
          if (prev >= 0) (kids[prev].properties ??= {}).dataBlock = ids[0];
          else loose.push(...ids);
          continue;
        }
        (k.properties ??= {}).dataBlock = ids[0];
      } else loose.push(...ids);
    }
    return loose;
  };
  return (tree: unknown) => {
    visit(tree as HNode);
  };
}
