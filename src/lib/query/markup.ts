/*
 * The reading view's hook for ```query blocks (called from src/lib/markdown/render.ts).
 *
 * The sanitised HTML keeps a query block as <pre><code class="language-query">; this wraps it in
 * <nexus-query>, the element that runs the query in the browser
 * (src/components/workspace/query/element.ts). The code block stays inside, so wherever the
 * element is not defined (a public share page, or before the module loads) the query reads as
 * code, and no vault data is ever rendered on the server. The element's module is loaded only
 * when a note has a query block.
 */
const BLOCK = /<pre><code class="language-query">([\s\S]*?)<\/code><\/pre>/g;

let defining: Promise<void> | null = null;

export function renderQueryBlocks(html: string): string {
  if (!html.includes('<code class="language-query">')) return html;
  if (typeof window !== "undefined")
    defining ??= import("@/components/workspace/query/element")
      .then((m) => m.defineQueryElement())
      .catch(() => {
        defining = null; // try again with the next render
      });
  return html.replace(BLOCK, (block) => `<nexus-query class="query-block">${block}</nexus-query>`);
}
