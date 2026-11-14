import "./atlas.css";

/**
 * Nexus's signature picture: a vault drawn as schematic line art. Each mark is a note, each hairline a
 * [[link]]; blue marks the open note and its neighbours, orange the notes carrying one #tag. The
 * layout is seeded, so the server and every visit draw the same vault.
 */

type Node = { x: number; y: number; r: number; kind: "plain" | "open" | "near" | "tag"; label?: string };

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const HOT = ["Weekly sync", "Project kickoff", "Release notes", "Mira Chen", "2026-11-13"];
const FAR = ["Reading list", "Zettelkasten"];

function build(width: number, height: number, count: number, seed: number) {
  const rand = rng(seed);
  const tall = width < height * 1.6;
  const unit = Math.min(width / (tall ? 1.5 : 2.6), height);
  const open = { x: width * 0.42, y: height * 0.5 };
  const nodes: Node[] = [{ x: Math.round(open.x), y: Math.round(open.y), r: 6, kind: "open", label: "Q4 roadmap" }];
  const edges: Array<[number, number, boolean]> = [];
  // Folders: one cluster around each note the open note links to, and two further out.
  const hubs: Array<{ x: number; y: number; label: string; hot: boolean }> = [];
  HOT.forEach((label, k) => {
    const a = -Math.PI * 0.85 + (k / (HOT.length - 1)) * Math.PI * 1.7 + (rand() - 0.5) * 0.3;
    hubs.push({ x: open.x + Math.cos(a) * unit * 0.42, y: open.y + Math.sin(a) * unit * 0.36, label, hot: true });
  });
  hubs.push({ x: width * (tall ? 0.18 : 0.1), y: height * (tall ? 0.12 : 0.42), label: FAR[0], hot: false });
  hubs.push({ x: width * (tall ? 0.72 : 0.84), y: height * (tall ? 0.9 : 0.5), label: FAR[1], hot: false });
  const hubIdx: number[] = [];
  for (const h of hubs) {
    hubIdx.push(nodes.length);
    nodes.push({ x: Math.round(h.x), y: Math.round(h.y), r: h.hot ? 4 : 4, kind: h.hot ? "near" : "plain", label: h.label });
  }
  hubIdx.forEach((i) => {
    if (nodes[i].kind === "near") edges.push([0, i, true]);
  });
  // Notes in each folder, linked to their folder's hub or to a neighbour.
  let c = 0;
  while (nodes.length < count) {
    const h = hubIdx[c++ % hubIdx.length];
    const spread = hubs[hubIdx.indexOf(h)].hot ? 0.2 : 0.3;
    const a = rand() * Math.PI * 2;
    const d = (0.35 + rand() * 0.65) * unit * spread;
    const n = { x: Math.round(nodes[h].x + Math.cos(a) * d * 1.3), y: Math.round(nodes[h].y + Math.sin(a) * d), r: 2 + Math.round(rand()), kind: "plain" as const };
    if (n.x < 8 || n.x > width - 8 || n.y < 8 || n.y > height - 8) continue;
    const i = nodes.length;
    nodes.push(n);
    const near = nodes
      .map((m, j) => ({ j, d: (m.x - n.x) ** 2 + (m.y - n.y) ** 2 }))
      .filter((o) => o.j !== i && o.j !== 0)
      .sort((p, q) => p.d - q.d);
    edges.push([i, rand() > 0.4 ? h : near[0].j, false]);
    if (rand() > 0.6 && near[1]) edges.push([i, near[1].j, false]);
  }
  // A few links between folders.
  edges.push([hubIdx[0], hubIdx[5], false], [hubIdx[4], hubIdx[6], false], [hubIdx[2], hubIdx[6], false]);
  for (let i = 9; i < nodes.length; i += 7) if (nodes[i].kind === "plain") nodes[i].kind = "tag";
  return { nodes, edges };
}

export function VaultAtlas({
  width = 1200,
  height = 420,
  count = 64,
  seed = 7,
  labels = true,
  decorative = false,
  className,
}: {
  width?: number;
  height?: number;
  count?: number;
  seed?: number;
  labels?: boolean;
  /** Drawn as ornament next to other content: hidden from assistive technology. */
  decorative?: boolean;
  className?: string;
}) {
  const { nodes, edges } = build(width, height, count, seed);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      {...(decorative
        ? { "aria-hidden": true }
        : {
            role: "img",
            "aria-label":
              "A sample vault drawn as its link graph: each dot is a note and each line a link between two notes. The open note, Q4 roadmap, links to five others.",
          })}
      preserveAspectRatio="xMidYMid meet"
    >
      <g className="at-edges">
        {edges.map(([a, b, hot], i) => (
          <line
            key={i}
            x1={nodes[a].x}
            y1={nodes[a].y}
            x2={nodes[b].x}
            y2={nodes[b].y}
            className={hot ? "at-edge at-edge-hot" : "at-edge"}
            style={{ ["--i" as string]: i % 24 }}
          />
        ))}
      </g>
      <g>
        {nodes.map((n, i) => (
          <circle key={i} cx={n.x} cy={n.y} r={n.r} className={`at-node at-${n.kind}`} />
        ))}
      </g>
      {labels && (
        <g className="at-labels" aria-hidden="true">
          {nodes
            .filter((n) => n.label)
            .map((n) => (
              <text key={n.label} x={n.x + n.r + 6} y={n.y - n.r - 4} className={n.kind === "open" ? "at-label at-label-open" : "at-label"}>
                {n.label}
              </text>
            ))}
        </g>
      )}
    </svg>
  );
}

/** The vault as a strip of vertical bars, one per note, its height the note's length. */
export function VaultBars({ count = 140, seed = 11, className }: { count?: number; seed?: number; className?: string }) {
  const rand = rng(seed);
  const w = count * 8;
  const h = 64;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden="true" preserveAspectRatio="none">
      {Array.from({ length: count }, (_, i) => {
        const v = 6 + Math.round(rand() ** 1.8 * 56);
        const kind = i === 61 ? "open" : rand() > 0.94 ? "tag" : "plain";
        return <rect key={i} x={i * 8 + 3} y={h - v} width={2} height={v} className={`at-bar at-bar-${kind}`} />;
      })}
    </svg>
  );
}
