import { describe, expect, it } from "vitest";
import { diffSeq, expandGap, hunksOf, revertHunks, rowsOf, sideBySide, stats, wordDiff } from "@/components/workspace/history/diff";

/** Apply a diff's ops to rebuild b from a: any correct diff must round-trip. */
const rebuild = (a: string[], b: string[]) =>
  diffSeq(a, b)
    .filter((o) => o.type !== "del")
    .map((o) => (o.type === "same" ? a[o.a] : b[o.b]));

const lines = (n: number, f = (i: number) => `line ${i}`) => Array.from({ length: n }, (_, i) => f(i)).join("\n");

describe("diffSeq", () => {
  it("round-trips and finds a minimal edit", () => {
    const a = "the quick brown fox jumps over the lazy dog".split(" ");
    const b = "the quick red fox leaps over the dog today".split(" ");
    expect(rebuild(a, b)).toEqual(b);
    const ops = diffSeq(a, b);
    expect(ops.filter((o) => o.type !== "same")).toHaveLength(6); // LCS: the quick fox over the dog
  });

  it("handles empty sides and identical input", () => {
    expect(diffSeq([], ["a"])).toEqual([{ type: "add", a: 0, b: 0 }]);
    expect(diffSeq(["a"], [])).toEqual([{ type: "del", a: 0, b: 0 }]);
    expect(diffSeq(["a", "b"], ["a", "b"]).every((o) => o.type === "same")).toBe(true);
  });

  it("falls back to a full replace past the cost limit, still correct", () => {
    const a = Array.from({ length: 300 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 300 }, (_, i) => `b${i}`);
    expect(rebuild(a, b)).toEqual(b);
    expect(rebuild(a, b.slice(0, 10))).toEqual(b.slice(0, 10));
    const capped = diffSeq(a, b, 5);
    expect(capped.filter((o) => o.type === "del")).toHaveLength(300);
  });

  it("stays fast on long notes with scattered edits", () => {
    const a = lines(5000).split("\n");
    const b = a.map((l, i) => (i % 50 === 0 ? `${l} edited` : l));
    const t0 = performance.now();
    expect(rebuild(a, b)).toEqual(b);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe("hunks and restoring one change", () => {
  const old = ["# Plan", "", "Intro line.", "Keep this.", "Old risk.", "", "Ending."].join("\n");
  const now = ["# Plan", "", "Intro line, revised.", "Keep this.", "", "Ending.", "New closing line."].join("\n");

  it("numbers the changes top to bottom", () => {
    const h = hunksOf(old, now);
    expect(h.map((x) => [x.oldStart, x.oldLines, x.newStart, x.newLines])).toEqual([
      [3, ["Intro line."], 3, ["Intro line, revised."]],
      [5, ["Old risk."], 5, []],
      [8, [], 7, ["New closing line."]],
    ]);
  });

  it("puts back exactly the chosen hunks", () => {
    expect(revertHunks(old, now, [1])).toBe(["# Plan", "", "Intro line, revised.", "Keep this.", "Old risk.", "", "Ending.", "New closing line."].join("\n"));
    expect(revertHunks(old, now, [0, 2])).toBe(["# Plan", "", "Intro line.", "Keep this.", "", "Ending."].join("\n"));
    expect(revertHunks(old, now, [0, 1, 2])).toBe(old);
    expect(revertHunks(old, now, [])).toBe(now);
    expect(() => revertHunks(old, now, [3])).toThrow(RangeError);
    expect(() => revertHunks(old, now, [-1])).toThrow(RangeError);
  });

  it("keeps CRLF notes intact around a restored hunk", () => {
    expect(revertHunks("a\r\nb\r\nc", "a\nB\nc", [0])).toBe("a\nb\nc");
  });
});

describe("display rows", () => {
  it("diffs edited lines word by word and leaves rewrites whole", () => {
    const w = wordDiff("Ship the beta to 40 teams", "Ship the public beta to 60 teams");
    expect(w.old.filter((s) => s.changed).map((s) => s.text)).toEqual(["40"]);
    expect(w.new.filter((s) => s.changed).map((s) => s.text.trim())).toEqual(["public", "60"]);
    const rows = rowsOf("alpha beta gamma\nzzz", "alpha beta delta\ncompletely different words here");
    const dels = rows.filter((r) => r.kind === "del");
    expect(dels[0].kind === "del" && dels[0].segments.some((s) => !s.changed)).toBe(true);
    expect(dels[1].kind === "del" && dels[1].segments).toEqual([{ text: "zzz", changed: true }]);
  });

  it("collapses long unchanged runs and expands them on demand", () => {
    const a = lines(40);
    const b = a.replace("line 20", "line twenty");
    const rows = rowsOf(a, b);
    const gaps = rows.filter((r) => r.kind === "gap");
    expect(gaps.map((g) => g.kind === "gap" && g.count)).toEqual([17, 16]);
    expect(stats(rows)).toEqual({ added: 1, removed: 1, changes: 1 });
    const first = gaps[0];
    if (first.kind !== "gap") throw new Error();
    const shown = expandGap(a, b, first);
    expect(shown).toHaveLength(17);
    expect(shown[0]).toMatchObject({ kind: "same", oldNo: 1, newNo: 1 });
  });

  it("pairs removed and added lines side by side", () => {
    const side = sideBySide(rowsOf("a\nb\nc", "a\nB\nX\nc"));
    expect(side.map((r) => (r.kind === "change" ? [r.left?.text ?? null, r.right?.text ?? null] : r.kind))).toEqual([
      "same",
      ["b", "B"],
      [null, "X"],
      "same",
    ]);
  });
});
