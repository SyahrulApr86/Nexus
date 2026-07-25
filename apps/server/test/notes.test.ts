import { beforeEach, describe, expect, it } from "vitest";
import { api, registerAndLogin, resetDb } from "./helpers.js";
import { prisma } from "../src/db.js";
import type { NoteDto, NoteSummaryDto } from "@nexus/shared";

beforeEach(resetDb);

async function createNote(
  cookie: string,
  body: Record<string, unknown> = {},
): Promise<NoteDto> {
  const res = await api("/notes", {
    method: "POST",
    cookie,
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return (await res.json() as any).note;
}

describe("FR-004 note CRUD", () => {
  it("creates a note and lists it", async () => {
    const { cookie } = await registerAndLogin();
    const note = await createNote(cookie, {
      title: "First",
      content: "# Hello",
    });
    expect(note.title).toBe("First");

    const list = await api("/notes", { cookie });
    expect(list.status).toBe(200);
    const notes: NoteSummaryDto[] = (await list.json() as any).notes;
    expect(notes.map((n) => n.id)).toContain(note.id);
    // List is summary-only — no content field leaks (lazy loading)
    expect((notes[0] as unknown as Record<string, unknown>).content).toBeUndefined();
  });

  it("gets a note with decrypted content", async () => {
    const { cookie } = await registerAndLogin();
    const note = await createNote(cookie, {
      title: "T",
      content: "secret body text",
    });
    const res = await api(`/notes/${note.id}`, { cookie });
    expect(res.status).toBe(200);
    expect((await res.json() as any).note.content).toBe("secret body text");
  });

  it("updates title and content", async () => {
    const { cookie } = await registerAndLogin();
    const note = await createNote(cookie);
    const res = await api(`/notes/${note.id}`, {
      method: "PATCH",
      cookie,
      body: JSON.stringify({ title: "Renamed", content: "new body" }),
    });
    expect(res.status).toBe(200);
    const updated = (await res.json() as any).note;
    expect(updated.title).toBe("Renamed");
    expect(updated.content).toBe("new body");
  });

  it("soft-deletes a note (disappears from list)", async () => {
    const { cookie } = await registerAndLogin();
    const note = await createNote(cookie);
    const del = await api(`/notes/${note.id}`, { method: "DELETE", cookie });
    expect(del.status).toBe(200);
    const list = await api("/notes", { cookie });
    expect(((await list.json() as any).notes as NoteSummaryDto[]).length).toBe(0);
    // Still in DB, soft-deleted
    const row = await prisma.note.findUnique({ where: { id: note.id } });
    expect(row!.isTrashed).toBe(true);
  });

  it("allows duplicate titles in the same folder (edge case)", async () => {
    const { cookie } = await registerAndLogin();
    const a = await createNote(cookie, { title: "Same" });
    const b = await createNote(cookie, { title: "Same" });
    expect(a.id).not.toBe(b.id);
  });
});

describe("FR-026 encryption at rest", () => {
  it("stores content encrypted — plaintext absent from the raw column", async () => {
    const { cookie } = await registerAndLogin();
    const marker = "VERY-UNIQUE-PLAINTEXT-MARKER-9218";
    const note = await createNote(cookie, { content: `text ${marker} end` });
    const rows = await prisma.$queryRaw<{ contentEnc: Buffer }[]>`
      SELECT "contentEnc" FROM "Note" WHERE id = ${note.id}::uuid`;
    const raw = rows[0]!.contentEnc.toString("latin1");
    expect(raw).not.toContain(marker);
    // And decrypts fine through the API
    const res = await api(`/notes/${note.id}`, { cookie });
    expect((await res.json() as any).note.content).toContain(marker);
  });

  it("title stays plaintext for indexing (per FR-026 metadata carve-out)", async () => {
    const { cookie } = await registerAndLogin();
    const note = await createNote(cookie, { title: "Visible Title" });
    const row = await prisma.note.findUnique({ where: { id: note.id } });
    expect(row!.title).toBe("Visible Title");
  });
});

describe("US2-S5 concurrent-edit conflict", () => {
  it("detects a stale write and returns 409 with server content", async () => {
    const { cookie } = await registerAndLogin();
    const note = await createNote(cookie, { content: "v1" });

    // Tab A updates
    const first = await api(`/notes/${note.id}`, {
      method: "PATCH",
      cookie,
      body: JSON.stringify({ content: "v2", baseUpdatedAt: note.updatedAt }),
    });
    expect(first.status).toBe(200);

    // Tab B updates from the old snapshot → conflict
    const second = await api(`/notes/${note.id}`, {
      method: "PATCH",
      cookie,
      body: JSON.stringify({
        content: "v2-from-stale-tab",
        baseUpdatedAt: note.updatedAt,
      }),
    });
    expect(second.status).toBe(409);
    const body = await second.json() as any;
    expect(body.code).toBe("CONFLICT");
    // Last-write-wins: the server accepted nothing from the stale tab
    const current = await api(`/notes/${note.id}`, { cookie });
    expect((await current.json() as any).note.content).toBe("v2");
  });

  it("update without baseUpdatedAt always wins (last-write-wins)", async () => {
    const { cookie } = await registerAndLogin();
    const note = await createNote(cookie, { content: "v1" });
    await api(`/notes/${note.id}`, {
      method: "PATCH",
      cookie,
      body: JSON.stringify({ content: "v2" }),
    });
    const res = await api(`/notes/${note.id}`, {
      method: "PATCH",
      cookie,
      body: JSON.stringify({ content: "v3" }),
    });
    expect(res.status).toBe(200);
  });
});

describe("FR-029 version snapshots", () => {
  it("creates a version per content update and lists summaries", async () => {
    const { cookie } = await registerAndLogin();
    const note = await createNote(cookie, { content: "v1" });
    await api(`/notes/${note.id}`, {
      method: "PATCH",
      cookie,
      body: JSON.stringify({ content: "v2" }),
    });
    await api(`/notes/${note.id}`, {
      method: "PATCH",
      cookie,
      body: JSON.stringify({ content: "v3" }),
    });
    const res = await api(`/notes/${note.id}`, { cookie });
    const body = await res.json() as any;
    // v1 (create) + v2 + v3
    expect(body.versions.length).toBe(3);
  });

  it("title-only update does not create a version", async () => {
    const { cookie } = await registerAndLogin();
    const note = await createNote(cookie, { content: "v1" });
    await api(`/notes/${note.id}`, {
      method: "PATCH",
      cookie,
      body: JSON.stringify({ title: "Renamed" }),
    });
    const versions = await prisma.noteVersion.count({
      where: { noteId: note.id },
    });
    expect(versions).toBe(1);
  });

  it("caps versions at 100, pruning oldest (PRD edge case)", async () => {
    const { cookie } = await registerAndLogin();
    const note = await createNote(cookie, { content: "v0" });
    for (let i = 1; i <= 105; i++) {
      await api(`/notes/${note.id}`, {
        method: "PATCH",
        cookie,
        body: JSON.stringify({ content: `v${i}` }),
      });
    }
    const versions = await prisma.noteVersion.findMany({
      where: { noteId: note.id },
      orderBy: { createdAt: "asc" },
    });
    expect(versions.length).toBe(100);
  }, 30_000);
});

describe("FR-025 data isolation", () => {
  it("user B cannot read, update, or delete user A's note (404, no existence leak)", async () => {
    const a = await registerAndLogin("alice@example.com");
    const b = await registerAndLogin("bob@example.com");
    const note = await createNote(a.cookie, { content: "alice private" });

    const read = await api(`/notes/${note.id}`, { cookie: b.cookie });
    expect(read.status).toBe(404);

    const update = await api(`/notes/${note.id}`, {
      method: "PATCH",
      cookie: b.cookie,
      body: JSON.stringify({ content: "hacked" }),
    });
    expect(update.status).toBe(404);

    const del = await api(`/notes/${note.id}`, {
      method: "DELETE",
      cookie: b.cookie,
    });
    expect(del.status).toBe(404);

    // A's note untouched
    const check = await api(`/notes/${note.id}`, { cookie: a.cookie });
    expect((await check.json() as any).note.content).toBe("alice private");

    // B's list does not contain A's note
    const list = await api("/notes", { cookie: b.cookie });
    expect(((await list.json() as any).notes as NoteSummaryDto[]).length).toBe(0);
  });
});
