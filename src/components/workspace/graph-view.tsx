"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { api, type GraphData } from "./api";
import { useWorkspace } from "./store";

type N = SimulationNodeDatum & { id: string; name: string; ghost: boolean; degree: number; tagged: boolean };
type L = SimulationLinkDatum<N>;

/**
 * Graph view as a tab. Canvas for drawing; an equivalent list view for keyboard
 * and screen-reader users (the canvas is decorative to assistive tech).
 */
export function GraphView() {
  const w = useWorkspace();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState(false);
  const [showGhost, setShowGhost] = useState(false);
  const [filter, setFilter] = useState("");
  const [asList, setAsList] = useState(false);
  const filterId = useId();
  const activeId = useMemo(() => {
    // Highlight the note shown in the other tab group, if any.
    for (const g of w.layout.groups) {
      const t = g.tabs[g.active];
      const v = t?.history[t.index];
      if (v?.type === "note") return v.id;
    }
    return null;
  }, [w.layout]);
  const openRef = useRef(w.actions.open);
  useEffect(() => {
    openRef.current = w.actions.open;
  });

  useEffect(() => {
    let live = true;
    api
      .graph()
      .then((d) => live && (setData(d), setError(false)))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [w.version]);

  const view = useMemo(() => {
    if (!data) return null;
    const f = filter.trim().toLowerCase();
    const tagFilter = f.startsWith("#") ? f.slice(1) : null;
    const keep = data.nodes.filter(
      (n) =>
        (showGhost || !n.ghost) &&
        (!f || (tagFilter !== null ? n.tags.some((t) => t === tagFilter || t.startsWith(`${tagFilter}/`)) : n.name.toLowerCase().includes(f))),
    );
    const ids = new Set(keep.map((n) => n.id));
    const edges = data.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    return { nodes: keep, edges, tagFilter };
  }, [data, filter, showGhost]);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !view || asList) return;
    const ctx = el.getContext("2d")!;
    const css = getComputedStyle(document.documentElement);
    const C = {
      fg: css.getPropertyValue("--fg").trim(),
      node: css.getPropertyValue("--faint").trim(),
      accent: css.getPropertyValue("--accent").trim(),
      mark: css.getPropertyValue("--mark").trim(),
      edge: css.getPropertyValue("--control").trim(),
      ghost: css.getPropertyValue("--border").trim(),
    };

    const degree = new Map<string, number>();
    view.edges.forEach((e) => {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    });
    const nodes: N[] = view.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      ghost: n.ghost,
      degree: degree.get(n.id) ?? 0,
      tagged: !!view.tagFilter,
    }));
    const links: L[] = view.edges.map((e) => ({ ...e }));
    const neighbors = new Map<string, Set<string>>();
    view.edges.forEach((e) => {
      if (!neighbors.has(e.source)) neighbors.set(e.source, new Set());
      if (!neighbors.has(e.target)) neighbors.set(e.target, new Set());
      neighbors.get(e.source)!.add(e.target);
      neighbors.get(e.target)!.add(e.source);
    });

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

    const view2d = { x: 0, y: 0, k: nodes.length < 15 ? 1.8 : nodes.length < 60 ? 1.3 : 1 };
    const labelAll = nodes.length <= 60;
    let hover: N | null = null;
    const radius = (n: N) => 3.5 + Math.sqrt(n.degree) * 2;

    const sim = forceSimulation<N>(nodes)
      .force("link", forceLink<N, L>(links).id((d) => d.id).distance(56).strength(0.6))
      .force("charge", forceManyBody().strength(-140))
      .force("center", forceCenter(0, 0))
      .force("collide", forceCollide<N>().radius((n) => radius(n) + 2));

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.translate(W / 2 + view2d.x, H / 2 + view2d.y);
      ctx.scale(view2d.k, view2d.k);
      const focus = hover?.id ?? null;
      const near = focus ? neighbors.get(focus) : null;
      ctx.lineWidth = 1 / view2d.k;
      for (const l of links) {
        const s = l.source as N;
        const t = l.target as N;
        const lit = focus && (s.id === focus || t.id === focus);
        ctx.strokeStyle = lit ? C.accent : C.edge;
        ctx.globalAlpha = focus && !lit ? 0.15 : lit ? 1 : 0.45;
        ctx.beginPath();
        ctx.moveTo(s.x!, s.y!);
        ctx.lineTo(t.x!, t.y!);
        ctx.stroke();
      }
      for (const n of nodes) {
        const dim = focus && n.id !== focus && !near?.has(n.id);
        ctx.globalAlpha = dim ? 0.2 : 1;
        ctx.fillStyle =
          n.id === focus || n.id === activeId ? C.accent : n.ghost ? C.ghost : n.tagged ? C.mark : C.node;
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, radius(n), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = C.fg;
      ctx.font = `${13 / view2d.k}px ${css.getPropertyValue("--font-hanken") || "sans-serif"}, sans-serif`;
      ctx.textAlign = "center";
      for (const n of nodes) {
        const show = labelAll || view2d.k > 1.2 || n.degree > 3 || n.id === focus || n.id === activeId || near?.has(n.id);
        if (!show) continue;
        const dim = focus && n.id !== focus && !near?.has(n.id);
        ctx.globalAlpha = dim ? 0.2 : n.ghost ? 0.6 : 0.9;
        ctx.fillText(n.name, n.x!, n.y! + radius(n) + 14 / view2d.k);
      }
      ctx.globalAlpha = 1;
    };
    sim.on("tick", draw);

    const toWorld = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      return { x: (cx - r.left - W / 2 - view2d.x) / view2d.k, y: (cy - r.top - H / 2 - view2d.y) / view2d.k };
    };
    const pick = (cx: number, cy: number) => {
      const p = toWorld(cx, cy);
      let best: N | null = null;
      let bestD = Infinity;
      for (const n of nodes) {
        const d = Math.hypot(n.x! - p.x, n.y! - p.y);
        if (d < radius(n) + 8 / view2d.k && d < bestD) {
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
          sim.alphaTarget(0.3).restart();
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
          draw();
        }
        return;
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (Math.hypot(e.clientX - prev.x, e.clientY - prev.y) > 2) moved = true;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) view2d.k = Math.max(0.2, Math.min(5, view2d.k * (d / pinch)));
        pinch = d;
        draw();
      } else if (dragNode) {
        const p = toWorld(e.clientX, e.clientY);
        dragNode.fx = p.x;
        dragNode.fy = p.y;
      } else {
        view2d.x += e.clientX - prev.x;
        view2d.y += e.clientY - prev.y;
        draw();
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (dragNode) {
        dragNode.fx = dragNode.fy = null;
        sim.alphaTarget(0);
        if (!moved && !dragNode.ghost) openRef.current(dragNode.id, e.ctrlKey || e.metaKey ? "tab" : "split");
        dragNode = null;
      }
      if (pointers.size < 2) pinch = 0;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left - W / 2;
      const my = e.clientY - r.top - H / 2;
      const k = Math.max(0.2, Math.min(5, view2d.k * Math.exp(-e.deltaY * 0.0015)));
      view2d.x = mx - ((mx - view2d.x) * k) / view2d.k;
      view2d.y = my - ((my - view2d.y) * k) / view2d.k;
      view2d.k = k;
      draw();
    };
    const ro = new ResizeObserver(() => {
      resize();
      draw();
    });
    ro.observe(el);

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      sim.stop();
      ro.disconnect();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
    };
  }, [view, activeId, asList]);

  const nameOf = (id: string) => data?.nodes.find((n) => n.id === id)?.name ?? id;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pb-3 pt-1" role="toolbar" aria-label="Graph options">
        <label htmlFor={filterId} className="sr-only">
          Filter notes
        </label>
        <input
          id={filterId}
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name or #tag…"
          autoComplete="off"
          spellCheck={false}
          className="h-8 w-56 rounded-lg border border-control bg-sheet px-2.5 text-[16px] outline-none placeholder:text-faint focus-visible:outline-2 focus-visible:outline-[var(--focus)] md:text-[13px]"
        />
        <label className="flex items-center gap-2 text-[13px] text-muted">
          <input type="checkbox" checked={showGhost} onChange={(e) => setShowGhost(e.target.checked)} className="size-4 accent-[var(--accent)]" />
          Show notes not created yet
        </label>
        <label className="flex items-center gap-2 text-[13px] text-muted">
          <input type="checkbox" checked={asList} onChange={(e) => setAsList(e.target.checked)} className="size-4 accent-[var(--accent)]" />
          Show as list
        </label>
        {view && (
          <span className="ml-auto text-[12px] text-faint tabular">
            {view.nodes.length} {view.nodes.length === 1 ? "note" : "notes"}, {view.edges.length} {view.edges.length === 1 ? "link" : "links"}
          </span>
        )}
      </div>
      {error && <p className="px-4 text-[13px] text-muted">Couldn’t load the graph. Reopen the tab to try again.</p>}
      {!data && !error && <p className="px-4 text-[13px] text-faint">Loading graph…</p>}
      {asList && view ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          <ul className="max-w-2xl space-y-2">
            {view.nodes
              .filter((n) => !n.ghost)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((n) => {
                const out = view.edges.filter((e) => e.source === n.id).map((e) => nameOf(e.target));
                return (
                  <li key={n.id}>
                    <button type="button" onClick={() => w.actions.open(n.id)} className="font-medium text-accent-ink hover:underline">
                      {n.name}
                    </button>
                    <span className="text-[13px] text-faint"> {out.length ? `links to ${out.join(", ")}` : "no outgoing links"}</span>
                  </li>
                );
              })}
          </ul>
        </div>
      ) : (
        <canvas
          ref={canvas}
          aria-hidden="true"
          className="min-h-0 w-full flex-1 cursor-grab touch-none"
        />
      )}
    </div>
  );
}
