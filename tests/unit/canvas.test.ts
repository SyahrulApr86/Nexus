import { describe, expect, it } from "vitest";
import {
  anchor,
  bestSides,
  boundsOf,
  canvasLinks,
  canvasText,
  colorVars,
  edgePath,
  isCanvasPath,
  nearestSide,
  normalizeWebUrl,
  parseCanvas,
  readingOrder,
  rewriteCanvasLinks,
  serializeCanvas,
  type CanvasDoc,
} from "@/lib/canvas";
import { canvasReducer, initCanvasState, withGroupContents, type CanvasState } from "@/lib/canvas/reducer";

const sample = {
  nodes: [
    { id: "g1", type: "group", x: -20, y: -20, width: 600, height: 400, label: "Ideas", color: "4" },
    { id: "t1", type: "text", x: 0, y: 0, width: 250, height: 60, text: "See [[Plan]] and #idea" },
    { id: "f1", type: "file", x: 300, y: 0, width: 400, height: 400, file: "Projects/Roadmap.md", subpath: "#Q1" },
    { id: "f2", type: "file", x: 300, y: 500, width: 200, height: 200, file: "Assets/photo.png" },
    { id: "l1", type: "link", x: 0, y: 500, width: 400, height: 120, url: "https://example.com" },
  ],
  edges: [
    { id: "e1", fromNode: "t1", fromSide: "right", toNode: "f1", toSide: "left", label: "plans", color: "#ff0000" },
    { id: "e2", fromNode: "t1", toNode: "l1", fromEnd: "arrow", toEnd: "none" },
  ],
  pluginData: { kept: true },
};

describe("JSON Canvas schema", () => {
  it("parses every node type, edges and unknown fields", () => {
    const res = parseCanvas(JSON.stringify(sample));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc.nodes.map((n) => n.type)).toEqual(["group", "text", "file", "file", "link"]);
    expect(res.doc.edges).toHaveLength(2);
    expect(res.doc.rest).toEqual({ pluginData: { kept: true } });
  });

  it("round-trips through serializeCanvas as tab-indented JSON, keeping unknown fields", () => {
    const withExtra = { ...sample, nodes: [{ ...sample.nodes[1], styleAttributes: { shape: "pill" } }], edges: [] };
    const res = parseCanvas(JSON.stringify(withExtra));
    if (!res.ok) throw new Error(res.error);
    const out = serializeCanvas(res.doc);
    expect(out).toContain('\n\t"nodes"');
    expect(JSON.parse(out)).toEqual(withExtra);
  });

  it("treats empty content as an empty canvas and accepts missing arrays", () => {
    expect(parseCanvas("")).toEqual({ ok: true, doc: { nodes: [], edges: [] } });
    expect(parseCanvas("  \n")).toEqual({ ok: true, doc: { nodes: [], edges: [] } });
    expect(parseCanvas("{}")).toEqual({ ok: true, doc: { nodes: [], edges: [] } });
  });

  it("refuses invalid JSON, wrong shapes, unknown node types, bad colours and duplicate ids", () => {
    expect(parseCanvas("{nodes:")).toEqual({ ok: false, error: "This file is not valid JSON." });
    expect(parseCanvas("[]").ok).toBe(false);
    expect(parseCanvas('{"nodes":[{"id":"a","type":"shape","x":0,"y":0,"width":1,"height":1}]}').ok).toBe(false);
    expect(parseCanvas('{"nodes":[{"id":"a","type":"text","x":"0","y":0,"width":1,"height":1,"text":""}]}').ok).toBe(false);
    expect(parseCanvas('{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":1,"height":1,"text":"","color":"7"}]}').ok).toBe(false);
    expect(parseCanvas('{"edges":[{"id":"e","fromNode":"a","toNode":"b","toSide":"middle"}]}').ok).toBe(false);
    const dup = parseCanvas(
      '{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":1,"height":1,"text":""},{"id":"a","type":"text","x":0,"y":0,"width":1,"height":1,"text":""}]}',
    );
    expect(dup).toEqual({ ok: false, error: "Two cards share the id “a”." });
  });

  it("recognises canvas paths", () => {
    expect(isCanvasPath("Boards/Plan.canvas")).toBe(true);
    expect(isCanvasPath("Plan.CANVAS")).toBe(true);
    expect(isCanvasPath("Plan")).toBe(false);
    expect(isCanvasPath("canvas")).toBe(false);
  });

  it("maps presets to tokens and passes custom hex through", () => {
    expect(colorVars("2")).toEqual({ "--cv-edge": "var(--canvas-2)", "--cv-wash": "var(--canvas-2-wash)" });
    expect(colorVars("#ff0000")?.["--cv-edge"]).toBe("#ff0000");
    expect(colorVars("red")).toBeUndefined();
    expect(colorVars(undefined)).toBeUndefined();
  });
});

describe("canvas links", () => {
  it("counts file cards that point at notes and wikilinks in text cards, not attachments", () => {
    expect(canvasLinks(JSON.stringify(sample))).toEqual([
      { target: "Plan", embed: false },
      { target: "Projects/Roadmap.md", embed: true },
    ]);
  });

  it("finds nothing in content that does not parse", () => {
    expect(canvasLinks("not json [[Plan]]")).toEqual([]);
  });

  it("collects text card and group text for tags", () => {
    expect(canvasText(JSON.stringify(sample))).toBe("Ideas\n\nSee [[Plan]] and #idea");
  });

  it("rewrites file cards and text links on rename", () => {
    const next = rewriteCanvasLinks(
      JSON.stringify(sample),
      (t) => t.toLowerCase().replace(/\.md$/, "") === "projects/roadmap",
      "Archive/Roadmap 2026.md",
      (text) => (text.includes("[[Plan]]") ? text.replace("[[Plan]]", "[[Plan B]]") : null),
    );
    expect(next).not.toBeNull();
    const doc = parseCanvas(next!);
    if (!doc.ok) throw new Error(doc.error);
    expect(doc.doc.nodes.find((n) => n.id === "f1")).toMatchObject({ file: "Archive/Roadmap 2026.md", subpath: "#Q1" });
    expect(doc.doc.nodes.find((n) => n.id === "t1")).toMatchObject({ text: "See [[Plan B]] and #idea" });
    expect(doc.doc.rest).toEqual({ pluginData: { kept: true } });
    expect(rewriteCanvasLinks(JSON.stringify(sample), () => false, "x.md", () => null)).toBeNull();
  });
});

describe("canvas geometry", () => {
  const a = { x: 0, y: 0, width: 100, height: 50 };
  const b = { x: 300, y: 0, width: 100, height: 50 };
  it("anchors connections at side midpoints and picks facing sides", () => {
    expect(anchor(a, "right")).toEqual({ x: 100, y: 25 });
    expect(anchor(a, "top")).toEqual({ x: 50, y: 0 });
    expect(bestSides(a, b)).toEqual(["right", "left"]);
    expect(nearestSide(a, { x: 50, y: 200 })).toBe("bottom");
  });

  it("draws a cubic path between anchors", () => {
    const g = edgePath(anchor(a, "right"), "right", anchor(b, "left"), "left");
    expect(g.d.startsWith("M100,25 C")).toBe(true);
    expect(g.mid).toEqual({ x: 200, y: 25 });
  });

  it("orders cards top to bottom, then left to right, groups first", () => {
    const res = parseCanvas(JSON.stringify(sample));
    if (!res.ok) throw new Error(res.error);
    expect(readingOrder(res.doc.nodes).map((n) => n.id)).toEqual(["g1", "t1", "f1", "l1", "f2"]);
    expect(boundsOf(res.doc.nodes)).toEqual({ x: -20, y: -20, width: 720, height: 720 });
    expect(boundsOf([])).toBeNull();
  });
});

describe("canvas reducer", () => {
  const start = (): CanvasState => {
    const res = parseCanvas(JSON.stringify(sample));
    if (!res.ok) throw new Error(res.error);
    return initCanvasState(res.doc);
  };
  const node = (s: CanvasState, id: string) => s.doc.nodes.find((n) => n.id === id)!;
  const run = (s: CanvasState, ...actions: Parameters<typeof canvasReducer>[1][]) => actions.reduce(canvasReducer, s);

  it("moves cards as one undo step and undoes and redoes it", () => {
    let s = run(start(), { type: "move", ids: ["t1"], dx: 8, dy: -40 });
    expect(node(s, "t1")).toMatchObject({ x: 8, y: -40 });
    expect(s.past).toHaveLength(1);
    s = canvasReducer(s, { type: "undo" });
    expect(node(s, "t1")).toMatchObject({ x: 0, y: 0 });
    s = canvasReducer(s, { type: "redo" });
    expect(node(s, "t1")).toMatchObject({ x: 8, y: -40 });
    expect(s.future).toHaveLength(0);
  });

  it("records a whole drag gesture as one step", () => {
    let s = run(
      start(),
      { type: "begin" },
      { type: "move", ids: ["t1"], dx: 3, dy: 0, transient: true },
      { type: "move", ids: ["t1"], dx: 4, dy: 5, transient: true },
      { type: "end" },
    );
    expect(node(s, "t1")).toMatchObject({ x: 7, y: 5 });
    expect(s.past).toHaveLength(1);
    s = canvasReducer(s, { type: "undo" });
    expect(node(s, "t1")).toMatchObject({ x: 0, y: 0 });
    // A gesture that changed nothing records nothing.
    expect(run(start(), { type: "begin" }, { type: "end" }).past).toHaveLength(0);
  });

  it("resizes with a minimum size and undoes it", () => {
    let s = canvasReducer(start(), { type: "resize", id: "t1", rect: { x: 0, y: 0, width: 10, height: 300.4 } });
    expect(node(s, "t1")).toMatchObject({ width: 80, height: 300 });
    s = canvasReducer(s, { type: "undo" });
    expect(node(s, "t1")).toMatchObject({ width: 250, height: 60 });
  });

  it("moves the cards inside a group with it", () => {
    const s = start();
    // f1 sticks out of the group, so it stays put.
    expect(withGroupContents(s.doc, ["g1"]).sort()).toEqual(["g1", "t1"]);
  });

  it("coalesces typing in one card into one step", () => {
    let s = run(
      start(),
      { type: "updateNode", id: "t1", patch: { text: "a" }, coalesce: "text" },
      { type: "updateNode", id: "t1", patch: { text: "ab" }, coalesce: "text" },
      { type: "updateNode", id: "t1", patch: { text: "abc" }, coalesce: "text" },
    );
    expect(s.past).toHaveLength(1);
    s = canvasReducer(s, { type: "undo" });
    expect((node(s, "t1") as { text: string }).text).toBe("See [[Plan]] and #idea");
  });

  it("removes cards with their connections and keeps the selection valid", () => {
    let s = run(start(), { type: "select", ids: ["t1", "e1"] }, { type: "remove", ids: ["t1"] });
    expect(s.doc.nodes.some((n) => n.id === "t1")).toBe(false);
    expect(s.doc.edges).toEqual([]);
    expect(s.selection).toEqual([]);
    s = canvasReducer(s, { type: "undo" });
    expect(s.doc.edges).toHaveLength(2);
  });

  it("duplicates cards with new ids and copies connections between them", () => {
    const s = run(start(), { type: "duplicate", ids: ["t1", "f1"] });
    expect(s.doc.nodes).toHaveLength(7);
    expect(s.doc.edges).toHaveLength(3);
    const ids = new Set(s.doc.nodes.map((n) => n.id));
    expect(ids.size).toBe(7);
    expect(s.selection).toHaveLength(2);
    const copy = node(s, s.selection[0]);
    expect(copy).toMatchObject({ type: "text", x: 40, y: 40 });
  });

  it("refuses connections to missing cards or to the same card", () => {
    const s = start();
    expect(canvasReducer(s, { type: "addEdge", edge: { id: "x", fromNode: "t1", toNode: "nope" } })).toBe(s);
    expect(canvasReducer(s, { type: "addEdge", edge: { id: "x", fromNode: "t1", toNode: "t1" } })).toBe(s);
    const next = canvasReducer(s, { type: "addEdge", edge: { id: "x", fromNode: "t1", toNode: "l1" } });
    expect(next.doc.edges).toHaveLength(3);
  });

  it("adds groups behind other cards and selects new cards", () => {
    const s = canvasReducer(start(), { type: "addNode", node: { id: "g2", type: "group", x: 0, y: 0, width: 10, height: 10 } });
    expect(s.doc.nodes[0].id).toBe("g2");
    expect(s.selection).toEqual(["g2"]);
  });

  it("caps the undo history and clears redo on a new change", () => {
    let s: CanvasState = start();
    for (let i = 0; i < 130; i++) s = canvasReducer(s, { type: "move", ids: ["t1"], dx: 1, dy: 0 });
    expect(s.past.length).toBe(100);
    s = run(s, { type: "undo" }, { type: "move", ids: ["t1"], dx: 1, dy: 0 });
    expect(s.future).toHaveLength(0);
  });

  it("keeps the same state object for no-op actions", () => {
    const s = start();
    expect(canvasReducer(s, { type: "move", ids: ["t1"], dx: 0, dy: 0 })).toBe(s);
    expect(canvasReducer(s, { type: "undo" })).toBe(s);
    expect(canvasReducer(s, { type: "remove", ids: [] })).toBe(s);
  });

  it("loads a server document with a fresh history", () => {
    const s = run(start(), { type: "move", ids: ["t1"], dx: 1, dy: 1 });
    const doc: CanvasDoc = { nodes: [], edges: [] };
    expect(canvasReducer(s, { type: "load", doc })).toEqual(initCanvasState(doc));
  });
});

describe("normalizeWebUrl", () => {
  it("drops a doubled scheme from a pasted address", () => {
    expect(normalizeWebUrl("https://https://x.org")).toBe("https://x.org/");
    expect(normalizeWebUrl("https://https://example.org/page")).toBe("https://example.org/page");
    expect(normalizeWebUrl("https://http://x.org/a")).toBe("http://x.org/a");
  });
  it("adds https:// when no scheme is given and trims", () => {
    expect(normalizeWebUrl("  example.org/page ")).toBe("https://example.org/page");
    expect(normalizeWebUrl("http://x.org")).toBe("http://x.org/");
    expect(normalizeWebUrl("https://localhost:3000/a")).toBe("https://localhost:3000/a");
  });
  it("rejects empty, bare-prefix and non-web addresses", () => {
    expect(normalizeWebUrl("")).toBeNull();
    expect(normalizeWebUrl("https://")).toBeNull();
    expect(normalizeWebUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeWebUrl("https://javascript:alert(1)")).toBeNull();
    expect(normalizeWebUrl("mailto:a@b.c")).toBeNull();
  });
});
