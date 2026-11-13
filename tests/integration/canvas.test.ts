import { expect, it } from "vitest";
import { exportVault, getNote, graph, importNotes, listTree, renameNote, createNote, updateContent } from "@/lib/notes";
import { parseCanvas, serializeCanvas, type CanvasDoc } from "@/lib/canvas";
import { describeDb, linksOf, tagsOf, useVaults } from "./fixtures";

const board = (doc: CanvasDoc) => serializeCanvas(doc);
const sample = (file = "Projects/Roadmap.md"): CanvasDoc => ({
  nodes: [
    { id: "t1", type: "text", x: 0, y: 0, width: 250, height: 60, text: "Talk to [[People/Ana]] #planning" },
    { id: "f1", type: "file", x: 300, y: 0, width: 400, height: 400, file },
    { id: "f2", type: "file", x: 0, y: 300, width: 200, height: 200, file: "Assets/photo.png" },
  ],
  edges: [{ id: "e1", fromNode: "t1", toNode: "f1" }],
});

describeDb("canvas notes", () => {
  const v = useVaults();

  it("keeps the .canvas extension in the path and name, and numbers copies before it", async () => {
    const a = await createNote(v.a, "Boards/Plan.canvas", board(sample()));
    expect(a).toMatchObject({ path: "Boards/Plan.canvas", name: "Plan.canvas" });
    const b = await createNote(v.a, "Boards/Plan.canvas", "");
    expect(b.path).toBe("Boards/Plan 1.canvas");
    expect((await listTree(v.a)).folders).toEqual(["Boards"]);
  });

  it("indexes file cards and text-card links and tags, not attachments", async () => {
    const roadmap = await createNote(v.a, "Projects/Roadmap", "# Roadmap");
    const c = await createNote(v.a, "Plan.canvas", board(sample()));
    expect(await linksOf(c.id)).toEqual([
      { target: "people/ana", embed: false },
      { target: "projects/roadmap", embed: true },
    ]);
    expect(await tagsOf(c.id)).toEqual(["planning"]);
    // The canvas shows up as a backlink of the note it holds, and as an edge in the graph.
    expect((await getNote(v.a, roadmap.id)).backlinks.map((b) => b.id)).toEqual([c.id]);
    const g = await graph(v.a);
    expect(g.edges).toContainEqual({ source: c.id, target: roadmap.id });

    // Saving re-indexes through the canvas indexer too.
    await updateContent(v.a, c.id, board({ nodes: [], edges: [] }));
    expect(await linksOf(c.id)).toEqual([]);
    expect(await tagsOf(c.id)).toEqual([]);
  });

  it("points file cards at a renamed note and keeps a canvas a canvas", async () => {
    const roadmap = await createNote(v.a, "Projects/Roadmap", "# Roadmap");
    const c = await createNote(v.a, "Plan.canvas", board(sample()));
    const res = await renameNote(v.a, roadmap.id, "Archive/Roadmap 2026");
    expect(res.updatedLinks).toBe(1);
    const after = parseCanvas((await getNote(v.a, c.id)).content);
    if (!after.ok) throw new Error(after.error);
    expect(after.doc.nodes.find((n) => n.id === "f1")).toMatchObject({ file: "Archive/Roadmap 2026.md" });
    expect(after.doc.edges).toHaveLength(1);
    expect(await linksOf(c.id)).toContainEqual({ target: "archive/roadmap 2026", embed: true });

    // A canvas renamed without its extension keeps it; a note cannot become a canvas.
    expect((await renameNote(v.a, c.id, "Boards/Q1")).path).toBe("Boards/Q1.canvas");
    await expect(renameNote(v.a, roadmap.id, "Roadmap.canvas")).rejects.toMatchObject({ status: 400 });
  });

  it("imports .canvas files as canvases and exports them under their own name", async () => {
    const content = board(sample("Notes/Idea.md"));
    const res = await importNotes(v.a, [
      { path: "Boards/Map.canvas", content },
      { path: "Notes/Idea.md", content: "idea" },
    ]);
    expect(res).toEqual({ created: 2, updated: 0, skipped: [] });
    const tree = await listTree(v.a);
    const map = tree.notes.find((n) => n.path === "Boards/Map.canvas")!;
    expect(map.name).toBe("Map.canvas");
    expect(await linksOf(map.id)).toContainEqual({ target: "notes/idea", embed: true });
    const exported = await exportVault(v.a);
    expect(exported.find((e) => e.path === "Boards/Map.canvas")?.content).toBe(content);
  });
});
