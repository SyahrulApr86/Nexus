import { beforeEach, describe, expect, it } from "vitest";
import { api, registerAndLogin, resetDb } from "./helpers.js";
import { prisma } from "../src/db.js";
import type { FolderDto } from "@nexus/shared";

beforeEach(resetDb);

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
  expect(res.status).toBe(201);
  return (await res.json() as any).folder as { id: string; name: string };
}

async function getTree(cookie: string): Promise<FolderDto[]> {
  const res = await api("/folders/tree", { cookie });
  expect(res.status).toBe(200);
  return (await res.json() as any).tree;
}

async function createNote(cookie: string, body: Record<string, unknown>) {
  const res = await api("/notes", {
    method: "POST",
    cookie,
    body: JSON.stringify(body),
  });
  return (await res.json() as any).note as { id: string };
}

describe("FR-007 folder CRUD", () => {
  it("creates folders and returns hierarchical tree with note counts (FR-008)", async () => {
    const { cookie } = await registerAndLogin();
    const parent = await createFolder(cookie, "Projects");
    const child = await createFolder(cookie, "Alpha", parent.id);
    await createNote(cookie, { title: "N1", folderId: child.id });
    await createNote(cookie, { title: "N2", folderId: child.id });

    const tree = await getTree(cookie);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.name).toBe("Projects");
    expect(tree[0]!.children).toHaveLength(1);
    expect(tree[0]!.children[0]!.name).toBe("Alpha");
    expect(tree[0]!.children[0]!.noteCount).toBe(2);
  });

  it("renames a folder (US3-S4)", async () => {
    const { cookie } = await registerAndLogin();
    const folder = await createFolder(cookie, "Old Name");
    await createNote(cookie, { title: "Kept", folderId: folder.id });
    const res = await api(`/folders/${folder.id}`, {
      method: "PATCH",
      cookie,
      body: JSON.stringify({ name: "New Name" }),
    });
    expect(res.status).toBe(200);
    const tree = await getTree(cookie);
    expect(tree[0]!.name).toBe("New Name");
    expect(tree[0]!.noteCount).toBe(1); // notes retain association
  });

  it("moves a folder under another parent", async () => {
    const { cookie } = await registerAndLogin();
    const a = await createFolder(cookie, "A");
    const b = await createFolder(cookie, "B");
    const res = await api(`/folders/${b.id}/move`, {
      method: "POST",
      cookie,
      body: JSON.stringify({ parentId: a.id }),
    });
    expect(res.status).toBe(200);
    const tree = await getTree(cookie);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.children[0]!.name).toBe("B");
  });

  it("rejects moving a folder into its own descendant (cycle guard)", async () => {
    const { cookie } = await registerAndLogin();
    const a = await createFolder(cookie, "A");
    const b = await createFolder(cookie, "B", a.id);
    const res = await api(`/folders/${a.id}/move`, {
      method: "POST",
      cookie,
      body: JSON.stringify({ parentId: b.id }),
    });
    expect(res.status).toBe(400);
  });

  it("cascade soft-deletes folder with descendants (US3-S3, US12-S2)", async () => {
    const { cookie } = await registerAndLogin();
    const parent = await createFolder(cookie, "Parent");
    const child = await createFolder(cookie, "Child", parent.id);
    const note1 = await createNote(cookie, { title: "InParent", folderId: parent.id });
    const note2 = await createNote(cookie, { title: "InChild", folderId: child.id });

    const res = await api(`/folders/${parent.id}`, {
      method: "DELETE",
      cookie,
    });
    expect(res.status).toBe(200);

    expect(await getTree(cookie)).toHaveLength(0);
    for (const id of [note1.id, note2.id]) {
      const row = await prisma.note.findUnique({ where: { id } });
      expect(row!.isTrashed).toBe(true);
      expect(row!.trashRootId).toBe(parent.id);
    }
    const childRow = await prisma.folder.findUnique({ where: { id: child.id } });
    expect(childRow!.isTrashed).toBe(true);
    expect(childRow!.trashRootId).toBe(parent.id);
  });
});

describe("FR-025 folder isolation", () => {
  it("user B cannot see, rename, move into, or delete user A's folders", async () => {
    const a = await registerAndLogin("alice@example.com");
    const b = await registerAndLogin("bob@example.com");
    const folder = await createFolder(a.cookie, "Private");

    expect(await getTree(b.cookie)).toHaveLength(0);

    const rename = await api(`/folders/${folder.id}`, {
      method: "PATCH",
      cookie: b.cookie,
      body: JSON.stringify({ name: "Hacked" }),
    });
    expect(rename.status).toBe(404);

    const del = await api(`/folders/${folder.id}`, {
      method: "DELETE",
      cookie: b.cookie,
    });
    expect(del.status).toBe(404);

    // B cannot create a note inside A's folder
    const note = await api("/notes", {
      method: "POST",
      cookie: b.cookie,
      body: JSON.stringify({ title: "Sneak", folderId: folder.id }),
    });
    expect(note.status).toBe(404);
  });
});
