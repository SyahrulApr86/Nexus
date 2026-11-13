"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type ForceLink,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { X } from "lucide-react";
import { api, type GraphData } from "./api";
import { shallowEqual, useWorkspaceActions, useWorkspaceSelector } from "./store";
import { CLEAR_BUTTON, nf, useShown } from "./ui";

type N = SimulationNodeDatum & { id: string; name: string; ghost: boolean; degree: number; tagged: boolean };
type L = SimulationLinkDatum<N>;
type ViewData = { nodes: GraphData["nodes"]; edges: GraphData["edges"]; tagFilter: string | null };
type Scene = { setView: (v: ViewData) => void; draw: () => void };

/** Theme tokens, read again whenever the theme changes. */
const readColors = () => {
  const css = getComputedStyle(document.documentElement);
  const v = (n: string) => css.getPropertyValue(n).trim();
  return {
    fg: v("--fg"),
    node: v("--faint"),
    accent: v("--accent"),
    mark: v("--mark"),
    edge: v("--control"),
    ghost: v("--border"),
    font: v("--font-hanken") || "sans-serif",
  };
};

/** Node ids and edges: when this is unchanged, the layout does not need to move. */
const structureKey = (v: ViewData) =>
  `${v.nodes
    .map((n) => n.id)
    .sort()
    .join(",")}|${v.edges
    .map((e) => `${e.source}>${e.target}`)
    .sort()
    .join(",")}`;

/**
 * Graph view as a tab. Canvas for drawing; an equivalent list view for keyboard
 * and screen-reader users (the canvas is decorative to assistive tech).
 *
 * The simulation lives as long as the canvas: new data only adds or removes
 * nodes, keeps everyone else where they are and keeps the pan and zoom.
 * Under reduced motion the layout is computed off screen and drawn once.
 */
export function GraphView() {
  const actions = useWorkspaceActions();
  const w = useWorkspaceSelector(
    (s) => ({ layout: s.layout, tree: s.tree, linksVersion: s.linksVersion, tagsVersion: s.tagsVersion }),
    shallowEqual,
  );
  const canvas = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [showGhost, setShowGhost] = useState(false);
  const [filter, setFilter] = useState("");
  const [asList, setAsList] = useState(false);
  const filterId = useId();
  const filterRef = useRef<HTMLInputElement>(null);
  const activeId = useMemo(() => {
    // Highlight the note shown in the other tab group, if any.
    for (const g of w.layout.groups) {
      const t = g.tabs[g.active];
      const v = t?.history[t.index];
      if (v?.type === "note") return v.id;
    }
    return null;
  }, [w.layout]);
  const openRef = useRef(actions.open);
  const activeRef = useRef(activeId);
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

  const view = useMemo<ViewData | null>(() => {
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
    return view.nodes
      .filter((n) => !n.ghost)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((n) => ({ id: n.id, name: n.name, out: outBy.get(n.id) ?? [] }));
  }, [data, view]);

  const notesInVault = data ? data.nodes.filter((n) => !n.ghost).length : 0;
  const shown = view ? (asList ? listRows.length : view.nodes.length) : 0;
  const empty = !!view && shown === 0;

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
    let labelAll = true;
    let hover: N | null = null;
    const radius = (n: N) => 3.5 + Math.sqrt(n.degree) * 2;

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

    const sim = forceSimulation<N>([])
      .force("link", forceLink<N, L>([]).id((d) => d.id).distance(56).strength(0.6))
      .force("charge", forceManyBody().strength(-140))
      .force("center", forceCenter(0, 0))
      .force("collide", forceCollide<N>().radius((n) => radius(n) + 2))
      .stop();

    const cam = () => (camRef.current ??= { x: 0, y: 0, k: 1 });

    const draw = () => {
      const view2d = cam();
      const activeId = activeRef.current;
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
        ctx.fillStyle = n.id === focus || n.id === activeId ? C.accent : n.ghost ? C.ghost : n.tagged ? C.mark : C.node;
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, radius(n), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = C.fg;
      ctx.font = `${13 / view2d.k}px ${C.font}, sans-serif`;
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

    /** Move the layout towards rest: animated, or computed at once under reduced motion. */
    const settle = (alpha: number) => {
      sim.alpha(alpha);
      if (reduce.matches) {
        sim.stop();
        const ticks = Math.ceil(Math.log(sim.alphaMin() / alpha) / Math.log(1 - sim.alphaDecay()));
        sim.tick(Math.max(0, ticks));
        draw();
      } else sim.restart();
    };

    const setView = (v: ViewData) => {
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
          n.tagged = !!v.tagFilter;
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
          tagged: !!v.tagFilter,
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
      labelAll = nodes.length <= 60;
      if (!camRef.current) camRef.current = { x: 0, y: 0, k: nodes.length < 15 ? 1.8 : nodes.length < 60 ? 1.3 : 1 };
      sim.nodes(nodes);
      sim.force<ForceLink<N, L>>("link")!.links(links);
      if (resume) draw();
      else settle(firstBuild || placed === 0 ? 1 : placed === nodes.length ? 0.1 : 0.3);
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
        const d = Math.hypot(n.x! - p.x, n.y! - p.y);
        if (d < radius(n) + 8 / k && d < bestD) {
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
          draw();
        }
        return;
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (Math.hypot(e.clientX - prev.x, e.clientY - prev.y) > 2) moved = true;
      const view2d = cam();
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
        if (reduce.matches) {
          dragNode.x = p.x;
          dragNode.y = p.y;
          draw();
        }
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
    sceneRef.current = { setView, draw };
    const saved = posRef.current;
    return () => {
      sim.stop();
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

  /* The highlighted note changed: repaint only. */
  useEffect(() => {
    activeRef.current = activeId;
    sceneRef.current?.draw();
  }, [activeId]);

  return (
    <div ref={rootRef} className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pb-3 pt-1" role="toolbar" aria-label="Graph options">
        <label htmlFor={filterId} className="sr-only">
          Filter notes
        </label>
        <div className="flex h-9 w-full items-center gap-1 rounded-lg border border-control bg-sheet pl-2.5 pr-1 focus-within:outline focus-within:outline-2 focus-within:outline-[var(--focus)] sm:w-64 md:h-8 pointer-coarse:h-11">
          <input
            ref={filterRef}
            id={filterId}
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              // Escape clears the filter, like the browser's own search field did.
              if (e.key === "Escape" && filter) {
                e.preventDefault();
                setFilter("");
              }
            }}
            placeholder="Filter by name or #tag…"
            autoComplete="off"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint md:text-[13px] [&::-webkit-search-cancel-button]:hidden"
          />
          {filter && (
            <button
              type="button"
              aria-label="Clear filter"
              onClick={() => {
                setFilter("");
                filterRef.current?.focus();
              }}
              className={CLEAR_BUTTON}
            >
              <X aria-hidden="true" className="size-4 stroke-[1.5]" />
            </button>
          )}
        </div>
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
            {nf.format(view.nodes.length)} {view.nodes.length === 1 ? "note" : "notes"}, {nf.format(view.edges.length)}{" "}
            {view.edges.length === 1 ? "link" : "links"}
          </span>
        )}
      </div>
      {error && !data && (
        <div className="px-4 text-[13px] text-muted">
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
      {!data && !error && <p className="px-4 text-[13px] text-faint">Loading graph…</p>}
      {empty && (
        <div role="status" className="px-4 text-[13px] text-muted">
          {notesInVault === 0 ? (
            <>
              <p>Your vault has no notes yet.</p>
              <button type="button" className="mt-2 font-medium text-accent-ink hover:underline" onClick={() => actions.newNote("")}>
                Create a note
              </button>
            </>
          ) : filter.trim() ? (
            <>
              <p>
                {view.tagFilter !== null ? (
                  <>
                    No notes tagged <span translate="no">#{view.tagFilter}</span>.
                  </>
                ) : (
                  <>No notes match “{filter.trim()}”.</>
                )}
              </p>
              <button type="button" className="mt-2 font-medium text-accent-ink hover:underline" onClick={() => setFilter("")}>
                Clear filter
              </button>
            </>
          ) : (
            <p>No created notes to list.</p>
          )}
        </div>
      )}
      {asList ? (
        view &&
        !empty && (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
            <ul className="max-w-2xl space-y-2">
              {listRows.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => actions.open(r.id)} className="font-medium text-accent-ink hover:underline" translate="no">
                    {r.name}
                  </button>
                  <span className="text-[13px] text-faint">
                    {" "}
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
        <canvas ref={canvas} aria-hidden="true" className={`min-h-0 w-full flex-1 cursor-grab touch-none ${empty ? "hidden" : ""}`} />
      )}
    </div>
  );
}
