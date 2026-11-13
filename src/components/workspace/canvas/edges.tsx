"use client";

import { memo, useEffect, useRef, useState } from "react";
import {
  anchor,
  arrowHead,
  bestSides,
  colorVars,
  edgePath,
  type CanvasDoc,
  type CanvasEdge,
  type EdgeGeometry,
  type Point,
  type Side,
} from "@/lib/canvas";

export type PlacedEdge = { edge: CanvasEdge; geo: EdgeGeometry; from: string; to: string };

/** Geometry of every connection whose two cards exist; `names` gives each card's short label. */
export function placeEdges(doc: CanvasDoc, names: Map<string, string>): PlacedEdge[] {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const out: PlacedEdge[] = [];
  for (const edge of doc.edges) {
    const a = byId.get(edge.fromNode);
    const b = byId.get(edge.toNode);
    if (!a || !b) continue;
    const [sa, sb] = bestSides(a, b);
    const fromSide = edge.fromSide ?? sa;
    const toSide = edge.toSide ?? sb;
    const geo = edgePath(anchor(a, fromSide), fromSide, anchor(b, toSide), toSide);
    out.push({ edge, geo, from: names.get(a.id) ?? "card", to: names.get(b.id) ?? "card" });
  }
  return out;
}

/** The lines and arrowheads, under the cards. Decorative to assistive tech: the knobs carry the names. */
export const EdgeLines = memo(function EdgeLines({
  edges,
  selected,
  draft,
  z,
}: {
  edges: PlacedEdge[];
  /** Stacking order: above groups, below cards. */
  z: number;
  selected: ReadonlySet<string>;
  /** A connection being drawn from a side handle. */
  draft: { from: Point; side: Side; to: Point } | null;
}) {
  const d = draft ? edgePath(draft.from, draft.side, draft.to, null) : null;
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1" style={{ zIndex: z }}>
      {edges.map(({ edge, geo }) => {
        const on = selected.has(edge.id);
        const toEnd = edge.toEnd ?? "arrow";
        const fromEnd = edge.fromEnd ?? "none";
        return (
          <g key={edge.id} className="canvas-edge" data-selected={on || undefined} style={colorVars(edge.color)}>
            {/* A wide, invisible stroke is the hit area for pointer selection. */}
            <path d={geo.d} className="canvas-edge-hit" data-edge-id={edge.id} />
            <path d={geo.d} className="canvas-edge-line" />
            {toEnd === "arrow" && <polygon points={arrowHead(geo.to, geo.c2)} className="canvas-edge-head" />}
            {fromEnd === "arrow" && <polygon points={arrowHead(geo.from, geo.c1)} className="canvas-edge-head" />}
          </g>
        );
      })}
      {d && (
        <g className="canvas-edge" data-selected>
          <path d={d.d} className="canvas-edge-line" strokeDasharray="6 4" />
        </g>
      )}
    </svg>
  );
});

/**
 * One focusable knob per connection at its midpoint: the label when there is one, else a small
 * dot. It is how keyboard and screen reader users reach a connection.
 */
export const EdgeKnob = memo(function EdgeKnob({
  placed,
  z,
  selected,
  editing,
  onLabel,
  onDone,
}: {
  placed: PlacedEdge;
  z: number;
  selected: boolean;
  editing: boolean;
  onLabel: (label: string) => void;
  onDone: (focusKnob: boolean) => void;
}) {
  const { edge, geo, from, to } = placed;
  const label = edge.label?.trim() ?? "";
  const name = `Connection from ${from} to ${to}${label ? `, labelled ${label}` : ""}`;
  return (
    <div
      className="absolute"
      style={{ left: geo.mid.x, top: geo.mid.y, zIndex: z, transform: "translate(-50%, -50%)", ...colorVars(edge.color) }}
    >
      {editing ? (
        <EdgeLabelInput initial={edge.label ?? ""} onCommit={onLabel} onDone={onDone} />
      ) : (
        <button
          type="button"
          data-edge-id={edge.id}
          data-selected={selected || undefined}
          aria-label={name}
          aria-pressed={selected}
          className={label ? "canvas-edge-label" : "canvas-edge-dot"}
        >
          {label ? <span translate="no">{label}</span> : null}
        </button>
      )}
    </div>
  );
});

function EdgeLabelInput({
  initial,
  onCommit,
  onDone,
}: {
  initial: string;
  onCommit: (label: string) => void;
  onDone: (focusKnob: boolean) => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (commit: boolean, focusKnob: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (commit && value.trim() !== initial.trim()) onCommit(value.trim());
    onDone(focusKnob);
  };
  return (
    <input
      ref={ref}
      value={value}
      aria-label="Connection label"
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
      className="canvas-edge-input"
      style={{ width: `${Math.max(8, value.length + 2)}ch` }}
    />
  );
}
