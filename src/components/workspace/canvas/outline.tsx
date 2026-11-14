"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { colorName, contains, readingOrder, type CanvasDoc, type CanvasNode } from "@/lib/canvas";
import { IconButton } from "../ui";
import type { PlacedEdge } from "./edges";

type Item = { node: CanvasNode; children: Item[] };

/** Cards in reading order, each card listed under the smallest group that holds it. */
function nest(doc: CanvasDoc): Item[] {
  const ordered = readingOrder(doc.nodes);
  const groups = ordered.filter((n) => n.type === "group");
  const parentOf = new Map<string, string>();
  for (const n of ordered) {
    let best: CanvasNode | null = null;
    for (const g of groups) {
      if (g.id === n.id || !contains(g, n)) continue;
      if (n.type === "group" && contains(n, g)) continue;
      if (!best || best.width * best.height > g.width * g.height) best = g;
    }
    if (best) parentOf.set(n.id, best.id);
  }
  const items = new Map(ordered.map((n) => [n.id, { node: n, children: [] as Item[] }]));
  const roots: Item[] = [];
  for (const n of ordered) {
    const item = items.get(n.id)!;
    const p = parentOf.get(n.id);
    if (p && items.has(p)) items.get(p)!.children.push(item);
    else roots.push(item);
  }
  return roots;
}

/**
 * The canvas as a structured list: every card (groups holding their cards) in reading order, then
 * every connection. Choosing an entry selects it on the canvas and moves focus there.
 */
export function CanvasOutline({
  doc,
  edges,
  names,
  kinds,
  selection,
  onPick,
  onClose,
}: {
  doc: CanvasDoc;
  edges: PlacedEdge[];
  names: Map<string, string>;
  kinds: Map<string, string>;
  selection: ReadonlySet<string>;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const tree = nest(doc);

  const entry = (id: string, text: string, detail: string | null, spoken?: string) => (
    <button
      type="button"
      onClick={() => onPick(id)}
      aria-label={spoken ? `${spoken}${detail ? `, ${detail}` : ""}` : undefined}
      aria-current={selection.has(id) || undefined}
      className="flex w-full min-w-0 flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-hover aria-[current]:bg-accent-soft"
    >
      <span className="w-full truncate text-[14px] text-fg" translate="no">
        {text}
      </span>
      {detail && <span className="text-[12px] leading-4 text-faint">{detail}</span>}
    </button>
  );

  const render = (items: Item[]) => (
    <ul className="space-y-0.5">
      {items.map(({ node, children }) => {
        const color = colorName(node.color);
        const detail = [kinds.get(node.id), color && `${color}`].filter(Boolean).join(", ");
        return (
          <li key={node.id}>
            {entry(node.id, names.get(node.id) ?? "Card", detail)}
            {children.length > 0 && (
              <div className="ml-3 border-l border-rule pl-2">
                <span className="sr-only">In this group:</span>
                {render(children)}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <aside
      aria-labelledby="canvas-outline-title"
      className="absolute inset-0 z-30 flex flex-col bg-sheet md:inset-y-0 md:left-auto md:right-0 md:w-80 md:border-l md:border-border"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-rule pl-4 pr-2">
        <h2 ref={heading} id="canvas-outline-title" tabIndex={-1} className="flex-1 text-[14px] font-semibold outline-none">
          Canvas outline
        </h2>
        <IconButton label="Close outline" onClick={onClose}>
          <X />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3">
        <h3 className="px-2 pb-1 text-[12px] font-medium leading-4 text-muted">
          Cards <span className="text-faint">({doc.nodes.length})</span>
        </h3>
        {tree.length ? render(tree) : <p className="px-2 text-[13px] text-faint">No cards yet.</p>}
        <h3 className="mt-4 px-2 pb-1 text-[12px] font-medium leading-4 text-muted">
          Connections <span className="text-faint">({edges.length})</span>
        </h3>
        {edges.length ? (
          <ul className="space-y-0.5">
            {edges.map(({ edge, from, to }) => {
              const both = (edge.fromEnd ?? "none") === "arrow" && (edge.toEnd ?? "arrow") === "arrow";
              const none = (edge.fromEnd ?? "none") === "none" && (edge.toEnd ?? "arrow") === "none";
              const arrow = both ? "↔" : none ? "–" : (edge.toEnd ?? "arrow") === "arrow" ? "→" : "←";
              const color = colorName(edge.color);
              const spoken = both ? `${from} and ${to}, both ways` : none ? `${from} and ${to}` : arrow === "→" ? `From ${from} to ${to}` : `From ${to} to ${from}`;
              return (
                <li key={edge.id}>
                  {entry(
                    edge.id,
                    `${from} ${arrow} ${to}`,
                    [edge.label?.trim() && `“${edge.label.trim()}”`, color].filter(Boolean).join(", ") || null,
                    spoken,
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-2 text-[13px] text-faint">No connections yet.</p>
        )}
      </div>
    </aside>
  );
}
