/**
 * Dollar handling for Obsidian-style math, run on text whose code is already masked.
 *
 * - Display math: `$$ … $$`, may span lines.
 * - Inline math follows the rule Obsidian uses: `$`, a non-space character, …, a
 *   non-space character, `$`, and the closing `$` is not followed by a digit. So
 *   "costs $5 and $10" stays text while `$x^2$` is math.
 *
 * Returns the positions of stray dollars (to escape as `\$`, so remark-math leaves
 * them alone) and a copy of the text with every formula blanked out, so wikilinks,
 * tags and highlights are never rewritten inside a formula.
 */
export function scanMath(masked: string): { escapes: number[]; blanked: string } {
  const escapes: number[] = [];
  const spans: [number, number][] = [];
  const s = masked;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c !== "$") {
      i++;
      continue;
    }
    if (s[i + 1] === "$") {
      const end = s.indexOf("$$", i + 2);
      if (end !== -1) {
        spans.push([i, end + 2]);
        i = end + 2;
      } else {
        escapes.push(i, i + 1);
        i += 2;
      }
      continue;
    }
    const next = s[i + 1];
    let close = -1;
    if (next !== undefined && !/\s/.test(next)) {
      for (let j = i + 1; j < s.length && s[j] !== "\n"; j++) {
        if (s[j] === "\\") {
          j++;
          continue;
        }
        if (s[j] === "$") {
          if (!/\s/.test(s[j - 1]) && !/\d/.test(s[j + 1] ?? "")) close = j;
          break;
        }
      }
    }
    if (close !== -1) {
      spans.push([i, close + 1]);
      i = close + 1;
    } else {
      escapes.push(i);
      i++;
    }
  }
  if (!spans.length) return { escapes, blanked: masked };
  const chars = masked.split("");
  for (const [from, to] of spans) for (let k = from; k < to; k++) if (chars[k] !== "\n") chars[k] = " ";
  return { escapes, blanked: chars.join("") };
}
