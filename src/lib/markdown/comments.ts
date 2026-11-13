import { maskCode } from "./parse";

/**
 * Obsidian comments: `%%inline%%` and `%%`-fenced blocks stay in the source but are
 * hidden from the reading view. Code spans and code blocks are left untouched, so a
 * Mermaid `%%{init: …}%%` directive inside a fence is never mistaken for a comment.
 */
export function stripComments(md: string): string {
  if (!md.includes("%%")) return md;
  const masked = maskCode(md);
  let out = "";
  let pos = 0;
  for (const m of masked.matchAll(/%%[\s\S]*?%%/g)) {
    out += md.slice(pos, m.index);
    pos = m.index! + m[0].length;
  }
  return out + md.slice(pos);
}
