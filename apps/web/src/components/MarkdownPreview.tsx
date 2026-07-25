import { memo, useMemo, type MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkNexus } from "../lib/remarkNexus.js";

export interface WikilinkResolution {
  targetTitle: string;
  targetNoteId: string | null;
}

/**
 * Live preview pane (FR-005) with wikilink navigation (FR-011/012) and
 * styled tags (FR-017).
 */
export const MarkdownPreview = memo(function MarkdownPreview({
  content,
  links = [],
  onOpenWikilink,
  onTagClick,
}: {
  content: string;
  links?: WikilinkResolution[];
  onOpenWikilink?: (title: string, resolvedId: string | null) => void;
  onTagClick?: (tag: string) => void;
}) {
  // Past this size, rendering the whole document would build tens of
  // thousands of DOM nodes on every pass. The note is stored and exported in
  // full — only this preview stops early, and says so.
  const PREVIEW_CHAR_LIMIT = 80_000;
  const truncated = content.length > PREVIEW_CHAR_LIMIT;
  const rendered = truncated ? content.slice(0, PREVIEW_CHAR_LIMIT) : content;

  const linkMap = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const l of links) map.set(l.targetTitle, l.targetNoteId);
    return map;
  }, [links]);

  const plugins = useMemo(
    () => [
      remarkGfm,
      remarkNexus({
        resolve: (title) => (linkMap.get(title) ?? null) !== null,
      }),
    ],
    [linkMap],
  );

  const handleClick = (e: MouseEvent<HTMLElement>) => {
    const target = (e.target as HTMLElement).closest("[data-wikilink],[data-tag]");
    if (!target) return;
    e.preventDefault();
    const wikilink = target.getAttribute("data-wikilink");
    if (wikilink && onOpenWikilink) {
      onOpenWikilink(wikilink, linkMap.get(wikilink) ?? null);
      return;
    }
    const tag = target.getAttribute("data-tag");
    if (tag && onTagClick) onTagClick(tag);
  };

  return (
    // Click delegation for embedded interactive nodes; keyboard path exists
    // via editor + command palette, links are real <a> for keyboard focus.
    <div
      className="md-preview h-full overflow-auto px-6 py-4 text-[16px] text-ink"
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") handleClick(e as unknown as MouseEvent<HTMLElement>);
      }}
    >
      <ReactMarkdown remarkPlugins={plugins}>{rendered}</ReactMarkdown>
      {truncated && (
        <p className="mt-6 rounded-control border border-border bg-surface px-4 py-3 text-[13px] text-muted">
          Preview stops here to stay responsive. The full note is saved and
          exports complete.
        </p>
      )}
    </div>
  );
});
