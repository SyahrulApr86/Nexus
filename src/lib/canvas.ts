/**
 * JSON Canvas 1.0 (https://jsoncanvas.org/spec/1.0/), the format of Obsidian's .canvas files.
 *
 * A canvas is a note whose path ends in ".canvas" and whose content is the canvas as JSON. This
 * module is pure and shared by the server (indexing, rename) and the client (the canvas view):
 * the schema, parsing and serialising, the links a canvas holds, and the geometry of cards and
 * connections. Unknown fields on the canvas, its nodes and edges are kept, so a file written by
 * Obsidian or a plugin survives a round trip through Nexus.
 */
import { z } from "zod";
import { extractWikiLinks } from "@/lib/markdown/parse";

export const CANVAS_EXT = ".canvas";

/** True for a note path that names a canvas ("Boards/Plan.canvas"). */
export function isCanvasPath(path: string): boolean {
  return /\.canvas$/i.test(path);
}

/** "Boards/Plan.canvas" → "Plan": a canvas's name without its extension, for display. */
export function canvasTitle(name: string): string {
  return name.replace(/\.canvas$/i, "");
}

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

/** Hard ceilings on top of the note size limit, so a hostile file cannot stall a tab. */
export const CANVAS_LIMITS = { nodes: 5_000, edges: 10_000, text: 1_000_000 } as const;

const SIDES = ["top", "right", "bottom", "left"] as const;
const ENDS = ["none", "arrow"] as const;
export type Side = (typeof SIDES)[number];
export type End = (typeof ENDS)[number];

/** "1" to "6" (Obsidian's presets) or a "#rrggbb" hex colour. */
const Color = z.string().regex(/^(?:[1-6]|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})$/);
const Coord = z.number();
const Size = z.number().nonnegative();
const Id = z.string().min(1).max(200);

const base = { id: Id, x: Coord, y: Coord, width: Size, height: Size, color: Color.optional() };

const TextNode = z.looseObject({ ...base, type: z.literal("text"), text: z.string().max(CANVAS_LIMITS.text) });
const FileNode = z.looseObject({ ...base, type: z.literal("file"), file: z.string().min(1).max(1000), subpath: z.string().max(1000).optional() });
const LinkNode = z.looseObject({ ...base, type: z.literal("link"), url: z.string().max(4000) });
const GroupNode = z.looseObject({
  ...base,
  type: z.literal("group"),
  label: z.string().max(1000).optional(),
  background: z.string().max(1000).optional(),
  backgroundStyle: z.enum(["cover", "ratio", "repeat"]).optional(),
});

export const CanvasNodeSchema = z.discriminatedUnion("type", [TextNode, FileNode, LinkNode, GroupNode]);

export const CanvasEdgeSchema = z.looseObject({
  id: Id,
  fromNode: Id,
  fromSide: z.enum(SIDES).optional(),
  fromEnd: z.enum(ENDS).optional(),
  toNode: Id,
  toSide: z.enum(SIDES).optional(),
  toEnd: z.enum(ENDS).optional(),
  color: Color.optional(),
  label: z.string().max(1000).optional(),
});

export const CanvasSchema = z.looseObject({
  nodes: z.array(CanvasNodeSchema).max(CANVAS_LIMITS.nodes).optional(),
  edges: z.array(CanvasEdgeSchema).max(CANVAS_LIMITS.edges).optional(),
});

export type CanvasNode = z.infer<typeof CanvasNodeSchema>;
export type TextCanvasNode = z.infer<typeof TextNode>;
export type FileCanvasNode = z.infer<typeof FileNode>;
export type LinkCanvasNode = z.infer<typeof LinkNode>;
export type GroupCanvasNode = z.infer<typeof GroupNode>;
export type CanvasEdge = z.infer<typeof CanvasEdgeSchema>;
/** A parsed canvas: `nodes` and `edges` always present, extra top-level fields kept in `rest`. */
export type CanvasDoc = { nodes: CanvasNode[]; edges: CanvasEdge[]; rest?: Record<string, unknown> };

export type ParseResult = { ok: true; doc: CanvasDoc } | { ok: false; error: string };

export const emptyCanvas = (): CanvasDoc => ({ nodes: [], edges: [] });

/**
 * Parse a canvas file. Empty or whitespace-only content is an empty canvas (a new file). Anything
 * that is not JSON Canvas fails with a short, human reason; ids must be unique.
 */
export function parseCanvas(content: string): ParseResult {
  if (!content.trim()) return { ok: true, doc: emptyCanvas() };
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return { ok: false, error: "This file is not valid JSON." };
  }
  const res = CanvasSchema.safeParse(raw);
  if (!res.success) {
    const issue = res.error.issues[0];
    const where = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
    return { ok: false, error: `This file is not a valid JSON Canvas${where}: ${issue?.message ?? "unknown problem"}.` };
  }
  const { nodes = [], edges = [], ...rest } = res.data;
  const ids = new Set<string>();
  for (const n of nodes) {
    if (ids.has(n.id)) return { ok: false, error: `Two cards share the id “${n.id}”.` };
    ids.add(n.id);
  }
  const doc: CanvasDoc = { nodes, edges };
  if (Object.keys(rest).length) doc.rest = rest;
  return { ok: true, doc };
}

/** Tab-indented JSON, the way Obsidian writes canvas files. */
export function serializeCanvas(doc: CanvasDoc): string {
  return JSON.stringify({ ...doc.rest, nodes: doc.nodes, edges: doc.edges }, null, "\t");
}

/** A 16-digit hex id, the shape Obsidian uses. */
export function newCanvasId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------------------ */
/* Links                                                               */
/* ------------------------------------------------------------------ */

/** A file node points at a note (or a canvas) rather than an attachment. */
export function isNoteFile(file: string): boolean {
  const base = file.slice(file.lastIndexOf("/") + 1);
  return /\.(md|canvas)$/i.test(base) || !base.includes(".");
}

/**
 * The links a canvas holds, for backlinks and the graph: every file node that points at a note
 * (an embed), then the [[wikilinks]] written in text cards. Content that does not parse has none.
 */
export function canvasLinks(content: string): { target: string; embed: boolean }[] {
  const parsed = parseCanvas(content);
  if (!parsed.ok) return [];
  const out: { target: string; embed: boolean }[] = [];
  for (const n of parsed.doc.nodes) {
    if (n.type === "file" && isNoteFile(n.file)) out.push({ target: n.file.trim(), embed: true });
    else if (n.type === "text") for (const l of extractWikiLinks(n.text)) if (l.target) out.push({ target: l.target, embed: l.embed });
  }
  return out;
}

/** The text of every text card, joined: what a canvas contributes to tags. */
export function canvasText(content: string): string {
  const parsed = parseCanvas(content);
  if (!parsed.ok) return "";
  return parsed.doc.nodes
    .flatMap((n) => (n.type === "text" ? [n.text] : n.type === "group" && n.label ? [n.label] : []))
    .join("\n\n");
}

/**
 * Point the canvas at a renamed note: file nodes whose target `matches` get `file`, and text cards
 * go through `rewriteText` (null = unchanged). Returns the new content, or null when nothing changed.
 */
export function rewriteCanvasLinks(
  content: string,
  matches: (target: string) => boolean,
  file: string,
  rewriteText: (text: string) => string | null,
): string | null {
  const parsed = parseCanvas(content);
  if (!parsed.ok) return null;
  let changed = false;
  const nodes = parsed.doc.nodes.map((n) => {
    if (n.type === "file" && isNoteFile(n.file) && matches(n.file)) {
      changed = true;
      return { ...n, file };
    }
    if (n.type === "text") {
      const next = rewriteText(n.text);
      if (next !== null && next !== n.text) {
        changed = true;
        return { ...n, text: next };
      }
    }
    return n;
  });
  return changed ? serializeCanvas({ ...parsed.doc, nodes }) : null;
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

export const MIN_NODE = { width: 80, height: 40 } as const;
export const SIDE_LIST: readonly Side[] = SIDES;

/** Middle of a card's side, where a connection attaches. */
export function anchor(r: Rect, side: Side): Point {
  if (side === "top") return { x: r.x + r.width / 2, y: r.y };
  if (side === "bottom") return { x: r.x + r.width / 2, y: r.y + r.height };
  if (side === "left") return { x: r.x, y: r.y + r.height / 2 };
  return { x: r.x + r.width, y: r.y + r.height / 2 };
}

const NORMAL: Record<Side, Point> = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

/** The side of `r` nearest to `p`. */
export function nearestSide(r: Rect, p: Point): Side {
  let best: Side = "top";
  let dist = Infinity;
  for (const s of SIDES) {
    const a = anchor(r, s);
    const d = (a.x - p.x) ** 2 + (a.y - p.y) ** 2;
    if (d < dist) {
      dist = d;
      best = s;
    }
  }
  return best;
}

/** The pair of sides that makes the shortest connection between two cards, for an edge without sides. */
export function bestSides(a: Rect, b: Rect): [Side, Side] {
  const ca = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const cb = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  return [nearestSide(a, cb), nearestSide(b, ca)];
}

export type EdgeGeometry = { d: string; from: Point; to: Point; mid: Point; c1: Point; c2: Point };

/** A cubic Bézier from one side anchor to another, its control points pushed out along each side. */
export function edgePath(from: Point, fromSide: Side, to: Point, toSide: Side | null): EdgeGeometry {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const k = Math.max(40, Math.min(200, dist * 0.45));
  const n1 = NORMAL[fromSide];
  const c1 = { x: from.x + n1.x * k, y: from.y + n1.y * k };
  const n2 = toSide ? NORMAL[toSide] : { x: 0, y: 0 };
  const c2 = { x: to.x + n2.x * k, y: to.y + n2.y * k };
  // Point at t = 0.5 of the cubic.
  const mid = { x: (from.x + 3 * c1.x + 3 * c2.x + to.x) / 8, y: (from.y + 3 * c1.y + 3 * c2.y + to.y) / 8 };
  const r = (v: number) => Math.round(v * 10) / 10;
  return { d: `M${r(from.x)},${r(from.y)} C${r(c1.x)},${r(c1.y)} ${r(c2.x)},${r(c2.y)} ${r(to.x)},${r(to.y)}`, from, to, mid, c1, c2 };
}

/** An arrowhead at `tip`, pointing away from `ctrl`, as an SVG polygon "points" value. */
export function arrowHead(tip: Point, ctrl: Point, size = 10): string {
  let dx = tip.x - ctrl.x;
  let dy = tip.y - ctrl.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const bx = tip.x - dx * size;
  const by = tip.y - dy * size;
  const w = size * 0.55;
  const p = (x: number, y: number) => `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
  return `${p(tip.x, tip.y)} ${p(bx - dy * w, by + dx * w)} ${p(bx + dy * w, by - dx * w)}`;
}

/** Smallest rectangle around `rects`, or null when there are none. */
export function boundsOf(rects: readonly Rect[]): Rect | null {
  if (!rects.length) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.width);
    y2 = Math.max(y2, r.y + r.height);
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** `inner` lies wholly inside `outer`. */
export function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** The two rectangles overlap. */
export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Cards in reading order: top to bottom, then left to right, with cards whose tops are within
 * 24px of each other read as one row. Groups come before the cards they hold at the same height.
 */
export function readingOrder<T extends Rect & { type?: string }>(nodes: readonly T[]): T[] {
  return [...nodes].sort((a, b) => {
    if (Math.abs(a.y - b.y) > 24) return a.y - b.y;
    if (a.x !== b.x) return a.x - b.x;
    return (a.type === "group" ? 0 : 1) - (b.type === "group" ? 0 : 1);
  });
}

/* ------------------------------------------------------------------ */
/* Colours                                                             */
/* ------------------------------------------------------------------ */

/** Obsidian's six presets, named the way Obsidian names them. Each maps to a checked token pair in globals.css. */
export const CANVAS_COLORS = [
  { id: "1", name: "Red" },
  { id: "2", name: "Orange" },
  { id: "3", name: "Yellow" },
  { id: "4", name: "Green" },
  { id: "5", name: "Cyan" },
  { id: "6", name: "Purple" },
] as const;

/** Display name of a colour value, for menus and the outline. */
export function colorName(color: string | undefined): string | null {
  if (!color) return null;
  return CANVAS_COLORS.find((c) => c.id === color)?.name ?? color.toLowerCase();
}

/**
 * CSS custom properties for a coloured card or connection: `--cv-edge` (lines and card edges,
 * >= 3:1 on the sheet) and `--cv-wash` (the card's faint ground). Presets use the tokens; a custom
 * hex is the person's own choice and is used as is, with the wash mixed down from it.
 */
export function colorVars(color: string | undefined): Record<string, string> | undefined {
  if (!color) return undefined;
  if (/^[1-6]$/.test(color)) return { "--cv-edge": `var(--canvas-${color})`, "--cv-wash": `var(--canvas-${color}-wash)` };
  if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(color))
    return { "--cv-edge": color, "--cv-wash": `color-mix(in srgb, ${color} 10%, var(--sheet))` };
  return undefined;
}
