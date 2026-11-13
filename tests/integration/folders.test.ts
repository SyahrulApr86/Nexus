import { describe, expect, it } from "vitest";
import { createFolder, createNote, deleteFolder, graph, listTree, renameFolder } from "@/lib/notes";
import { describeDb, expectHttpError, noteRow, useVaults } from "./fixtures";

describeDb("folders", () => {
  const v = useVaults();

  const tree = async () => {
    const t = await listTree(v.a);
    return { notes: t.notes.map((n) => n.path), folders: t.folders };
  };

  describe("renameFolder", () => {
    it("moves notes and subfolders, leaving a sibling with the same prefix alone", async () => {
      await createNote(v.a, "Projects/One");
      const two = await createNote(v.a, "Projects/Sub/Two");
      await createNote(v.a, "ProjectsX/Three");
      await createNote(v.a, "Root");

      expect(await renameFolder(v.a, "Projects", "Archive/2026")).toEqual({ moved: 2 });
      expect(await tree()).toEqual({
        notes: ["Archive/2026/One", "Archive/2026/Sub/Two", "ProjectsX/Three", "Root"],
        folders: ["Archive", "Archive/2026", "Archive/2026/Sub", "ProjectsX"],
      });
      expect(await noteRow(v.a, two.id)).toMatchObject({ path: "Archive/2026/Sub/Two", name: "Two" });
    });

    it("renames empty folders", async () => {
      await createFolder(v.a, "Empty/Inner");
      expect(await renameFolder(v.a, "Empty", "Full")).toEqual({ moved: 0 });
      expect((await tree()).folders).toEqual(["Full", "Full/Inner"]);
    });

    it("rejects moving a folder into itself and paths that normalise to nothing", async () => {
      await createNote(v.a, "Projects/One");
      await expectHttpError(renameFolder(v.a, "Projects", "Projects/Sub"), 400);
      await expectHttpError(renameFolder(v.a, "Projects", "./Projects/"), 400);
      await expectHttpError(renameFolder(v.a, "..", "Elsewhere"), 400);
      await expectHttpError(renameFolder(v.a, "Projects", "/"), 400);
      expect(await tree()).toEqual({ notes: ["Projects/One"], folders: ["Projects"] });
    });
  });

  describe("deleteFolder", () => {
    it("deletes the notes and subfolders under the folder only", async () => {
      await createNote(v.a, "Projects/One");
      await createNote(v.a, "Projects/Sub/Two");
      await createNote(v.a, "ProjectsX/Three");
      const root = await createNote(v.a, "Root", "[[One]]");

      await deleteFolder(v.a, "Projects");

      expect(await tree()).toEqual({ notes: ["ProjectsX/Three", "Root"], folders: ["ProjectsX"] });
      // The link from Root now points at nothing.
      expect((await graph(v.a)).edges).toEqual([{ source: root.id, target: "ghost:one" }]);
    });

    it("treats LIKE wildcards in the folder name literally", async () => {
      await createNote(v.a, "a_b/Keep me not");
      await createNote(v.a, "aXb/Keep");
      await createNote(v.a, "100%/Gone");
      await createNote(v.a, "1000/Stay");

      await deleteFolder(v.a, "a_b");
      await deleteFolder(v.a, "100%");

      expect(await tree()).toEqual({ notes: ["1000/Stay", "aXb/Keep"], folders: ["1000", "aXb"] });
    });

    it("rejects a path that normalises to nothing", async () => {
      await createNote(v.a, "Projects/One");
      await expectHttpError(deleteFolder(v.a, "/"), 400);
      await expectHttpError(deleteFolder(v.a, "../.."), 400);
      expect((await tree()).notes).toEqual(["Projects/One"]);
    });
  });
});
