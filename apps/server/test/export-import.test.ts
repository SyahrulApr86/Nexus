import { beforeEach, describe, expect, it } from "vitest";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { api, registerAndLogin, resetDb } from "./helpers.js";

beforeEach(resetDb);

async function createNote(cookie: string, body: Record<string, unknown>) {
  const res = await api("/notes", {
    method: "POST",
    cookie,
    body: JSON.stringify(body),
  });
  return (await res.json() as any).note as { id: string };
}

async function createFolder(
  cookie: string,
  name: string,
  parentId: string | null = null,
) {
  const res = await api("/folders", {
    method: "POST",
    cookie,
    body: JSON.stringify({ name, parentId }),
  });
  return (await res.json() as any).folder as { id: string };
}

describe("FR-024 export vault as ZIP", () => {
  it("preserves folder hierarchy and content (US11-S1/S2)", async () => {
    const { cookie } = await registerAndLogin();
    const projects = await createFolder(cookie, "Projects");
    const alpha = await createFolder(cookie, "Alpha", projects.id);
    await createNote(cookie, {
      title: "Root Note",
      content: "# Root\n[[Deep Note]] #tag1",
    });
    await createNote(cookie, {
      title: "Deep Note",
      folderId: alpha.id,
      content: "deep content",
    });

    const res = await api("/export", { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/zip");

    const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const paths = Object.keys(zip).sort();
    expect(paths).toEqual(
      ["Projects/Alpha/Deep Note.md", "Root Note.md"].sort(),
    );
    // Wikilinks/tags stay literal plain text (US11-S2)
    expect(strFromU8(zip["Root Note.md"]!)).toBe("# Root\n[[Deep Note]] #tag1");
  });

  it("deduplicates colliding filenames within a folder", async () => {
    const { cookie } = await registerAndLogin();
    await createNote(cookie, { title: "Same", content: "a" });
    await createNote(cookie, { title: "Same", content: "b" });
    const res = await api("/export", { cookie });
    const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(zip).sort()).toEqual(["Same (1).md", "Same.md"]);
  });

  it("excludes trashed notes and other vaults (FR-025)", async () => {
    const a = await registerAndLogin("alice@example.com");
    const b = await registerAndLogin("bob@example.com");
    await createNote(a.cookie, { title: "Alice Note", content: "private" });
    const doomed = await createNote(b.cookie, { title: "Trashed", content: "x" });
    await api(`/notes/${doomed.id}`, { method: "DELETE", cookie: b.cookie });

    const res = await api("/export", { cookie: b.cookie });
    const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(zip)).toHaveLength(0);
  });
});

describe("FR-033/034 import markdown files", () => {
  it("imports a single .md file, filename becomes title (US13-S1)", async () => {
    const { cookie } = await registerAndLogin();
    const form = new FormData();
    form.append(
      "files",
      new File(["# Imported\ncontent"], "My Import.md", {
        type: "text/markdown",
      }),
    );
    const res = await api("/import/files", {
      method: "POST",
      cookie,
      body: form,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.imported).toBe(1);

    const list = await api("/notes", { cookie });
    const notes = (await list.json() as any).notes as { id: string; title: string }[];
    expect(notes.map((n) => n.title)).toContain("My Import");
    const note = await api(`/notes/${notes[0]!.id}`, { cookie });
    expect((await note.json() as any).note.content).toBe("# Imported\ncontent");
  });

  it("imports multiple files at once (US13-S2)", async () => {
    const { cookie } = await registerAndLogin();
    const form = new FormData();
    form.append("files", new File(["one"], "One.md"));
    form.append("files", new File(["two"], "Two.markdown"));
    const res = await api("/import/files", {
      method: "POST",
      cookie,
      body: form,
    });
    expect((await res.json() as any).imported).toBe(2);
  });

  it("rejects non-markdown files with a clear error (edge case)", async () => {
    const { cookie } = await registerAndLogin();
    const form = new FormData();
    form.append("files", new File(["binary"], "image.png"));
    const res = await api("/import/files", {
      method: "POST",
      cookie,
      body: form,
    });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toMatch(/\.md/);
  });

  it("adds numeric suffix on title collision (US13-S5)", async () => {
    const { cookie } = await registerAndLogin();
    await createNote(cookie, { title: "Note", content: "existing" });
    const form = new FormData();
    form.append("files", new File(["new"], "Note.md"));
    await api("/import/files", { method: "POST", cookie, body: form });
    const list = await api("/notes", { cookie });
    const titles = ((await list.json() as any).notes as { title: string }[]).map(
      (n) => n.title,
    );
    expect(titles.sort()).toEqual(["Note", "Note (1)"]);
  });
});

describe("FR-035/036 import ZIP with structure", () => {
  it("recreates folder hierarchy, skips non-md, links/tags functional (US13-S3/S4, SC-012)", async () => {
    const { cookie } = await registerAndLogin();
    const zipData = zipSync({
      "Root.md": strToU8("root links [[Deep]]"),
      "Folder A/Deep.md": strToU8("deep #imported"),
      "Folder A/Sub B/Leaf.md": strToU8("leaf"),
      "Folder A/skip.txt": strToU8("not markdown"),
    });
    const form = new FormData();
    form.append(
      "file",
      new File([new Uint8Array(zipData)], "vault.zip", { type: "application/zip" }),
    );
    const res = await api("/import/zip", { method: "POST", cookie, body: form });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.imported).toBe(3);
    expect(body.skipped).toBe(1);

    // Folder structure recreated
    const tree = await api("/folders/tree", { cookie });
    const roots = (await tree.json() as any).tree;
    expect(roots[0].name).toBe("Folder A");
    expect(roots[0].children[0].name).toBe("Sub B");

    // Wikilink resolves post-import (FR-036)
    const list = await api("/notes", { cookie });
    const notes = (await list.json() as any).notes as { id: string; title: string }[];
    const root = notes.find((n) => n.title === "Root")!;
    const got = await api(`/notes/${root.id}`, { cookie });
    const links = (await got.json() as any).links;
    expect(links[0].targetNoteId).not.toBeNull();

    // Tag indexed post-import
    const tags = await api("/tags", { cookie });
    expect(((await tags.json() as any).tags as { name: string }[]).map((t) => t.name)).toContain(
      "imported",
    );
  });
});
