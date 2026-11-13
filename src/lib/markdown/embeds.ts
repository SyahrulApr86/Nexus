/**
 * Note embeds (`![[Note]]`, `![[Note#Heading]]`).
 *
 * At render time an embed that stands alone on its line becomes a placeholder block:
 *   <div class="embed" data-embed="Note#Heading">
 *     <a class="embed-title" href="wikilink:Note#Heading">Note › Heading</a>
 *     <div class="embed-body">Loading…</div>
 *   </div>
 * which the reading view fills on the client (see embeds-client.ts). Embeds inside
 * running text, and embeds of attachments (images, PDFs…), stay links for now.
 */

const ATTACHMENT = /\.(png|jpe?g|gif|webp|avif|bmp|svg|pdf|mp3|wav|ogg|m4a|flac|mp4|webm|mov|canvas)$/i;

/** True when the embed should render as a block: it is the only thing on its line and not an attachment. */
export function isBlockEmbed(md: string, from: number, to: number, target: string): boolean {
  if (ATTACHMENT.test(target.trim())) return false;
  const start = md.lastIndexOf("\n", from - 1) + 1;
  const endIdx = md.indexOf("\n", to);
  // Quote, callout and list markers in front of the embed do not make it inline.
  const line = md.slice(start, endIdx === -1 ? undefined : endIdx).replace(/^(?:[ \t]{0,3}>)*[ \t]{0,3}(?:(?:[-*+]|\d{1,9}[.)])[ \t]{1,4})?/, "");
  return line.trim() === md.slice(from, to);
}

/** Markdown for a block embed placeholder link (turned into a block by `rehypeEmbeds`). */
export function embedLinkMarkdown(label: string, targetWithHeading: string, missing: boolean) {
  return `[${label}](embed:${encodeURIComponent(targetWithHeading)}${missing ? ' "ghost"' : ""})`;
}

type HNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HNode[];
};

const text = (n: HNode): string => (n.type === "text" ? (n.value ?? "") : (n.children ?? []).map(text).join(""));

function toBlock(link: HNode): HNode {
  const encoded = String(link.properties?.href ?? "").slice("embed:".length);
  let target = "";
  try {
    target = decodeURIComponent(encoded);
  } catch {
    target = encoded;
  }
  const [name, ...rest] = target.split("#");
  const heading = rest.join("#");
  const missing = link.properties?.title === "ghost";
  const href = `wikilink:${encodeURIComponent(name.trim())}${heading ? `#${encodeURIComponent(heading)}` : ""}`;
  const label = text(link).replace(/^↳\s*/, "");
  return {
    type: "element",
    tagName: "div",
    properties: { className: ["embed"], dataEmbed: target, ...(missing ? { dataEmbedMissing: "" } : {}) },
    children: [
      {
        type: "element",
        tagName: "a",
        properties: { href, className: missing ? ["embed-title", "ghost"] : ["embed-title"] },
        children: [{ type: "text", value: label }],
      },
      {
        type: "element",
        tagName: "div",
        properties: { className: ["embed-body", "embed-note"] },
        children: [{ type: "text", value: missing ? "Not created yet. Select the title to create it." : "Loading…" }],
      },
    ],
  };
}

/** Runs after sanitisation: a paragraph holding only an `embed:` link becomes the embed block. */
export function rehypeEmbeds() {
  const visit = (node: HNode) => {
    const kids = node.children;
    if (!kids) return;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (k.type === "element" && (k.tagName === "p" || k.tagName === "li")) {
        // Only embed links (and line breaks) here: one embed block per link.
        const meaningful = (k.children ?? []).filter(
          (c) => !(c.type === "text" && !(c.value ?? "").trim()) && !(c.type === "element" && c.tagName === "br"),
        );
        const allEmbeds =
          meaningful.length > 0 &&
          meaningful.every((c) => c.type === "element" && c.tagName === "a" && String(c.properties?.href ?? "").startsWith("embed:"));
        if (allEmbeds) {
          const blocks = meaningful.map(toBlock);
          if (k.tagName === "p") {
            kids.splice(i, 1, ...blocks);
            i += blocks.length - 1;
          } else k.children = blocks;
          continue;
        }
      }
      // A stray inline embed: keep it a normal wikilink.
      if (k.type === "element" && k.tagName === "a" && String(k.properties?.href ?? "").startsWith("embed:")) {
        const block = toBlock(k);
        const titleLink = block.children![0];
        const classes = (titleLink.properties?.className as string[]).filter((c) => c !== "embed-title");
        k.properties = { href: titleLink.properties?.href, ...(classes.length ? { className: classes } : {}) };
      }
      visit(k);
    }
  };
  return (tree: unknown) => visit(tree as HNode);
}

/**
 * The section of `md` under the heading named `heading` (case-insensitive), heading
 * included, up to the next heading of the same or a higher level. Null when absent.
 */
export function extractSection(md: string, heading: string): string | null {
  const lines = md.split("\n");
  const want = heading.trim().toLowerCase();
  let inFence = false;
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!h) continue;
    if (start === -1) {
      if (h[2].trim().toLowerCase() === want) {
        start = i;
        level = h[1].length;
      }
    } else if (h[1].length <= level) {
      return lines.slice(start, i).join("\n");
    }
  }
  return start === -1 ? null : lines.slice(start).join("\n");
}
