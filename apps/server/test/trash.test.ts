import { beforeEach, describe, expect, it } from "vitest";
import { api, registerAndLogin, resetDb } from "./helpers.js";
import { prisma } from "../src/db.js";

beforeEach(resetDb);

async function createNote(cookie: string, body: Record<string, unknown>) {
  const res = await api("/notes", {
    method: "POST",
    cookie,
    body: JSON.stringify(body),
  });
  return (await res.json() as any).note as { id: string; updatedAt: string };
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

async function listTrash(cookie: string) {
  const res = await api("/trash", { cookie });
  expect(res.status).toBe(200);
  return (await res.json() as any).items as {
    type: string;
    id: string;
    title: string;
  }[];
}

describe("FR-028 trash listing", () => {
  it("shows trashed notes and folders as root items (US12-S1/S2)", async () => {
    const { cookie } = await registerAndLogin();
    const note = await createNote(cookie, { title: "Doomed Note" });
    const folder = await createFolder(cookie, "Doomed Folder");
    await createNote(cookie, { title: "Inside", folderId: folder.id });

    await api(`/notes/${note.id}`, { method: "DELETE", cookie });
    await api(`/folders/${folder.id}`, { method: "DELETE", cookie });

    const items = await listTrash(cookie);
    // Only roots appear — not the contained note
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.title).sort()).toEqual(
      ["Doomed Folder", "Doomed Note"].sort(),
    );
  });

  it("is vault-scoped (FR-025)", async () => {
    const a = await registerAndLogin("alice@example.com");
    const b = await registerAndLogin("bob@example.com");
    const note = await createNote(a.cookie, { title: "A private" });
    await api(`/notes/${note.id}`, { method: "DELETE", cookie: a.cookie });
    expect(await listTrash(b.cookie)).toHaveLength(0);
    // B cannot restore or purge A's item
    const restore = await api(`/trash/note/${note.id}/restore`, {
      method: "POST",
      cookie: b.cookie,
    });
    expect(restore.status).toBe(404);
    const purge = await api(`/trash/note/${note.id}`, {
      method: "DELETE",
      cookie: b.cookie,
    });
    expect(purge.status).toBe(404);
  });
});

describe("FR-029/FR-030 restore with version history", () => {
  it("restores a note to its original folder with versions intact (US12-S3)", async () => {
    const { cookie } = await registerAndLogin();
    const folder = await createFolder(cookie, "Home");
    const note = await createNote(cookie, {
      title: "Versioned",
      folderId: folder.id,
      content: "v1",
    });
    await api(`/notes/${note.id}`, {
      method: "PATCH",
      cookie,
      body: JSON.stringify({ content: "v2" }),
    });
    await api(`/notes/${note.id}`, { method: "DELETE", cookie });

    const restore = await api(`/trash/note/${note.id}/restore`, {
      method: "POST",
      cookie,
    });
    expect(restore.status).toBe(200);
    expect((await restore.json() as any).restoredToRoot).toBe(false);

    const got = await api(`/notes/${note.id}`, { cookie });
    const body = await got.json() as any;
    expect(body.note.folderId).toBe(folder.id);
    expect(body.note.content).toBe("v2"); // latest version active
    expect(body.versions.length).toBe(2); // all prior versions preserved
  });

  it("restores to vault root with flag when original folder was purged (US12-S7)", async () => {
    const { cookie } = await registerAndLogin();
    const folder = await createFolder(cookie, "Transient");
    const note = await createNote(cookie, {
      title: "Orphan",
      folderId: folder.id,
    });
    await api(`/notes/${note.id}`, { method: "DELETE", cookie });
    await api(`/folders/${folder.id}`, { method: "DELETE", cookie });
    await api(`/trash/folder/${folder.id}`, { method: "DELETE", cookie });

    const restore = await api(`/trash/note/${note.id}/restore`, {
      method: "POST",
      cookie,
    });
    expect(restore.status).toBe(200);
    expect((await restore.json() as any).restoredToRoot).toBe(true);
    const got = await api(`/notes/${note.id}`, { cookie });
    expect(((await got.json()) as any).note.folderId).toBeNull();
  });

  it("restores a folder subtree together (US12-S2/S5)", async () => {
    const { cookie } = await registerAndLogin();
    const parent = await createFolder(cookie, "Parent");
    const child = await createFolder(cookie, "Child", parent.id);
    const note = await createNote(cookie, { title: "Deep", folderId: child.id });
    await api(`/folders/${parent.id}`, { method: "DELETE", cookie });

    const restore = await api(`/trash/folder/${parent.id}/restore`, {
      method: "POST",
      cookie,
    });
    expect(restore.status).toBe(200);

    const tree = await api("/folders/tree", { cookie });
    const roots = (await tree.json() as any).tree;
    expect(roots[0].name).toBe("Parent");
    expect(roots[0].children[0].name).toBe("Child");
    const got = await api(`/notes/${note.id}`, { cookie });
    expect(got.status).toBe(200);
  });

  it("restoring a note re-resolves wikilinks pointing at it", async () => {
    const { cookie } = await registerAndLogin();
    const target = await createNote(cookie, { title: "Linked" });
    const source = await createNote(cookie, {
      title: "Src",
      content: "[[Linked]]",
    });
    await api(`/notes/${target.id}`, { method: "DELETE", cookie });
    let links = ((await (await api(`/notes/${source.id}`, { cookie })).json()) as any).links;
    expect(links[0].targetNoteId).toBeNull();

    await api(`/trash/note/${target.id}/restore`, { method: "POST", cookie });
    links = ((await (await api(`/notes/${source.id}`, { cookie })).json()) as any).links;
    expect(links[0].targetNoteId).toBe(target.id);
  });
});

describe("FR-031 permanent delete", () => {
  it("irreversibly removes note and all versions (US12-S4)", async () => {
    const { cookie } = await registerAndLogin();
    const note = await createNote(cookie, { title: "Gone", content: "v1" });
    await api(`/notes/${note.id}`, {
      method: "PATCH",
      cookie,
      body: JSON.stringify({ content: "v2" }),
    });
    await api(`/notes/${note.id}`, { method: "DELETE", cookie });
    const purge = await api(`/trash/note/${note.id}`, {
      method: "DELETE",
      cookie,
    });
    expect(purge.status).toBe(200);

    expect(await prisma.note.findUnique({ where: { id: note.id } })).toBeNull();
    expect(
      await prisma.noteVersion.count({ where: { noteId: note.id } }),
    ).toBe(0);
    expect(await listTrash(cookie)).toHaveLength(0);
  });

  it("purging a folder removes its whole subtree", async () => {
    const { cookie } = await registerAndLogin();
    const folder = await createFolder(cookie, "Bye");
    const note = await createNote(cookie, { title: "Inside", folderId: folder.id });
    await api(`/folders/${folder.id}`, { method: "DELETE", cookie });
    const purge = await api(`/trash/folder/${folder.id}`, {
      method: "DELETE",
      cookie,
    });
    expect(purge.status).toBe(200);
    expect(await prisma.folder.findUnique({ where: { id: folder.id } })).toBeNull();
    expect(await prisma.note.findUnique({ where: { id: note.id } })).toBeNull();
  });
});

describe("FR-032 version preview in trash", () => {
  it("returns read-only content of any prior version (US12-S6)", async () => {
    const { cookie } = await registerAndLogin();
    const note = await createNote(cookie, { title: "Hist", content: "first" });
    await api(`/notes/${note.id}`, {
      method: "PATCH",
      cookie,
      body: JSON.stringify({ content: "second" }),
    });
    await api(`/notes/${note.id}`, { method: "DELETE", cookie });

    const res = await api(`/trash/note/${note.id}/versions`, { cookie });
    expect(res.status).toBe(200);
    const versions = (await res.json() as any).versions as { id: string }[];
    expect(versions).toHaveLength(2);

    const contents: string[] = [];
    for (const v of versions) {
      const pv = await api(`/trash/note/${note.id}/versions/${v.id}`, {
        cookie,
      });
      contents.push(((await pv.json()) as any).content);
    }
    expect(contents.sort()).toEqual(["first", "second"]);
  });
});
