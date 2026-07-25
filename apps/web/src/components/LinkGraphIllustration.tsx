import { useEffect, useRef, useState } from "react";

interface Node {
  id: string;
  label: string;
  x: number;
  y: number;
  r: number;
  broken?: boolean;
}

const NODES: Node[] = [
  { id: "systems", label: "Systems thinking", x: 250, y: 150, r: 11 },
  { id: "feedback", label: "Feedback Loops", x: 110, y: 78, r: 8 },
  { id: "stocks", label: "Stocks & Flows", x: 108, y: 224, r: 8 },
  { id: "antifragile", label: "Antifragile", x: 400, y: 84, r: 7, broken: true },
  { id: "reading", label: "Reading list", x: 412, y: 218, r: 7 },
  { id: "orphan", label: "Scratchpad", x: 505, y: 152, r: 5 },
];

const EDGES: [string, string][] = [
  ["systems", "feedback"],
  ["systems", "stocks"],
  ["systems", "antifragile"],
  ["systems", "reading"],
  ["feedback", "stocks"],
];

const byId = Object.fromEntries(NODES.map((n) => [n.id, n]));

/**
 * Draws the wikilink network the way the app's graph view does — edges first,
 * then nodes, then labels — so the marketing page never promises a shape the
 * product doesn't produce. Static when reduced motion is requested.
 */
export function LinkGraphIllustration() {
  const ref = useRef<SVGSVGElement>(null);
  const [play, setPlay] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setPlay(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setPlay(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2, rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(el);
    // Never leave the illustration blank: if it is still unseen after a beat
    // (odd scroll containers, screenshots, prerender), draw it anyway.
    const fallback = setTimeout(() => {
      setPlay(true);
      observer.disconnect();
    }, 2500);
    return () => {
      clearTimeout(fallback);
      observer.disconnect();
    };
  }, []);

  return (
    <svg
      ref={ref}
      viewBox="0 0 600 300"
      role="img"
      aria-label="Six notes connected by wikilinks, with one unlinked note off to the side and one link pointing at a note that doesn't exist yet"
      className="w-full"
      data-testid="link-graph"
    >
      <g stroke="var(--t-mist)" strokeWidth="1.5" fill="none">
        {EDGES.map(([a, b], i) => {
          const from = byId[a]!;
          const to = byId[b]!;
          const length = Math.hypot(to.x - from.x, to.y - from.y);
          return (
            <line
              key={`${a}-${b}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              strokeDasharray={length}
              strokeDashoffset={play ? 0 : length}
              strokeOpacity={to.broken ? 0.55 : 1}
              style={{
                transition: "stroke-dashoffset 620ms ease",
                transitionDelay: `${i * 110}ms`,
              }}
            />
          );
        })}
      </g>
      {NODES.map((n, i) => (
        <g
          key={n.id}
          style={{
            opacity: play ? 1 : 0,
            transition: "opacity 400ms ease",
            transitionDelay: `${300 + i * 90}ms`,
          }}
        >
          <circle
            cx={n.x}
            cy={n.y}
            r={n.r}
            fill={n.broken ? "var(--t-bg)" : "var(--t-accent)"}
            stroke={n.broken ? "var(--t-broken)" : "none"}
            strokeWidth={n.broken ? 1.5 : 0}
            strokeDasharray={n.broken ? "3 3" : undefined}
          />
          <text
            x={n.x + n.r + 7}
            y={n.y + 4}
            fontSize="13"
            fill={n.broken ? "var(--t-broken)" : "var(--t-ink)"}
            className="font-sans"
          >
            {n.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
