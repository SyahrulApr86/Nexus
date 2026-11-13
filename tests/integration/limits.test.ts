import { count, eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { db } from "@/db";
import { folder, note, noteRevision } from "@/db/schema";
import {
  LIMITS,
  createFolder,
  createNote,
  exportPage,
  getNote,
  graph,
  importNotes,
  listTree,
  renameFolder,
  renameNote,
  unlinkedMentions,
} from "@/lib/notes";
import { describeDb, expectHttpError, linksOf, tagsOf, useVaults } from "./fixtures";

describeDb("limits (input validation and quotas)", () => {
  const v = useVaults();

  it("import applies the JSON routes' path and size limits and reports what it skipped", async () => {
    const deep = `${Array.from({ length: 40 }, (_, i) => `d${i}`).join("/")}/n.md`;
    const longSeg = `${"s".repeat(300)}/n.md`;
    const tooLong = `${"a/".repeat(260)}n.md`;
    const big = "x".repeat(LIMITS.noteBytes + 1);
    const res = await importNotes(v.a, [
      { path: "ok.md", content: "fine\u0000 #tag" },
      { path: deep, content: "deep" },
      { path: longSeg, content: "seg" },
      { path: tooLong, content: "long" },
      { path: "big.md", content: big },
      { path: "...md", content: "dots" },
    ]);
    expect(res.created).toBe(1);
    expect(res.skipped.map((s) => s.reason).sort()).toEqual([
      "A path segment is too long",
      "Note is too large",
      "Path is nested too deeply",
      "Path is too long",
    ]);
    const tree = await listTree(v.a);
    expect(tree.notes.map((n) => n.path)).toEqual(["ok"]);
    expect(tree.folders).toEqual([]);
    // NUL is stripped (Postgres text refuses it), the rest is indexed.
    expect((await getNote(v.a, tree.notes[0].id)).content).toBe("fine #tag");
  });

  it("import writes many notes set-based, with links, tags and folders", async () => {
    const files = Array.from({ length: 1_200 }, (_, i) => ({
      path: `Bulk/${i % 10}/n${i}.md`,
      content: `---\ntags: [bulk]\n---\n[[n${(i + 1) % 1_200}]] #k${i % 3}`,
    }));
    expect(await importNotes(v.a, files)).toMatchObject({ created: 1_200, updated: 0, skipped: [] });
    const tree = await listTree(v.a);
    expect(tree.notes).toHaveLength(1_200);
    expect(tree.folders).toHaveLength(11);
    const n0 = tree.notes.find((n) => n.path === "Bulk/0/n0")!;
    expect(await linksOf(n0.id)).toEqual([{ target: "n1", embed: false }]);
    expect(await tagsOf(n0.id)).toEqual(["bulk", "k0"]);

    // Re-import overwrites, keeping one "import" revision of each note that changed.
    const again = files.slice(0, 3).map((f) => ({ ...f, content: `${f.content} changed` }));
    expect(await importNotes(v.a, again)).toMatchObject({ created: 0, updated: 3 });
    const revs = await db.select().from(noteRevision).where(eq(noteRevision.noteId, n0.id));
    expect(revs).toHaveLength(1);
    expect(revs[0]).toMatchObject({ reason: "import", content: files[0].content });
    // Same content again: no new revision.
    await importNotes(v.a, again);
    expect(await db.select().from(noteRevision).where(eq(noteRevision.noteId, n0.id))).toHaveLength(1);
  });

  it("caps indexed links and tags per note", async () => {
    const links = Array.from({ length: LIMITS.linksPerNote + 50 }, (_, i) => `[[t${i}]]`).join(" ");
    const tags = Array.from({ length: LIMITS.tagsPerNote + 50 }, (_, i) => `#g${i}`).join(" ");
    const n = await createNote(v.a, "Many", `${links}\n${tags}`);
    expect(await linksOf(n.id)).toHaveLength(LIMITS.linksPerNote);
    expect(await tagsOf(n.id)).toHaveLength(LIMITS.tagsPerNote);
  });

  it("refuses paths that are too deep or too long on create, rename and folders", async () => {
    const deep = Array.from({ length: 40 }, (_, i) => `d${i}`).join("/");
    await expectHttpError(createNote(v.a, `${deep}/n`), 400);
    await expectHttpError(createFolder(v.a, deep), 400);
    const n = await createNote(v.a, "Plain");
    await expectHttpError(renameNote(v.a, n.id, `${deep}/n`), 400);
    await expectHttpError(createNote(v.a, `${"x".repeat(300)}/n`), 400);
    expect((await listTree(v.a)).folders).toEqual([]);
  });

  it("renameFolder never writes a path with a dot segment", async () => {
    // A legacy row that predates the normalizePath fix.
    await db.insert(note).values({ vaultId: v.a, path: "Src/../evil", name: "evil", content: "" });
    await db.insert(folder).values({ vaultId: v.a, path: "Src" });
    await expectHttpError(renameFolder(v.a, "Src", "Dst"), 400);
    expect((await listTree(v.a)).notes.map((n) => n.path)).toEqual(["Src/../evil"]);
  });

  it("export pages by path and the route skips unsafe legacy paths", async () => {
    for (const p of ["c", "a", "b"]) await createNote(v.a, p, p);
    const first = await exportPage(v.a, null, 2);
    expect(first.map((r) => r.path)).toEqual(["a", "b"]);
    expect((await exportPage(v.a, "b", 2)).map((r) => r.path)).toEqual(["c"]);
  });

  it("refuses a note past the vault's note quota and rolls the write back", async () => {
    await db.execute(sql`
      insert into ${note} (vault_id, path, name)
      select ${v.a}, 'q' || g, 'q' || g from generate_series(1, ${LIMITS.vaultNotes}) as g`);
    await expectHttpError(createNote(v.a, "One too many"), 413);
    expect(await importNotes(v.a, [{ path: "q1.md", content: "overwrite is fine" }])).toMatchObject({ updated: 1 });
    await expectHttpError(importNotes(v.a, [{ path: "new.md", content: "x" }]), 413);
    const [{ n }] = await db.select({ n: count() }).from(note).where(eq(note.vaultId, v.a));
    expect(n).toBe(LIMITS.vaultNotes);
  });

  it("unlinked mentions and backlink context only load a window of each note", async () => {
    const target = await createNote(v.a, "Needle");
    const pad = "lorem ipsum ".repeat(50_000); // ~600 KB before the hit
    await createNote(v.a, "Far", `${pad}\nwe mention Needle here\n${pad}`);
    await createNote(v.a, "Linker", `${pad}\nsee [[Needle]] for more\n`);
    const mentions = await unlinkedMentions(v.a, target.id);
    expect(mentions.map((m) => m.context)).toEqual(["we mention Needle here"]);
    const { backlinks } = await getNote(v.a, target.id);
    expect(backlinks.map((b) => b.context)).toEqual(["see [[Needle]] for more"]);
  });

  it("graph reports whether it was truncated", async () => {
    await createNote(v.a, "G", "[[H]]");
    expect(await graph(v.a)).toMatchObject({ truncated: false });
  });
});
