import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { db } from "@/db";
import { attachment, share } from "@/db/schema";
import { uploadAttachment } from "@/lib/attachments";
import { createNote } from "@/lib/notes";
import { describeDb, useVaults } from "./fixtures";

const req = vi.hoisted(() => ({ headers: new Headers({ "x-forwarded-for": "203.0.113.7" }) }));
vi.mock("next/headers", () => ({ headers: async () => req.headers }));

const { createShare, renderSharedNote, resolveShare, revokeShare, sharedAttachments } = await import("@/lib/shares");
const fileRoute = await import("@/app/s/[token]/a/[hash]/route");

const png = (seed: number) => {
  const b = new Uint8Array(256).fill(seed);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return b;
};
const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>');
const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

const get = (token: string, hash: string) =>
  fileRoute.GET(new Request(`http://app.test/s/${token}/a/${hash}`), { params: Promise.resolve({ token, hash }) });

describeDb("share page attachments", () => {
  const v = useVaults();
  let dir = "";
  let token = "";
  const sha: Record<string, string> = {};

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "nexus-share-attach-"));
    process.env.NEXUS_DATA_DIR = dir;
  });
  afterAll(async () => {
    delete process.env.NEXUS_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  });

  async function setup() {
    await db.delete(attachment).where(eq(attachment.vaultId, v.a));
    for (const [name, folder, bytes] of [
      ["cover.png", "Assets", png(1)],
      ["diagram.svg", "Assets", svg],
      ["guide.pdf", "Assets", pdf],
      ["private.png", "Secret", png(2)],
    ] as const) {
      await uploadAttachment(v.a, { name, folder, bytes });
    }
    const rows = await db.select({ path: attachment.path, sha256: attachment.sha256 }).from(attachment).where(eq(attachment.vaultId, v.a));
    for (const r of rows) sha[r.path] = r.sha256;
    const n = await createNote(
      v.a,
      "Shared/Field notes",
      "# Field notes\n\n![[cover.png|300]]\n\n![[diagram.svg]]\n\n[[guide.pdf]]\n\n![[missing.png]]\n\nSee [[#Later]] and [[Field notes#^tide]].\n\n## Later\n\nTide text. ^tide\n\nFormula $a^2$.\n",
    );
    token = (await createShare(v.a, n.id)).token;
  }

  it("resolves only the attachments the shared note names, with token-bound URLs", async () => {
    await setup();
    const shared = (await resolveShare(token))!;
    expect(shared.vaultId).toBe(v.a);
    const { lookup, files } = await sharedAttachments(token, shared);
    expect([...files.keys()].sort()).toEqual([sha["Assets/cover.png"], sha["Assets/diagram.svg"], sha["Assets/guide.pdf"]].sort());
    expect(files.has(sha["Secret/private.png"])).toBe(false);
    expect(lookup("private.png")).toBeNull();
    expect(lookup("cover.png")?.url).toBe(`/s/${token}/a/${sha["Assets/cover.png"]}`);

    const html = renderSharedNote(shared.content, { name: shared.name, attachments: lookup });
    expect(html).toContain(`<img src="/s/${token}/a/${sha["Assets/cover.png"]}" alt="cover" loading="lazy" decoding="async" width="300">`);
    expect(html).toContain(`src="/s/${token}/a/${sha["Assets/diagram.svg"]}"`);
    // Non-images are downloads, never players or new-tab cards.
    expect(html).toMatch(new RegExp(`<a href="/s/${token}/a/${sha["Assets/guide.pdf"]}" download="guide.pdf">guide.pdf</a>`));
    expect(html).not.toContain("/api/attachments/file");
    expect(html).toContain('<span class="share-link">↳ missing.png</span>');
    // Heading and block links into the note itself jump within the page; ids stay hidden.
    expect(html).toContain('<a class="share-anchor" href="#h-later">Later</a>');
    expect(html).toContain('<a class="share-anchor" href="#b-tide">Field notes › ^tide</a>');
    expect(html).toContain('<p data-block="tide" id="b-tide">Tide text.</p>');
    // Math is rendered on the server.
    expect(html).toContain('class="katex"');
    expect(html).not.toContain("math-inline");
  });

  it("serves a named file with the attachment rules, and 404s everything else", async () => {
    await setup();
    const ok = await get(token, sha["Assets/cover.png"]);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    expect(ok.headers.get("content-security-policy")).toMatch(/^sandbox/);
    expect(ok.headers.get("content-disposition")).toMatch(/^inline; filename="cover.png"/);
    expect(ok.headers.get("referrer-policy")).toBe("no-referrer");
    expect(ok.headers.get("x-robots-tag")).toContain("noindex");
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(png(1));

    const svgRes = await get(token, sha["Assets/diagram.svg"]);
    expect(svgRes.status).toBe(200);
    expect(svgRes.headers.get("content-disposition")).toMatch(/^attachment;/);

    // A file of the same vault the note does not name, a malformed hash, a wrong token.
    expect((await get(token, sha["Secret/private.png"])).status).toBe(404);
    expect((await get(token, "abc")).status).toBe(404);
    expect((await get("x".repeat(43), sha["Assets/cover.png"])).status).toBe(404);

    // A revoked link stops serving at once.
    const [row] = await db.select({ id: share.id }).from(share).where(eq(share.vaultId, v.a)).limit(1);
    await revokeShare(v.userId, row.id);
    expect((await get(token, sha["Assets/cover.png"])).status).toBe(404);
  });
});
