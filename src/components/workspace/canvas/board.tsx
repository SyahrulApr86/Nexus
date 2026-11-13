"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  CANVAS_COLORS,
  MIN_NODE,
  bestSides,
  boundsOf,
  canvasTitle,
  colorVars,
  intersects,
  isCanvasPath,
  nearestSide,
  newCanvasId,
  normalizeWebUrl,
  readingOrder,
  serializeCanvas,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasNode,
  type Point,
  type Rect,
  type Side,
} from "@/lib/canvas";
import { canvasReducer, initCanvasState, withGroupContents } from "@/lib/canvas/reducer";
import { basename } from "@/lib/markdown/parse";
import { api } from "../api";
import { Palette } from "../palette";
import { shallowEqual, useWorkspaceActions, useWorkspaceSelector } from "../store";
import { Menu, type MenuAnchor, type MenuItem } from "../ui";
import { FileCardBody, LinkCardBody, TextCardBody, fileLabel, safeUrl } from "./cards";
import { fileFor } from "./create";
import { EdgeKnob, EdgeLines, placeEdges } from "./edges";
import { CanvasOutline } from "./outline";
import { CanvasToolbar } from "./toolbar";

/* ------------------------------------------------------------------ */
/* Viewport                                                            */
/* ------------------------------------------------------------------ */

export type Viewport = { x: number; y: number; zoom: number };
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 3;
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
/** Where each canvas was left, so a tab switch or a reload from the server keeps the view. */
const viewports = new Map<string, Viewport>();

const STEP = 8;
const BIG_STEP = 40;
const DRAG_SLOP = 4;
const LONG_PRESS = 500;

type Drag =
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number; moved: boolean; clear: boolean }
  | { kind: "move"; ids: string[]; sx: number; sy: number; lx: number; ly: number; moved: boolean; timer?: ReturnType<typeof setTimeout> }
  | { kind: "resize"; id: string; start: Rect; sx: number; sy: number; moved: boolean }
  | { kind: "marquee"; ax: number; ay: number; base: string[] }
  | { kind: "connect"; from: string; side: Side; start: Point };

type Editing = { kind: "node" | "edge"; id: string } | null;

/**
 * After a long press opened a menu, the finger's lift still sends mouse events and a click to whatever
 * is under it (the menu's backdrop or first item). Swallow them so the menu stays open with focus.
 */
function swallowNextClick() {
  const stop = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  // The lift's compatibility mousedown would also move focus out of the menu.
  for (const type of ["mousedown", "mouseup", "click"] as const) {
    window.addEventListener(type, stop, { capture: true, once: true });
    setTimeout(() => window.removeEventListener(type, stop, { capture: true }), 1000);
  }
}
type MenuState = { anchor: MenuAnchor; label: string; items: MenuItem[] } | null;

/* ------------------------------------------------------------------ */
/* Names                                                               */
/* ------------------------------------------------------------------ */

/** First line of a text card without markdown marks, for names and the outline. */
function excerpt(text: string) {
  const line = text
    .split("\n")
    .map((l) => l.replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[.\]\s+)?|>\s*|\d+\.\s+)/, "").replace(/[*_`~=]|\[\[|\]\]/g, "").trim())
    .find(Boolean);
  if (!line) return "Empty text card";
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

function nameOf(n: CanvasNode) {
  if (n.type === "text") return excerpt(n.text);
  if (n.type === "file") return isCanvasPath(n.file) ? canvasTitle(basename(n.file)) : fileLabel(n.file);
  if (n.type === "link") {
    try {
      return new URL(n.url).hostname || n.url;
    } catch {
      return n.url || "Web link";
    }
  }
  return n.label?.trim() || "Untitled group";
}

function kindOf(n: CanvasNode) {
  if (n.type === "text") return "Text card";
  if (n.type === "file") return /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(n.file) ? "Image card" : "Note card";
  if (n.type === "link") return "Web link card";
  return "Group";
}

/* ------------------------------------------------------------------ */
/* Board                                                               */
/* ------------------------------------------------------------------ */

export function CanvasBoard({
  noteId,
  name,
  initial,
  onSave,
}: {
  noteId: string;
  name: string;
  initial: CanvasDoc;
  onSave: (json: string) => void;
}) {
  const actions = useWorkspaceActions();
  const w = useWorkspaceSelector((s) => ({ dialog: s.dialog, findNote: s.findNote, notes: s.tree.notes }), shallowEqual);
  const [state, dispatch] = useReducer(canvasReducer, initial, initCanvasState);
  const { doc } = state;
  const helpId = useId();

  const rootRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  const findRef = useRef(w.findNote);
  const [view, setViewState] = useState<Viewport>(() => viewports.get(noteId) ?? { x: 0, y: 0, zoom: 1 });
  const viewRef = useRef(view);
  const [ready, setReady] = useState(() => viewports.has(noteId));
  const [editing, setEditing] = useState<Editing>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [outline, setOutline] = useState(false);
  const [picker, setPicker] = useState<Point | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [draft, setDraft] = useState<{ from: Point; side: Side; to: Point } | null>(null);
  const [message, setMessage] = useState("");
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ dist: number; mid: Point; view: Viewport } | null>(null);
  const saved = useRef(initial);

  useLayoutEffect(() => {
    stateRef.current = state;
    findRef.current = w.findNote;
  });

  const setView = useCallback(
    (next: Viewport | ((v: Viewport) => Viewport)) => {
      const v = typeof next === "function" ? next(viewRef.current) : next;
      viewRef.current = v;
      viewports.set(noteId, v);
      setViewState(v);
    },
    [noteId],
  );

  const announce = useCallback((m: string) => setMessage((prev) => (prev === m ? `${m} ` : m)), []);

  /* ---------------- derived ---------------- */

  const names = useMemo(() => new Map(doc.nodes.map((n) => [n.id, nameOf(n)])), [doc.nodes]);
  const kinds = useMemo(() => new Map(doc.nodes.map((n) => [n.id, kindOf(n)])), [doc.nodes]);
  const ordered = useMemo(() => readingOrder(doc.nodes), [doc.nodes]);
  const edges = useMemo(() => placeEdges(doc, names), [doc, names]);
  const selected = useMemo(() => new Set(state.selection), [state.selection]);
  const selectedNodes = useMemo(() => doc.nodes.filter((n) => selected.has(n.id)), [doc.nodes, selected]);
  // Stacking (tab order stays reading order): groups in file order, then the connection lines,
  // then cards in file order, then connection labels on top.
  const layer = useMemo(() => {
    const z = new Map<string, number>();
    doc.nodes.forEach((n, i) => z.set(n.id, n.type === "group" ? i : doc.nodes.length + 1 + i));
    return z;
  }, [doc.nodes]);

  /* ---------------- autosave ---------------- */

  // Every finished change goes through the normal save path (debounced there, with conflict handling).
  useEffect(() => {
    if (state.gesture || doc === saved.current) return;
    saved.current = doc;
    onSave(serializeCanvas(doc));
  }, [doc, state.gesture, onSave]);

  /* ---------------- geometry ---------------- */

  const local = useCallback((clientX: number, clientY: number): Point => {
    const r = rootRef.current?.getBoundingClientRect();
    return { x: clientX - (r?.left ?? 0), y: clientY - (r?.top ?? 0) };
  }, []);
  const toWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const p = local(clientX, clientY);
      const v = viewRef.current;
      return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom };
    },
    [local],
  );

  const zoomAt = useCallback(
    (factor: number, at?: Point) => {
      const el = rootRef.current;
      const p = at ?? { x: (el?.clientWidth ?? 0) / 2, y: (el?.clientHeight ?? 0) / 2 };
      setView((v) => {
        const zoom = clampZoom(v.zoom * factor);
        return { zoom, x: p.x - ((p.x - v.x) * zoom) / v.zoom, y: p.y - ((p.y - v.y) * zoom) / v.zoom };
      });
    },
    [setView],
  );

  /** Fit `rects` (default: every card) in the view, never zooming in past 100%. */
  const fit = useCallback(
    (rects?: Rect[]) => {
      const el = rootRef.current;
      if (!el) return;
      const b = boundsOf(rects ?? stateRef.current.doc.nodes);
      const W = el.clientWidth;
      const H = el.clientHeight;
      if (!b) return setView({ x: W / 2, y: H / 2, zoom: 1 });
      const pad = 48;
      const bottom = 72; // the toolbar
      const zoom = clampZoom(Math.min((W - pad * 2) / Math.max(b.width, 1), (H - pad - bottom) / Math.max(b.height, 1), 1));
      setView({ zoom, x: (W - b.width * zoom) / 2 - b.x * zoom, y: (H - bottom + pad - b.height * zoom) / 2 - b.y * zoom });
    },
    [setView],
  );

  /** Pan just enough to bring a card fully into view (centred when it does not fit). */
  const reveal = useCallback(
    (r: Rect) => {
      const el = rootRef.current;
      if (!el) return;
      const v = viewRef.current;
      const W = el.clientWidth;
      const H = el.clientHeight - 64;
      const sx = r.x * v.zoom + v.x;
      const sy = r.y * v.zoom + v.y;
      const sw = r.width * v.zoom;
      const sh = r.height * v.zoom;
      const m = 24;
      let x = v.x;
      let y = v.y;
      if (sw + 2 * m > W) x = W / 2 - (r.x + r.width / 2) * v.zoom;
      else if (sx < m) x += m - sx;
      else if (sx + sw > W - m) x -= sx + sw - (W - m);
      if (sh + 2 * m > H) y = m - r.y * v.zoom;
      else if (sy < m) y += m - sy;
      else if (sy + sh > H - m) y -= sy + sh - (H - m);
      if (x !== v.x || y !== v.y) setView({ ...v, x, y });
    },
    [setView],
  );

  // Size: the first measure fits the canvas when there is no remembered view.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (!el.clientWidth || !el.clientHeight) return;
      if (!viewports.has(noteId)) fit();
      setReady(true);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [noteId, fit]);

  /* ---------------- focus ---------------- */

  const focusNode = useCallback((id: string) => {
    requestAnimationFrame(() => {
      const el = rootRef.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);
      el?.focus({ preventScroll: true });
    });
  }, []);
  const focusEdge = useCallback((id: string) => {
    requestAnimationFrame(() => {
      const el = rootRef.current?.querySelector<HTMLElement>(`button[data-edge-id="${CSS.escape(id)}"]`);
      el?.focus({ preventScroll: true });
    });
  }, []);

  const stopEditing = useCallback(
    (refocus: boolean) => {
      const cur = editing;
      setEditing(null);
      if (!cur || !refocus) return;
      if (cur.kind === "node") focusNode(cur.id);
      else focusEdge(cur.id);
    },
    [editing, focusNode, focusEdge],
  );

  /* ---------------- creating ---------------- */

  /**
   * The free spot nearest to `p` for a card of `size`: rings of candidate positions around `p`,
   * the first that overlaps no card (groups may hold it). Falls back to `p` on a crowded canvas.
   */
  const placeAt = useCallback((p: Point, size: { width: number; height: number }): Rect => {
    const at = (x: number, y: number) => ({ x: Math.round(x - size.width / 2), y: Math.round(y - size.height / 2), ...size });
    const cards = stateRef.current.doc.nodes.filter((n) => n.type !== "group");
    const gap = 24;
    const free = (r: Rect) => !cards.some((n) => intersects({ x: r.x - gap, y: r.y - gap, width: r.width + gap * 2, height: r.height + gap * 2 }, n));
    const first = at(p.x, p.y);
    if (free(first)) return first;
    const step = 60;
    for (let ring = 1; ring <= 20; ring++) {
      const d = ring * step;
      const tries: Point[] = [];
      for (let k = -ring; k <= ring; k++) {
        tries.push({ x: p.x + k * step, y: p.y + d }, { x: p.x + k * step, y: p.y - d }, { x: p.x + d, y: p.y + k * step }, { x: p.x - d, y: p.y + k * step });
      }
      tries.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
      for (const c of tries) {
        const r = at(c.x, c.y);
        if (free(r)) return r;
      }
    }
    return first;
  }, []);

  const viewCenter = useCallback((): Point => {
    const el = rootRef.current;
    const v = viewRef.current;
    return { x: ((el?.clientWidth ?? 0) / 2 - v.x) / v.zoom, y: ((el?.clientHeight ?? 0) / 2 - 32 - v.y) / v.zoom };
  }, []);

  const addNode = useCallback(
    (node: CanvasNode, edit = false) => {
      dispatch({ type: "addNode", node });
      reveal(node);
      announce(`${kindOf(node)} added`);
      if (edit) setEditing({ kind: "node", id: node.id });
      else focusNode(node.id);
    },
    [reveal, announce, focusNode],
  );

  const addText = useCallback(
    (at?: Point) => addNode({ id: newCanvasId(), type: "text", text: "", ...placeAt(at ?? viewCenter(), { width: 260, height: 140 }) }, true),
    [addNode, placeAt, viewCenter],
  );

  const addLink = useCallback(
    async (at?: Point) => {
      const p = at ?? viewCenter();
      const raw = await w.dialog.prompt({
        title: "Add web link",
        label: "Web address",
        value: "",
        confirm: "Add link",
        hint: "For example https://example.org. The card shows the address and opens it in a new browser tab.",
        submit: async (value) => {
          if (!normalizeWebUrl(value)) throw new Error("Enter a web address that starts with https:// or http://");
        },
      });
      const url = raw ? normalizeWebUrl(raw) : null;
      if (!url) return;
      addNode({ id: newCanvasId(), type: "link", url, ...placeAt(p, { width: 400, height: 120 }) });
    },
    [w.dialog, addNode, placeAt, viewCenter],
  );

  const addGroup = useCallback(
    (at?: Point) => {
      const nodes = stateRef.current.doc.nodes.filter((n) => stateRef.current.selection.includes(n.id));
      const b = !at && nodes.length ? boundsOf(nodes) : null;
      const rect = b
        ? { x: b.x - 40, y: b.y - 40, width: b.width + 80, height: b.height + 80 }
        : placeAt(at ?? viewCenter(), { width: 480, height: 320 });
      addNode({ id: newCanvasId(), type: "group", label: "", ...rect }, true);
    },
    [addNode, placeAt, viewCenter],
  );

  const addNoteCard = useCallback((noteIdToAdd: string, at: Point) => {
    const n = w.notes.find((x) => x.id === noteIdToAdd);
    if (!n) return;
    addNode({ id: newCanvasId(), type: "file", file: fileFor(n.path), ...placeAt(at, { width: 400, height: 400 }) });
  }, [w.notes, addNode, placeAt]);

  /* ---------------- editing commands ---------------- */

  const removeSelection = useCallback(() => {
    const s = stateRef.current;
    if (!s.selection.length) return;
    const count = s.selection.length;
    dispatch({ type: "remove", ids: s.selection });
    announce(count === 1 ? "Deleted. Press Ctrl+Z to undo." : `${count} items deleted. Press Ctrl+Z to undo.`);
    rootRef.current?.focus({ preventScroll: true });
  }, [announce]);

  const duplicate = useCallback(() => {
    const s = stateRef.current;
    const ids = s.selection.filter((id) => s.doc.nodes.some((n) => n.id === id));
    if (!ids.length) return;
    dispatch({ type: "duplicate", ids });
    announce(ids.length === 1 ? "Card duplicated" : `${ids.length} cards duplicated`);
    requestAnimationFrame(() => {
      const first = stateRef.current.selection[0];
      if (first) focusNode(first);
    });
  }, [announce, focusNode]);

  const undo = useCallback(() => {
    if (!stateRef.current.past.length) return;
    setEditing(null);
    dispatch({ type: "undo" });
    announce("Undone");
  }, [announce]);
  const redo = useCallback(() => {
    if (!stateRef.current.future.length) return;
    setEditing(null);
    dispatch({ type: "redo" });
    announce("Redone");
  }, [announce]);

  const openFile = useCallback(
    (file: string, newTab: boolean) => {
      const hit = findRef.current(file);
      if (hit) actions.open(hit.id, newTab ? "tab" : "current");
      else actions.notify(`“${fileLabel(file)}” is not in this vault`, { tone: "error" });
    },
    [actions],
  );

  /** Enter or double-click: edit a text card or group label, open a note or a link. */
  const activate = useCallback(
    (id: string, newTab = false) => {
      const n = stateRef.current.doc.nodes.find((x) => x.id === id);
      if (!n) return;
      if (n.type === "text" || n.type === "group") setEditing({ kind: "node", id });
      else if (n.type === "file") openFile(n.file, newTab);
      else if (n.type === "link") {
        const href = safeUrl(n.url);
        if (href) window.open(href, "_blank", "noopener,noreferrer");
      }
    },
    [openFile],
  );

  const connect = useCallback(
    (from: string, to: string, fromSide?: Side, toSide?: Side) => {
      const s = stateRef.current.doc;
      const a = s.nodes.find((n) => n.id === from);
      const b = s.nodes.find((n) => n.id === to);
      if (!a || !b || a.id === b.id) return;
      const [sa, sb] = bestSides(a, b);
      const edge: CanvasEdge = { id: newCanvasId(), fromNode: from, fromSide: fromSide ?? sa, toNode: to, toSide: toSide ?? sb };
      dispatch({ type: "addEdge", edge, select: false });
      announce(`Connected ${nameOf(a)} to ${nameOf(b)}`);
    },
    [announce],
  );

  /* ---------------- menus ---------------- */

  const colorItems = useCallback(
    (current: string | undefined, apply: (c: string | undefined) => void): MenuItem[] => [
      { label: "No color", checked: !current, onSelect: () => apply(undefined) },
      ...CANVAS_COLORS.map((c) => ({ label: c.name, checked: current === c.id, onSelect: () => apply(c.id) })),
    ],
    [],
  );

  const openNodeMenu = useCallback(
    (id: string, anchor: MenuAnchor) => {
      const s = stateRef.current;
      const n = s.doc.nodes.find((x) => x.id === id);
      if (!n) return;
      if (!s.selection.includes(id)) dispatch({ type: "select", ids: [id] });
      const ids = s.selection.includes(id) ? s.selection.filter((x) => s.doc.nodes.some((m) => m.id === x)) : [id];
      const again = (label: string, items: MenuItem[]) => setMenu({ anchor: anchor instanceof DOMRect ? DOMRect.fromRect(anchor) : { ...anchor }, label, items });
      const setColor = (c: string | undefined) => {
        for (const x of ids) dispatch({ type: "updateNode", id: x, patch: { color: c } });
        announce(c ? `Color set to ${CANVAS_COLORS.find((k) => k.id === c)?.name}` : "Color removed");
      };
      const others = readingOrder(s.doc.nodes).filter((m) => m.id !== id);
      const items: MenuItem[] = [];
      if (n.type === "text") items.push({ label: "Edit text", shortcut: "Enter", onSelect: () => setEditing({ kind: "node", id }) });
      if (n.type === "group") items.push({ label: "Rename group", shortcut: "Enter", onSelect: () => setEditing({ kind: "node", id }) });
      if (n.type === "file") {
        items.push({ label: "Open note", shortcut: "Enter", onSelect: () => openFile(n.file, false) });
        items.push({ label: "Open in new tab", onSelect: () => openFile(n.file, true) });
      }
      if (n.type === "link") {
        items.push({ label: "Open link", shortcut: "Enter", onSelect: () => activate(id) });
        items.push({
          label: "Edit link…",
          onSelect: async () => {
            const v = await w.dialog.prompt({
              title: "Edit web link",
              label: "Web address",
              value: n.url,
              confirm: "Save",
              submit: async (value) => {
                if (!normalizeWebUrl(value)) throw new Error("Enter a web address that starts with https:// or http://");
              },
            });
            const url = v ? normalizeWebUrl(v) : null;
            if (url && url !== n.url) dispatch({ type: "updateNode", id, patch: { url } });
          },
        });
      }
      items.push(
        "separator",
        { label: "Color…", onSelect: () => again(`Color of ${nameOf(n)}`, colorItems(n.color, setColor)) },
        {
          label: "Connect to…",
          disabled: !others.length,
          onSelect: () =>
            again(
              `Connect ${nameOf(n)} to`,
              others.map((m) => ({ label: `${nameOf(m)} (${kindOf(m).toLowerCase()})`, onSelect: () => connect(id, m.id) })),
            ),
        },
        { label: "Duplicate", shortcut: "Mod+D", onSelect: duplicate },
        "separator",
        { label: ids.length > 1 ? `Delete ${ids.length} cards` : "Delete", shortcut: "Delete", danger: true, onSelect: removeSelection },
      );
      setMenu({ anchor, label: `${kindOf(n)} actions`, items });
    },
    [announce, activate, openFile, connect, duplicate, removeSelection, colorItems, w.dialog],
  );

  const openEdgeMenu = useCallback(
    (id: string, anchor: MenuAnchor) => {
      const e = stateRef.current.doc.edges.find((x) => x.id === id);
      if (!e) return;
      dispatch({ type: "select", ids: [id] });
      const again = (label: string, items: MenuItem[]) => setMenu({ anchor: anchor instanceof DOMRect ? DOMRect.fromRect(anchor) : { ...anchor }, label, items });
      const toEnd = e.toEnd ?? "arrow";
      const fromEnd = e.fromEnd ?? "none";
      setMenu({
        anchor,
        label: "Connection actions",
        items: [
          { label: e.label ? "Edit label" : "Add label", shortcut: "Enter", onSelect: () => setEditing({ kind: "edge", id }) },
          {
            label: "Color…",
            onSelect: () =>
              again(
                "Connection color",
                colorItems(e.color, (c) => dispatch({ type: "updateEdge", id, patch: { color: c } })),
              ),
          },
          { label: "Arrow at end", checked: toEnd === "arrow", onSelect: () => dispatch({ type: "updateEdge", id, patch: { toEnd: toEnd === "arrow" ? "none" : "arrow" } }) },
          { label: "Arrow at start", checked: fromEnd === "arrow", onSelect: () => dispatch({ type: "updateEdge", id, patch: { fromEnd: fromEnd === "arrow" ? "none" : "arrow" } }) },
          "separator",
          { label: "Delete connection", shortcut: "Delete", danger: true, onSelect: removeSelection },
        ],
      });
    },
    [colorItems, removeSelection],
  );

  const openBackgroundMenu = useCallback(
    (anchor: MenuAnchor, at: Point) => {
      setMenu({
        anchor,
        label: "Canvas actions",
        items: [
          { label: "Add text card", onSelect: () => addText(at) },
          { label: "Add note card…", onSelect: () => setPicker(at) },
          { label: "Add web link…", onSelect: () => void addLink(at) },
          { label: "Add group", onSelect: () => addGroup(at) },
          "separator",
          { label: "Zoom to fit", shortcut: "Shift+1", onSelect: () => fit() },
          { label: "Select all", shortcut: "Mod+A", onSelect: () => dispatch({ type: "select", ids: stateRef.current.doc.nodes.map((n) => n.id) }) },
        ],
      });
    },
    [addText, addLink, addGroup, fit],
  );

  /* ---------------- pointer input ---------------- */

  const endDrag = useCallback(() => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === "move") clearTimeout(d.timer);
    if (stateRef.current.gesture) dispatch({ type: "end" });
    setMarquee(null);
    setDraft(null);
    setPanning(false);
  }, []);

  const onWindowMove = useCallback(
    (e: PointerEvent) => {
      if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // Two fingers: pinch to zoom and pan together.
      const p = pinch.current;
      if (p && pointers.current.size >= 2) {
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = local((a.x + b.x) / 2, (a.y + b.y) / 2);
        const zoom = clampZoom(p.view.zoom * (dist / Math.max(p.dist, 1)));
        const wx = (p.mid.x - p.view.x) / p.view.zoom;
        const wy = (p.mid.y - p.view.y) / p.view.zoom;
        setView({ zoom, x: mid.x - wx * zoom, y: mid.y - wy * zoom });
        return;
      }
      const d = drag.current;
      if (!d) return;
      const v = viewRef.current;
      if (d.kind === "pan") {
        const dx = e.clientX - d.sx;
        const dy = e.clientY - d.sy;
        if (!d.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
        if (!d.moved) setPanning(true);
        d.moved = true;
        setView({ ...v, x: d.vx + dx, y: d.vy + dy });
      } else if (d.kind === "move") {
        if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_SLOP) return;
        if (!d.moved) {
          d.moved = true;
          clearTimeout(d.timer);
          dispatch({ type: "begin" });
        }
        const p2 = toWorld(e.clientX, e.clientY);
        const dx = p2.x - d.lx;
        const dy = p2.y - d.ly;
        // Whole pixels only: the remainder stays in lx/ly for the next move.
        const rx = Math.round(dx);
        const ry = Math.round(dy);
        if (!rx && !ry) return;
        d.lx += rx;
        d.ly += ry;
        dispatch({ type: "move", ids: d.ids, dx: rx, dy: ry, transient: true });
      } else if (d.kind === "resize") {
        if (!d.moved) {
          d.moved = true;
          dispatch({ type: "begin" });
        }
        const dx = (e.clientX - d.sx) / v.zoom;
        const dy = (e.clientY - d.sy) / v.zoom;
        dispatch({ type: "resize", id: d.id, rect: { ...d.start, width: d.start.width + dx, height: d.start.height + dy }, transient: true });
      } else if (d.kind === "marquee") {
        const p2 = local(e.clientX, e.clientY);
        const r = { x: Math.min(d.ax, p2.x), y: Math.min(d.ay, p2.y), width: Math.abs(p2.x - d.ax), height: Math.abs(p2.y - d.ay) };
        setMarquee(r);
        const world = { x: (r.x - v.x) / v.zoom, y: (r.y - v.y) / v.zoom, width: r.width / v.zoom, height: r.height / v.zoom };
        const hits = stateRef.current.doc.nodes.filter((n) => intersects(world, n)).map((n) => n.id);
        dispatch({ type: "select", ids: [...new Set([...d.base, ...hits])] });
      } else if (d.kind === "connect") {
        setDraft({ from: d.start, side: d.side, to: toWorld(e.clientX, e.clientY) });
      }
    },
    [local, toWorld, setView],
  );

  const onWindowUp = useCallback(
    (e: PointerEvent) => {
      pointers.current.delete(e.pointerId);
      if (pinch.current) {
        if (pointers.current.size < 2) pinch.current = null;
        if (pointers.current.size === 0) endDrag();
        return;
      }
      const d = drag.current;
      if (!d) return;
      if (d.kind === "pan" && !d.moved && d.clear && e.type === "pointerup") dispatch({ type: "select", ids: [] });
      if (d.kind === "move" && d.moved) announce(d.ids.length === 1 ? "Card moved" : `${d.ids.length} cards moved`);
      if (d.kind === "resize" && d.moved) announce("Card resized");
      if (d.kind === "connect" && e.type === "pointerup") {
        const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-node-id]");
        const to = el?.dataset.nodeId;
        const p = toWorld(e.clientX, e.clientY);
        const target = to ? stateRef.current.doc.nodes.find((n) => n.id === to) : undefined;
        if (target && to !== d.from) connect(d.from, target.id, d.side, nearestSide(target, p));
        else if (!target && Math.hypot(p.x - d.start.x, p.y - d.start.y) > 60) {
          // Dropped on empty space: a new text card there, connected, ready to write in (as in Obsidian).
          const id = newCanvasId();
          const rect = { x: Math.round(p.x - 130), y: Math.round(p.y - 30), width: 260, height: 140 };
          dispatch({ type: "addNode", node: { id, type: "text", text: "", ...rect }, select: true });
          const side = nearestSide(rect, d.start);
          dispatch({ type: "addEdge", edge: { id: newCanvasId(), fromNode: d.from, fromSide: d.side, toNode: id, toSide: side }, select: false });
          setEditing({ kind: "node", id });
          announce("Text card added and connected");
        }
      }
      endDrag();
    },
    [announce, connect, endDrag, toWorld],
  );

  useEffect(() => {
    window.addEventListener("pointermove", onWindowMove);
    window.addEventListener("pointerup", onWindowUp);
    window.addEventListener("pointercancel", onWindowUp);
    return () => {
      window.removeEventListener("pointermove", onWindowMove);
      window.removeEventListener("pointerup", onWindowUp);
      window.removeEventListener("pointercancel", onWindowUp);
    };
  }, [onWindowMove, onWindowUp]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-canvas-ui]")) return;
    if (e.pointerType === "touch") {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 2) {
        // A second finger turns whatever the first one started into a pinch.
        const d = drag.current;
        if (d?.kind === "move") clearTimeout(d.timer);
        drag.current = null;
        if (stateRef.current.gesture) dispatch({ type: "end" });
        const [a, b] = [...pointers.current.values()];
        pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: local((a.x + b.x) / 2, (a.y + b.y) / 2), view: viewRef.current };
        return;
      }
    }
    if (e.button === 2) return;
    const nodeEl = t.closest<HTMLElement>("[data-node-id]");
    if (editing) {
      const inside = editing.kind === "node" ? nodeEl?.dataset.nodeId === editing.id : !!t.closest(".canvas-edge-input");
      if (inside) return;
      stopEditing(false);
    }
    const v = viewRef.current;
    // Space held, or the middle button: pan from anywhere, even over a card.
    if ((spaceDown && e.button === 0) || e.button === 1) {
      e.preventDefault();
      drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y, moved: false, clear: false };
      return;
    }
    const handle = t.closest<HTMLElement>("[data-handle]");
    if (handle && nodeEl) {
      e.preventDefault();
      const n = stateRef.current.doc.nodes.find((x) => x.id === nodeEl.dataset.nodeId);
      if (!n) return;
      const side = handle.dataset.handle as Side;
      const start = side === "top" ? { x: n.x + n.width / 2, y: n.y } : side === "bottom" ? { x: n.x + n.width / 2, y: n.y + n.height } : side === "left" ? { x: n.x, y: n.y + n.height / 2 } : { x: n.x + n.width, y: n.y + n.height / 2 };
      drag.current = { kind: "connect", from: n.id, side, start };
      setDraft({ from: start, side, to: start });
      return;
    }
    if (t.closest("[data-resize]") && nodeEl) {
      e.preventDefault();
      const n = stateRef.current.doc.nodes.find((x) => x.id === nodeEl.dataset.nodeId);
      if (!n) return;
      drag.current = { kind: "resize", id: n.id, start: { x: n.x, y: n.y, width: n.width, height: n.height }, sx: e.clientX, sy: e.clientY, moved: false };
      return;
    }
    const edgeEl = t.closest<HTMLElement>("[data-edge-id]");
    if (edgeEl) {
      const id = edgeEl.dataset.edgeId!;
      const sel = stateRef.current.selection;
      dispatch({ type: "select", ids: e.shiftKey ? (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]) : [id] });
      return;
    }
    if (nodeEl) {
      const id = nodeEl.dataset.nodeId!;
      const sel = stateRef.current.selection;
      let next = sel;
      if (e.shiftKey) next = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
      else if (!sel.includes(id)) next = [id];
      dispatch({ type: "select", ids: next });
      if (e.shiftKey && !next.includes(id)) return;
      const nodeIds = next.filter((x) => stateRef.current.doc.nodes.some((n) => n.id === x));
      const p = toWorld(e.clientX, e.clientY);
      const d: Drag = { kind: "move", ids: withGroupContents(stateRef.current.doc, nodeIds), sx: e.clientX, sy: e.clientY, lx: p.x, ly: p.y, moved: false };
      // Long press on touch opens the card menu.
      if (e.pointerType === "touch") {
        const at = { x: e.clientX, y: e.clientY };
        d.timer = setTimeout(() => {
          if (drag.current === d && !d.moved) {
            drag.current = null;
            swallowNextClick();
            // The menu hands focus back to the card when it closes.
            nodeEl.focus({ preventScroll: true });
            openNodeMenu(id, at);
          }
        }, LONG_PRESS);
      }
      drag.current = d;
      return;
    }
    // Empty space: drag pans; Shift+drag draws a selection box.
    if (e.shiftKey && e.pointerType !== "touch" && e.button === 0 && !spaceDown) {
      const p = local(e.clientX, e.clientY);
      drag.current = { kind: "marquee", ax: p.x, ay: p.y, base: stateRef.current.selection };
      return;
    }
    if (e.button === 0 || e.button === 1) {
      if (e.button === 1) e.preventDefault();
      drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y, moved: false, clear: !e.shiftKey };
      if (e.pointerType === "touch") {
        const at = { x: e.clientX, y: e.clientY };
        const d = drag.current;
        setTimeout(() => {
          if (drag.current === d && !d.moved && pointers.current.size === 1) {
            drag.current = null;
            swallowNextClick();
            rootRef.current?.focus({ preventScroll: true });
            openBackgroundMenu(at, toWorld(at.x, at.y));
          }
        }, LONG_PRESS);
      }
    }
  };

  // Wheel: scroll pans, Ctrl/Cmd+wheel (and trackpad pinch) zooms. Non-passive, so it can stop page scroll.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-canvas-ui]")) return;
      const zoom = e.ctrlKey || e.metaKey;
      if (!zoom) {
        // A card that can still scroll that way keeps the wheel.
        const scroller = t.closest<HTMLElement>("[data-canvas-scroll]");
        if (scroller) {
          const down = e.deltaY > 0;
          const can = down ? scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1 : scroller.scrollTop > 0;
          if (e.deltaY && can) return;
        }
      }
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      // About 20% per mouse-wheel notch (deltaY 100); trackpad pinches send small deltas and zoom smoothly.
      if (zoom) zoomAt(Math.exp(-Math.max(-150, Math.min(150, e.deltaY * unit)) * 0.002), local(e.clientX, e.clientY));
      else {
        const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * unit;
        const dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * unit;
        setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, local, setView]);

  /* ---------------- keyboard ---------------- */

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-canvas-ui]")) return;
    const typing = t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA";
    if (typing) {
      // Escape leaves the card editor (after CodeMirror had its turn, e.g. closing a completion list).
      if (e.key === "Escape" && !e.defaultPrevented && editing?.kind === "node") {
        e.preventDefault();
        stopEditing(true);
      }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const nodeEl = t.dataset.nodeId ? t : null;
    const edgeEl = t.dataset.edgeId ? t : null;
    const s = stateRef.current;
    const run = (fn: () => void) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    };

    if (mod && !e.altKey) {
      const key = k.toLowerCase();
      if (key === "z" && !e.shiftKey) return run(undo);
      if ((key === "z" && e.shiftKey) || key === "y") return run(redo);
      if (key === "d") return run(duplicate);
      if (key === "a") return run(() => dispatch({ type: "select", ids: s.doc.nodes.map((n) => n.id) }));
      if (k === "=" || k === "+") return run(() => zoomAt(1.2));
      if (k === "-") return run(() => zoomAt(1 / 1.2));
      if (k === "0") return run(() => setView((v) => ({ ...v, zoom: 1 })));
      return;
    }
    if (k === " " && (t === rootRef.current || nodeEl)) {
      e.preventDefault();
      if (!e.repeat) setSpaceDown(true);
      return;
    }
    if (k.startsWith("Arrow")) {
      const dx = k === "ArrowLeft" ? -1 : k === "ArrowRight" ? 1 : 0;
      const dy = k === "ArrowUp" ? -1 : k === "ArrowDown" ? 1 : 0;
      const step = e.shiftKey ? BIG_STEP : STEP;
      const nodeIds = s.selection.filter((id) => s.doc.nodes.some((n) => n.id === id));
      if (nodeIds.length && (nodeEl || t === rootRef.current)) {
        if (e.altKey) {
          const n = s.doc.nodes.find((x) => x.id === (nodeEl?.dataset.nodeId ?? nodeIds[0]));
          if (!n) return;
          return run(() => {
            const width = Math.max(MIN_NODE.width, n.width + dx * step);
            const height = Math.max(MIN_NODE.height, n.height + dy * step);
            dispatch({ type: "resize", id: n.id, rect: { x: n.x, y: n.y, width, height } });
            announce(`Size ${Math.round(width)} by ${Math.round(height)}`);
            reveal({ x: n.x, y: n.y, width, height });
          });
        }
        return run(() => {
          const ids = withGroupContents(s.doc, nodeIds);
          dispatch({ type: "move", ids, dx: dx * step, dy: dy * step });
          const first = s.doc.nodes.find((n) => n.id === nodeIds[0]);
          if (first) {
            announce(`Moved to ${Math.round(first.x + dx * step)}, ${Math.round(first.y + dy * step)}`);
            reveal({ ...first, x: first.x + dx * step, y: first.y + dy * step });
          }
        });
      }
      if (t === rootRef.current) return run(() => setView((v) => ({ ...v, x: v.x - dx * step * 2, y: v.y - dy * step * 2 })));
      return;
    }
    if (k === "Enter" && (nodeEl || edgeEl)) {
      if (nodeEl) return run(() => activate(nodeEl.dataset.nodeId!, mod));
      return run(() => setEditing({ kind: "edge", id: edgeEl!.dataset.edgeId! }));
    }
    if ((k === "Delete" || k === "Backspace") && s.selection.length) return run(removeSelection);
    if (k === "Escape" && s.selection.length) {
      return run(() => {
        dispatch({ type: "select", ids: [] });
        announce("Selection cleared");
      });
    }
    if ((k === "F10" && e.shiftKey) || k === "ContextMenu") {
      return run(() => {
        const r = t.getBoundingClientRect();
        if (nodeEl) openNodeMenu(nodeEl.dataset.nodeId!, r);
        else if (edgeEl) openEdgeMenu(edgeEl.dataset.edgeId!, r);
        else openBackgroundMenu({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, viewCenter());
      });
    }
    if (k === "!" || (e.code === "Digit1" && e.shiftKey)) return run(() => fit());
    if (k === "+" || k === "=") return run(() => zoomAt(1.2));
    if (k === "-") return run(() => zoomAt(1 / 1.2));
  };

  const onKeyUp = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === " ") setSpaceDown(false);
  };

  /** Keyboard focus on a card selects it (unless it is already part of the selection) and scrolls it into view. */
  const onFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    // The root is never scrolled: focus moves the view instead.
    const root = rootRef.current;
    if (root && (root.scrollTop || root.scrollLeft)) {
      root.scrollTop = 0;
      root.scrollLeft = 0;
    }
    const id = t.dataset.nodeId ?? (t.tagName === "BUTTON" ? t.dataset.edgeId : undefined);
    if (!id) return;
    const s = stateRef.current;
    if (!s.selection.includes(id) && !drag.current) dispatch({ type: "select", ids: [id] });
    const n = s.doc.nodes.find((x) => x.id === id);
    if (n) reveal(n);
    else {
      const placed = edges.find((x) => x.edge.id === id);
      if (placed) reveal({ x: placed.geo.mid.x - 20, y: placed.geo.mid.y - 20, width: 40, height: 40 });
    }
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-canvas-ui]") || t.closest(".canvas-edge-input")) return;
    const nodeEl = t.closest<HTMLElement>("[data-node-id]");
    if (nodeEl) {
      if (editing?.kind === "node" && editing.id === nodeEl.dataset.nodeId) return;
      if (t.closest("a, button")) return;
      e.preventDefault();
      return activate(nodeEl.dataset.nodeId!, e.ctrlKey || e.metaKey);
    }
    const edgeEl = t.closest<HTMLElement>("[data-edge-id]");
    if (edgeEl) return setEditing({ kind: "edge", id: edgeEl.dataset.edgeId! });
    addText(toWorld(e.clientX, e.clientY));
  };

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const open = (e.target as HTMLElement).closest<HTMLElement>("[data-canvas-open]");
    if (open) {
      e.preventDefault();
      actions.open(open.dataset.canvasOpen!, e.ctrlKey || e.metaKey ? "tab" : "current");
    }
  };

  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-canvas-ui]")) return;
    if (editing && t.closest(".cm-editor, input")) return;
    e.preventDefault();
    const at = { x: e.clientX, y: e.clientY };
    const nodeEl = t.closest<HTMLElement>("[data-node-id]");
    const edgeEl = t.closest<HTMLElement>("[data-edge-id]");
    if (nodeEl) openNodeMenu(nodeEl.dataset.nodeId!, at);
    else if (edgeEl) openEdgeMenu(edgeEl.dataset.edgeId!, at);
    else openBackgroundMenu(at, toWorld(e.clientX, e.clientY));
  };

  /* ---------------- render ---------------- */

  const single = selectedNodes.length === 1 && state.selection.length === 1 ? selectedNodes[0].id : null;
  const dotGap = 24 * view.zoom;
  const empty = doc.nodes.length === 0;

  return (
    // overflow-clip, not hidden: nothing (a focused card, the editor's caret) may scroll the board out of place.
    <div className="relative flex min-h-0 flex-1 overflow-clip">
      <div
        ref={rootRef}
        tabIndex={0}
        role="region"
        aria-roledescription="canvas"
        aria-label={`${canvasTitle(name)}, ${doc.nodes.length} ${doc.nodes.length === 1 ? "card" : "cards"}, ${doc.edges.length} ${doc.edges.length === 1 ? "connection" : "connections"}`}
        aria-describedby={helpId}
        className={`canvas-root relative min-h-0 flex-1 overflow-clip ${panning ? "cursor-grabbing" : spaceDown ? "cursor-grab" : ""}`}
        style={{ "--canvas-zoom": view.zoom } as React.CSSProperties}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onFocus={onFocus}
        onBlur={() => setSpaceDown(false)}
        onDoubleClick={onDoubleClick}
        onClick={onClick}
        onContextMenu={onContextMenu}
      >
        <p id={helpId} className="sr-only">
          Tab moves between cards in reading order. Arrow keys move the selected cards, with Shift for bigger steps and Alt to
          resize. Enter edits a text card or opens a note, Escape stops editing, Delete removes, Shift+F10 opens the card menu,
          Ctrl+Z undoes. The outline button lists every card and connection.
        </p>
        {/* Dot grid: a real canvas surface, scaled and moved with the view. */}
        {view.zoom >= 0.35 && (
          <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full">
            <defs>
              <pattern
                id={`${helpId}-dots`}
                width={dotGap}
                height={dotGap}
                patternUnits="userSpaceOnUse"
                x={((view.x % dotGap) + dotGap) % dotGap}
                y={((view.y % dotGap) + dotGap) % dotGap}
              >
                <circle cx={1} cy={1} r={1} className="canvas-dot" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#${CSS.escape(`${helpId}-dots`)})`} />
          </svg>
        )}

        <div
          className={`absolute left-0 top-0 origin-top-left ${ready ? "" : "invisible"}`}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
        >
          <EdgeLines edges={edges} selected={selected} draft={draft} z={doc.nodes.length} />
          {ordered.map((n) => (
            <CanvasCard
              key={n.id}
              node={n}
              z={layer.get(n.id) ?? 0}
              name={names.get(n.id) ?? ""}
              kind={kinds.get(n.id) ?? ""}
              selected={selected.has(n.id)}
              single={single === n.id}
              editing={editing?.kind === "node" && editing.id === n.id}
              selfId={noteId}
              dispatch={dispatch}
              onDone={stopEditing}
            />
          ))}
          {edges.map((p) => (
            <EdgeKnob
              key={p.edge.id}
              placed={p}
              z={doc.nodes.length * 2 + 2}
              selected={selected.has(p.edge.id)}
              editing={editing?.kind === "edge" && editing.id === p.edge.id}
              onLabel={(label) => dispatch({ type: "updateEdge", id: p.edge.id, patch: { label: label || undefined } })}
              onDone={(focus) => stopEditing(focus)}
            />
          ))}
        </div>

        {marquee && (
          <div
            aria-hidden="true"
            className="canvas-marquee pointer-events-none absolute"
            style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }}
          />
        )}

        {empty && ready && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 pb-20">
            <div className="max-w-xs text-center">
              <p className="text-[15px] font-medium text-muted">This canvas is empty</p>
              <p className="mt-1 text-[13px] leading-5 text-faint">
                <span className="pointer-coarse:hidden">Double-click anywhere to add a text card, or use the toolbar below.</span>
                <span className="hidden pointer-coarse:inline">Use Add below to place a card. Drag to pan, pinch to zoom.</span>
              </p>
            </div>
          </div>
        )}
      </div>

      <CanvasToolbar
        shifted={outline}
        zoom={view.zoom}
        canUndo={state.past.length > 0}
        canRedo={state.future.length > 0}
        outline={outline}
        onAddText={() => addText()}
        onAddNote={() => setPicker(viewCenter())}
        onAddLink={() => void addLink()}
        onAddGroup={() => addGroup()}
        onZoomIn={() => zoomAt(1.2)}
        onZoomOut={() => zoomAt(1 / 1.2)}
        onZoomReset={() => zoomAt(1 / viewRef.current.zoom)}
        onFit={() => fit()}
        onUndo={undo}
        onRedo={redo}
        onOutline={() => setOutline((o) => !o)}
      />

      {outline && (
        <div data-canvas-ui className="contents">
          <CanvasOutline
            doc={doc}
            edges={edges}
            names={names}
            kinds={kinds}
            selection={selected}
            onClose={() => {
              setOutline(false);
              rootRef.current?.focus({ preventScroll: true });
            }}
            onPick={(id) => {
              dispatch({ type: "select", ids: [id] });
              if (window.matchMedia("(max-width: 767px)").matches) setOutline(false);
              if (doc.nodes.some((n) => n.id === id)) focusNode(id);
              else focusEdge(id);
            }}
          />
        </div>
      )}

      <div role="status" aria-live="polite" className="sr-only">
        {message}
      </div>

      {menu && <Menu anchor={menu.anchor} label={menu.label} items={menu.items} onClose={() => setMenu(null)} />}
      {picker && (
        <Palette
          mode="notes"
          notes={w.notes.filter((n) => n.id !== noteId)}
          commands={[]}
          onOpen={(id) => addNoteCard(id, picker)}
          onCreate={async (title) => {
            try {
              const n = await api.create(title, "");
              await actions.refreshTree();
              addNode({ id: newCanvasId(), type: "file", file: fileFor(n.path), ...placeAt(picker, { width: 400, height: 400 }) });
            } catch {
              actions.notify("Couldn’t create that note. Try again.", { tone: "error" });
            }
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

const SIDES: Side[] = ["top", "right", "bottom", "left"];

function CanvasCard({
  node,
  z,
  name,
  kind,
  selected,
  single,
  editing,
  selfId,
  dispatch,
  onDone,
}: {
  node: CanvasNode;
  z: number;
  name: string;
  kind: string;
  selected: boolean;
  single: boolean;
  editing: boolean;
  selfId: string;
  dispatch: (a: Parameters<typeof canvasReducer>[1]) => void;
  onDone: (refocus: boolean) => void;
}) {
  const group = node.type === "group";
  const label = `${kind}: ${name}`;
  const onText = useCallback((text: string) => dispatch({ type: "updateNode", id: node.id, patch: { text }, coalesce: "text" }), [dispatch, node.id]);
  return (
    <div
      data-node-id={node.id}
      tabIndex={0}
      role="group"
      aria-roledescription={kind.toLowerCase()}
      aria-label={selected ? `${label}, selected` : label}
      data-selected={selected || undefined}
      data-type={node.type}
      className={`canvas-node absolute ${group ? "canvas-group" : "canvas-card"} ${editing ? "is-editing" : ""}`}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height, zIndex: z, ...colorVars(node.color) }}
    >
      {group ? (
        <GroupLabel label={node.label ?? ""} editing={editing} onCommit={(v) => dispatch({ type: "updateNode", id: node.id, patch: { label: v || undefined } })} onDone={onDone} />
      ) : (
        <div className="canvas-card-body">
          {node.type === "text" && <TextCardBody text={node.text} editing={editing} label={`Text card, ${name}`} onChange={onText} />}
          {node.type === "file" && <FileCardBody file={node.file} selfId={selfId} />}
          {node.type === "link" && <LinkCardBody url={node.url} />}
        </div>
      )}
      {!editing &&
        SIDES.map((s) => <span key={s} aria-hidden="true" data-handle={s} className={`canvas-handle canvas-handle-${s}`} />)}
      {single && !editing && <span aria-hidden="true" data-resize="" className="canvas-resize" />}
    </div>
  );
}

function GroupLabel({
  label,
  editing,
  onCommit,
  onDone,
}: {
  label: string;
  editing: boolean;
  onCommit: (v: string) => void;
  onDone: (refocus: boolean) => void;
}) {
  if (editing) return <GroupLabelInput label={label} onCommit={onCommit} onDone={onDone} />;
  return (
    <span className="canvas-group-label" translate="no">
      {label || <span className="text-faint">Untitled group</span>}
    </span>
  );
}

function GroupLabelInput({ label, onCommit, onDone }: { label: string; onCommit: (v: string) => void; onDone: (refocus: boolean) => void }) {
  const [value, setValue] = useState(label);
  const ref = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (commit: boolean, refocus: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (commit && value.trim() !== label) onCommit(value.trim());
    onDone(refocus);
  };
  return (
    <input
      ref={ref}
      value={value}
      aria-label="Group name"
      placeholder="Group name"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true, true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false, true);
        }
      }}
      onBlur={() => finish(true, false)}
      className="canvas-group-label canvas-group-input"
    />
  );
}
