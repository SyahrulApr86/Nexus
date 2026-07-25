import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  select,
  zoom,
  zoomIdentity,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
  type ZoomTransform,
} from "d3";
import type { GraphDataDto } from "@nexus/shared";
import { api } from "../api/client.js";
import { Button } from "../components/ui.js";

interface GraphNode extends SimulationNodeDatum {
  id: string;
  title: string;
  linkCount: number;
}

type GraphLink = SimulationLinkDatum<GraphNode>;

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

/**
 * FR-015/016: interactive force-directed graph on canvas with pan/zoom and
 * viewport culling (SC-004). Canvas is decorative for AT — the node list
 * beside it is the accessible, keyboard-first path to every node (SC-006).
 */
export function GraphPage() {
  const { data } = useQuery({
    queryKey: ["graph"],
    queryFn: () => api<GraphDataDto>("/graph"),
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const navigate = useNavigate();
  const [listOpen, setListOpen] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;

    const parent = canvas.parentElement!;
    const dpr = window.devicePixelRatio || 1;
    const width = parent.clientWidth;
    const height = parent.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d")!;

    const nodes: GraphNode[] = data.nodes.map((n) => ({ ...n }));
    const links: GraphLink[] = data.edges.map((e) => ({
      source: e.sourceId,
      target: e.targetId,
    }));

    let transform: ZoomTransform = zoomIdentity;

    const ink = cssVar("--t-ink") || "#091135";
    const accent = cssVar("--t-accent") || "#0b5cd6";
    const mist = cssVar("--t-mist") || "#b1bbcd";
    const bg = cssVar("--t-bg") || "#ffffff";

    const draw = () => {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
      ctx.translate(transform.x, transform.y);
      ctx.scale(transform.k, transform.k);

      // Viewport culling: skip anything outside the visible world rect
      const x0 = -transform.x / transform.k - 50;
      const y0 = -transform.y / transform.k - 50;
      const x1 = x0 + width / transform.k + 100;
      const y1 = y0 + height / transform.k + 100;
      const visible = (x?: number, y?: number) =>
        x !== undefined && y !== undefined && x > x0 && x < x1 && y > y0 && y < y1;

      ctx.strokeStyle = mist;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1 / transform.k;
      ctx.beginPath();
      for (const l of links) {
        const s = l.source as GraphNode;
        const t = l.target as GraphNode;
        if (!visible(s.x, s.y) && !visible(t.x, t.y)) continue;
        ctx.moveTo(s.x!, s.y!);
        ctx.lineTo(t.x!, t.y!);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      for (const n of nodes) {
        if (!visible(n.x, n.y)) continue;
        const r = 4 + Math.min(n.linkCount, 8);
        ctx.beginPath();
        ctx.fillStyle = n.linkCount > 0 ? accent : mist;
        ctx.arc(n.x!, n.y!, r, 0, Math.PI * 2);
        ctx.fill();
        if (transform.k > 0.5) {
          ctx.fillStyle = ink;
          ctx.font = `${12 / transform.k}px sans-serif`;
          ctx.fillText(n.title.slice(0, 30), n.x! + r + 3, n.y! + 4);
        }
      }
      ctx.restore();
    };

    const simulation = forceSimulation(nodes)
      .force(
        "link",
        forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance(60),
      )
      .force("charge", forceManyBody().strength(-120))
      .force("center", forceCenter(width / 2, height / 2))
      .force("collide", forceCollide(14))
      .on("tick", draw);

    const zoomBehavior = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 6])
      .on("zoom", (event) => {
        transform = event.transform;
        draw();
      });
    select(canvas).call(zoomBehavior);

    const onClick = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const [wx, wy] = transform.invert([
        event.clientX - rect.left,
        event.clientY - rect.top,
      ]);
      let best: GraphNode | null = null;
      let bestDist = 15;
      for (const n of nodes) {
        const d = Math.hypot((n.x ?? 0) - wx, (n.y ?? 0) - wy);
        if (d < bestDist) {
          best = n;
          bestDist = d;
        }
      }
      if (best) {
        navigate({ to: "/notes/$noteId", params: { noteId: best.id } });
      }
    };
    canvas.addEventListener("click", onClick);

    return () => {
      simulation.stop();
      canvas.removeEventListener("click", onClick);
      select(canvas).on(".zoom", null);
    };
  }, [data, navigate]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-[24px] font-semibold tracking-heading">Graph</h1>
          <p className="text-[14px] text-muted">
            {data
              ? `${data.nodes.length} notes · ${data.edges.length} links · ${data.orphanCount} unlinked`
              : "Loading…"}
          </p>
        </div>
        <Button
          variant="ghost"
          className="!px-3 !py-1.5 text-[14px]"
          aria-expanded={listOpen}
          onClick={() => setListOpen((o) => !o)}
        >
          {listOpen ? "Hide node list" : "Show node list"}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            data-testid="graph-canvas"
            className="absolute inset-0 cursor-grab active:cursor-grabbing"
          />
        </div>
        {listOpen && (
          <nav
            aria-label="Graph nodes"
            className="w-64 shrink-0 overflow-auto border-l border-border bg-surface py-2"
          >
            <ul className="flex flex-col">
              {data?.nodes.map((n) => (
                <li key={n.id}>
                  <Link
                    to="/notes/$noteId"
                    params={{ noteId: n.id }}
                    className="flex items-center justify-between px-4 py-1.5 text-[14px] text-ink hover:bg-card"
                  >
                    <span className="truncate">{n.title}</span>
                    <span className="ml-2 shrink-0 text-[12px] text-muted">
                      {n.linkCount}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </div>
  );
}
