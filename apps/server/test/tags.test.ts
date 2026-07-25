import { beforeEach, describe, expect, it } from "vitest";
import { api, registerAndLogin, resetDb } from "./helpers.js";
import type { TagDto } from "@nexus/shared";

beforeEach(resetDb);

async function createNote(cookie: string, body: Record<string, unknown>) {
  const res = await api("/notes", {
    method: "POST",
    cookie,
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return (await res.json() as any).note as { id: string };
}

async function getTags(cookie: string): Promise<TagDto[]> {
  const res = await api("/tags", { cookie });
  expect(res.status).toBe(200);
  return (await res.json() as any).tags;
}

describe("FR-018 tag aggregation", () => {
  it("aggregates tags with note counts (US7-S2)", async () => {
    const { cookie } = await registerAndLogin();
    await createNote(cookie, { title: "A", content: "work on #project-alpha" });
    await createNote(cookie, {
      title: "B",
      content: "#project-alpha and #beta today",
    });
    const tags = await getTags(cookie);
    const alpha = tags.find((t) => t.name === "project-alpha");
    const beta = tags.find((t) => t.name === "beta");
    expect(alpha?.noteCount).toBe(2);
    expect(beta?.noteCount).toBe(1);
  });

  it("ignores tags inside code blocks (shared parser semantics)", async () => {
    const { cookie } = await registerAndLogin();
    await createNote(cookie, { content: "```\n#hidden\n```\n#visible" });
    const tags = await getTags(cookie);
    expect(tags.map((t) => t.name)).toEqual(["visible"]);
  });

  it("updates aggregation when a note is edited or trashed", async () => {
    const { cookie } = await registerAndLogin();
    const note = await createNote(cookie, { content: "#temp" });
    await api(`/notes/${note.id}`, {
      method: "PATCH",
      cookie,
      body: JSON.stringify({ content: "no tags anymore" }),
    });
    expect(await getTags(cookie)).toHaveLength(0);

    await api(`/notes/${note.id}`, {
      method: "PATCH",
      cookie,
      body: JSON.stringify({ content: "#back" }),
    });
    expect((await getTags(cookie)).map((t) => t.name)).toEqual(["back"]);

    await api(`/notes/${note.id}`, { method: "DELETE", cookie });
    expect(await getTags(cookie)).toHaveLength(0);
  });

  it("is vault-scoped (FR-025)", async () => {
    const a = await registerAndLogin("alice@example.com");
    const b = await registerAndLogin("bob@example.com");
    await createNote(a.cookie, { content: "#alicesecret" });
    expect(await getTags(b.cookie)).toHaveLength(0);
  });
});

describe("FR-019 filter by tag", () => {
  it("returns only notes carrying the tag (US7-S3)", async () => {
    const { cookie } = await registerAndLogin();
    const tagged = await createNote(cookie, {
      title: "Tagged",
      content: "#focus work",
    });
    await createNote(cookie, { title: "Other", content: "nothing" });

    const res = await api("/tags/focus/notes", { cookie });
    expect(res.status).toBe(200);
    const notes = (await res.json() as any).notes as { id: string }[];
    expect(notes.map((n) => n.id)).toEqual([tagged.id]);
  });

  it("handles unicode tag names", async () => {
    const { cookie } = await registerAndLogin();
    const note = await createNote(cookie, { content: "#日本語 note" });
    const res = await api(`/tags/${encodeURIComponent("日本語")}/notes`, {
      cookie,
    });
    const notes = (await res.json() as any).notes as { id: string }[];
    expect(notes.map((n) => n.id)).toEqual([note.id]);
  });
});
