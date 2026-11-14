/*
 * Graph view settings and the pure graph work behind them: which nodes and links a set of
 * filters keeps, the local neighbourhood of a note, and which group colours each node.
 *
 * Settings are kept per vault per device (localStorage, under the vault's id): a laptop and a
 * phone can each have their own view of the same vault. Nothing here touches the DOM, so the
 * same code is unit tested and runs on 5k-note vaults without React in the loop.
 */

export type GraphNodeData = { id: string; name: string; path: string; tags: string[]; ghost: boolean };
export type GraphEdgeData = { source: string; target: string };
export type NodeKind = "note" | "attachment" | "unresolved";

/** Group colours: the canvas presets that are not orange (orange marks tags), each >= 3:1 on the sheet. */
export const GROUP_COLORS = [5, 6, 4, 3, 1] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];
export const GROUP_COLOR_NAMES: Record<GroupColor, string> = { 5: "Cyan", 6: "Purple", 4: "Green", 3: "Yellow", 1: "Red" };
export const MAX_GROUPS = 8;

export type GraphGroup = { id: string; query: string; color: GroupColor };
export type LabelMode = "always" | "zoom" | "hover";

export type GraphSettings = {
  scope: "global" | "local";
  /** Local graph: how many links away from the open note. */
  depth: 1 | 2 | 3;
  search: string;
  tags: string[];
  folders: string[];
  showAttachments: boolean;
  showOrphans: boolean;
  existingOnly: boolean;
  groups: GraphGroup[];
  sizeByLinks: boolean;
  /** Link width in CSS pixels. */
  linkWidth: number;
  labels: LabelMode;
  /** Pull towards the centre, 0 to 1. */
  centre: number;
  /** Push between nodes, 0 to 500. */
  repel: number;
  /** Rest length of a link, 20 to 200. */
  linkDistance: number;
};

export const DEFAULT_SETTINGS: GraphSettings = {
  scope: "global",
  depth: 1,
  search: "",
  tags: [],
  folders: [],
  showAttachments: false,
  showOrphans: true,
  existingOnly: true,
  groups: [],
  sizeByLinks: true,
  linkWidth: 1,
  labels: "always",
  centre: 0.1,
  repel: 140,
  linkDistance: 56,
};

export const RANGES = {
  linkWidth: { min: 0.5, max: 4, step: 0.5 },
  centre: { min: 0, max: 1, step: 0.05 },
  repel: { min: 0, max: 500, step: 10 },
  linkDistance: { min: 20, max: 200, step: 4 },
} as const;

const clamp = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const strings = (v: unknown, max = 200) =>
  Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === "string" && s.length > 0 && s.length <= 500))].slice(0, max) : [];

/** Settings from storage, whatever shape they are in: unknown keys dropped, numbers clamped. */
export function parseSettings(raw: unknown): GraphSettings {
  const d = DEFAULT_SETTINGS;
  if (!raw || typeof raw !== "object") return { ...d };
  const r = raw as Record<string, unknown>;
  const groups = Array.isArray(r.groups)
    ? r.groups
        .filter((g): g is Record<string, unknown> => !!g && typeof g === "object")
        .map((g, i) => ({
          id: typeof g.id === "string" && g.id ? g.id.slice(0, 40) : `g${i}`,
          query: typeof g.query === "string" ? g.query.slice(0, 500) : "",
          color: (GROUP_COLORS as readonly number[]).includes(g.color as number) ? (g.color as GroupColor) : GROUP_COLORS[i % GROUP_COLORS.length],
        }))
        .slice(0, MAX_GROUPS)
    : [];
  return {
    scope: r.scope === "local" ? "local" : "global",
    depth: clamp(r.depth, 1, 3, d.depth) === 3 ? 3 : clamp(r.depth, 1, 3, d.depth) >= 2 ? 2 : 1,
    search: typeof r.search === "string" ? r.search.slice(0, 500) : "",
    tags: strings(r.tags),
    folders: strings(r.folders),
    showAttachments: bool(r.showAttachments, d.showAttachments),
    showOrphans: bool(r.showOrphans, d.showOrphans),
    existingOnly: bool(r.existingOnly, d.existingOnly),
    groups,
    sizeByLinks: bool(r.sizeByLinks, d.sizeByLinks),
    linkWidth: clamp(r.linkWidth, RANGES.linkWidth.min, RANGES.linkWidth.max, d.linkWidth),
    labels: r.labels === "zoom" || r.labels === "hover" ? r.labels : "always",
    centre: clamp(r.centre, RANGES.centre.min, RANGES.centre.max, d.centre),
    repel: clamp(r.repel, RANGES.repel.min, RANGES.repel.max, d.repel),
    linkDistance: clamp(r.linkDistance, RANGES.linkDistance.min, RANGES.linkDistance.max, d.linkDistance),
  };
}

const storageKey = (vault: string | null) => `nexus:graph:${vault ?? "default"}`;

/** This device's settings for the vault; the defaults when storage is empty, blocked or corrupt. */
export function loadSettings(vault: string | null): GraphSettings {
  try {
    const raw = window.localStorage.getItem(storageKey(vault));
    return parseSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(vault: string | null, s: GraphSettings) {
  try {
    window.localStorage.setItem(storageKey(vault), JSON.stringify(s));
  } catch {
    // Private mode or a full quota: the settings last for this visit only.
  }
}

/* ------------------------------------------------------------------ */
/* Kinds, folders and the query language                               */
/* ------------------------------------------------------------------ */

const NOTE_EXT = /\.(md|markdown|canvas)$/i;
const FILE_EXT = /\.[a-z0-9]{1,8}$/i;

/** A ghost whose target has a file extension (`![[photo.png]]`) is an attachment, not a missing note. */
export function nodeKind(n: Pick<GraphNodeData, "ghost" | "path">): NodeKind {
  if (!n.ghost) return "note";
  return FILE_EXT.test(n.path) && !NOTE_EXT.test(n.path) ? "attachment" : "unresolved";
}

export const folderOf = (path: string) => {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
};

const inFolder = (path: string, folder: string) => {
  const f = folderOf(path).toLowerCase();
  const want = folder.toLowerCase();
  return f === want || f.startsWith(`${want}/`);
};

const hasTag = (tags: string[], want: string) => tags.some((t) => t === want || t.startsWith(`${want}/`));

type Term = { neg: boolean; test: (n: GraphNodeData) => boolean };

/**
 * A query, as used by the search field and by groups: space-separated terms that must all match.
 * `#tag` or `tag:tag` (nested tags included), `path:Folder/Sub` or `folder:Folder`, `-term` to
 * exclude, "quoted words" kept together; anything else matches the note's name or path. Case is
 * ignored. An empty query matches nothing (an empty group colours no node).
 */
export function compileQuery(query: string): ((n: GraphNodeData) => boolean) | null {
  const tokens = query.match(/-?(?:\w+:)?"[^"]*"|\S+/g) ?? [];
  const terms: Term[] = [];
  for (let raw of tokens) {
    let neg = false;
    if (raw.startsWith("-") && raw.length > 1) {
      neg = true;
      raw = raw.slice(1);
    }
    const m = /^(tag|path|folder|file|name):(.*)$/i.exec(raw);
    const kind = m ? m[1].toLowerCase() : raw.startsWith("#") ? "tag" : "text";
    let value = (m ? m[2] : kind === "tag" ? raw.slice(1) : raw).replace(/^"|"$/g, "").toLowerCase();
    if (kind === "tag") value = value.replace(/^#/, "");
    if (!value) continue;
    const test =
      kind === "tag"
        ? (n: GraphNodeData) => hasTag(n.tags, value)
        : kind === "path" || kind === "folder"
          ? (n: GraphNodeData) => n.path.toLowerCase().startsWith(value.endsWith("/") ? value : `${value}/`) || folderOf(n.path).toLowerCase() === value
          : kind === "file" || kind === "name"
            ? (n: GraphNodeData) => n.name.toLowerCase().includes(value)
            : (n: GraphNodeData) => n.name.toLowerCase().includes(value) || n.path.toLowerCase().includes(value);
    terms.push({ neg, test });
  }
  if (!terms.length) return null;
  return (n) => terms.every((t) => t.test(n) !== t.neg);
}

/** The tag a search for exactly one `#tag` names, so matching nodes can be drawn in the tag colour. */
export function soleTag(query: string): string | null {
  const m = /^\s*(?:#|tag:)([^\s"]+)\s*$/i.exec(query);
  return m ? m[1].toLowerCase() : null;
}

/* ------------------------------------------------------------------ */
/* Neighbourhood                                                       */
/* ------------------------------------------------------------------ */

/** Nodes within `depth` links of `root`, either direction. Includes the root. */
export function neighbourhood(edges: GraphEdgeData[], root: string, depth: number) {
  const adj = new Map<string, string[]>();
  const add = (a: string, b: string) => {
    const l = adj.get(a);
    if (l) l.push(b);
    else adj.set(a, [b]);
  };
  for (const e of edges) {
    add(e.source, e.target);
    add(e.target, e.source);
  }
  const seen = new Set([root]);
  let frontier = [root];
  for (let d = 0; d < depth && frontier.length; d++) {
    const next: string[] = [];
    for (const id of frontier)
      for (const m of adj.get(id) ?? [])
        if (!seen.has(m)) {
          seen.add(m);
          next.push(m);
        }
    frontier = next;
  }
  return seen;
}

/* ------------------------------------------------------------------ */
/* The filtered view                                                   */
/* ------------------------------------------------------------------ */

export type GraphViewModel = {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  /** Group colour per node id (the first group whose query matches wins). */
  colors: Map<string, GroupColor>;
  /** Nodes drawn in the tag colour: the search names exactly one tag. */
  tagged: Set<string>;
  tagFilter: string | null;
  /** Local graph: the note it is centred on (null in the global graph). */
  root: string | null;
};

/**
 * Apply the settings to the vault's graph. Order: node kinds, tags and folders, the search
 * text, then the local neighbourhood (taken over what is left, so filters also cut paths), then
 * orphans. In the local graph the root note always stays, whatever the filters say.
 */
export function buildView(data: { nodes: GraphNodeData[]; edges: GraphEdgeData[] }, s: GraphSettings, activeId: string | null): GraphViewModel {
  const search = compileQuery(s.search);
  const tagFilter = soleTag(s.search);
  const tags = s.tags.map((t) => t.toLowerCase().replace(/^#/, ""));
  const local = s.scope === "local" && activeId ? activeId : null;
  let keep = data.nodes.filter((n) => {
    if (n.id === local) return true;
    const kind = nodeKind(n);
    if (kind === "attachment" && !s.showAttachments) return false;
    if (kind === "unresolved" && s.existingOnly) return false;
    // Tag and folder filters choose among notes; attachments and unresolved links ride along with them.
    if (kind === "note") {
      if (tags.length && !tags.some((t) => hasTag(n.tags, t))) return false;
      if (s.folders.length && !s.folders.some((f) => inFolder(n.path, f))) return false;
    }
    if (search && !search(n)) return false;
    return true;
  });
  let ids = new Set(keep.map((n) => n.id));
  let edges = data.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  if (local) {
    const near = ids.has(local) ? neighbourhood(edges, local, s.depth) : new Set<string>();
    keep = keep.filter((n) => near.has(n.id));
    ids = near;
    edges = edges.filter((e) => near.has(e.source) && near.has(e.target));
  }
  if (!s.showOrphans) {
    const linked = new Set<string>();
    for (const e of edges) {
      linked.add(e.source);
      linked.add(e.target);
    }
    keep = keep.filter((n) => linked.has(n.id) || n.id === local);
  }
  const groups = s.groups.map((g) => ({ test: compileQuery(g.query), color: g.color })).filter((g) => g.test);
  const colors = new Map<string, GroupColor>();
  if (groups.length)
    for (const n of keep) {
      const g = groups.find((x) => x.test!(n));
      if (g) colors.set(n.id, g.color);
    }
  const tagged = new Set<string>();
  if (tagFilter !== null) for (const n of keep) if (hasTag(n.tags, tagFilter)) tagged.add(n.id);
  return { nodes: keep, edges, colors, tagged, tagFilter, root: local };
}

/** Every tag and folder in the vault, for the filter pickers. */
export function facets(nodes: GraphNodeData[]) {
  const tags = new Set<string>();
  const folders = new Set<string>();
  for (const n of nodes) {
    if (n.ghost) continue;
    for (const t of n.tags) tags.add(t);
    let f = folderOf(n.path);
    while (f) {
      folders.add(f);
      f = folderOf(f);
    }
  }
  const sort = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" });
  return { tags: [...tags].sort(sort), folders: [...folders].sort(sort) };
}

/** How many filters differ from the defaults: shown on the settings button. */
export function activeFilterCount(s: GraphSettings) {
  const d = DEFAULT_SETTINGS;
  return (
    (s.tags.length ? 1 : 0) +
    (s.folders.length ? 1 : 0) +
    (s.showAttachments !== d.showAttachments ? 1 : 0) +
    (s.showOrphans !== d.showOrphans ? 1 : 0) +
    (s.existingOnly !== d.existingOnly ? 1 : 0)
  );
}
