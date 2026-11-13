import { describe, expect, it } from "vitest";
import {
  dropId,
  enqueue,
  findInTree,
  overlayTree,
  queuedPath,
  queuedText,
  remapId,
  remapLayout,
  touches,
  type NewOp,
  type OutboxOp,
} from "@/components/workspace/offline/outbox";

const T = "local-1";
const run = (ops: NewOp[], inFlight?: number) =>
  ops.reduce<OutboxOp[]>((q, op, i) => enqueue(q, op, 1000 + i, inFlight), []);
const shape = (ops: OutboxOp[]) =>
  ops.map((o) => {
    const rest: Partial<OutboxOp> = { ...o };
    delete rest.seq;
    delete rest.at;
    return rest;
  });

describe("outbox ordering", () => {
  it("keeps edits of different notes in the order they were made", () => {
    const q = run([
      { kind: "save", id: "a", content: "A1", base: "t0" },
      { kind: "rename", id: "b", path: "Folder/B" },
      { kind: "save", id: "c", content: "C1", base: "t1" },
      { kind: "delete", id: "d" },
    ]);
    expect(q.map((o) => `${o.kind}:${o.id}`)).toEqual(["save:a", "rename:b", "save:c", "delete:d"]);
    expect(q.map((o) => o.seq)).toEqual([1, 2, 3, 4]);
  });

  it("numbers new entries after the highest sequence, even after the head left", () => {
    let q = run([
      { kind: "save", id: "a", content: "1" },
      { kind: "save", id: "b", content: "1" },
    ]);
    q = q.slice(1);
    q = enqueue(q, { kind: "save", id: "c", content: "1" }, 5);
    expect(q.map((o) => o.seq)).toEqual([2, 3]);
  });
});

describe("outbox coalescing", () => {
  it("merges saves of one note into the first, keeping its base and position", () => {
    const q = run([
      { kind: "save", id: "a", content: "A1", base: "t0" },
      { kind: "save", id: "b", content: "B1", base: "u0" },
      { kind: "save", id: "a", content: "A2", base: "t0" },
      { kind: "save", id: "a", content: "A3", base: "t0" },
    ]);
    expect(shape(q)).toEqual([
      { kind: "save", id: "a", content: "A3", base: "t0" },
      { kind: "save", id: "b", content: "B1", base: "u0" },
    ]);
  });

  it("folds saves and renames of a note created offline into its create", () => {
    const q = run([
      { kind: "create", id: T, path: "Inbox/Untitled", content: "" },
      { kind: "save", id: T, content: "first", base: "fake" },
      { kind: "rename", id: T, path: "Inbox/Groceries.md" },
      { kind: "save", id: T, content: "milk", base: "fake" },
    ]);
    expect(shape(q)).toEqual([{ kind: "create", id: T, path: "Inbox/Groceries", content: "milk" }]);
  });

  it("drops a note created and deleted offline, and everything queued for it", () => {
    const q = run([
      { kind: "save", id: "a", content: "A1", base: "t0" },
      { kind: "create", id: T, path: "Scratch", content: "x" },
      { kind: "delete", id: T },
    ]);
    expect(shape(q)).toEqual([{ kind: "save", id: "a", content: "A1", base: "t0" }]);
  });

  it("drops saves and renames of a server note that is then deleted", () => {
    const q = run([
      { kind: "save", id: "a", content: "A1", base: "t0" },
      { kind: "rename", id: "a", path: "Old/A" },
      { kind: "save", id: "b", content: "B1", base: "u0" },
      { kind: "delete", id: "a" },
    ]);
    expect(shape(q)).toEqual([
      { kind: "save", id: "b", content: "B1", base: "u0" },
      { kind: "delete", id: "a" },
    ]);
  });

  it("merges renames of one note into the first rename", () => {
    const q = run([
      { kind: "rename", id: "a", path: "One" },
      { kind: "save", id: "b", content: "B" },
      { kind: "rename", id: "a", path: "Two" },
    ]);
    expect(shape(q)).toEqual([
      { kind: "rename", id: "a", path: "Two" },
      { kind: "save", id: "b", content: "B" },
    ]);
  });

  it("never changes the entry being sent: a later save queues behind it, chained", () => {
    const first = run([{ kind: "save", id: "a", content: "A1", base: "t0" }]);
    const q = enqueue(first, { kind: "save", id: "a", content: "A2", base: "t0" }, 2000, first[0].seq);
    expect(shape(q)).toEqual([
      { kind: "save", id: "a", content: "A1", base: "t0" },
      { kind: "save", id: "a", content: "A2", chained: true },
    ]);
    // A third save merges into the chained one, not the one in flight.
    const r = enqueue(q, { kind: "save", id: "a", content: "A3", base: "t0" }, 3000, first[0].seq);
    expect(shape(r).map((o) => (o.kind === "save" ? o.content : ""))).toEqual(["A1", "A3"]);
  });

  it("queues saves of a note whose create is being sent as their own entries, without a base", () => {
    const first = run([{ kind: "create", id: T, path: "New", content: "" }]);
    const q = enqueue(first, { kind: "save", id: T, content: "typed", base: "fake" }, 2000, first[0].seq);
    expect(shape(q)).toEqual([
      { kind: "create", id: T, path: "New", content: "" },
      { kind: "save", id: T, content: "typed", base: undefined },
    ]);
  });
});

describe("outbox helpers", () => {
  it("remaps a temporary id to the server id in later entries", () => {
    const q = remapId(run([{ kind: "save", id: T, content: "x" }, { kind: "save", id: "b", content: "y" }]), T, "real");
    expect(q.map((o) => o.id)).toEqual(["real", "b"]);
  });

  it("drops every entry of a note except the one in flight", () => {
    const q = run([
      { kind: "save", id: "a", content: "1" },
      { kind: "rename", id: "a", path: "x" },
      { kind: "save", id: "b", content: "2" },
    ]);
    expect(dropId(q, "a", 1).map((o) => o.seq)).toEqual([1, 3]);
    expect(touches(dropId(q, "a"), "a")).toBe(false);
  });

  it("reads back the newest queued text with the first base", () => {
    const first = run([{ kind: "save", id: "a", content: "A1", base: "t0" }]);
    const q = enqueue(first, { kind: "save", id: "a", content: "A2" }, 2, 1);
    expect(queuedText(q, "a")).toEqual({ content: "A2", base: "t0" });
    expect(queuedText(run([{ kind: "create", id: T, path: "N", content: "hi" }]), T)).toEqual({ content: "hi" });
    expect(queuedText(run([{ kind: "delete", id: "a" }]), "a")).toBeNull();
    expect(queuedPath(run([{ kind: "rename", id: "a", path: "B/C" }]), "a")).toBe("B/C");
  });

  it("applies creates, renames and deletes to the mirrored tree", () => {
    const tree = {
      notes: [
        { id: "a", path: "Projects/Alpha", name: "Alpha", updatedAt: "2026-01-01T00:00:00.000Z" },
        { id: "b", path: "Beta", name: "Beta", updatedAt: "2026-01-01T00:00:00.000Z" },
      ],
      folders: ["Projects"],
    };
    const t = overlayTree(
      tree,
      run([
        { kind: "create", id: T, path: "Daily/2026-11-14", content: "" },
        { kind: "rename", id: "a", path: "Archive/Alpha" },
        { kind: "delete", id: "b" },
      ]),
    );
    expect(t.notes.map((n) => `${n.id}=${n.path}`).sort()).toEqual(["a=Archive/Alpha", `${T}=Daily/2026-11-14`]);
    expect(t.folders).toEqual(["Archive", "Daily", "Projects"]);
    expect(findInTree(t, "2026-11-14")?.id).toBe(T);
    expect(findInTree(t, "archive/alpha.md")?.id).toBe("a");
    expect(overlayTree(tree, [])).toBe(tree);
  });

  it("points tab histories at the new id and leaves other views alone", () => {
    const layout = {
      groups: [{ key: "g", active: 0, tabs: [{ key: "t", index: 1, history: [{ type: "graph" }, { type: "note", id: T, mode: "edit" }] }] }],
      focus: 0,
    };
    const next = remapLayout(layout, T, "real");
    expect(next.groups[0].tabs[0].history).toEqual([{ type: "graph" }, { type: "note", id: "real", mode: "edit" }]);
    expect(remapLayout(layout, "other", "x")).toBe(layout);
  });
});
