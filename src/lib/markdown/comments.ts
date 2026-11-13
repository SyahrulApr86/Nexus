import { maskCode } from "./parse";

/**
 * Obsidian comments: `%%inline%%` and `%%`-fenced blocks stay in the source but are
 * hidden from the reading view; an unclosed `%%` hides everything after it.
 *
 * Comments are replaced by spaces of the same length (line breaks kept), so offsets
 * into the result match the source. Task toggling relies on that. Code spans and code
 * blocks are left untouched, so a Mermaid `%%{init: …}%%` directive inside a fence is
 * never mistaken for a comment.
 */
export function stripComments(md: string): string {
  if (!md.includes("%%")) return md;
  const masked = maskCode(md);
  const chars = md.split("");
  const blank = (from: number, to: number) => {
    for (let i = from; i < to; i++) if (chars[i] !== "\n") chars[i] = " ";
  };
  let pos = 0;
  for (;;) {
    const open = masked.indexOf("%%", pos);
    if (open === -1) break;
    const close = masked.indexOf("%%", open + 2);
    if (close === -1) {
      blank(open, md.length);
      break;
    }
    blank(open, close + 2);
    pos = close + 2;
  }
  return chars.join("");
}
