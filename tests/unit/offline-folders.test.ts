import { describe, expect, it } from "vitest";
import type { Tree } from "@/components/workspace/api";
import { planFolderDelete, planFolderRename } from "@/components/workspace/offline/folders";
import { enqueue, overlayTree, pathOf, queuedPath, type NewOp, type OutboxOp, type SaveOp } from "@/components/workspace/offline/outbox";
import { replay } from "@/components/workspace/offline/replay";

const run = (ops: NewOp[], inFlight?: number) => ops.reduce<OutboxOp[]>((q, op, i) => enqueue(q, op, 1000 + i, inFlight), []);
const T0 = "2026-11-01T10:00:00.000Z";
const T1 = "2026-11-02T10:00:00.000Z";
const tree = (notes: [string, string, string?][], folders: string[] = []): Tree => ({
  notes: notes.map(([id, path, updatedAt]) => ({ id, path, name: path.slice(path.lastIndexOf("/") + 1), updatedAt: updatedAt ?? T0 })),
  folders,
});

describe("folder edits in the outbox", () => {
  it("queues folder renames and deletes in order with note edits, without merging them", () => {
    const q = run([
      { kind: "mvdir", from: "Projects", to: "Work" },
      { kind: "save", id: "a", content: "A1", base: T0 },
      { kind: "mvdir", from: "Work", to: "Archive/Work" },
      { kind: "mkdir", path: " Inbox / Later " },
    ]);
    expect(q.map((o) => o.kind)).toEqual(["mvdir", "save", "mvdir", "mkdir"]);
    expect(q[3]).toMatchObject({ kind: "mkdir", path: "Inbox/Later" });
  });

  it("follows a note through folder renames, and drops it with a deleted folder", () => {
    const q = run([
      { kind: "create", id: "local-1", path: "Projects/Plan", content: "" },
      { kind: "mvdir", from: "Projects", to: "Work" },
    ]);
    expect(pathOf(q, "local-1")).toBe("Work/Plan");
    expect(queuedPath(q, "a", "Projects/Deep/A")).toBe("Work/Deep/A");
    expect(queuedPath(q, "b", "Projectsish/B")).toBeNull();
    const gone = run([{ kind: "rmdir", path: "Work", notes: [{ id: "a", updatedAt: T0 }] }]);
    expect(pathOf(gone, "a", "Elsewhere/A")).toBeNull();
  });

  it("shows queued folder edits in the tree at once", () => {
    const base = tree([
      ["a", "Projects/A"],
      ["b", "Projects/Sub/B"],
      ["c", "Other/C"],
    ], ["Other", "Projects", "Projects/Sub"]);
    const moved = overlayTree(base, run([{ kind: "mvdir", from: "Projects", to: "Work/Now" }]));
    expect(moved.notes.map((n) => n.path).sort()).toEqual(["Other/C", "Work/Now/A", "Work/Now/Sub/B"]);
    expect(moved.folders).toEqual(["Other", "Work", "Work/Now", "Work/Now/Sub"]);
    const removed = overlayTree(base, run([{ kind: "rmdir", path: "Projects", notes: [] }, { kind: "mkdir", path: "Empty" }]));
    expect(removed.notes.map((n) => n.path)).toEqual(["Other/C"]);
    expect(removed.folders).toEqual(["Empty", "Other"]);
  });

  it("deleting a folder drops queued edits of its notes and notes created offline in it", () => {
    const q = run([
      { kind: "save", id: "a", content: "A1", base: T0 },
      { kind: "create", id: "local-1", path: "Projects/New", content: "x" },
      { kind: "save", id: "local-1", content: "y" },
      { kind: "save", id: "c", content: "C1", base: T0 },
      { kind: "rmdir", path: "Projects", notes: [{ id: "a", updatedAt: T0 }] },
    ]);
    expect(q.map((o) => `${o.kind}:${o.id ?? ""}`)).toEqual(["save:c", "rmdir:"]);
  });

  it("never changes an entry that is being sent", () => {
    const q = run(
      [
        { kind: "save", id: "a", content: "A1", base: T0 },
        { kind: "rmdir", path: "Projects", notes: [{ id: "a", updatedAt: T0 }] },
      ],
      1,
    );
    expect(q.map((o) => o.kind)).toEqual(["save", "rmdir"]);
  });
});

describe("replaying a folder rename", () => {
  it("renames when nothing collides", () => {
    expect(planFolderRename(tree([["a", "Projects/A"]]), "Projects", "Work")).toEqual({ kind: "rename", to: "Work", renamed: false });
  });

  it("is done when the server already has the new name", () => {
    expect(planFolderRename(tree([["a", "Work/A"]]), "Projects", "Work")).toEqual({ kind: "done" });
  });

  it("does nothing when the folder was renamed or deleted elsewhere", () => {
    expect(planFolderRename(tree([["a", "Elsewhere/A"]]), "Projects", "Work")).toEqual({ kind: "missing" });
  });

  it("picks a free name instead of letting notes collide", () => {
    const t = tree([
      ["a", "Projects/A"],
      ["b", "Work/a"],
      ["c", "Work (offline)/A"],
    ]);
    expect(planFolderRename(t, "Projects", "Work")).toEqual({ kind: "rename", to: "Work (offline 2)", renamed: true });
  });
});

describe("replaying a folder delete", () => {
  const seen = [
    { id: "a", updatedAt: T0 },
    { id: "b", updatedAt: T0 },
  ];

  it("deletes the folder when it holds exactly what this device saw", () => {
    const t = tree([["a", "Projects/A"], ["b", "Projects/B"], ["c", "Other/C"]]);
    expect(planFolderDelete(t, "Projects", seen)).toEqual({ whole: true, remove: [], kept: 0 });
  });

  it("keeps notes added or edited elsewhere, and the folder with them", () => {
    const t = tree([["a", "Projects/A"], ["b", "Projects/B", T1], ["n", "Projects/New"]]);
    expect(planFolderDelete(t, "Projects", seen)).toEqual({ whole: false, remove: ["a"], kept: 2 });
  });

  it("still deletes seen, unchanged notes that were moved out elsewhere", () => {
    const t = tree([["a", "Moved/A"], ["b", "Projects/B"]]);
    expect(planFolderDelete(t, "Projects", seen)).toEqual({ whole: true, remove: ["a"], kept: 0 });
  });

  it("compares versions as instants", () => {
    const t = tree([["a", "Projects/A", "2026-11-01T10:00:00Z"]]);
    expect(planFolderDelete(t, "Projects", [{ id: "a", updatedAt: T0 }]).whole).toBe(true);
  });
});

describe("replay order", () => {
  it("renames the folder before the note in it is saved, then deletes", async () => {
    let q = run([
      { kind: "mvdir", from: "Projects", to: "Work" },
      { kind: "save", id: "a", content: "edited in Work", base: T0 },
      { kind: "rmdir", path: "Old", notes: [] },
    ]);
    const calls: string[] = [];
    const r = await replay({
      create: async (path) => ({ id: "x", path, name: path }),
      rename: async () => {},
      remove: async () => {},
      folder: async (op) => {
        calls.push(op.kind === "mvdir" ? `mvdir ${op.from}->${op.to}` : `${op.kind} ${op.path}`);
        return "done";
      },
      save: async (op: SaveOp) => {
        calls.push(`save ${op.id}`);
        return "done";
      },
      head: () => q[0],
      begin: () => {},
      finish: async (seq) => void (q = q.filter((o) => o.seq !== seq)),
      created: async () => {},
      dropped: () => {},
    });
    expect(calls).toEqual(["mvdir Projects->Work", "save a", "rmdir Old"]);
    expect(r).toEqual({ synced: 3, conflicts: 0, failed: 0, stopped: "empty" });
  });

  it("counts a folder conflict, keeps going, and keeps a folder edit queued while offline", async () => {
    let q = run([
      { kind: "mvdir", from: "Projects", to: "Work" },
      { kind: "rmdir", path: "Old", notes: [] },
    ]);
    const { ApiError } = await import("@/components/workspace/api");
    let first = true;
    const r = await replay({
      create: async (path) => ({ id: "x", path, name: path }),
      rename: async () => {},
      remove: async () => {},
      folder: async (op) => {
        if (op.kind === "mvdir") return "conflict";
        if (first) {
          first = false;
          throw new ApiError("offline", 0);
        }
        return "done";
      },
      save: async () => "done",
      head: () => q[0],
      begin: () => {},
      finish: async (seq) => void (q = q.filter((o) => o.seq !== seq)),
      created: async () => {},
      dropped: () => {},
    });
    expect(r).toEqual({ synced: 0, conflicts: 1, failed: 0, stopped: "offline" });
    expect(q.map((o) => o.kind)).toEqual(["rmdir"]);
  });
});
