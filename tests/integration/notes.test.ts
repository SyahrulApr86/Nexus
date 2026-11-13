import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createNote, getNote, listTree, renameNote, resolveLink, search, updateContent } from "@/lib/notes";
import { HttpError } from "@/lib/session";
import { describeDb, expectHttpError, linksOf, tagsOf, useVaults } from "./fixtures";

describeDb("notes", () => {
  const v = useVaults();

  describe("createNote", () => {
    it("normalises the path, derives the name and creates the parent folders", async () => {
      const n = await createNote(v.a, " Projects//Nexus/ Roadmap.md ");
      expect(n).toMatchObject({ path: "Projects/Nexus/Roadmap", name: "Roadmap" });
      expect(n.id).toMatch(/^[0-9a-f-]{36}$/);
      expect((await listTree(v.a)).folders).toEqual(["Projects", "Projects/Nexus"]);
    });

    it("suffixes the path when it is already taken", async () => {
      const first = await createNote(v.a, "Ideas/Draft");
      const second = await createNote(v.a, "Ideas/Draft");
      const third = await createNote(v.a, "Ideas/Draft.md");
      expect([first, second, third].map((n) => n.path)).toEqual(["Ideas/Draft", "Ideas/Draft 1", "Ideas/Draft 2"]);
      expect(second.name).toBe("Draft 1");
    });

    it("falls back to Untitled when the path normalises to nothing", async () => {
      const a = await createNote(v.a, "");
      const b = await createNote(v.a, "../..");
      expect([a.path, b.path]).toEqual(["Untitled", "Untitled 1"]);
    });

    it("indexes links, tags and frontmatter of the initial content", async () => {
      const n = await createNote(v.a, "Indexed", "---\ntags: [fm]\n---\n[[Target]] ![[Image]] #body");
      expect(await linksOf(n.id)).toEqual([
        { target: "image", embed: true },
        { target: "target", embed: false },
      ]);
      expect(await tagsOf(n.id)).toEqual(["body", "fm"]);
      expect((await getNote(v.a, n.id)).frontmatter).toEqual({ tags: ["fm"] });
    });
  });

  describe("updateContent", () => {
    it("replaces the indexed links and tags", async () => {
      const n = await createNote(v.a, "Source", "[[Alpha]] [[Beta|b]] #one #two/sub");
      const content = "[[Gamma#Part]] [[gamma]] ![[Gamma]] `[[Code]]` #three";
      const res = await updateContent(v.a, n.id, content);
      expect(res.id).toBe(n.id);
      expect(await linksOf(n.id)).toEqual([
        { target: "gamma", embed: false },
        { target: "gamma", embed: true },
      ]);
      expect(await tagsOf(n.id)).toEqual(["three"]);
      expect((await getNote(v.a, n.id)).content).toBe(content);
    });

    it("clears the index and frontmatter when the content is emptied", async () => {
      const n = await createNote(v.a, "Source", "---\ntags: [a]\n---\n[[Alpha]] #b");
      await updateContent(v.a, n.id, "");
      expect(await linksOf(n.id)).toEqual([]);
      expect(await tagsOf(n.id)).toEqual([]);
      expect((await getNote(v.a, n.id)).frontmatter).toEqual({});
    });

    it("throws 404 for an unknown note", async () => {
      await expectHttpError(updateContent(v.a, randomUUID(), "x"), 404);
    });
  });

  describe("getNote", () => {
    it("returns backlinks by name and by path with the linking line as context", async () => {
      const target = await createNote(v.a, "Area/Target", "# Target");
      const byName = await createNote(v.a, "Notes/By name", "intro\n  Read [[target|the target]] first.  \noutro");
      const byPath = await createNote(v.a, "Notes/By path", "See [[Area/Target#Section]]");
      await createNote(v.a, "Notes/Unrelated", "[[Other]] and `[[Target]]`\n```\n[[Target]]\n```");

      const n = await getNote(v.a, target.id);
      expect(n).toMatchObject({ id: target.id, path: "Area/Target", name: "Target", content: "# Target" });
      expect(n).not.toHaveProperty("search");
      expect(n.backlinks).toEqual([
        { id: byName.id, path: "Notes/By name", name: "By name", context: "Read [[target|the target]] first." },
        { id: byPath.id, path: "Notes/By path", name: "By path", context: "See [[Area/Target#Section]]" },
      ]);
    });

    it("ignores self links and truncates long context lines", async () => {
      const target = await createNote(v.a, "Target", "I link to myself: [[Target]]");
      const source = await createNote(v.a, "Long", `${"x".repeat(250)} [[Target]]`);
      const { backlinks } = await getNote(v.a, target.id);
      expect(backlinks).toEqual([{ id: source.id, path: "Long", name: "Long", context: `${"x".repeat(197)}…` }]);
    });

    it("throws 404 for an unknown note", async () => {
      await expectHttpError(getNote(v.a, randomUUID()), 404);
    });
  });

  describe("resolveLink", () => {
    it("prefers an exact path, then the shortest path with that name", async () => {
      const root = await createNote(v.a, "Alpha");
      const deep = await createNote(v.a, "Deep/Alpha");
      const beta = await createNote(v.a, "Deep/Nested/Beta");

      expect(await resolveLink(v.a, "Deep/Alpha")).toEqual({ id: deep.id, path: "Deep/Alpha", name: "Alpha" });
      expect((await resolveLink(v.a, "alpha"))?.id).toBe(root.id);
      expect((await resolveLink(v.a, "BETA.md"))?.id).toBe(beta.id);
      expect((await resolveLink(v.a, "deep/nested/beta"))?.id).toBe(beta.id);
      expect(await resolveLink(v.a, "Missing")).toBeNull();
    });
  });

  describe("search", () => {
    const body = "Discussed the quarterly roadmap with the platform team.";

    it("matches word prefixes in the name and the content, requiring every word", async () => {
      const meeting = await createNote(v.a, "Meeting notes", body);
      await createNote(v.a, "Groceries", "Buy coffee and bread.");

      const ids = async (q: string) => (await search(v.a, q)).map((r) => r.id);
      expect(await ids("quart")).toEqual([meeting.id]);
      expect(await ids("ROAD plat")).toEqual([meeting.id]);
      expect(await ids("meet")).toEqual([meeting.id]);
      expect(await ids("roadmap coffee")).toEqual([]);
    });

    it("returns a snippet with the match marked", async () => {
      await createNote(v.a, "Meeting notes", body);
      const [hit] = await search(v.a, "quarter");
      expect(hit.snippet).toContain("<<quarterly>>");
    });

    it("treats query syntax as plain text", async () => {
      const meeting = await createNote(v.a, "Meeting notes", body);
      for (const q of ["", "   ", "&|!():*", "-", "_", "'"]) expect(await search(v.a, q)).toEqual([]);
      expect((await search(v.a, "roadmap:* | !(")).map((r) => r.id)).toEqual([meeting.id]);
    });
  });
  describe("optimistic concurrency (contract R1)", () => {
    it("writes when baseUpdatedAt matches and refuses a stale one with the current note", async () => {
      const n = await createNote(v.a, "Shared", "v1");
      const loaded = await getNote(v.a, n.id);
      const first = await updateContent(v.a, n.id, "v2", "autosave", loaded.updatedAt);
      expect(first.updatedAt.getTime()).not.toBe(loaded.updatedAt.getTime());

      const err = await updateContent(v.a, n.id, "v3 from a stale tab", "autosave", loaded.updatedAt).catch((e) => e);
      expect(err).toBeInstanceOf(HttpError);
      expect(err.status).toBe(409);
      expect(err.body).toEqual({ error: "conflict", note: { id: n.id, content: "v2", updatedAt: first.updatedAt } });
      expect((await getNote(v.a, n.id)).content).toBe("v2");

      // Without a base the write goes through, as before.
      await updateContent(v.a, n.id, "v4");
      expect((await getNote(v.a, n.id)).content).toBe("v4");
    });

    it("checks a rename against the base and leaves updatedAt alone on a move", async () => {
      const n = await createNote(v.a, "Inbox/Moved", "body");
      const loaded = await getNote(v.a, n.id);
      await renameNote(v.a, n.id, "Archive/Moved", loaded.updatedAt);
      const after = await getNote(v.a, n.id);
      expect(after.path).toBe("Archive/Moved");
      expect(after.updatedAt.getTime()).toBe(loaded.updatedAt.getTime());

      await updateContent(v.a, n.id, "edited elsewhere");
      const err = await renameNote(v.a, n.id, "Elsewhere/Moved", loaded.updatedAt).catch((e) => e);
      expect(err.status).toBe(409);
      expect((await getNote(v.a, n.id)).path).toBe("Archive/Moved");
    });
  });
});
