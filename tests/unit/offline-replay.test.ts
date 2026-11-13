import { describe, expect, it } from "vitest";
import { ApiError } from "@/components/workspace/api";
import { enqueue, remapId, type NewOp, type OutboxOp, type SaveOp } from "@/components/workspace/offline/outbox";
import { fallbackPath, replay, type SaveOutcome } from "@/components/workspace/offline/replay";

/** A queue and a fake server that records what reached it, in order. */
function setup(ops: NewOp[], server: { fail?: (call: string) => unknown; save?: (op: SaveOp) => SaveOutcome } = {}) {
  let q: OutboxOp[] = ops.reduce<OutboxOp[]>((acc, op, i) => enqueue(acc, op, i), []);
  const calls: string[] = [];
  const created: string[] = [];
  const dropped: string[] = [];
  let ids = 0;
  const call = async (name: string) => {
    calls.push(name);
    const err = server.fail?.(name);
    if (err) throw err;
  };
  const result = replay({
    create: async (path) => {
      await call(`create ${path}`);
      return { id: `srv-${++ids}`, path, name: path };
    },
    rename: (id, path) => call(`rename ${id} ${path}`),
    remove: (id) => call(`delete ${id}`),
    save: async (op) => {
      await call(`save ${op.id} ${op.content}`);
      return server.save?.(op) ?? "done";
    },
    head: () => q[0],
    begin: () => {},
    finish: async (seq) => void (q = q.filter((o) => o.seq !== seq)),
    created: async (op, ref) => {
      created.push(`${op.id}->${ref.id}`);
      q = remapId(q, op.id, ref.id);
    },
    dropped: (op) => void dropped.push(`${op.kind} ${op.id}`),
  });
  return { result, calls, created, dropped, left: () => q };
}

describe("outbox replay", () => {
  it("replays in order and maps a created note's later edits to its server id", async () => {
    const t = setup([
      { kind: "save", id: "a", content: "A1", base: "t0" },
      { kind: "create", id: "local-x", path: "Inbox/New", content: "hello" },
      { kind: "rename", id: "b", path: "Archive/B" },
      { kind: "delete", id: "c" },
    ]);
    const r = await t.result;
    expect(t.calls).toEqual(["save a A1", "create Inbox/New", "rename b Archive/B", "delete c"]);
    expect(t.created).toEqual(["local-x->srv-1"]);
    expect(r).toEqual({ synced: 4, conflicts: 0, failed: 0, stopped: "empty" });
    expect(t.left()).toEqual([]);
  });

  it("stops at a lost connection and keeps that entry and the rest queued", async () => {
    const t = setup(
      [
        { kind: "save", id: "a", content: "A1" },
        { kind: "rename", id: "b", path: "X" },
        { kind: "save", id: "c", content: "C1" },
      ],
      { fail: (c) => (c.startsWith("rename") ? new ApiError("offline", 0) : null) },
    );
    const r = await t.result;
    expect(r.stopped).toBe("offline");
    expect(r.synced).toBe(1);
    expect(t.left().map((o) => o.id)).toEqual(["b", "c"]);
  });

  it("stops when signed out, and on server errors, without dropping anything", async () => {
    for (const [status, why] of [
      [401, "signedOut"],
      [503, "serverError"],
    ] as const) {
      const t = setup([{ kind: "delete", id: "a" }], { fail: () => new ApiError("x", status) });
      expect((await t.result).stopped).toBe(why);
      expect(t.left()).toHaveLength(1);
    }
  });

  it("counts a save the workspace holds as a conflict and moves on", async () => {
    const t = setup(
      [
        { kind: "save", id: "a", content: "mine", base: "t0" },
        { kind: "save", id: "b", content: "B" },
      ],
      { save: (op) => (op.id === "a" ? "conflict" : "done") },
    );
    expect(await t.result).toEqual({ synced: 1, conflicts: 1, failed: 0, stopped: "empty" });
    expect(t.left()).toEqual([]);
  });

  it("stops when the workspace could not send a save yet", async () => {
    const t = setup([{ kind: "save", id: "a", content: "A" }, { kind: "delete", id: "b" }], { save: () => "retry" });
    expect((await t.result).stopped).toBe("serverError");
    expect(t.left()).toHaveLength(2);
  });

  it("treats deleting a note that is already gone as done", async () => {
    const t = setup([{ kind: "delete", id: "a" }], { fail: () => new ApiError("gone", 404) });
    expect((await t.result).synced).toBe(1);
  });

  it("drops a refused rename and reports it, then carries on", async () => {
    const t = setup(
      [
        { kind: "rename", id: "a", path: "Taken" },
        { kind: "save", id: "b", content: "B" },
      ],
      { fail: (c) => (c.startsWith("rename") ? new ApiError("A note with that name exists.", 409) : null) },
    );
    const r = await t.result;
    expect(r).toMatchObject({ synced: 1, failed: 1 });
    expect(t.dropped).toEqual(["rename a"]);
  });

  it("keeps a created note under a plain name when its typed path is refused", async () => {
    const t = setup([{ kind: "create", id: "local-x", path: "Bad", content: "text" }], {
      fail: (c) => (c === "create Bad" ? new ApiError("Invalid path", 400) : null),
    });
    await t.result;
    expect(t.calls).toEqual(["create Bad", `create ${fallbackPath(0)}`]);
    expect(t.created).toHaveLength(1);
  });
});
