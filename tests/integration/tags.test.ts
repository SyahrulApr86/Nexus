import { expect, it } from "vitest";
import { createNote, listTags, notesByTag, updateContent } from "@/lib/notes";
import { describeDb, useVaults } from "./fixtures";

describeDb("tags", () => {
  const v = useVaults();

  async function seed() {
    const one = await createNote(v.a, "One", "#project/alpha #Urgent");
    const two = await createNote(v.a, "Two", "---\ntags: [project/beta, urgent]\n---\n#project");
    const three = await createNote(v.a, "Three", "#projection `#project`\n```\n#project\n```");
    return { one, two, three };
  }

  it("listTags counts notes per tag from the body and the frontmatter, ignoring code", async () => {
    await seed();
    expect(await listTags(v.a)).toEqual([
      { tag: "project", count: 1 },
      { tag: "project/alpha", count: 1 },
      { tag: "project/beta", count: 1 },
      { tag: "projection", count: 1 },
      { tag: "urgent", count: 2 },
    ]);
  });

  it("listTags follows content updates", async () => {
    const { one } = await seed();
    await updateContent(v.a, one.id, "no tags any more");
    expect((await listTags(v.a)).map((t) => t.tag)).toEqual(["project", "project/beta", "projection", "urgent"]);
  });

  it("notesByTag includes nested tags but not tags that only share a prefix", async () => {
    const { one, two, three } = await seed();
    const ids = async (t: string) => (await notesByTag(v.a, t)).map((n) => n.id);

    expect(await ids("project")).toEqual([one.id, two.id]);
    expect(await ids("#Project/Alpha")).toEqual([one.id]);
    expect(await ids("project/beta")).toEqual([two.id]);
    expect(await ids("projection")).toEqual([three.id]);
    expect(await ids("URGENT")).toEqual([one.id, two.id]);
    expect(await ids("proj")).toEqual([]);
  });
});
