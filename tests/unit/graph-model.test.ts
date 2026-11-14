import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  buildView,
  compileQuery,
  DEFAULT_SETTINGS,
  facets,
  neighbourhood,
  nodeKind,
  parseSettings,
  soleTag,
  type GraphNodeData,
  type GraphSettings,
} from "@/components/workspace/graph/model";

const node = (id: string, path: string, tags: string[] = [], ghost = false): GraphNodeData => ({
  id,
  path,
  name: path.split("/").pop()!,
  tags,
  ghost,
});

const data = {
  nodes: [
    node("a", "Projects/Atlas", ["project", "launch"]),
    node("b", "Projects/Pricing", ["project"]),
    node("c", "Research/Interviews", ["research"]),
    node("d", "Research/Deep/Competitors", ["research/market"]),
    node("e", "Inbox"),
    node("f", "Orphan"),
    node("ghost:photo.png", "photo.png", [], true),
    node("ghost:Missing", "Missing", [], true),
  ],
  edges: [
    { source: "a", target: "b" },
    { source: "b", target: "d" },
    { source: "c", target: "a" },
    { source: "e", target: "c" },
    { source: "a", target: "ghost:photo.png" },
    { source: "c", target: "ghost:Missing" },
  ],
};

const ids = (v: { nodes: { id: string }[] }) => v.nodes.map((n) => n.id).sort();
const with_ = (p: Partial<GraphSettings>): GraphSettings => ({ ...DEFAULT_SETTINGS, ...p });

describe("graph settings", () => {
  it("parses stored settings defensively", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("nope")).toEqual(DEFAULT_SETTINGS);
    const s = parseSettings({
      scope: "local",
      depth: 9,
      repel: -50,
      linkDistance: 1000,
      linkWidth: "wide",
      labels: "sometimes",
      tags: ["a", "a", 3, ""],
      groups: [{ query: "#x", color: 2 }, { id: "k", query: "y", color: 6 }, null],
      extra: true,
    });
    expect(s.scope).toBe("local");
    expect(s.depth).toBe(3);
    expect(s.repel).toBe(0);
    expect(s.linkDistance).toBe(200);
    expect(s.linkWidth).toBe(DEFAULT_SETTINGS.linkWidth);
    expect(s.labels).toBe("always");
    expect(s.tags).toEqual(["a"]);
    // Orange (2) is not a group colour: it marks tags.
    expect(s.groups.map((g) => g.color)).toEqual([5, 6]);
    expect(s.groups[1].id).toBe("k");
    expect("extra" in s).toBe(false);
  });

  it("counts filters that differ from the defaults", () => {
    expect(activeFilterCount(DEFAULT_SETTINGS)).toBe(0);
    expect(activeFilterCount(with_({ tags: ["x"], showOrphans: false, existingOnly: false }))).toBe(3);
  });
});

describe("graph queries", () => {
  it("matches names, tags with nesting, folders and exclusions", () => {
    const q = (s: string) => data.nodes.filter((n) => compileQuery(s)!(n)).map((n) => n.id);
    expect(q("atlas")).toEqual(["a"]);
    expect(q("#research")).toEqual(["c", "d"]);
    expect(q("tag:project -pricing")).toEqual(["a"]);
    expect(q("path:Research")).toEqual(["c", "d"]);
    expect(q("folder:research/deep")).toEqual(["d"]);
    expect(q('"Inbox"')).toEqual(["e"]);
    expect(compileQuery("   ")).toBeNull();
  });

  it("names a sole tag search", () => {
    expect(soleTag("#Project")).toBe("project");
    expect(soleTag("tag:research/market")).toBe("research/market");
    expect(soleTag("#a #b")).toBeNull();
    expect(soleTag("atlas")).toBeNull();
  });

  it("tells attachments from missing notes", () => {
    expect(nodeKind({ ghost: false, path: "x.png" })).toBe("note");
    expect(nodeKind({ ghost: true, path: "img/photo.PNG" })).toBe("attachment");
    expect(nodeKind({ ghost: true, path: "Missing" })).toBe("unresolved");
    expect(nodeKind({ ghost: true, path: "Plan.md" })).toBe("unresolved");
    expect(nodeKind({ ghost: true, path: "v1.2 notes" })).toBe("unresolved");
  });
});

describe("graph view model", () => {
  it("hides attachments and missing notes by default and shows them on request", () => {
    expect(ids(buildView(data, DEFAULT_SETTINGS, null))).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(ids(buildView(data, with_({ showAttachments: true }), null))).toContain("ghost:photo.png");
    const all = buildView(data, with_({ showAttachments: true, existingOnly: false }), null);
    expect(all.nodes).toHaveLength(8);
    expect(all.edges).toHaveLength(6);
  });

  it("filters by tags and folders, keeping only links between kept nodes", () => {
    const v = buildView(data, with_({ tags: ["project"] }), null);
    expect(ids(v)).toEqual(["a", "b"]);
    expect(v.edges).toEqual([{ source: "a", target: "b" }]);
    expect(ids(buildView(data, with_({ folders: ["Research"] }), null))).toEqual(["c", "d"]);
    expect(ids(buildView(data, with_({ folders: ["Research/Deep", "Projects"] }), null))).toEqual(["a", "b", "d"]);
  });

  it("hides orphans", () => {
    expect(ids(buildView(data, with_({ showOrphans: false }), null))).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("builds the local graph to the chosen depth, both directions", () => {
    expect([...neighbourhood(data.edges, "a", 1)].sort()).toEqual(["a", "b", "c", "ghost:photo.png"]);
    expect(ids(buildView(data, with_({ scope: "local", depth: 1 }), "a"))).toEqual(["a", "b", "c"]);
    expect(ids(buildView(data, with_({ scope: "local", depth: 2 }), "a"))).toEqual(["a", "b", "c", "d", "e"]);
    // The root stays even when a filter would drop it; filters also cut paths (d is only reachable via b).
    const v = buildView(data, with_({ scope: "local", depth: 3, search: "#research" }), "a");
    expect(v.root).toBe("a");
    expect(ids(v)).toEqual(["a", "c"]);
    expect(ids(buildView(data, with_({ scope: "local" }), "f"))).toEqual(["f"]);
  });

  it("colours nodes by the first matching group and marks a sole tag search", () => {
    const v = buildView(
      data,
      with_({
        groups: [
          { id: "1", query: "#project", color: 5 },
          { id: "2", query: "path:Projects", color: 6 },
          { id: "3", query: "", color: 4 },
          { id: "4", query: "path:Research", color: 3 },
        ],
      }),
      null,
    );
    expect(Object.fromEntries(v.colors)).toEqual({ a: 5, b: 5, c: 3, d: 3 });
    const t = buildView(data, with_({ search: "#project" }), null);
    expect([...t.tagged].sort()).toEqual(["a", "b"]);
    expect(t.tagFilter).toBe("project");
  });

  it("lists tags and every folder level for the pickers", () => {
    expect(facets(data.nodes)).toEqual({
      tags: ["launch", "project", "research", "research/market"],
      folders: ["Projects", "Research", "Research/Deep"],
    });
  });

  it("filters a 5k-note vault quickly", () => {
    const N = 5000;
    const big = {
      nodes: Array.from({ length: N }, (_, i) => node(`n${i}`, `F${i % 7}/n${i}`, [`t${i % 4}`])),
      edges: Array.from({ length: 2 * N }, (_, i) => ({ source: `n${i % N}`, target: `n${(i * 7919) % N}` })),
    };
    const t0 = performance.now();
    const v = buildView(big, with_({ search: "#t1", groups: [{ id: "g", query: "path:F3", color: 5 }] }), null);
    buildView(big, with_({ scope: "local", depth: 3 }), "n0");
    expect(v.nodes).toHaveLength(N / 4);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
