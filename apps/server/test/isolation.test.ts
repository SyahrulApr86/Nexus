import { beforeEach, describe, expect, it } from "vitest";
import { api, registerAndLogin, resetDb } from "./helpers.js";

/**
 * FR-025 release gate: every data-access path is vault-scoped. Alice owns
 * one of each resource; Bob must never read or mutate any of them, and every
 * endpoint must reject unauthenticated callers.
 */

interface Fixture {
  alice: { cookie: string };
  bob: { cookie: string };
  noteId: string;
  folderId: string;
  versionId: string;
  trashedNoteId: string;
}

let f: Fixture;

beforeEach(async () => {
  await resetDb();
  const alice = await registerAndLogin("alice@example.com");
  const bob = await registerAndLogin("bob@example.com");

  const folder = (
    (await (
      await api("/folders", {
        method: "POST",
        cookie: alice.cookie,
        body: JSON.stringify({ name: "Alice Folder", parentId: null }),
      })
    ).json()) as any
  ).folder;

  const note = (
    (await (
      await api("/notes", {
        method: "POST",
        cookie: alice.cookie,
        body: JSON.stringify({
          title: "Alice Note",
          content: "alice secret #alicetag [[Alice Note]]",
          folderId: folder.id,
        }),
      })
    ).json()) as any
  ).note;

  const trashed = (
    (await (
      await api("/notes", {
        method: "POST",
        cookie: alice.cookie,
        body: JSON.stringify({ title: "Alice Trashed", content: "gone" }),
      })
    ).json()) as any
  ).note;
  await api(`/notes/${trashed.id}`, { method: "DELETE", cookie: alice.cookie });

  const versions = (
    (await (
      await api(`/trash/note/${trashed.id}/versions`, { cookie: alice.cookie })
    ).json()) as any
  ).versions;

  f = {
    alice,
    bob,
    noteId: note.id,
    folderId: folder.id,
    versionId: versions[0].id,
    trashedNoteId: trashed.id,
  };
});

describe("FR-025 cross-user access is impossible", () => {
  it("read endpoints never expose another vault's data", async () => {
    const reads: [string, string][] = [
      ["note by id", `/notes/${f.noteId}`],
      ["trashed versions", `/trash/note/${f.trashedNoteId}/versions`],
      [
        "version content",
        `/trash/note/${f.trashedNoteId}/versions/${f.versionId}`,
      ],
    ];
    for (const [label, path] of reads) {
      const res = await api(path, { cookie: f.bob.cookie });
      expect(res.status, label).toBe(404);
    }

    // Collection endpoints return Bob's (empty) vault, never Alice's rows
    const collections: [string, string, string][] = [
      ["notes list", "/notes", "notes"],
      ["folder tree", "/folders/tree", "tree"],
      ["trash list", "/trash", "items"],
      ["tags", "/tags", "tags"],
      ["tag notes", "/tags/alicetag/notes", "notes"],
      ["search title", "/search?q=Alice", "results"],
      ["search content", "/search?q=secret", "results"],
      ["suggestions", "/notes/suggestions?q=Alice", "suggestions"],
    ];
    for (const [label, path, key] of collections) {
      const res = await api(path, { cookie: f.bob.cookie });
      expect(res.status, label).toBe(200);
      expect((await res.json() as any)[key], label).toHaveLength(0);
    }

    const graph = await api("/graph", { cookie: f.bob.cookie });
    const graphBody = (await graph.json()) as any;
    expect(graphBody.nodes).toHaveLength(0);
    expect(graphBody.edges).toHaveLength(0);

    // Export streams only the caller's vault
    const zip = await api("/export", { cookie: f.bob.cookie });
    expect(zip.status).toBe(200);
    expect((await zip.arrayBuffer()).byteLength).toBeLessThan(200); // empty zip
  });

  it("mutating endpoints reject cross-vault targets with 404", async () => {
    const mutations: [string, string, RequestInit][] = [
      [
        "update note",
        `/notes/${f.noteId}`,
        { method: "PATCH", body: JSON.stringify({ content: "hacked" }) },
      ],
      ["delete note", `/notes/${f.noteId}`, { method: "DELETE" }],
      [
        "move note",
        `/notes/${f.noteId}/move`,
        { method: "POST", body: JSON.stringify({ folderId: null }) },
      ],
      [
        "reorder note",
        `/notes/${f.noteId}/reorder`,
        { method: "POST", body: JSON.stringify({ position: 0 }) },
      ],
      [
        "rename folder",
        `/folders/${f.folderId}`,
        { method: "PATCH", body: JSON.stringify({ name: "hacked" }) },
      ],
      [
        "move folder",
        `/folders/${f.folderId}/move`,
        { method: "POST", body: JSON.stringify({ parentId: null }) },
      ],
      ["delete folder", `/folders/${f.folderId}`, { method: "DELETE" }],
      [
        "restore note",
        `/trash/note/${f.trashedNoteId}/restore`,
        { method: "POST" },
      ],
      [
        "purge note",
        `/trash/note/${f.trashedNoteId}`,
        { method: "DELETE" },
      ],
      [
        "create note in foreign folder",
        "/notes",
        {
          method: "POST",
          body: JSON.stringify({ title: "x", folderId: f.folderId }),
        },
      ],
      [
        "create folder under foreign parent",
        "/folders",
        {
          method: "POST",
          body: JSON.stringify({ name: "x", parentId: f.folderId }),
        },
      ],
    ];

    for (const [label, path, init] of mutations) {
      const res = await api(path, { ...init, cookie: f.bob.cookie });
      expect(res.status, label).toBe(404);
    }

    // Alice's data survived every attempt
    const check = await api(`/notes/${f.noteId}`, { cookie: f.alice.cookie });
    expect(check.status).toBe(200);
    expect((await check.json() as any).note.content).toContain("alice secret");
    const tree = await api("/folders/tree", { cookie: f.alice.cookie });
    expect((await tree.json() as any).tree[0].name).toBe("Alice Folder");
  });

  it("every data endpoint requires authentication", async () => {
    const paths: [string, RequestInit][] = [
      ["/notes", {}],
      [`/notes/${f.noteId}`, {}],
      ["/notes/suggestions?q=a", {}],
      ["/notes", { method: "POST", body: JSON.stringify({ title: "x" }) }],
      [`/notes/${f.noteId}`, { method: "PATCH", body: JSON.stringify({}) }],
      [`/notes/${f.noteId}`, { method: "DELETE" }],
      ["/folders/tree", {}],
      ["/folders", { method: "POST", body: JSON.stringify({ name: "x" }) }],
      ["/search?q=a", {}],
      ["/tags", {}],
      ["/tags/x/notes", {}],
      ["/graph", {}],
      ["/trash", {}],
      [`/trash/note/${f.trashedNoteId}/restore`, { method: "POST" }],
      ["/export", {}],
      ["/import/files", { method: "POST" }],
      ["/import/zip", { method: "POST" }],
      ["/auth/me", {}],
      ["/auth/preferences", { method: "PATCH", body: JSON.stringify({}) }],
    ];
    for (const [path, init] of paths) {
      const res = await api(path, init);
      expect(res.status, `${init.method ?? "GET"} ${path}`).toBe(401);
    }
  });

  it("a stale session cookie cannot reach another user's data", async () => {
    const forged = "nexus_session=totally-made-up-token";
    const res = await api(`/notes/${f.noteId}`, { cookie: forged });
    expect(res.status).toBe(401);
    expect((await res.json() as any).code).toBe("SESSION_EXPIRED");
  });
});
