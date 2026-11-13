import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createNote, getNote, graph, linkMention, listTree, renameNote, unlinkedMentions } from "@/lib/notes";
import { describeDb, expectHttpError, linksOf, noteRow, useVaults } from "./fixtures";

describeDb("links", () => {
  const v = useVaults();

  describe("renameNote", () => {
    it("rewrites every link form in other notes and reports how many notes changed", async () => {
      const old = await createNote(v.a, "Folder/Old", "# Old");
      const plain = await createNote(v.a, "Plain", "See [[Old]] and [[old|an alias]]. Also `[[Old]]` in code.");
      const heading = await createNote(v.a, "Heading", "Jump to [[Old#Intro]]\n![[Old]]");
      const byPath = await createNote(v.a, "By path", "[[Folder/Old#Intro|alias]]");
      const untouched = await createNote(v.a, "Untouched", "[[Older]] and `[[Old]]`\n```\n[[Old]]\n```");

      const res = await renameNote(v.a, old.id, "Archive/New.md");
      expect(res).toEqual({ id: old.id, path: "Archive/New", name: "New", updatedLinks: 3 });

      expect((await noteRow(v.a, plain.id)).content).toBe(
        "See [[New]] and [[New|an alias]]. Also `[[Old]]` in code.",
      );
      expect((await noteRow(v.a, heading.id)).content).toBe("Jump to [[New#Intro]]\n![[New]]");
      expect((await noteRow(v.a, byPath.id)).content).toBe("[[New#Intro|alias]]");
      expect((await noteRow(v.a, untouched.id)).content).toBe("[[Older]] and `[[Old]]`\n```\n[[Old]]\n```");

      // The link index follows the rewritten content.
      expect(await linksOf(heading.id)).toEqual([
        { target: "new", embed: false },
        { target: "new", embed: true },
      ]);
      expect((await getNote(v.a, old.id)).backlinks.map((b) => b.id)).toEqual([byPath.id, heading.id, plain.id]);
      expect((await listTree(v.a)).folders).toEqual(["Archive", "Folder"]);
    });

    it("reports no updates when the path does not change", async () => {
      const n = await createNote(v.a, "Same");
      await createNote(v.a, "Linker", "[[Same]]");
      expect(await renameNote(v.a, n.id, " Same.md ")).toEqual({ id: n.id, path: "Same", name: "Same", updatedLinks: 0 });
    });

    it("suffixes the new path when it is taken and links to the suffixed name", async () => {
      await createNote(v.a, "Taken");
      const mine = await createNote(v.a, "Mine");
      const linker = await createNote(v.a, "Linker", "[[Mine]]");
      expect(await renameNote(v.a, mine.id, "Taken")).toEqual({
        id: mine.id,
        path: "Taken 1",
        name: "Taken 1",
        updatedLinks: 1,
      });
      expect((await noteRow(v.a, linker.id)).content).toBe("[[Taken 1]]");
    });

    it("rejects an empty path and unknown notes", async () => {
      const n = await createNote(v.a, "Keep");
      await expectHttpError(renameNote(v.a, n.id, "../"), 400);
      await expectHttpError(renameNote(v.a, randomUUID(), "Anything"), 404);
      expect(await noteRow(v.a, n.id)).toMatchObject({ path: "Keep", name: "Keep" });
    });
  });

  describe("unlinkedMentions", () => {
    it("lists plain-text mentions with context, skipping linked notes, code and partial words", async () => {
      const target = await createNote(v.a, "Topics/Zettel");
      const mention = await createNote(v.a, "Mention", "first line\n  I keep a ZETTEL box.  \nlast line");
      await createNote(v.a, "Linked", "[[Zettel]] and a zettel in prose");
      await createNote(v.a, "Linked by path", "[[Topics/Zettel|box]] then zettel");
      await createNote(v.a, "Code", "`zettel` inline\n```\nzettel\n```");
      await createNote(v.a, "Partial", "zettelkasten, zettels and my_zettel");

      expect(await unlinkedMentions(v.a, target.id)).toEqual([
        { id: mention.id, path: "Mention", name: "Mention", context: "I keep a ZETTEL box." },
      ]);
    });

    it("matches names with regular-expression characters literally", async () => {
      const target = await createNote(v.a, "C++");
      const mention = await createNote(v.a, "Languages", "I write C++ daily.");
      await createNote(v.a, "Other", "C and more");
      expect((await unlinkedMentions(v.a, target.id)).map((m) => m.id)).toEqual([mention.id]);
    });

    it("ignores names shorter than two characters", async () => {
      const x = await createNote(v.a, "X");
      await createNote(v.a, "Other", "X marks the spot");
      expect(await unlinkedMentions(v.a, x.id)).toEqual([]);
    });
  });

  describe("linkMention", () => {
    it("links the first plain mention and adds an alias when the case differs", async () => {
      const target = await createNote(v.a, "Topics/Zettel");
      const source = await createNote(v.a, "Source", "`zettel` in code, then a zettel box, then Zettel again.");

      await linkMention(v.a, target.id, source.id);

      expect((await noteRow(v.a, source.id)).content).toBe(
        "`zettel` in code, then a [[Zettel|zettel]] box, then Zettel again.",
      );
      expect(await linksOf(source.id)).toEqual([{ target: "zettel", embed: false }]);
      expect((await getNote(v.a, target.id)).backlinks.map((b) => b.id)).toEqual([source.id]);
      expect(await unlinkedMentions(v.a, target.id)).toEqual([]);
    });

    it("links without an alias when the case matches", async () => {
      const target = await createNote(v.a, "Zettel");
      const source = await createNote(v.a, "Source", "a Zettel box");
      await linkMention(v.a, target.id, source.id);
      expect((await noteRow(v.a, source.id)).content).toBe("a [[Zettel]] box");
    });

    it("throws 409 when no plain mention is left", async () => {
      const target = await createNote(v.a, "Zettel");
      const source = await createNote(v.a, "Source", "only `zettel` in code and [[Zettel]]");
      await expectHttpError(linkMention(v.a, target.id, source.id), 409);
      expect((await noteRow(v.a, source.id)).content).toBe("only `zettel` in code and [[Zettel]]");
    });
  });

  describe("graph", () => {
    it("returns notes with tags, resolved edges and one ghost node per missing target", async () => {
      const a = await createNote(v.a, "A", "[[B]] [[Missing]] [[A]] #x");
      const b = await createNote(v.a, "Dir/B", "[[a]] [[Dir/C]] ![[missing]]");
      const c = await createNote(v.a, "Dir/C", "#y #y/z");

      const g = await graph(v.a);
      const nodes = g.nodes
        .map((n) => ({ ...n, tags: [...n.tags].sort() }))
        .sort((p, q) => (p.path < q.path ? -1 : 1));
      expect(nodes).toEqual([
        { id: a.id, name: "A", path: "A", tags: ["x"], ghost: false },
        { id: b.id, name: "B", path: "Dir/B", tags: [], ghost: false },
        { id: c.id, name: "C", path: "Dir/C", tags: ["y", "y/z"], ghost: false },
        { id: "ghost:missing", name: "missing", path: "missing", tags: [], ghost: true },
      ]);

      const edge = (e: { source: string; target: string }) => `${e.source}->${e.target}`;
      // The self link A -> A is dropped.
      expect(g.edges.map(edge).sort()).toEqual(
        [
          { source: a.id, target: b.id },
          { source: a.id, target: "ghost:missing" },
          { source: b.id, target: a.id },
          { source: b.id, target: c.id },
          { source: b.id, target: "ghost:missing" },
        ]
          .map(edge)
          .sort(),
      );
    });

    it("is empty for an empty vault", async () => {
      expect(await graph(v.a)).toEqual({ nodes: [], edges: [] });
    });
  });
});
