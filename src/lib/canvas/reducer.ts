/**
 * The canvas editor's state as a pure reducer: the document, the selection and an undo history.
 *
 * Every change that the person makes in one go is one history step. A gesture (dragging cards,
 * resizing one) opens with `begin`, sends transient updates while the pointer moves and closes with
 * `end`, which records the document from before the gesture once. Typing in a card sends updates
 * with a `coalesce` key, so a run of keystrokes in one card is one step too.
 */
import { MIN_NODE, contains, newCanvasId, type CanvasDoc, type CanvasEdge, type CanvasNode, type Rect } from "@/lib/canvas";

export const HISTORY_LIMIT = 100;

export type CanvasState = {
  doc: CanvasDoc;
  /** Selected node and edge ids. */
  selection: string[];
  past: CanvasDoc[];
  future: CanvasDoc[];
  /** The document when the current gesture began; null outside a gesture. */
  gesture: CanvasDoc | null;
  /** Key of the last coalescing update: a new one with the same key joins its history step. */
  coalesce: string | null;
};

type Patch<T> = Partial<Omit<T, "id" | "type">>;

export type CanvasAction =
  | { type: "load"; doc: CanvasDoc }
  | { type: "select"; ids: string[] }
  | { type: "begin" }
  | { type: "end" }
  | { type: "move"; ids: string[]; dx: number; dy: number; transient?: boolean }
  | { type: "resize"; id: string; rect: Rect; transient?: boolean }
  | { type: "addNode"; node: CanvasNode; select?: boolean }
  | { type: "addEdge"; edge: CanvasEdge; select?: boolean }
  | { type: "updateNode"; id: string; patch: Patch<CanvasNode> | Record<string, unknown>; coalesce?: string }
  | { type: "updateEdge"; id: string; patch: Patch<CanvasEdge>; coalesce?: string }
  | { type: "remove"; ids: string[] }
  | { type: "duplicate"; ids: string[]; offset?: number }
  | { type: "undo" }
  | { type: "redo" };

export function initCanvasState(doc: CanvasDoc): CanvasState {
  return { doc, selection: [], past: [], future: [], gesture: null, coalesce: null };
}

/** Record `prev` as an undo step and move to `doc`. */
function commit(s: CanvasState, doc: CanvasDoc, extra: Partial<CanvasState> = {}): CanvasState {
  if (doc === s.doc) return { ...s, ...extra };
  if (s.gesture) return { ...s, doc, ...extra };
  const past = [...s.past, s.doc].slice(-HISTORY_LIMIT);
  return { ...s, doc, past, future: [], coalesce: null, ...extra };
}

/**
 * The ids a move of `ids` carries: the cards themselves plus every card wholly inside a group
 * being moved (the way groups behave in Obsidian).
 */
export function withGroupContents(doc: CanvasDoc, ids: readonly string[]): string[] {
  const set = new Set(ids);
  for (const n of doc.nodes) {
    if (n.type !== "group" || !set.has(n.id)) continue;
    for (const m of doc.nodes) if (m.id !== n.id && contains(n, m)) set.add(m.id);
  }
  return [...set];
}

const round = (v: number) => Math.round(v);

export function canvasReducer(s: CanvasState, a: CanvasAction): CanvasState {
  switch (a.type) {
    case "load":
      return initCanvasState(a.doc);
    case "select": {
      const known = new Set([...s.doc.nodes.map((n) => n.id), ...s.doc.edges.map((e) => e.id)]);
      const ids = a.ids.filter((id) => known.has(id));
      if (ids.length === s.selection.length && ids.every((id, i) => id === s.selection[i])) return s;
      return { ...s, selection: ids };
    }
    case "begin":
      return s.gesture ? s : { ...s, gesture: s.doc, coalesce: null };
    case "end": {
      if (!s.gesture) return s;
      if (s.gesture === s.doc) return { ...s, gesture: null };
      return { ...s, gesture: null, past: [...s.past, s.gesture].slice(-HISTORY_LIMIT), future: [], coalesce: null };
    }
    case "move": {
      if (!a.dx && !a.dy) return s;
      const ids = new Set(a.ids);
      const nodes = s.doc.nodes.map((n) => (ids.has(n.id) ? { ...n, x: round(n.x + a.dx), y: round(n.y + a.dy) } : n));
      const doc = { ...s.doc, nodes };
      return a.transient && s.gesture ? { ...s, doc } : commit(s, doc);
    }
    case "resize": {
      const r = {
        x: round(a.rect.x),
        y: round(a.rect.y),
        width: round(Math.max(MIN_NODE.width, a.rect.width)),
        height: round(Math.max(MIN_NODE.height, a.rect.height)),
      };
      let hit = false;
      const nodes = s.doc.nodes.map((n) => {
        if (n.id !== a.id) return n;
        hit = true;
        return { ...n, ...r };
      });
      if (!hit) return s;
      const doc = { ...s.doc, nodes };
      return a.transient && s.gesture ? { ...s, doc } : commit(s, doc);
    }
    case "addNode": {
      // Groups go first in the file, so they stay behind the cards they hold (JSON Canvas z-order).
      const nodes = a.node.type === "group" ? [a.node, ...s.doc.nodes] : [...s.doc.nodes, a.node];
      return commit(s, { ...s.doc, nodes }, a.select === false ? {} : { selection: [a.node.id] });
    }
    case "addEdge": {
      const ids = new Set(s.doc.nodes.map((n) => n.id));
      if (!ids.has(a.edge.fromNode) || !ids.has(a.edge.toNode) || a.edge.fromNode === a.edge.toNode) return s;
      return commit(s, { ...s.doc, edges: [...s.doc.edges, a.edge] }, a.select === false ? {} : { selection: [a.edge.id] });
    }
    case "updateNode": {
      let hit = false;
      const nodes = s.doc.nodes.map((n) => {
        if (n.id !== a.id) return n;
        hit = true;
        return { ...n, ...a.patch, id: n.id, type: n.type } as CanvasNode;
      });
      if (!hit) return s;
      return update(s, { ...s.doc, nodes }, a.coalesce ? `node:${a.id}:${a.coalesce}` : null);
    }
    case "updateEdge": {
      let hit = false;
      const edges = s.doc.edges.map((e) => {
        if (e.id !== a.id) return e;
        hit = true;
        return { ...e, ...a.patch, id: e.id };
      });
      if (!hit) return s;
      return update(s, { ...s.doc, edges }, a.coalesce ? `edge:${a.id}:${a.coalesce}` : null);
    }
    case "remove": {
      const ids = new Set(a.ids);
      if (!ids.size) return s;
      const nodes = s.doc.nodes.filter((n) => !ids.has(n.id));
      const left = new Set(nodes.map((n) => n.id));
      // A connection goes with either of its cards.
      const edges = s.doc.edges.filter((e) => !ids.has(e.id) && left.has(e.fromNode) && left.has(e.toNode));
      if (nodes.length === s.doc.nodes.length && edges.length === s.doc.edges.length) return s;
      const doc = { ...s.doc, nodes, edges };
      return commit(s, doc, { selection: keep(doc, s.selection) });
    }
    case "duplicate": {
      const offset = a.offset ?? 40;
      const ids = new Set(withGroupContents(s.doc, a.ids.filter((id) => s.doc.nodes.some((n) => n.id === id))));
      if (!ids.size) return s;
      const map = new Map<string, string>();
      const copies: CanvasNode[] = [];
      for (const n of s.doc.nodes) {
        if (!ids.has(n.id)) continue;
        const id = newCanvasId();
        map.set(n.id, id);
        copies.push({ ...n, id, x: n.x + offset, y: n.y + offset });
      }
      // Connections between copied cards are copied with them.
      const edges = s.doc.edges
        .filter((e) => map.has(e.fromNode) && map.has(e.toNode))
        .map((e) => ({ ...e, id: newCanvasId(), fromNode: map.get(e.fromNode)!, toNode: map.get(e.toNode)! }));
      const groups = copies.filter((c) => c.type === "group");
      const others = copies.filter((c) => c.type !== "group");
      const doc = { ...s.doc, nodes: [...groups, ...s.doc.nodes, ...others], edges: [...s.doc.edges, ...edges] };
      const selected = a.ids.flatMap((id) => (map.has(id) ? [map.get(id)!] : []));
      return commit(s, doc, { selection: selected });
    }
    case "undo": {
      if (s.gesture || !s.past.length) return s;
      const doc = s.past[s.past.length - 1];
      return { ...s, doc, past: s.past.slice(0, -1), future: [s.doc, ...s.future], selection: keep(doc, s.selection), coalesce: null };
    }
    case "redo": {
      if (s.gesture || !s.future.length) return s;
      const doc = s.future[0];
      return { ...s, doc, past: [...s.past, s.doc], future: s.future.slice(1), selection: keep(doc, s.selection), coalesce: null };
    }
  }
}

/** An update that joins the previous history step when it carries the same coalesce key. */
function update(s: CanvasState, doc: CanvasDoc, key: string | null): CanvasState {
  if (key && key === s.coalesce && !s.gesture) return { ...s, doc };
  const next = commit(s, doc);
  return { ...next, coalesce: key };
}

/** The selected ids that still exist in `doc`. */
function keep(doc: CanvasDoc, selection: string[]) {
  const ids = new Set([...doc.nodes.map((n) => n.id), ...doc.edges.map((e) => e.id)]);
  return selection.filter((id) => ids.has(id));
}
