/*
 * Line and word diffs for version history, and restoring single changes. Pure functions shared
 * by the history dialog and the restore route, so both sides number the changes the same way.
 *
 * Direction: "old" is the saved version, "new" is the note as it is now. A hunk is one run of
 * changed lines (with no unchanged line between them); restoring a hunk puts its old lines back
 * in place of its new ones and leaves every other change alone.
 */

export type Op = { type: "same" | "del" | "add"; text: string };

/**
 * Myers' O((N+M)D) diff of two sequences. Past `maxCost` edit steps (huge, unrelated texts) it
 * stops searching and reports everything as replaced, which is still a correct diff.
 */
export function diffSeq<T>(a: T[], b: T[], maxCost = 2000): { type: Op["type"]; a: number; b: number }[] {
  // Strip the common prefix and suffix first: most edits touch a small part of a note.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const out: { type: Op["type"]; a: number; b: number }[] = [];
  for (let i = 0; i < start; i++) out.push({ type: "same", a: i, b: i });
  const n = endA - start;
  const m = endB - start;
  const mid: { type: Op["type"]; a: number; b: number }[] = [];
  if (n === 0) for (let j = 0; j < m; j++) mid.push({ type: "add", a: endA, b: start + j });
  else if (m === 0) for (let i = 0; i < n; i++) mid.push({ type: "del", a: start + i, b: endB });
  else {
    const max = n + m;
    const off = max;
    const v = new Int32Array(2 * max + 2);
    const trace: Int32Array[] = [];
    let found = -1;
    for (let d = 0; d <= Math.min(max, maxCost); d++) {
      // Only the diagonals step d can reach: memory grows with D squared, not D times N.
      trace.push(v.slice(off - d, off + d + 1));
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
        let y = x - k;
        while (x < n && y < m && a[start + x] === b[start + y]) {
          x++;
          y++;
        }
        v[off + k] = x;
        if (x >= n && y >= m) {
          found = d;
          break;
        }
      }
      if (found >= 0) break;
    }
    if (found < 0) {
      for (let i = 0; i < n; i++) mid.push({ type: "del", a: start + i, b: start });
      for (let j = 0; j < m; j++) mid.push({ type: "add", a: endA, b: start + j });
    } else {
      // Walk the trace back from (n, m) to (0, 0).
      let x = n;
      let y = m;
      for (let d = found; d > 0; d--) {
        const vv = trace[d];
        const at = (kk: number) => vv[kk + d];
        const k = x - y;
        const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
        const prevX = at(prevK);
        const prevY = prevX - prevK;
        while (x > prevX && y > prevY) {
          x--;
          y--;
          mid.push({ type: "same", a: start + x, b: start + y });
        }
        if (x === prevX) {
          y--;
          mid.push({ type: "add", a: start + x, b: start + y });
        } else {
          x--;
          mid.push({ type: "del", a: start + x, b: start + y });
        }
      }
      while (x > 0 && y > 0) {
        x--;
        y--;
        mid.push({ type: "same", a: start + x, b: start + y });
      }
      mid.reverse();
      // Within a replaced run, deletions read better before additions.
      for (let i = 0; i < mid.length; ) {
        if (mid[i].type === "same") {
          i++;
          continue;
        }
        let j = i;
        while (j < mid.length && mid[j].type !== "same") j++;
        const run = mid.slice(i, j);
        const sorted = [...run.filter((o) => o.type === "del"), ...run.filter((o) => o.type === "add")];
        mid.splice(i, j - i, ...sorted);
        i = j;
      }
    }
  }
  out.push(...mid);
  for (let i = 0; i < a.length - endA; i++) out.push({ type: "same", a: endA + i, b: endB + i });
  return out;
}

export const splitLines = (text: string) => text.split(/\r?\n/);

/** One changed region. Line numbers are 1-based; a pure insertion has no old lines (and the reverse). */
export type Hunk = {
  index: number;
  oldStart: number;
  oldLines: string[];
  newStart: number;
  newLines: string[];
};

/** The changes between two texts, line by line. */
export function hunksOf(oldText: string, newText: string): Hunk[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const ops = diffSeq(a, b);
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  for (const o of ops) {
    if (o.type === "same") {
      cur = null;
      continue;
    }
    if (!cur) {
      cur = { index: hunks.length, oldStart: o.a + 1, oldLines: [], newStart: o.b + 1, newLines: [] };
      hunks.push(cur);
    }
    if (o.type === "del") cur.oldLines.push(a[o.a]);
    else cur.newLines.push(b[o.b]);
  }
  return hunks;
}

/**
 * The current text with the chosen hunks put back as they were in `oldText`. Hunks are numbered
 * as hunksOf(oldText, newText) numbers them; unknown numbers are an error, not ignored.
 */
export function revertHunks(oldText: string, newText: string, which: number[]): string {
  const hunks = hunksOf(oldText, newText);
  const pick = new Set(which);
  for (const i of pick) if (!Number.isInteger(i) || i < 0 || i >= hunks.length) throw new RangeError(`No change ${i}`);
  const lines = splitLines(newText);
  // From the bottom up, so earlier line numbers stay valid.
  for (const h of [...hunks].reverse()) {
    if (!pick.has(h.index)) continue;
    lines.splice(h.newStart - 1, h.newLines.length, ...h.oldLines);
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Rows for display                                                    */
/* ------------------------------------------------------------------ */

export type Segment = { text: string; changed: boolean };
export type Row =
  | { kind: "same"; oldNo: number; newNo: number; text: string }
  | { kind: "del"; oldNo: number; text: string; segments: Segment[]; hunk: number }
  | { kind: "add"; newNo: number; text: string; segments: Segment[]; hunk: number }
  | { kind: "gap"; count: number; from: number };

const TOKEN = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

/** Word-level changes between two lines: what each side has that the other does not. */
export function wordDiff(oldLine: string, newLine: string): { old: Segment[]; new: Segment[] } {
  const a = oldLine.match(TOKEN) ?? [];
  const b = newLine.match(TOKEN) ?? [];
  const ops = diffSeq(a, b, 400);
  const left: Segment[] = [];
  const right: Segment[] = [];
  const push = (list: Segment[], text: string, changed: boolean) => {
    const last = list[list.length - 1];
    if (last && last.changed === changed) last.text += text;
    else list.push({ text, changed });
  };
  for (const o of ops) {
    if (o.type === "same") {
      push(left, a[o.a], false);
      push(right, b[o.b], false);
    } else if (o.type === "del") push(left, a[o.a], true);
    else push(right, b[o.b], true);
  }
  return { old: left, new: right };
}

/** Share of a line pair that is unchanged, 0 to 1: below a threshold the lines are not "the same line edited". */
function similarity(seg: Segment[]) {
  const total = seg.reduce((n, s) => n + s.text.length, 0);
  return total ? seg.reduce((n, s) => n + (s.changed ? 0 : s.text.length), 0) / total : 1;
}

/**
 * Rows for an inline diff: unchanged runs longer than 2 * context collapse into a gap row. Within
 * a hunk the n-th removed line is compared word by word with the n-th added line when they are
 * similar enough to be the same line edited.
 */
export function rowsOf(oldText: string, newText: string, context = 3): Row[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const ops = diffSeq(a, b);
  const rows: Row[] = [];
  let hunk = -1;
  for (let i = 0; i < ops.length; ) {
    const o = ops[i];
    if (o.type === "same") {
      rows.push({ kind: "same", oldNo: o.a + 1, newNo: o.b + 1, text: a[o.a] });
      i++;
      continue;
    }
    hunk++;
    let j = i;
    while (j < ops.length && ops[j].type !== "same") j++;
    const dels = ops.slice(i, j).filter((x) => x.type === "del");
    const adds = ops.slice(i, j).filter((x) => x.type === "add");
    const delRows: Row[] = dels.map((d) => ({ kind: "del", oldNo: d.a + 1, text: a[d.a], segments: [{ text: a[d.a], changed: true }], hunk }));
    const addRows: Row[] = adds.map((d) => ({ kind: "add", newNo: d.b + 1, text: b[d.b], segments: [{ text: b[d.b], changed: true }], hunk }));
    for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
      const w = wordDiff(a[dels[k].a], b[adds[k].b]);
      if (similarity(w.old) >= 0.4 || similarity(w.new) >= 0.4) {
        (delRows[k] as Extract<Row, { kind: "del" }>).segments = w.old;
        (addRows[k] as Extract<Row, { kind: "add" }>).segments = w.new;
      }
    }
    rows.push(...delRows, ...addRows);
    i = j;
  }
  return collapse(rows, context);
}

function collapse(rows: Row[], context: number): Row[] {
  const out: Row[] = [];
  for (let i = 0; i < rows.length; ) {
    if (rows[i].kind !== "same") {
      out.push(rows[i++]);
      continue;
    }
    let j = i;
    while (j < rows.length && rows[j].kind === "same") j++;
    const keepHead = i === 0 ? 0 : context;
    const keepTail = j === rows.length ? 0 : context;
    if (j - i > keepHead + keepTail + 1) {
      out.push(...rows.slice(i, i + keepHead));
      out.push({ kind: "gap", count: j - i - keepHead - keepTail, from: i + keepHead });
      out.push(...rows.slice(j - keepTail, j));
    } else out.push(...rows.slice(i, j));
    i = j;
  }
  return out;
}

/** The unchanged rows a gap hides, to expand it in place. */
export function expandGap(oldText: string, newText: string, gap: Extract<Row, { kind: "gap" }>): Row[] {
  const full = rowsOf(oldText, newText, Number.MAX_SAFE_INTEGER);
  return full.slice(gap.from, gap.from + gap.count);
}

export type SideRow =
  | { kind: "same"; oldNo: number; newNo: number; text: string }
  | { kind: "change"; hunk: number; left: Extract<Row, { kind: "del" }> | null; right: Extract<Row, { kind: "add" }> | null }
  | { kind: "gap"; count: number; from: number };

/** Inline rows paired up for two columns: the n-th removed line beside the n-th added one. */
export function sideBySide(rows: Row[]): SideRow[] {
  const out: SideRow[] = [];
  for (let i = 0; i < rows.length; ) {
    const r = rows[i];
    if (r.kind === "same" || r.kind === "gap") {
      out.push(r);
      i++;
      continue;
    }
    const hunk = r.hunk;
    const dels: Extract<Row, { kind: "del" }>[] = [];
    const adds: Extract<Row, { kind: "add" }>[] = [];
    while (i < rows.length) {
      const x = rows[i];
      if (x.kind === "del" && x.hunk === hunk) dels.push(x);
      else if (x.kind === "add" && x.hunk === hunk) adds.push(x);
      else break;
      i++;
    }
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) out.push({ kind: "change", hunk, left: dels[k] ?? null, right: adds[k] ?? null });
  }
  return out;
}

/** Counts for a summary line: lines added and removed. */
export function stats(rows: Row[]) {
  let added = 0;
  let removed = 0;
  let changes = 0;
  for (const r of rows) {
    if (r.kind === "add") added++;
    else if (r.kind === "del") removed++;
    if ((r.kind === "add" || r.kind === "del") && r.hunk + 1 > changes) changes = r.hunk + 1;
  }
  return { added, removed, changes };
}
