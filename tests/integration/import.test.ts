import { expect, it } from "vitest";
import { exportVault, getNote, importNotes, listTree } from "@/lib/notes";
import { describeDb, linksOf, tagsOf, useVaults } from "./fixtures";

describeDb("importNotes", () => {
  const v = useVaults();

  it("creates notes and folders, then updates existing notes by path", async () => {
    expect(
      await importNotes(v.a, [
        { path: "Inbox/Idea.md", content: "[[Plan]] #new" },
        { path: "Plan.md", content: "plan" },
      ]),
    ).toEqual({ created: 2, updated: 0, skipped: [] });

    const before = await listTree(v.a);
    expect(before.notes.map((n) => n.path)).toEqual(["Inbox/Idea", "Plan"]);
    expect(before.folders).toEqual(["Inbox"]);
    const idea = before.notes.find((n) => n.path === "Inbox/Idea")!;
    expect(await linksOf(idea.id)).toEqual([{ target: "plan", embed: false }]);

    const content = "---\ntags: [changed]\n---\n[[Other]]";
    expect(await importNotes(v.a, [{ path: "Inbox/Idea.md", content }])).toEqual({ created: 0, updated: 1, skipped: [] });

    const after = await getNote(v.a, idea.id);
    expect(after.content).toBe(content);
    expect(after.frontmatter).toEqual({ tags: ["changed"] });
    expect(await linksOf(idea.id)).toEqual([{ target: "other", embed: false }]);
    expect(await tagsOf(idea.id)).toEqual(["changed"]);
    expect((await listTree(v.a)).notes).toHaveLength(2);
  });

  it("normalises hostile paths into the vault and skips paths that normalise to nothing", async () => {
    const res = await importNotes(v.a, [
      { path: "../x.md", content: "1" },
      { path: "/abs.md", content: "2" },
      { path: "a/../../b.md", content: "3" },
      { path: "..\\..\\win\\evil.md", content: "4" },
      { path: "C:/Users/me/notes/n.md", content: "5" },
      { path: "../..", content: "skipped" },
      { path: "", content: "skipped" },
      { path: "<>|?*.md", content: "skipped" },
    ]);
    expect(res).toEqual({ created: 5, updated: 0, skipped: [] });

    const exported = await exportVault(v.a);
    expect(exported.map((f) => f.path).sort()).toEqual(["C/Users/me/notes/n", "a/b", "abs", "win/evil", "x"]);
    for (const f of exported) {
      expect(f.path).not.toMatch(/(^|\/)\.\.?(\/|$)|^\/|\\/);
      expect(f.content).not.toBe("skipped");
    }
    expect((await listTree(v.a)).folders.sort()).toEqual(["C", "C/Users", "C/Users/me", "C/Users/me/notes", "a", "win"]);
  });

  it("treats a path repeated within one import as an update", async () => {
    expect(
      await importNotes(v.a, [
        { path: "Same.md", content: "first" },
        { path: "./Same", content: "second" },
      ]),
    ).toEqual({ created: 1, updated: 1, skipped: [] });
    expect(await exportVault(v.a)).toEqual([{ path: "Same", content: "second" }]);
  });
});
