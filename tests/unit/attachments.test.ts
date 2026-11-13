import { describe, expect, it } from "vitest";
import { attachmentPathProblem, normalizeAttachmentPath, numberedPath } from "@/lib/attachments/path";
import { checkFile, extensionOf, servedInline, sniffType } from "@/lib/attachments/sniff";
import { attachmentUrl, createAttachmentLookup } from "@/lib/markdown/attachments";
import { renderMarkdown } from "@/lib/markdown/render";

const bytes = (...parts: (string | number[])[]) => {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === "string") for (const c of p) out.push(c.charCodeAt(0));
    else out.push(...p);
  }
  return new Uint8Array(out);
};
const pad = (b: Uint8Array, n = 64) => {
  const out = new Uint8Array(Math.max(n, b.length));
  out.set(b);
  return out;
};

const PNG = pad(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const JPEG = pad(bytes([0xff, 0xd8, 0xff, 0xe0]));
const GIF = pad(bytes("GIF89a"));
const WEBP = pad(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "));
const WAV = pad(bytes("RIFF", [0, 0, 0, 0], "WAVEfmt "));
const PDF = pad(bytes("%PDF-1.7\n"));
const OGG = pad(bytes("OggS"));
const MP3_ID3 = pad(bytes("ID3", [4, 0]));
const MP3_SYNC = pad(bytes([0xff, 0xfb, 0x90, 0x00]));
const ftyp = (major: string, ...compatible: string[]) =>
  pad(bytes([0, 0, 0, 16 + 4 * compatible.length], "ftyp", major, [0, 0, 0, 0], ...compatible));
const AVIF = ftyp("avif", "mif1", "miaf");
const MP4 = ftyp("isom", "isom", "iso2", "avc1", "mp41");
const M4A = ftyp("M4A ", "M4A ", "mp42", "isom");
const WEBM = pad(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84], "webm"));
const MKV = pad(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x88], "matroska"));
const SVG = new TextEncoder().encode('<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = new TextEncoder().encode("<!doctype html><html><script>alert(document.cookie)</script></html>");

describe("sniffType", () => {
  it.each([
    ["png", PNG, "png"],
    ["jpeg", JPEG, "jpg"],
    ["gif", GIF, "gif"],
    ["webp", WEBP, "webp"],
    ["wav", WAV, "wav"],
    ["pdf", PDF, "pdf"],
    ["ogg", OGG, "ogg"],
    ["mp3", MP3_ID3, "mp3"],
    ["mp3", MP3_SYNC, "mp3"],
    ["avif", AVIF, "avif"],
    ["mp4", MP4, "mp4"],
    ["m4a", M4A, "m4a"],
    ["m4a", MP4, "m4a"],
    ["webm", WEBM, "webm"],
    ["svg", SVG, "svg"],
  ] as const)("recognises %s", (type, data, ext) => {
    expect(sniffType(data, ext)).toBe(type);
  });

  it("refuses HTML, Matroska that is not WebM, plain text and empty files", () => {
    expect(sniffType(HTML, "png")).toBeNull();
    expect(sniffType(MKV, "webm")).toBeNull();
    expect(sniffType(new TextEncoder().encode("hello"), "png")).toBeNull();
    expect(sniffType(new Uint8Array(0), "png")).toBeNull();
  });

  it("does not take an SVG that only mentions <svg> later in an HTML page", () => {
    expect(sniffType(new TextEncoder().encode("<html><body><svg></svg></body></html>"), "svg")).toBeNull();
  });
});

describe("checkFile", () => {
  it("accepts a file whose bytes and extension agree", () => {
    expect(checkFile(PNG, "a/photo.PNG")).toEqual({ ok: true, type: "png", mime: "image/png", kind: "image" });
    expect(checkFile(JPEG, "photo.jpeg")).toMatchObject({ ok: true, mime: "image/jpeg" });
    expect(checkFile(M4A, "voice.m4a")).toMatchObject({ ok: true, mime: "audio/mp4", kind: "audio" });
    expect(checkFile(MP4, "clip.mp4")).toMatchObject({ ok: true, mime: "video/mp4", kind: "video" });
  });

  it("refuses HTML disguised as a PNG and a PNG named like a PDF", () => {
    expect(checkFile(HTML, "innocent.png")).toMatchObject({ ok: false });
    expect(checkFile(PNG, "report.pdf")).toEqual({ ok: false, reason: "The file is a PNG, not a .pdf file" });
    expect(checkFile(M4A, "clip.mp4")).toMatchObject({ ok: false });
  });

  it("refuses extensions outside the allowlist, whatever the bytes", () => {
    expect(checkFile(PNG, "page.html")).toMatchObject({ ok: false, reason: ".html files can’t be attached" });
    expect(checkFile(PNG, "noext")).toMatchObject({ ok: false });
    expect(checkFile(SVG, "x.svgz")).toMatchObject({ ok: false });
  });

  it("serves SVG as a download and everything else inline", () => {
    expect(checkFile(SVG, "logo.svg")).toMatchObject({ ok: true, mime: "image/svg+xml" });
    expect(servedInline("image/svg+xml")).toBe(false);
    expect(servedInline("text/html")).toBe(false);
    for (const mime of ["image/png", "application/pdf", "audio/mpeg", "video/webm"]) expect(servedInline(mime)).toBe(true);
  });
});

describe("attachment paths", () => {
  it("normalises like notes but keeps the extension", () => {
    expect(extensionOf("a.b/photo.JPG")).toBe("jpg");
    expect(extensionOf(".png")).toBe("");
    expect(normalizeAttachmentPath("photo.png", "Assets/2026")).toBe("Assets/2026/photo.png");
    expect(normalizeAttachmentPath("../../etc/passwd.png")).toBe("etc/passwd.png");
    expect(normalizeAttachmentPath("..\\..\\win\\x.png")).toBe("win/x.png");
    expect(normalizeAttachmentPath('na"me<>|?*.png')).toBe("name.png");
    expect(normalizeAttachmentPath("x".repeat(501))).toBe("");
  });

  it("refuses names without a stem or an allowed extension, and paths over the note limits", () => {
    expect(attachmentPathProblem("photo.png")).toBeNull();
    expect(attachmentPathProblem("a/.png")).toBe("Invalid file name");
    expect(attachmentPathProblem("a/page.html")).toBe("Unsupported file type");
    expect(attachmentPathProblem("a/../b.png")).toBe("Invalid path");
    expect(attachmentPathProblem(`${"d/".repeat(40)}x.png`)).toBe("Path is nested too deeply");
    expect(attachmentPathProblem(`${"x".repeat(256)}.png`)).toBe("A path segment is too long");
  });

  it("numbers a taken name before the extension, like notes", () => {
    expect(numberedPath("a/photo.png", 1)).toBe("a/photo 1.png");
    expect(numberedPath("a.b/photo.tar.png", 2)).toBe("a.b/photo.tar 2.png");
  });
});

const SHA = (c: string) => c.repeat(64);
const lookup = createAttachmentLookup([
  { path: "Assets/photo.png", mime: "image/png", sha256: SHA("a") },
  { path: "Deep/er/photo.png", mime: "image/png", sha256: SHA("b") },
  { path: "sub/file name.png", mime: "image/png", sha256: SHA("c") },
  { path: "docs/Doc.pdf", mime: "application/pdf", sha256: SHA("d") },
  { path: "a/song.mp3", mime: "audio/mpeg", sha256: SHA("e") },
  { path: "clip.webm", mime: "video/webm", sha256: SHA("f") },
  { path: "logo.svg", mime: "image/svg+xml", sha256: SHA("1") },
  { path: `q"uo'te.png`, mime: "image/png", sha256: SHA("2") },
]);
const render = (md: string, l = lookup) => renderMarkdown(md, () => true, l);
const url = (path: string, sha: string) => `/api/attachments/file?path=${encodeURIComponent(path)}&#x26;v=${sha.slice(0, 16)}`;

describe("createAttachmentLookup", () => {
  it("resolves the exact path first, then the shortest path with that file name", () => {
    expect(lookup("Deep/er/photo.png")?.path).toBe("Deep/er/photo.png");
    expect(lookup("photo.png")?.path).toBe("Assets/photo.png");
    expect(lookup("PHOTO.png")?.path).toBe("Assets/photo.png");
    expect(lookup("er/photo.png")?.path).toBe("Deep/er/photo.png");
    expect(lookup("other/photo.png")).toBeNull();
    expect(lookup("./sub/file name.png")?.path).toBe("sub/file name.png");
    expect(lookup("nothing.png")).toBeNull();
  });

  it("builds a same-origin URL pinned to the content", () => {
    expect(attachmentUrl({ path: "a b/c.png", mime: "image/png", sha256: SHA("a") })).toBe(
      `/api/attachments/file?path=a%20b%2Fc.png&v=${"a".repeat(16)}`,
    );
  });
});

describe("renderMarkdown with attachments", () => {
  it("renders ![[image]], sizes and markdown images as lazy <img>", () => {
    const u = url("Assets/photo.png", SHA("a"));
    expect(render("![[photo.png]]")).toBe(`<p><img src="${u}" alt="photo" loading="lazy" decoding="async"></p>`);
    expect(render("![[photo.png|300]]")).toContain(`<img src="${u}" alt="photo" loading="lazy" decoding="async" width="300">`);
    expect(render("![[photo.png|300x200]]")).toContain('width="300" height="200"');
    expect(render("![[photo.png|A sunset]]")).toContain('alt="A sunset"');
    expect(render("![alt](photo.png)")).toContain(`<img src="${u}" alt="alt"`);
    expect(render("![alt](sub/file%20name.png)")).toContain(`src="${url("sub/file name.png", SHA("c"))}"`);
    expect(render("![alt](<sub/file name.png>)")).toContain(`src="${url("sub/file name.png", SHA("c"))}"`);
  });

  it("renders audio and video with controls, and a PDF as a card that opens in a new tab", () => {
    expect(render("![[song.mp3]]")).toContain(
      `<audio controls preload="metadata" src="${url("a/song.mp3", SHA("e"))}" aria-label="song.mp3">`,
    );
    expect(render("![[clip.webm|480]]")).toContain(
      `<video controls preload="metadata" playsinline src="${url("clip.webm", SHA("f"))}" aria-label="clip.webm" width="480">`,
    );
    expect(render("![[Doc.pdf#page=2]]")).toBe(
      `<p><a href="${url("docs/Doc.pdf", SHA("d"))}#page=2" class="attachment-card" target="_blank" rel="noopener">` +
        '<span class="attachment-name">Doc.pdf</span><span class="attachment-meta">PDF, opens in a new tab</span></a></p>',
    );
    expect(render("[[Doc.pdf|the spec]]")).toBe(
      `<p><a href="${url("docs/Doc.pdf", SHA("d"))}" target="_blank" rel="noopener">the spec</a></p>`,
    );
    expect(render("[spec](docs/Doc.pdf)")).toContain(`href="${url("docs/Doc.pdf", SHA("d"))}" target="_blank"`);
  });

  it("shows an unresolved attachment as an inert ghost, never a link that would create a note", () => {
    const html = render("![[missing.png]] ![lost](gone/x.png)");
    expect(html).toBe(
      '<p><span class="ghost-attachment" data-attachment-missing="missing.png">missing.png</span> ' +
        '<span class="ghost-attachment" data-attachment-missing="gone/x.png">lost</span></p>',
    );
    // Without a lookup every attachment is missing.
    expect(renderMarkdown("![[photo.png]]", () => true)).toContain('class="ghost-attachment"');
  });

  it("turns remote images into links, so a note cannot load a tracker", () => {
    const html = render("![pixel](https://tracker.example/p.gif) ![](http://x.example/i.png)");
    expect(html).not.toContain("<img");
    expect(html).toContain('<a href="https://tracker.example/p.gif" class="external-image">pixel</a>');
    expect(html).toContain('<a href="http://x.example/i.png" class="external-image">http://x.example/i.png</a>');
  });

  it("never points an image at another same-origin URL or a script URL", () => {
    const html = render("![](/api/vault/export) ![](javascript:alert(1)) ![](data:image/svg+xml,<svg>) ![](//evil.example/x.png)");
    expect(html).not.toMatch(/src="(?!\/api\/attachments\/file\?)/);
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("/api/vault/export");
  });

  it("renders SVG through <img> only (no script runs in an image)", () => {
    expect(render("![[logo.svg]]")).toBe(`<p><img src="${url("logo.svg", SHA("1"))}" alt="logo" loading="lazy" decoding="async"></p>`);
  });

  it("escapes quotes and markup in file names and alt text", () => {
    const html = render(`![[q"uo'te.png|x" onerror="alert(1)]]`);
    expect(html).toContain(`src="/api/attachments/file?path=q%22uo&#x27;te.png&#x26;v=${"2".repeat(16)}"`);
    expect(html).toContain('alt="x&#x22; onerror=&#x22;alert(1)"');
    // Every attribute value is quoted with '"' escaped, so the alt text cannot add an attribute.
    const attrs = [.../<img((?:\s[a-z-]+="[^"]*")*)>/.exec(html)![1].matchAll(/\s([a-z-]+)="/g)].map((m) => m[1]);
    expect(attrs).toEqual(["src", "alt", "loading", "decoding"]);
    const ghost = render('![[<img src=x onerror=alert(1)>.png]]');
    // Outside attribute values (where "<" is inert) there is no tag but the ghost's own.
    expect(ghost.replace(/="[^"]*"/g, '=""')).not.toContain("<img");
    expect(ghost).toContain("&#x3C;img src=x onerror=alert(1)>.png");
  });

  it("leaves note embeds and ordinary links alone", () => {
    expect(render("![[Note]]")).toContain('class="embed"');
    expect(render("[[Note]]")).toBe('<p><a href="wikilink:Note">Note</a></p>');
    expect(render("[site](https://example.com)")).toBe('<p><a href="https://example.com">site</a></p>');
  });
});
