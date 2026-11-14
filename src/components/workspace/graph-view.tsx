"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type ForceLink,
  type ForceManyBody,
  type ForceX,
  type ForceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { SlidersHorizontal, X } from "lucide-react";
import { api, type GraphData } from "./api";
import { shallowEqual, useWorkspaceActions, useWorkspaceSelector, type Layout } from "./store";
import { CLEAR_BUTTON, nf, useShown } from "./ui";
import { GraphControls } from "./graph/controls";
import { useGraphSettings } from "./graph/use-settings";
import {
  activeFilterCount,
  buildView,
  DEFAULT_SETTINGS,
  facets as facetsOf,
  type GraphViewModel,
  type GroupColor,
  type LabelMode,
} from "./graph/model";

type N = SimulationNodeDatum & {
  id: string;
  name: string;
  ghost: boolean;
  degree: number;
  tagged: boolean;
  group: GroupColor | 0;
};
type L = SimulationLinkDatum<N>;
type Display = { sizeByLinks: boolean; linkWidth: number; labels: LabelMode };
type Forces = { centre: number; repel: number; linkDistance: number };
type Scene = { setView: (v: GraphViewModel) => void; setDisplay: (d: Display) => void; setForces: (f: Forces) => void; draw: () => void };

/** Theme tokens, read again whenever the theme changes. */
const readColors = () => {
  const css = getComputedStyle(document.documentElement);
  const v = (n: string) => css.getPropertyValue(n).trim();
  return {
    fg: v("--fg"),
    // Blueprint line-art: slate nodes on hairline edges; blue and orange are the only data points.
    node: v("--muted"),
    label: v("--muted"),
    grid: v("--border"),
    accent: v("--accent"),
    mark: v("--mark"),
    edge: v("--mist"),
    ghost: v("--control"),
    sheet: v("--sheet"),
    font: v("--font-hanken") || "sans-serif",
    group: { 1: v("--canvas-1"), 3: v("--canvas-3"), 4: v("--canvas-4"), 5: v("--canvas-5"), 6: v("--canvas-6") } as Record<GroupColor, string>,
  };
};

/** Node ids and edges: when this is unchanged, the layout does not need to move. */
const structureKey = (v: GraphViewModel) =>
  `${v.nodes
    .map((n) => n.id)
    .sort()
    .join(",")}|${v.edges
    .map((e) => `${e.source}>${e.target}`)
    .sort()
    .join(",")}`;

/**
 * The note the graph relates to: the one open in another tab group, else the newest note in the
 * graph tab's own back history (the note you opened the graph from), else any open note.
 */
function noteInFocus(layout: Layout): { active: string | null; centre: string | null } {
  for (const g of layout.groups) {
    const t = g.tabs[g.active];
    const v = t?.history[t.index];
    if (v?.type === "note") return { active: v.id, centre: v.id };
  }
  for (const g of layout.groups)
    for (const t of g.tabs)
      for (let i = t.index; i >= 0; i--) {
        const v = t.history[i];
        if (v?.type === "note") return { active: null, centre: v.id };
      }
  return { active: null, centre: null };
}

/** Above this many nodes the layout cools faster and labels are rationed. */
const BIG = 1500;

/**
 * Graph view as a tab: the whole vault (global) or the notes around the open one (local), with a
 * settings panel for filters, groups, display and forces kept per vault on this device. Canvas
 * for drawing; an equivalent list view for keyboard and screen-reader users (the canvas is
 * decorative to assistive tech).
 *
 * The simulation lives as long as the canvas: new data only adds or removes nodes, keeps
 * everyone else where they are and keeps the pan and zoom. Under reduced motion the layout is
 * computed off screen and drawn once.
 */
export function GraphView() {
  const actions = useWorkspaceActions();
  const w = useWorkspaceSelector(
    (s) => ({ layout: s.layout, tree: s.tree, linksVersion: s.linksVersion, tagsVersion: s.tagsVersion, user: s.user.email }),
    shallowEqual,
  );
  const canvas = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [asList, setAsList] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [settings, patch] = useGraphSettings(w.user);
  const filterId = useId();
  const panelId = useId();
  const filterRef = useRef<HTMLInputElement>(null);
  const panelButton = useRef<HTMLButtonElement>(null);
  const { active: activeId, centre: centreId } = useMemo(() => noteInFocus(w.layout), [w.layout]);
  const openRef = useRef(actions.open);
  const activeRef = useRef(activeId ?? centreId);
  const sceneRef = useRef<Scene | null>(null);
  // Survive switching to the list and back: positions and camera.
  const posRef = useRef(new Map<string, { x: number; y: number; vx: number; vy: number }>());
  const camRef = useRef<{ x: number; y: number; k: number } | null>(null);
  const savedKeyRef = useRef("");
  useEffect(() => {
    openRef.current = actions.open;
  });

  // Refetch only when links, tags or the set of notes changed, and only while the graph is on screen
  // (a hidden split group keeps it mounted).
  const [rootRef, onScreen] = useShown<HTMLDivElement>();
  const notesKey = useMemo(() => w.tree.notes.map((n) => `${n.id}:${n.path}`).join("\n"), [w.tree.notes]);
  const want = `${w.linksVersion}:${w.tagsVersion}:${attempt}:${notesKey}`;
  const done = useRef("");
  useEffect(() => {
    if (!onScreen || done.current === want) return;
    let live = true;
    api
      .graph()
      .then((d) => {
        if (!live) return;
        done.current = want;
        // Most refreshes change nothing here: keep the old object so the simulation is not touched.
        setData((prev) => (prev && JSON.stringify(prev) === JSON.stringify(d) ? prev : d));
        setError(false);
      })
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [want, onScreen]);

  const local = settings.scope === "local";
  const view = useMemo<GraphViewModel | null>(() => (data ? buildView(data, settings, centreId) : null), [data, settings, centreId]);
  const facets = useMemo(() => (data ? facetsOf(data.nodes) : { tags: [], folders: [] }), [data]);
  const centreName = useMemo(() => (centreId ? (data?.nodes.find((n) => n.id === centreId)?.name ?? null) : null), [data, centreId]);

  const listRows = useMemo(() => {
    if (!data || !view) return [];
    const names = new Map(data.nodes.map((n) => [n.id, n.name]));
    const outBy = new Map<string, string[]>();
    for (const e of view.edges) {
      const t = names.get(e.target) ?? e.target;
      const a = outBy.get(e.source);
      if (a) a.push(t);
      else outBy.set(e.source, [t]);
    }
    const groupOf = new Map(settings.groups.map((g) => [g.color, g.query.trim()]));
    return view.nodes
      .filter((n) => !n.ghost)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((n) => {
        const color = view.colors.get(n.id);
        return { id: n.id, name: n.name, out: outBy.get(n.id) ?? [], color, group: color ? groupOf.get(color) : undefined };
      });
  }, [data, view, settings.groups]);

  const notesInVault = data ? data.nodes.filter((n) => !n.ghost).length : 0;
  const noCentre = local && !centreId;
  const shown = view ? (asList ? listRows.length : view.nodes.length) : 0;
  const empty = !!view && (shown === 0 || noCentre);
  const filtersOn = activeFilterCount(settings);
  const display = useMemo<Display>(
    () => ({ sizeByLinks: settings.sizeByLinks, linkWidth: settings.linkWidth, labels: settings.labels }),
    [settings.sizeByLinks, settings.linkWidth, settings.labels],
  );
  const forces = useMemo<Forces>(
    () => ({ centre: settings.centre, repel: settings.repel, linkDistance: settings.linkDistance }),
    [settings.centre, settings.repel, settings.linkDistance],
  );
  const displayRef = useRef(display);
  const forcesRef = useRef(forces);

  /* Canvas, simulation and input: set up once per canvas. */
  useEffect(() => {
    const el = canvas.current;
    if (!el || asList) return;
    const ctx = el.getContext("2d")!;
    let C = readColors();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");

    let nodes: N[] = [];
    let links: L[] = [];
    let neighbors = new Map<string, Set<string>>();
    let structure = "";
    let hover: N | null = null;
    let disp = displayRef.current;
    const radius = (n: N) => (disp.sizeByLinks ? 3 + Math.sqrt(n.degree) * 1.5 : 4);

    const dpr = window.devicePixelRatio || 1;
    let W = 0;
    let H = 0;
    const resize = () => {
      W = el.clientWidth;
      H = el.clientHeight;
      el.width = W * dpr;
      el.height = H * dpr;
    };
    resize();

    const f0 = forcesRef.current;
    const sim = forceSimulation<N>([])
      .force("link", forceLink<N, L>([]).id((d) => d.id).distance(f0.linkDistance).strength(0.6))
      .force("charge", forceManyBody<N>().strength(-f0.repel).theta(0.9))
      .force("center", forceCenter(0, 0))
      // The centre force proper: a pull towards the middle, so loose islands stay in view.
      .force("x", forceX<N>(0).strength(f0.centre * 0.2))
      .force("y", forceY<N>(0).strength(f0.centre * 0.2))
      .stop();

    const cam = () => (camRef.current ??= { x: 0, y: 0, k: 1 });

    const draw = () => {
      // Read, do not create: the first setView picks the starting zoom from the graph's size.
      const view2d = camRef.current ?? { x: 0, y: 0, k: 1 };
      const activeId = activeRef.current;
      const k = view2d.k;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      // The map's survey grid: a dot every 24px on screen, fixed to the paper as it pans.
      ctx.fillStyle = C.grid;
      const step = 24;
      const ox = (((W / 2 + view2d.x) % step) + step) % step;
      const oy = (((H / 2 + view2d.y) % step) + step) % step;
      for (let gx = ox; gx < W; gx += step) for (let gy = oy; gy < H; gy += step) ctx.fillRect(gx, gy, 1, 1);
      ctx.translate(W / 2 + view2d.x, H / 2 + view2d.y);
      ctx.scale(k, k);
      // What is on screen, in world units, with a margin for labels: everything else is skipped.
      const x0 = (-W / 2 - view2d.x) / k - 80 / k;
      const x1 = (W / 2 - view2d.x) / k + 80 / k;
      const y0 = (-H / 2 - view2d.y) / k - 40 / k;
      const y1 = (H / 2 - view2d.y) / k + 40 / k;
      const visible = (n: N) => n.x! >= x0 && n.x! <= x1 && n.y! >= y0 && n.y! <= y1;
      const focus = hover?.id ?? null;
      const near = focus ? neighbors.get(focus) : null;

      // Links: one path per state, not one stroke per link (5k notes stay smooth).
      ctx.lineWidth = disp.linkWidth / k;
      const plain = new Path2D();
      const lit = new Path2D();
      for (const l of links) {
        const s = l.source as N;
        const t = l.target as N;
        if ((s.x! < x0 && t.x! < x0) || (s.x! > x1 && t.x! > x1) || (s.y! < y0 && t.y! < y0) || (s.y! > y1 && t.y! > y1)) continue;
        const p = focus && (s.id === focus || t.id === focus) ? lit : plain;
        p.moveTo(s.x!, s.y!);
        p.lineTo(t.x!, t.y!);
      }
      ctx.strokeStyle = C.edge;
      ctx.globalAlpha = focus ? 0.25 : 1;
      ctx.stroke(plain);
      if (focus) {
        ctx.strokeStyle = C.accent;
        ctx.globalAlpha = 1;
        ctx.stroke(lit);
      }

      // Nodes, batched by fill and dimming.
      const fills = new Map<string, Path2D>();
      const hollow: [Path2D, Path2D] = [new Path2D(), new Path2D()];
      for (const n of nodes) {
        if (!visible(n)) continue;
        const dim = !!focus && n.id !== focus && !near?.has(n.id);
        const on = n.id === focus || n.id === activeId;
        const r = radius(n);
        if (n.ghost && !on) {
          // A note not created yet is drawn hollow, like a planned station on a map.
          const p = hollow[dim ? 1 : 0];
          p.moveTo(n.x! + r, n.y!);
          p.arc(n.x!, n.y!, r, 0, Math.PI * 2);
          continue;
        }
        const fill = on ? C.accent : n.tagged ? C.mark : n.group ? C.group[n.group] : C.node;
        const key = `${dim ? 1 : 0}${fill}`;
        let p = fills.get(key);
        if (!p) fills.set(key, (p = new Path2D()));
        if (r * k < 1.5) {
          // Under 3px on screen a circle and a square look the same, and a square is far cheaper to fill.
          p.rect(n.x! - r, n.y! - r, 2 * r, 2 * r);
          continue;
        }
        p.moveTo(n.x! + r, n.y!);
        p.arc(n.x!, n.y!, r, 0, Math.PI * 2);
      }
      for (const [key, p] of fills) {
        ctx.globalAlpha = key[0] === "1" ? 0.2 : 1;
        ctx.fillStyle = key.slice(1);
        ctx.fill(p);
      }
      ctx.lineWidth = 1 / k;
      ctx.fillStyle = C.sheet;
      ctx.strokeStyle = C.ghost;
      hollow.forEach((p, i) => {
        ctx.globalAlpha = i ? 0.2 : 1;
        ctx.fill(p);
        ctx.stroke(p);
      });
      ctx.globalAlpha = 1;
      const here = activeId ? nodes.find((n) => n.id === activeId) : undefined;
      if (here) {
        // The open note: a 1px ring around its dot, like a station you are standing at.
        ctx.beginPath();
        ctx.arc(here.x!, here.y!, radius(here) + 4 / k, 0, Math.PI * 2);
        ctx.strokeStyle = C.accent;
        ctx.stroke();
      }

      // Labels: knocked out of the edges with a stroke in the sheet's colour, so they stay readable.
      const big = nodes.length > BIG;
      const all =
        disp.labels === "always" ? (big ? k > 1.6 : nodes.length <= 60 || k > 1.2) : disp.labels === "zoom" ? k > (big ? 2 : 1.4) : false;
      const hubs = disp.labels === "always" && !big;
      ctx.font = `500 ${12 / k}px ${C.font}, sans-serif`;
      ctx.textAlign = "center";
      ctx.lineJoin = "round";
      ctx.lineWidth = 4 / k;
      ctx.strokeStyle = C.sheet;
      for (const n of nodes) {
        const mine = n.id === focus || n.id === activeId || !!near?.has(n.id);
        if (!mine && !(all || (hubs && n.degree > 3))) continue;
        if (!visible(n)) continue;
        const dim = focus && n.id !== focus && !near?.has(n.id);
        ctx.globalAlpha = dim ? 0.2 : n.ghost ? 0.6 : 1;
        const text = n.id === focus || n.name.length <= 28 ? n.name : `${n.name.slice(0, 26).trimEnd()}…`;
        const y = n.y! + radius(n) + 15 / k;
        ctx.strokeText(text, n.x!, y);
        ctx.fillStyle = n.id === focus || n.id === activeId ? C.fg : C.label;
        ctx.fillText(text, n.x!, y);
      }
      ctx.globalAlpha = 1;
    };
    // At most one paint per frame, however many ticks or pointer moves come in.
    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), draw()));
    };
    sim.on("tick", schedule);

    /** Move the layout towards rest: animated, or computed at once under reduced motion. */
    const settle = (alpha: number) => {
      const big = nodes.length > BIG;
      sim.alphaDecay(big ? 0.05 : 0.0228);
      // Collision is the costliest force and adds little when thousands of dots are a few pixels wide.
      sim.force("collide", big ? null : forceCollide<N>().radius((n) => radius(n) + 2));
      sim.alpha(alpha);
      if (reduce.matches) {
        sim.stop();
        const ticks = Math.ceil(Math.log(sim.alphaMin() / alpha) / Math.log(1 - sim.alphaDecay()));
        sim.tick(Math.max(0, ticks));
        draw();
      } else sim.restart();
    };

    const setView = (v: GraphViewModel) => {
      const degree = new Map<string, number>();
      v.edges.forEach((e) => {
        degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
        degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
      });
      const key = structureKey(v);
      if (key === structure) {
        // Same nodes and links: only names and flags can have changed.
        const byId = new Map(v.nodes.map((n) => [n.id, n]));
        for (const n of nodes) {
          const d = byId.get(n.id)!;
          n.name = d.name;
          n.ghost = d.ghost;
          n.tagged = v.tagged.has(n.id);
          n.group = v.colors.get(n.id) ?? 0;
        }
        draw();
        return;
      }
      // Back from the list view with the same graph: the saved layout is already at rest.
      const resume = nodes.length === 0 && key === savedKeyRef.current;
      structure = key;
      const prev = new Map(nodes.map((n) => [n.id, n]));
      const saved = posRef.current;
      const firstBuild = prev.size === 0 && saved.size === 0;
      let placed = 0;
      const next: N[] = v.nodes.map((d) => {
        const p = prev.get(d.id) ?? saved.get(d.id);
        if (p) placed++;
        return {
          id: d.id,
          name: d.name,
          ghost: d.ghost,
          degree: degree.get(d.id) ?? 0,
          tagged: v.tagged.has(d.id),
          group: v.colors.get(d.id) ?? 0,
          ...(p ? { x: p.x, y: p.y, vx: p.vx, vy: p.vy } : {}),
        };
      });
      // A new node starts next to a neighbour that already has a place, not at the centre.
      const byId = new Map(next.map((n) => [n.id, n]));
      const at = new Map(next.filter((n) => n.x !== undefined).map((n) => [n.id, n]));
      for (const e of v.edges) {
        const s = byId.get(e.source)!;
        const t = byId.get(e.target)!;
        const [lonely, anchor] = s.x === undefined ? [s, at.get(t.id)] : t.x === undefined ? [t, at.get(s.id)] : [null, undefined];
        if (lonely && anchor) {
          lonely.x = anchor.x! + (Math.random() - 0.5) * 40;
          lonely.y = anchor.y! + (Math.random() - 0.5) * 40;
          at.set(lonely.id, lonely);
        }
      }
      nodes = next;
      links = v.edges.map((e) => ({ ...e }));
      neighbors = new Map();
      v.edges.forEach((e) => {
        if (!neighbors.has(e.source)) neighbors.set(e.source, new Set());
        if (!neighbors.has(e.target)) neighbors.set(e.target, new Set());
        neighbors.get(e.source)!.add(e.target);
        neighbors.get(e.target)!.add(e.source);
      });
      if (!camRef.current)
        camRef.current = { x: 0, y: 0, k: nodes.length < 15 ? 1.8 : nodes.length < 60 ? 1.3 : nodes.length > BIG ? 0.35 : 1 };
      sim.nodes(nodes);
      sim.force<ForceLink<N, L>>("link")!.links(links);
      if (resume) draw();
      else settle(firstBuild || placed === 0 ? 1 : placed === nodes.length ? 0.1 : 0.3);
    };

    const setDisplay = (d: Display) => {
      const resized = d.sizeByLinks !== disp.sizeByLinks;
      disp = d;
      if (resized) {
        // Bigger dots need more room: settle re-creates the collision force for the new radii.
        settle(0.2);
      } else draw();
    };
    const setForces = (f: Forces) => {
      sim.force<ForceLink<N, L>>("link")!.distance(f.linkDistance);
      sim.force<ForceManyBody<N>>("charge")!.strength(-f.repel);
      sim.force<ForceX<N>>("x")!.strength(f.centre * 0.2);
      sim.force<ForceY<N>>("y")!.strength(f.centre * 0.2);
      settle(0.4);
    };

    const toWorld = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      const view2d = cam();
      return { x: (cx - r.left - W / 2 - view2d.x) / view2d.k, y: (cy - r.top - H / 2 - view2d.y) / view2d.k };
    };
    const pick = (cx: number, cy: number) => {
      const p = toWorld(cx, cy);
      const k = cam().k;
      let best: N | null = null;
      let bestD = Infinity;
      for (const n of nodes) {
        const dx = n.x! - p.x;
        const dy = n.y! - p.y;
        const reach = radius(n) + 8 / k;
        if (dx > reach || dx < -reach || dy > reach || dy < -reach) continue;
        const d = Math.hypot(dx, dy);
        if (d < reach && d < bestD) {
          best = n;
          bestD = d;
        }
      }
      return best;
    };

    const pointers = new Map<number, { x: number; y: number }>();
    let dragNode: N | null = null;
    let moved = false;
    let pinch = 0;

    const onDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = false;
      if (pointers.size === 1) {
        dragNode = pick(e.clientX, e.clientY);
        if (dragNode) {
          // Under reduced motion only the dragged node moves, under the pointer.
          if (!reduce.matches) sim.alphaTarget(0.3).restart();
          dragNode.fx = dragNode.x;
          dragNode.fy = dragNode.y;
        }
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
        if (dragNode) {
          dragNode.fx = dragNode.fy = null;
          dragNode = null;
        }
      }
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) {
        const h = pick(e.clientX, e.clientY);
        if (h !== hover) {
          hover = h;
          el.style.cursor = h ? "pointer" : "grab";
          schedule();
        }
        return;
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (Math.hypot(e.clientX - prev.x, e.clientY - prev.y) > 2) moved = true;
      const view2d = cam();
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) view2d.k = Math.max(0.1, Math.min(5, view2d.k * (d / pinch)));
        pinch = d;
        schedule();
      } else if (dragNode) {
        const p = toWorld(e.clientX, e.clientY);
        dragNode.fx = p.x;
        dragNode.fy = p.y;
        if (reduce.matches) {
          dragNode.x = p.x;
          dragNode.y = p.y;
          schedule();
        }
      } else {
        view2d.x += e.clientX - prev.x;
        view2d.y += e.clientY - prev.y;
        schedule();
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (dragNode) {
        dragNode.fx = dragNode.fy = null;
        sim.alphaTarget(0);
        if (reduce.matches) {
          sim.stop();
          draw();
        }
        if (!moved && !dragNode.ghost) openRef.current(dragNode.id, e.ctrlKey || e.metaKey ? "tab" : "split");
        dragNode = null;
      }
      if (pointers.size < 2) pinch = 0;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const view2d = cam();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left - W / 2;
      const my = e.clientY - r.top - H / 2;
      const k = Math.max(0.1, Math.min(5, view2d.k * Math.exp(-e.deltaY * 0.0015)));
      view2d.x = mx - ((mx - view2d.x) * k) / view2d.k;
      view2d.y = my - ((my - view2d.y) * k) / view2d.k;
      view2d.k = k;
      schedule();
    };
    const ro = new ResizeObserver(() => {
      resize();
      draw();
    });
    ro.observe(el);

    // Repaint in the new theme's colours: manual switch (data-theme) or the OS in "Match system".
    const retheme = () => {
      C = readColors();
      draw();
    };
    const mo = new MutationObserver(retheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    scheme.addEventListener("change", retheme);
    // Reduced motion switched on mid-animation: finish the layout at once.
    const onReduce = () => {
      if (reduce.matches && sim.alpha() > sim.alphaMin()) settle(sim.alpha());
    };
    reduce.addEventListener("change", onReduce);

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    sceneRef.current = { setView, setDisplay, setForces, draw };
    const saved = posRef.current;
    return () => {
      sim.stop();
      cancelAnimationFrame(frame);
      for (const n of nodes) saved.set(n.id, { x: n.x ?? 0, y: n.y ?? 0, vx: 0, vy: 0 });
      savedKeyRef.current = structure;
      sceneRef.current = null;
      ro.disconnect();
      mo.disconnect();
      scheme.removeEventListener("change", retheme);
      reduce.removeEventListener("change", onReduce);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
    };
  }, [asList]);

  /* New data or filter: update the running simulation. */
  useEffect(() => {
    if (view && !asList) sceneRef.current?.setView(view);
  }, [view, asList]);

  /* Display and forces: applied to the running scene, and remembered for the next one. */
  useEffect(() => {
    if (displayRef.current === display) return;
    displayRef.current = display;
    sceneRef.current?.setDisplay(display);
  }, [display]);
  useEffect(() => {
    if (forcesRef.current === forces) return;
    forcesRef.current = forces;
    sceneRef.current?.setForces(forces);
  }, [forces]);

  /* The highlighted note changed: repaint only. */
  useEffect(() => {
    activeRef.current = activeId ?? (local ? centreId : null);
    sceneRef.current?.draw();
  }, [activeId, centreId, local]);

  const closePanel = () => {
    setPanelOpen(false);
    panelButton.current?.focus();
  };
  const count = view && !noCentre ? view.nodes.length : 0;
  const linkCount = view && !noCentre ? view.edges.length : 0;

  return (
    <div ref={rootRef} className="flex h-full flex-col">
      <h1 className="sr-only">{local ? "Local graph" : "Graph view"}</h1>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2.5" role="toolbar" aria-label="Graph options">
        <label htmlFor={filterId} className="sr-only">
          Filter notes
        </label>
        <div className="flex h-9 w-full items-center gap-1 rounded-md border border-control bg-sheet pl-2.5 pr-1 focus-within:outline focus-within:outline-2 focus-within:outline-[var(--focus)] sm:w-64 md:h-8 pointer-coarse:h-11">
          <input
            ref={filterRef}
            id={filterId}
            type="search"
            value={settings.search}
            onChange={(e) => patch({ search: e.target.value })}
            onKeyDown={(e) => {
              // Escape clears the filter, like the browser's own search field did.
              if (e.key === "Escape" && settings.search) {
                e.preventDefault();
                patch({ search: "" });
              }
            }}
            placeholder="Filter by name, #tag or path:…"
            autoComplete="off"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint md:text-[13px] [&::-webkit-search-cancel-button]:hidden"
          />
          {settings.search && (
            <button
              type="button"
              aria-label="Clear filter"
              onClick={() => {
                patch({ search: "" });
                filterRef.current?.focus();
              }}
              className={CLEAR_BUTTON}
            >
              <X aria-hidden="true" className="size-4 stroke-[1.5]" />
            </button>
          )}
        </div>
        <fieldset className="flex h-8 items-stretch rounded-md border border-control p-0.5 pointer-coarse:h-11">
          <legend className="sr-only">Graph scope</legend>
          {(
            [
              ["global", "Whole vault"],
              ["local", "Local"],
            ] as const
          ).map(([v, label]) => (
            <label
              key={v}
              className="grid cursor-pointer place-items-center rounded-[4px] px-2.5 text-[12px] font-medium text-muted transition-colors hover:text-fg has-checked:bg-active has-checked:text-fg has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-[var(--focus)]"
            >
              <input type="radio" name={`${filterId}-scope`} value={v} checked={settings.scope === v} onChange={() => patch({ scope: v })} className="sr-only" />
              {label}
            </label>
          ))}
        </fieldset>
        <label className="flex items-center gap-2 text-[13px] text-muted">
          <input type="checkbox" checked={asList} onChange={(e) => setAsList(e.target.checked)} className="size-4 accent-[var(--accent)]" />
          Show as list
        </label>
        <div className="ml-auto flex items-center gap-3">
          {view && (
            <span className="text-[12px] text-faint tabular">
              {nf.format(count)} {count === 1 ? "note" : "notes"}, {nf.format(linkCount)} {linkCount === 1 ? "link" : "links"}
            </span>
          )}
          <button
            ref={panelButton}
            type="button"
            aria-expanded={panelOpen}
            aria-controls={panelOpen ? panelId : undefined}
            onClick={() => (panelOpen ? closePanel() : setPanelOpen(true))}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-control px-2.5 text-[13px] font-medium transition-colors hover:border-fg hover:bg-hover aria-expanded:bg-active pointer-coarse:h-11"
          >
            <SlidersHorizontal aria-hidden="true" className="size-4 stroke-[1.5]" />
            Settings
            {filtersOn > 0 && (
              <span className="tabular text-[12px] text-accent-ink">
                <span className="sr-only">, </span>
                {filtersOn}
                <span className="sr-only">{filtersOn === 1 ? " filter on" : " filters on"}</span>
              </span>
            )}
          </button>
        </div>
      </div>
      {local && centreName && (
        <p className="border-b border-rule px-4 py-1.5 text-[12px] text-faint">
          Notes within {settings.depth === 1 ? "1 link" : `${settings.depth} links`} of{" "}
          <span className="font-medium text-fg" translate="no">
            {centreName}
          </span>
        </p>
      )}
      {error && !data && (
        <div className="px-4 pt-3 text-[13px] text-muted">
          <p>Couldn’t load the graph.</p>
          <button
            type="button"
            className="mt-2 font-medium text-accent-ink hover:underline"
            onClick={() => {
              setError(false);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}
      {!data && !error && <p className="px-4 pt-3 text-[13px] text-faint">Loading graph…</p>}
      {empty && (
        <div role="status" className="px-4 pt-3 text-[13px] text-muted">
          {notesInVault === 0 ? (
            <>
              <p>Your vault has no notes yet.</p>
              <button type="button" className="mt-2 font-medium text-accent-ink hover:underline" onClick={() => actions.newNote("")}>
                Create a note
              </button>
            </>
          ) : noCentre ? (
            <>
              <p>Open a note to see the notes around it.</p>
              <button type="button" className="mt-2 font-medium text-accent-ink hover:underline" onClick={() => patch({ scope: "global" })}>
                Show the whole vault
              </button>
            </>
          ) : settings.search.trim() ? (
            <>
              <p>
                {view.tagFilter !== null ? (
                  <>
                    No notes tagged <span translate="no">#{view.tagFilter}</span>.
                  </>
                ) : (
                  <>No notes match “{settings.search.trim()}”.</>
                )}
              </p>
              <button type="button" className="mt-2 font-medium text-accent-ink hover:underline" onClick={() => patch({ search: "" })}>
                Clear filter
              </button>
            </>
          ) : filtersOn ? (
            <>
              <p>No notes pass the filters.</p>
              <button
                type="button"
                className="mt-2 font-medium text-accent-ink hover:underline"
                onClick={() =>
                  patch({
                    tags: [],
                    folders: [],
                    showAttachments: DEFAULT_SETTINGS.showAttachments,
                    showOrphans: DEFAULT_SETTINGS.showOrphans,
                    existingOnly: DEFAULT_SETTINGS.existingOnly,
                  })
                }
              >
                Reset filters
              </button>
            </>
          ) : (
            <p>No created notes to list.</p>
          )}
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        {asList ? (
          view &&
          !empty && (
            <div className="h-full overflow-y-auto px-4 pb-6 pt-3">
              <ul className="max-w-2xl space-y-2">
                {listRows.map((r) => (
                  <li key={r.id}>
                    {r.color && (
                      <span aria-hidden="true" className="mr-2 inline-block size-2.5 rounded-full align-middle" style={{ background: `var(--canvas-${r.color})` }} />
                    )}
                    <button type="button" onClick={() => actions.open(r.id)} className="font-medium text-accent-ink hover:underline" translate="no">
                      {r.name}
                    </button>
                    <span className="text-[13px] text-faint">
                      {r.group && (
                        <>
                          {" "}
                          in group <span translate="no">{r.group}</span>,
                        </>
                      )}{" "}
                      {r.out.length ? (
                        <>
                          links to <span translate="no">{r.out.join(", ")}</span>
                        </>
                      ) : (
                        "no outgoing links"
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )
        ) : (
          <canvas ref={canvas} aria-hidden="true" className={`block h-full w-full cursor-grab touch-none ${empty ? "invisible" : ""}`} />
        )}
        {panelOpen && <GraphControls id={panelId} settings={settings} patch={patch} facets={facets} onClose={closePanel} />}
      </div>
    </div>
  );
}
