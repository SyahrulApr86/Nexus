import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { db } from "@/db";
import { note, noteRevision, user, vault } from "@/db/schema";
import { createNote } from "@/lib/notes";
import { describeDb } from "./fixtures";

const req = vi.hoisted(() => ({
  headers: new Headers(),
  users: new Map<string, { id: string; name: string; email: string }>(),
}));

vi.mock("next/headers", () => ({ headers: async () => req.headers }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getAuth: () => ({
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const u = req.users.get(headers.get("x-test-user") ?? "");
        return u ? { user: u } : null;
      },
    },
  }),
}));

const listRoute = await import("@/app/api/notes/[id]/history/route");
const restoreRoute = await import("@/app/api/notes/[id]/history/[revisionId]/restore/route");
const { hunksOf } = await import("@/components/workspace/history/diff");

function as(userId: string | null, vaultId?: string, extra: Record<string, string> = {}) {
  req.headers = new Headers({
    ...(userId ? { "x-test-user": userId } : {}),
    ...(vaultId ? { "x-nexus-vault": vaultId } : {}),
    ...extra,
  });
}
const post = (body?: unknown, type = "application/json") =>
  new Request("http://app.test/api/notes/x/history/y/restore", {
    method: "POST",
    ...(body === undefined ? {} : { headers: { "content-type": type }, body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
const params = (id: string, revisionId: string) => ({ params: Promise.resolve({ id, revisionId }) });
async function call(res: Promise<Response>) {
  const r = await res;
  return { status: r.status, body: await r.json() };
}

const OLD = ["# Plan", "", "Intro line.", "Keep this.", "Old risk.", "", "Ending."].join("\n");
const NOW = ["# Plan", "", "Intro line, revised. #draft", "Keep this.", "", "Ending.", "New closing line."].join("\n");

describeDb("version history restore", () => {
  const A = `vitest-a-${randomUUID()}`;
  const B = `vitest-b-${randomUUID()}`;
  let va = "";
  let vb = "";

  beforeAll(async () => {
    for (const id of [A, B]) {
      await db.insert(user).values({ id, name: id, email: `${id}@example.test` });
      req.users.set(id, { id, name: id, email: `${id}@example.test` });
    }
    [{ id: va }] = await db.insert(vault).values({ ownerId: A, name: "A" }).returning({ id: vault.id });
    [{ id: vb }] = await db.insert(vault).values({ ownerId: B, name: "B" }).returning({ id: vault.id });
  });

  afterAll(async () => {
    await db.delete(user).where(inArray(user.id, [A, B]));
  });

  /** A note whose current text is NOW, with one older revision holding OLD. */
  async function noteWithRevision() {
    const n = await createNote(va, `Plan ${randomUUID().slice(0, 8)}`, NOW);
    const [r] = await db
      .insert(noteRevision)
      .values({ noteId: n.id, vaultId: va, content: OLD, reason: "autosave", createdAt: new Date(Date.now() - 3600_000) })
      .returning({ id: noteRevision.id });
    const [row] = await db.select({ updatedAt: note.updatedAt }).from(note).where(eq(note.id, n.id));
    return { id: n.id, rev: r.id, updatedAt: row.updatedAt.toISOString() };
  }
  const contentOf = async (id: string) => (await db.select({ content: note.content }).from(note).where(eq(note.id, id)))[0].content;

  it("restores one change, keeps the others and keeps the replaced text as a revision", async () => {
    const n = await noteWithRevision();
    expect(hunksOf(OLD, NOW)).toHaveLength(3);
    as(A, va);
    const res = await call(restoreRoute.POST(post({ hunks: [1], baseUpdatedAt: n.updatedAt }), params(n.id, n.rev)));
    expect(res.status).toBe(200);
    expect(await contentOf(n.id)).toBe(["# Plan", "", "Intro line, revised. #draft", "Keep this.", "Old risk.", "", "Ending.", "New closing line."].join("\n"));
    const revs = await db.select({ content: noteRevision.content, reason: noteRevision.reason }).from(noteRevision).where(eq(noteRevision.noteId, n.id));
    expect(revs).toContainEqual({ content: NOW, reason: "restore" });
    // The list route reports it, newest first.
    const list = await call(listRoute.GET(new Request("http://app.test"), { params: Promise.resolve({ id: n.id }) }));
    expect(list.body[0]).toMatchObject({ reason: "restore" });
  });

  it("reindexes tags after restoring the change that held them", async () => {
    const n = await noteWithRevision();
    as(A, va);
    await call(restoreRoute.POST(post({ hunks: [0], baseUpdatedAt: n.updatedAt }), params(n.id, n.rev)));
    expect(await contentOf(n.id)).toContain("Intro line.\n");
    const { tag } = await import("@/db/schema");
    const tags = await db.select({ tag: tag.tag }).from(tag).where(and(eq(tag.noteId, n.id)));
    expect(tags).toEqual([]);
  });

  it("restores the whole version with no body, as before", async () => {
    const n = await noteWithRevision();
    as(A, va);
    const res = await call(restoreRoute.POST(post(), params(n.id, n.rev)));
    expect(res.status).toBe(200);
    expect(await contentOf(n.id)).toBe(OLD);
  });

  it("answers 409 with the server's note when the note moved on", async () => {
    const n = await noteWithRevision();
    as(A, va);
    const stale = new Date(Date.parse(n.updatedAt) - 1000).toISOString();
    const one = await call(restoreRoute.POST(post({ hunks: [0], baseUpdatedAt: stale }), params(n.id, n.rev)));
    expect(one.status).toBe(409);
    expect(one.body.note.content).toBe(NOW);
    const all = await call(restoreRoute.POST(post({ baseUpdatedAt: stale }), params(n.id, n.rev)));
    expect(all.status).toBe(409);
    expect(await contentOf(n.id)).toBe(NOW);
  });

  it("refuses bad input", async () => {
    const n = await noteWithRevision();
    as(A, va);
    expect((await call(restoreRoute.POST(post({ hunks: [7], baseUpdatedAt: n.updatedAt }), params(n.id, n.rev)))).status).toBe(400);
    expect((await call(restoreRoute.POST(post({ hunks: [0] }), params(n.id, n.rev)))).status).toBe(400);
    expect((await call(restoreRoute.POST(post({ hunks: [-1], baseUpdatedAt: n.updatedAt }), params(n.id, n.rev)))).status).toBe(400);
    expect((await call(restoreRoute.POST(post({ extra: 1 }), params(n.id, n.rev)))).status).toBe(400);
    expect((await call(restoreRoute.POST(post("hunks=0", "text/plain"), params(n.id, n.rev)))).status).toBe(415);
    expect(await contentOf(n.id)).toBe(NOW);
  });

  it("keeps vaults apart and refuses cross-site requests", async () => {
    const n = await noteWithRevision();
    as(B, vb);
    expect((await call(restoreRoute.POST(post({ hunks: [0], baseUpdatedAt: n.updatedAt }), params(n.id, n.rev)))).status).toBe(404);
    as(B);
    expect((await call(restoreRoute.POST(post(), params(n.id, n.rev)))).status).toBe(404);
    as(A, va, { "sec-fetch-site": "cross-site" });
    expect((await call(restoreRoute.POST(post(), params(n.id, n.rev)))).status).toBe(403);
    as(null);
    expect((await call(restoreRoute.POST(post(), params(n.id, n.rev)))).status).toBe(401);
    expect(await contentOf(n.id)).toBe(NOW);
  });
});
