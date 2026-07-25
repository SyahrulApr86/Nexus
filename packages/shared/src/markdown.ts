/**
 * Single source of truth for wikilink + tag recognition (PRD §13: editor,
 * preview, server indexer, and graph must resolve links identically).
 */

export interface WikilinkMatch {
  title: string;
  offset: number;
}

export interface TagMatch {
  name: string;
  offset: number;
}

interface Region {
  start: number;
  end: number;
}

/**
 * Compute code regions (fenced blocks and inline code spans) that must be
 * excluded from wikilink/tag recognition (US4-S6).
 */
function codeRegions(content: string): Region[] {
  const regions: Region[] = [];

  // Fenced code blocks: ``` or ~~~ at line start (allowing up to 3 leading
  // spaces), closed by a matching fence or end of document.
  const fenceRe = /^ {0,3}(```|~~~)/gm;
  let m: RegExpExecArray | null;
  let openFence: { start: number; marker: string } | null = null;
  while ((m = fenceRe.exec(content)) !== null) {
    const marker = m[1]!;
    if (!openFence) {
      openFence = { start: m.index, marker };
    } else if (marker === openFence.marker) {
      const end = content.indexOf("\n", m.index);
      regions.push({
        start: openFence.start,
        end: end === -1 ? content.length : end,
      });
      openFence = null;
    }
  }
  if (openFence) regions.push({ start: openFence.start, end: content.length });

  // Inline code spans: matching runs of backticks on the same logical span,
  // outside fenced blocks.
  const inFence = (i: number) =>
    regions.some((r) => i >= r.start && i < r.end);
  const inlineRe = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g;
  while ((m = inlineRe.exec(content)) !== null) {
    if (!inFence(m.index)) {
      regions.push({ start: m.index, end: m.index + m[0].length });
    }
  }

  return regions;
}

export function isInCodeRegion(content: string, offset: number): boolean {
  return codeRegions(content).some((r) => offset >= r.start && offset < r.end);
}

const WIKILINK_RE = /\[\[([^[\]]+)\]\]/g;

export function extractWikilinks(content: string): WikilinkMatch[] {
  const regions = codeRegions(content);
  const excluded = (i: number) =>
    regions.some((r) => i >= r.start && i < r.end);
  const out: WikilinkMatch[] = [];
  let m: RegExpExecArray | null;
  WIKILINK_RE.lastIndex = 0;
  while ((m = WIKILINK_RE.exec(content)) !== null) {
    if (excluded(m.index)) continue;
    const title = m[1]!.trim();
    if (title.length === 0) continue;
    out.push({ title, offset: m.index });
  }
  return out;
}

// A tag is '#' followed by unicode letters/digits/underscore/hyphen, not
// preceded by a word character or another '#' (so ATX headings `# H`, `## H`
// and mid-word `a#b` never match).
const TAG_RE = /(?<![\p{L}\p{N}_#])#([\p{L}\p{N}_-]+)/gu;

export function extractTags(content: string): TagMatch[] {
  const regions = codeRegions(content);
  const excluded = (i: number) =>
    regions.some((r) => i >= r.start && i < r.end);
  const out: TagMatch[] = [];
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(content)) !== null) {
    if (excluded(m.index)) continue;
    out.push({ name: m[1]!, offset: m.index });
  }
  return out;
}
