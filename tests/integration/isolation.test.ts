import { expect, it } from "vitest";
import {
  createNote,
  deleteFolder,
  deleteNote,
  exportVault,
  getNote,
  graph,
  importNotes,
  linkMention,
  listTags,
  listTree,
  notesByTag,
  renameFolder,
  renameNote,
  resolveLink,
  search,
  unlinkedMentions,
  updateContent,
} from "@/lib/notes";
import { describeDb, expectHttpError, noteRow, useVaults } from "./fixtures";

// Every function takes the caller's vault id; given vault B it must never
// read or change a note of vault A, even with that note's id in hand.
describeDb("vault isolation", () => {
  const v = useVaults();

  const TARGET = "#secret [[Other]] confidential-plan";
  const OTHER = "Target is mentioned here, and [[Target]] is linked.";

  async function seed() {
    const target = await createNote(v.a, "Shared/Target", TARGET);
    const other = await createNote(v.a, "Other", OTHER);
    const prose = await createNote(v.a, "Prose", "Target is only mentioned here.");
    // Vault B has a note at the same path and links to vault A's note names.
    const bTarget = await createNote(v.b, "Shared/Target", "vault B");
    const bLinker = await createNote(v.b, "B linker", "[[Target]] [[Other]] Target");
    return { target, other, prose, bTarget, bLinker };
  }

  async function expectVaultAUnchanged(ids: { target: { id: string }; other: { id: string } }) {
    expect(await noteRow(v.a, ids.target.id)).toEqual({ path: "Shared/Target", name: "Target", content: TARGET });
    expect(await noteRow(v.a, ids.other.id)).toEqual({ path: "Other", name: "Other", content: OTHER });
    expect((await listTree(v.a)).folders).toEqual(["Shared"]);
  }

  it("keeps paths unique per vault only", async () => {
    const { bTarget } = await seed();
    expect(bTarget.path).toBe("Shared/Target");
  });

  it("reads through vault B never return vault A's notes", async () => {
    const { target, other, prose, bTarget, bLinker } = await seed();

    await expectHttpError(getNote(v.b, target.id), 404);
    await expectHttpError(unlinkedMentions(v.b, target.id), 404);
    expect(await resolveLink(v.b, "Other")).toBeNull();
    expect((await resolveLink(v.b, "Target"))?.id).toBe(bTarget.id);
    expect(await search(v.b, "confidential")).toEqual([]);
    expect(await listTags(v.b)).toEqual([]);
    expect(await notesByTag(v.b, "secret")).toEqual([]);
    expect((await exportVault(v.b)).map((f) => f.content).sort()).toEqual(["[[Target]] [[Other]] Target", "vault B"]);
    expect((await listTree(v.b)).notes.map((n) => n.id).sort()).toEqual([bLinker.id, bTarget.id].sort());

    const g = await graph(v.b);
    expect(g.nodes.map((n) => n.id).sort()).toEqual([bLinker.id, bTarget.id, "ghost:other"].sort());
    expect(g.nodes.map((n) => n.id)).not.toContain(other.id);

    // Vault A's backlinks and mentions do not pick up vault B's links and prose.
    expect((await getNote(v.a, target.id)).backlinks.map((b) => b.id)).toEqual([other.id]);
    expect((await getNote(v.a, other.id)).backlinks.map((b) => b.id)).toEqual([target.id]);
    expect((await unlinkedMentions(v.a, target.id)).map((m) => m.id)).toEqual([prose.id]);
    expect(await unlinkedMentions(v.b, bTarget.id)).toEqual([]);
  });

  it("writes through vault B never change vault A's notes", async () => {
    const ids = await seed();
    const { target, other, bTarget } = ids;

    await expectHttpError(updateContent(v.b, target.id, "hijacked"), 404);
    await expectHttpError(renameNote(v.b, target.id, "Hijacked"), 404);
    await expectHttpError(deleteNote(v.b, target.id), 404);
    await expectHttpError(linkMention(v.b, target.id, other.id), 404);
    await expectHttpError(linkMention(v.b, bTarget.id, other.id), 404);
    await expectHttpError(linkMention(v.a, target.id, ids.bLinker.id), 404);

    expect(await importNotes(v.b, [{ path: "Other.md", content: "imported into B" }])).toEqual({
      created: 1,
      updated: 0,
    });
    expect(await renameFolder(v.b, "Shared", "Moved")).toEqual({ moved: 1 });
    await deleteFolder(v.b, "Moved");

    await expectVaultAUnchanged(ids);
  });

  it("renaming in vault A does not rewrite links in vault B", async () => {
    const ids = await seed();
    const res = await renameNote(v.a, ids.target.id, "Shared/Renamed");
    expect(res.updatedLinks).toBe(1);
    expect((await noteRow(v.a, ids.other.id)).content).toBe("Target is mentioned here, and [[Renamed]] is linked.");
    expect((await noteRow(v.b, ids.bLinker.id)).content).toBe("[[Target]] [[Other]] Target");
  });
});
