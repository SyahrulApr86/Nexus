import { beforeEach, describe, expect, it } from "vitest";
import { api, registerAndLogin, resetDb } from "./helpers.js";
import type { SearchResultDto } from "@nexus/shared";

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

async function search(cookie: string, q: string): Promise<SearchResultDto[]> {
  const res = await api(`/search?q=${encodeURIComponent(q)}`, { cookie });
  expect(res.status).toBe(200);
  return (await res.json() as any).results;
}

describe("FR-013 full-text fuzzy search", () => {
  it("finds notes by title and content, title matches ranked first", async () => {
    const { cookie } = await registerAndLogin();
    const inTitle = await createNote(cookie, {
      title: "Receive Payments",
      content: "nothing relevant here",
    });
    const inContent = await createNote(cookie, {
      title: "Random Note",
      content: "how to receive money fast",
    });
    await createNote(cookie, { title: "Unrelated", content: "nope" });

    const results = await search(cookie, "receive");
    expect(results.length).toBe(2);
    expect(results[0]!.id).toBe(inTitle.id); // title match ranked above
    expect(results[1]!.id).toBe(inContent.id);
    expect(results[0]!.titleMatch).toBe(true);
  });

  it("tolerates typos (US5-S1: recieve matches Receive)", async () => {
    const { cookie } = await registerAndLogin();
    const note = await createNote(cookie, {
      title: "Receive Payments",
      content: "",
    });
    const results = await search(cookie, "recieve");
    expect(results.map((r) => r.id)).toContain(note.id);
  });

  it("handles unicode content (CJK)", async () => {
    const { cookie } = await registerAndLogin();
    const note = await createNote(cookie, {
      title: "Japan Trip",
      content: "東京タワーに行きたい",
    });
    const results = await search(cookie, "東京");
    expect(results.map((r) => r.id)).toContain(note.id);
  });

  it("handles regex-reserved characters safely", async () => {
    const { cookie } = await registerAndLogin();
    const note = await createNote(cookie, {
      title: "Regex (notes)",
      content: "a+b* [test] (parens)",
    });
    const results = await search(cookie, "(parens)");
    expect(results.map((r) => r.id)).toContain(note.id);
  });

  it("returns empty array when nothing matches (US5-S4)", async () => {
    const { cookie } = await registerAndLogin();
    await createNote(cookie, { title: "Something", content: "else" });
    expect(await search(cookie, "zzzqqqxxx")).toHaveLength(0);
  });

  it("excludes trashed notes", async () => {
    const { cookie } = await registerAndLogin();
    const note = await createNote(cookie, { title: "Findme", content: "" });
    await api(`/notes/${note.id}`, { method: "DELETE", cookie });
    expect(await search(cookie, "findme")).toHaveLength(0);
  });

  it("never returns other users' notes (FR-025)", async () => {
    const a = await registerAndLogin("alice@example.com");
    const b = await registerAndLogin("bob@example.com");
    await createNote(a.cookie, {
      title: "Alice Secret",
      content: "classified content",
    });
    expect(await search(b.cookie, "secret")).toHaveLength(0);
    expect(await search(b.cookie, "classified")).toHaveLength(0);
  });
});
