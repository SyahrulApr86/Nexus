import { beforeEach, describe, expect, it } from "vitest";
import { api, registerAndLogin, resetDb } from "./helpers.js";

beforeEach(resetDb);

async function createNote(cookie: string, body: Record<string, unknown>) {
  const res = await api("/notes", {
    method: "POST",
    cookie,
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return (await res.json() as any).note as { id: string; updatedAt: string };
}

describe("FR-010 wikilink autocomplete suggestions", () => {
  it("returns titles filtered by fragment, vault-scoped", async () => {
    const { cookie } = await registerAndLogin();
    await createNote(cookie, { title: "Project Alpha" });
    await createNote(cookie, { title: "Project Beta" });
    await createNote(cookie, { title: "Unrelated" });

    const res = await api("/notes/suggestions?q=proj", { cookie });
    expect(res.status).toBe(200);
    const titles = ((await res.json() as any).suggestions as { title: string }[]).map(
      (s) => s.title,
    );
    expect(titles).toContain("Project Alpha");
    expect(titles).toContain("Project Beta");
    expect(titles).not.toContain("Unrelated");
  });

  it("does not leak other users' titles (FR-025)", async () => {
    const a = await registerAndLogin("alice@example.com");
    const b = await registerAndLogin("bob@example.com");
    await createNote(a.cookie, { title: "Alice Secret Plan" });
    const res = await api("/notes/suggestions?q=secret", { cookie: b.cookie });
    expect((await res.json() as any).suggestions).toHaveLength(0);
  });

  it("excludes trashed notes from suggestions", async () => {
    const { cookie } = await registerAndLogin();
    const note = await createNote(cookie, { title: "Doomed" });
    await api(`/notes/${note.id}`, { method: "DELETE", cookie });
    const res = await api("/notes/suggestions?q=doom", { cookie });
    expect((await res.json() as any).suggestions).toHaveLength(0);
  });
});

describe("FR-011/FR-012 link resolution", () => {
  it("note GET includes outgoing links with resolution state", async () => {
    const { cookie } = await registerAndLogin();
    const target = await createNote(cookie, { title: "Target Note" });
    const source = await createNote(cookie, {
      title: "Source",
      content: "See [[Target Note]] and [[Missing Note]]",
    });
    const res = await api(`/notes/${source.id}`, { cookie });
    const links = (await res.json() as any).links as {
      targetTitle: string;
      targetNoteId: string | null;
    }[];
    expect(links).toHaveLength(2);
    const resolved = links.find((l) => l.targetTitle === "Target Note");
    const broken = links.find((l) => l.targetTitle === "Missing Note");
    expect(resolved!.targetNoteId).toBe(target.id);
    expect(broken!.targetNoteId).toBeNull();
  });

  it("creating a note resolves previously broken links to its title", async () => {
    const { cookie } = await registerAndLogin();
    const source = await createNote(cookie, {
      title: "Source",
      content: "Link to [[Future Note]]",
    });
    const future = await createNote(cookie, { title: "Future Note" });
    const res = await api(`/notes/${source.id}`, { cookie });
    const links = (await res.json() as any).links;
    expect(links[0].targetNoteId).toBe(future.id);
  });

  it("trashing a note breaks links pointing to it (edge case)", async () => {
    const { cookie } = await registerAndLogin();
    const target = await createNote(cookie, { title: "Fragile" });
    const source = await createNote(cookie, {
      title: "Source",
      content: "[[Fragile]]",
    });
    await api(`/notes/${target.id}`, { method: "DELETE", cookie });
    const res = await api(`/notes/${source.id}`, { cookie });
    const links = (await res.json() as any).links;
    expect(links[0].targetNoteId).toBeNull();
  });

  it("wikilinks inside code blocks are not indexed (US4-S6)", async () => {
    const { cookie } = await registerAndLogin();
    await createNote(cookie, { title: "Code Target" });
    const source = await createNote(cookie, {
      title: "Source",
      content: "```\n[[Code Target]]\n```\ntext `[[Also Ignored]]`",
    });
    const res = await api(`/notes/${source.id}`, { cookie });
    expect((await res.json() as any).links).toHaveLength(0);
  });
});
