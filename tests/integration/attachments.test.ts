import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { strToU8, unzipSync } from "fflate";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { db } from "@/db";
import { attachment } from "@/db/schema";
import {
  ATTACHMENT_LIMITS,
  deleteAttachment,
  getAttachment,
  importVault,
  listAttachments,
  previewVaultImport,
  uploadAttachment,
} from "@/lib/attachments";
import { exportVault, listTree } from "@/lib/notes";
import { HttpError } from "@/lib/session";
import { describeDb, useVaults } from "./fixtures";

/** The vault the mocked requireVault hands to route handlers. */
const current = { vaultId: "", userId: "" };

vi.mock("@/lib/session", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/session")>();
  return { ...real, requireVault: async () => ({ user: { id: current.userId }, vaultId: current.vaultId }) };
});

const png = (seed: number, size = 256) => {
  const b = new Uint8Array(size).fill(seed);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return b;
};
const MP3 = (() => {
  const b = new Uint8Array(4096);
  b.set([0x49, 0x44, 0x33, 4, 0]);
  for (let i = 5; i < b.length; i++) b[i] = i % 251;
  return b;
})();

async function status(p: Promise<unknown>) {
  try {
    await p;
    return 200;
  } catch (e) {
    if (!(e instanceof HttpError)) throw e;
    return e.status;
  }
}

describeDb("attachments", () => {
  const v = useVaults();
  let dir = "";
  const blobs = async (vaultId: string) => {
    try {
      return (await readdir(path.join(dir, "attachments", vaultId))).filter((f) => !f.startsWith("."));
    } catch {
      return [];
    }
  };

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "nexus-attach-"));
    process.env.NEXUS_DATA_DIR = dir;
  });
  beforeEach(async () => {
    await db.delete(attachment).where(inArray(attachment.vaultId, [v.a, v.b]));
    await rm(path.join(dir, "attachments"), { recursive: true, force: true });
    Object.assign(current, { vaultId: v.a, userId: v.userId });
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("uploads into a folder, numbers name collisions and stores identical bytes once", async () => {
    const a = await uploadAttachment(v.a, { name: "photo.png", folder: "Assets", bytes: png(1) });
    expect(a).toMatchObject({ path: "Assets/photo.png", mime: "image/png", size: 256 });
    expect((await listTree(v.a)).folders).toContain("Assets");

    // Same path, same bytes: the existing attachment.
    expect(await uploadAttachment(v.a, { name: "photo.png", folder: "Assets", bytes: png(1) })).toEqual(a);
    // Same path, other bytes: " 1", then " 2".
    expect((await uploadAttachment(v.a, { name: "photo.png", folder: "Assets", bytes: png(2) })).path).toBe("Assets/photo 1.png");
    expect((await uploadAttachment(v.a, { name: "photo.png", folder: "Assets", bytes: png(3) })).path).toBe("Assets/photo 2.png");
    // Other path, same bytes as the first: a new row, no new blob.
    expect((await uploadAttachment(v.a, { name: "copy.png", bytes: png(1) })).path).toBe("copy.png");
    expect(await blobs(v.a)).toHaveLength(3);

    // A blob goes when its last row does.
    await deleteAttachment(v.a, "Assets/photo.png");
    expect(await blobs(v.a)).toHaveLength(3);
    await deleteAttachment(v.a, "copy.png");
    expect(await blobs(v.a)).toHaveLength(2);
    expect(await status(deleteAttachment(v.a, "copy.png"))).toBe(404);
  });

  it("refuses disguised files, wrong extensions and oversize files before writing anything", async () => {
    const html = strToU8("<!doctype html><script>alert(1)</script>");
    expect(await status(uploadAttachment(v.a, { name: "x.png", bytes: html }))).toBe(415);
    expect(await status(uploadAttachment(v.a, { name: "x.pdf", bytes: png(1) }))).toBe(415);
    expect(await status(uploadAttachment(v.a, { name: "x.html", bytes: png(1) }))).toBe(415);
    expect(await status(uploadAttachment(v.a, { name: "../.png", bytes: png(1) }))).toBe(400);
    const big = png(1, ATTACHMENT_LIMITS.fileBytes + 1);
    expect(await status(uploadAttachment(v.a, { name: "big.png", bytes: big }))).toBe(413);
    expect((await listAttachments(v.a, null)).items).toEqual([]);
    expect(await blobs(v.a)).toEqual([]);
  });

  it("enforces the per-vault quota in SQL, counting a shared blob once", async () => {
    const first = await uploadAttachment(v.a, { name: "a.png", bytes: png(1) });
    // Pretend the vault already stores almost 1 GiB (rows only; the quota is counted from rows).
    await db.insert(attachment).values({
      vaultId: v.a,
      path: "huge.mp4",
      mime: "video/mp4",
      size: ATTACHMENT_LIMITS.vaultBytes - 300,
      sha256: "f".repeat(64),
    });
    expect(await status(uploadAttachment(v.a, { name: "b.png", bytes: png(2) }))).toBe(413);
    // The same bytes again under another name take no new space.
    expect(await status(uploadAttachment(v.a, { name: "again.png", bytes: png(1) }))).toBe(200);
    // Vault B is not affected by A's usage.
    expect(await status(uploadAttachment(v.b, { name: "b.png", bytes: png(2) }))).toBe(200);
    expect(first.path).toBe("a.png");
  });

  it("keeps vaults apart", async () => {
    await uploadAttachment(v.a, { name: "secret.png", bytes: png(9) });
    expect(await getAttachment(v.b, "secret.png")).toBeNull();
    expect(await status(deleteAttachment(v.b, "secret.png"))).toBe(404);
    expect((await listAttachments(v.b, null)).items).toEqual([]);
  });

  it("lists by path, a page at a time", async () => {
    for (const n of ["c", "a", "b"]) await uploadAttachment(v.a, { name: `${n}.png`, bytes: png(n.charCodeAt(0)) });
    const p1 = await listAttachments(v.a, null, 2);
    expect(p1.items.map((i) => i.path)).toEqual(["a.png", "b.png"]);
    expect(p1.next).toBe("b.png");
    const p2 = await listAttachments(v.a, p1.next, 2);
    expect(p2.items.map((i) => i.path)).toEqual(["c.png"]);
    expect(p2.next).toBeNull();
  });

  it("serves bytes with safe headers, ETag revalidation and byte ranges", async () => {
    const { GET } = await import("@/app/api/attachments/file/route");
    const up = await uploadAttachment(v.a, { name: "song.mp3", folder: "Audio", bytes: MP3 });
    const row = (await getAttachment(v.a, up.path))!;
    const at = (q: string, headers: Record<string, string> = {}) =>
      GET(new Request(`http://localhost/api/attachments/file?${q}`, { headers }));

    const full = await at(`path=${encodeURIComponent(up.path)}&v=${row.sha256.slice(0, 16)}`);
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("audio/mpeg");
    expect(full.headers.get("x-content-type-options")).toBe("nosniff");
    expect(full.headers.get("content-security-policy")).toMatch(/^sandbox/);
    expect(full.headers.get("content-disposition")).toBe(`inline; filename="song.mp3"; filename*=UTF-8''song.mp3`);
    expect(full.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(full.headers.get("etag")).toBe(`"${row.sha256}"`);
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(MP3);

    // Without the version the browser must revalidate; a matching ETag answers 304.
    const unpinned = await at(`path=${encodeURIComponent(up.path)}`);
    expect(unpinned.headers.get("cache-control")).toBe("private, no-cache");
    await unpinned.body?.cancel();
    expect((await at(`path=${encodeURIComponent(up.path)}`, { "if-none-match": `"${row.sha256}"` })).status).toBe(304);

    const part = await at(`path=${encodeURIComponent(up.path)}`, { range: "bytes=100-199" });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 100-199/${MP3.length}`);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(MP3.slice(100, 200));

    const tail = await at(`path=${encodeURIComponent(up.path)}`, { range: "bytes=-10" });
    expect(new Uint8Array(await tail.arrayBuffer())).toEqual(MP3.slice(-10));

    const bad = await at(`path=${encodeURIComponent(up.path)}`, { range: `bytes=${MP3.length}-` });
    expect(bad.status).toBe(416);
    expect(bad.headers.get("content-range")).toBe(`bytes */${MP3.length}`);

    expect((await at("path=Audio%2Fnope.mp3")).status).toBe(404);
  });

  it("serves SVG as a download, never inline", async () => {
    const { GET } = await import("@/app/api/attachments/file/route");
    const svg = strToU8('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const up = await uploadAttachment(v.a, { name: `lo"go.svg`, bytes: svg });
    const res = await GET(new Request(`http://localhost/api/attachments/file?path=${encodeURIComponent(up.path)}`));
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="logo\.svg"/);
    await res.body?.cancel();
  });

  it("uploads through the route: multipart, one file, 201 with { id, path, mime, size }", async () => {
    const { POST } = await import("@/app/api/attachments/route");
    const post = (fd: FormData) => POST(new Request("http://localhost/api/attachments", { method: "POST", body: fd }));
    const fd = new FormData();
    fd.append("file", new File([png(4)], "pasted image.png", { type: "image/png" }));
    fd.append("folder", "Inbox");
    const res = await post(fd);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["id", "mime", "path", "size"]);
    expect(body).toMatchObject({ path: "Inbox/pasted image.png", mime: "image/png", size: 256 });

    const two = new FormData();
    two.append("file", new File([png(1)], "a.png"));
    two.append("file", new File([png(2)], "b.png"));
    expect((await post(two)).status).toBe(400);

    const json = await POST(
      new Request("http://localhost/api/attachments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(json.status).toBe(415);
  });

  it("round-trips a vault with an image through export and import", async () => {
    await importVault(
      v.a,
      [{ path: "Notes/Trip.md", content: "![[beach.png]]\n![[Doc.pdf]]" }],
      [
        { path: "Assets/beach.png", data: png(5) },
        { path: "Doc.pdf", data: strToU8("%PDF-1.7\n%%EOF") },
        { path: "fake.png", data: strToU8("<html>") },
      ],
    ).then((r) => {
      expect(r.attachments).toEqual({ created: 2, updated: 0 });
      expect(r.skipped).toEqual([{ path: "fake.png", reason: expect.stringContaining("not a supported") }]);
    });

    const { GET } = await import("@/app/api/vault/export/route");
    const res = await GET(new Request("http://localhost/api/vault/export"));
    expect(res.status).toBe(200);
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(["Assets/beach.png", "Doc.pdf", "Notes/Trip.md"]);
    expect(files["Assets/beach.png"]).toEqual(png(5));

    // Into vault B: the dry run sees nothing to replace, the import writes both kinds.
    const notes = [{ path: "Notes/Trip.md", content: new TextDecoder().decode(files["Notes/Trip.md"]) }];
    const atts = [
      { path: "Assets/beach.png", data: files["Assets/beach.png"] },
      { path: "Doc.pdf", data: files["Doc.pdf"] },
    ];
    expect(await previewVaultImport(v.b, notes, atts)).toEqual({ conflicts: [], attachmentConflicts: [], total: 1, attachments: 2 });
    await importVault(v.b, notes, atts);
    expect((await listAttachments(v.b, null)).items.map((i) => i.path)).toEqual(["Assets/beach.png", "Doc.pdf"]);
    expect((await exportVault(v.b)).map((n) => n.path)).toEqual(["Notes/Trip"]);

    // Again into A: the dry run reports the attachment and the note it would replace.
    const changed = [{ path: "Assets/beach.png", data: png(6) }];
    expect(await previewVaultImport(v.a, notes, changed)).toEqual({
      conflicts: ["Assets/beach.png", "Notes/Trip"],
      attachmentConflicts: ["Assets/beach.png"],
      total: 1,
      attachments: 1,
    });
    const before = await blobs(v.a);
    const r = await importVault(v.a, [], changed);
    expect(r.attachments).toEqual({ created: 0, updated: 1 });
    // The replaced blob is collected, the new one written.
    const after = await blobs(v.a);
    expect(after).toHaveLength(before.length);
    expect(after).not.toEqual(before);
  });

  it("rolls back notes and attachments together and removes blobs it wrote", async () => {
    await db.insert(attachment).values({
      vaultId: v.a,
      path: "huge.mp4",
      mime: "video/mp4",
      size: ATTACHMENT_LIMITS.vaultBytes,
      sha256: "e".repeat(64),
    });
    const res = importVault(v.a, [{ path: "Lost.md", content: "x" }], [{ path: "over.png", data: png(7) }]);
    expect(await status(res)).toBe(413);
    expect((await listTree(v.a)).notes).toEqual([]);
    expect(await db.select().from(attachment).where(eq(attachment.path, "over.png"))).toEqual([]);
    expect(await blobs(v.a)).toEqual([]);
  });
});
