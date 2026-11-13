import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { createAttachmentLookup } from "@/lib/markdown/attachments";
import { renderMarkdown } from "@/lib/markdown/render";
import {
  DEFAULT_ATTACHMENT_SETTINGS,
  attachmentRowPath,
  attachmentTreeRows,
  cleanFolder,
  embedInsert,
  embedLink,
  formatSize,
  isAttachmentRow,
  parseSettings,
  uploadFolder,
  uploadName,
  uploadingLabel,
} from "@/components/workspace/attachments/model";
import {
  addPlaceholders,
  finishUpload,
  placeholders,
  uploadPlaceholders,
} from "@/components/workspace/attachments/upload-field";
import { imageAlt, wikiEmbedParts } from "@/components/workspace/attachments/image-embeds";
import { frontmatterEnd } from "@/components/workspace/live-preview";

describe("attachment settings", () => {
  it("defaults to an Attachments folder, shown in the explorer", () => {
    expect(parseSettings(null)).toEqual({ location: "folder", folder: "Attachments", show: true });
    expect(parseSettings({ location: "elsewhere", folder: 3, show: "yes" })).toEqual(DEFAULT_ATTACHMENT_SETTINGS);
  });

  it("cleans the folder name", () => {
    expect(cleanFolder(" /Assets//img/ ")).toBe("Assets/img");
    expect(cleanFolder("../x/./y")).toBe("x/y");
    expect(parseSettings({ location: "folder", folder: "  /  " }).folder).toBe("Attachments");
  });

  it("picks the upload folder like Obsidian", () => {
    const s = DEFAULT_ATTACHMENT_SETTINGS;
    expect(uploadFolder({ ...s, location: "root" }, "Projects/Plan")).toBe("");
    expect(uploadFolder({ ...s, location: "note" }, "Projects/Q3/Plan")).toBe("Projects/Q3");
    expect(uploadFolder({ ...s, location: "note" }, "Inbox")).toBe("");
    expect(uploadFolder({ ...s, location: "note" }, null)).toBe("");
    expect(uploadFolder({ ...s, location: "folder", folder: "Media/" }, "Projects/Plan")).toBe("Media");
  });
});

describe("embed text", () => {
  it("embeds as a wikilink, or a markdown image when the path breaks a wikilink", () => {
    expect(embedLink("Attachments/photo.png")).toBe("![[Attachments/photo.png]]");
    expect(embedLink("a|b.png")).toBe("![](a%7Cb.png)");
    expect(embedLink("Shots/#1 [draft].png")).toBe("![](Shots/%231%20%5Bdraft%5D.png)");
  });

  it("the markdown fallback still resolves in the reading view", () => {
    const lookup = createAttachmentLookup([{ path: "Shots/#1 [draft].png", mime: "image/png" }]);
    const html = renderMarkdown(embedLink("Shots/#1 [draft].png"), () => false, lookup);
    expect(html).toContain('src="/api/attachments/file?path=Shots%2F%231%20%5Bdraft%5D.png"');
  });

  it("puts each file of a batch on its own line", () => {
    expect(embedInsert("a.png", 0)).toBe("![[a.png]]");
    expect(embedInsert("b.png", 1)).toBe("\n![[b.png]]");
  });

  it("gives an embed its own line at the start of a line with text", () => {
    expect(embedInsert("a.png", 0, { lineStart: true, restOfLine: "# Heading" })).toBe("![[a.png]]\n");
    expect(embedInsert("b.png", 1, { lineStart: true, restOfLine: "# Heading" })).toBe("![[b.png]]\n");
    expect(embedInsert("a.png", 0, { lineStart: true, restOfLine: "" })).toBe("![[a.png]]");
    expect(embedInsert("a.png", 0, { lineStart: false, restOfLine: " end" })).toBe("![[a.png]]");
  });

  it("names pasted screenshots with a timestamp, keeps real names", () => {
    const now = new Date(2026, 10, 14, 9, 5, 7);
    expect(uploadName("image.png", "image/png", true, now)).toBe("Pasted image 20261114090507.png");
    expect(uploadName("", "image/jpeg", true, now)).toBe("Pasted image 20261114090507.jpg");
    expect(uploadName("image.png", "image/png", false, now)).toBe("image.png");
    expect(uploadName("diagram.png", "image/png", true, now)).toBe("diagram.png");
  });

  it("labels the placeholder and sizes", () => {
    expect(uploadingLabel("photo.png")).toBe("Uploading photo.png…");
    expect(formatSize(1)).toBe("1 byte");
    expect(formatSize(2048)).toBe("2 KB");
    expect(formatSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});

describe("explorer rows", () => {
  it("shapes attachments like notes, keyed apart from note ids", () => {
    const rows = attachmentTreeRows([{ id: "1", path: "Attachments/photo.png", mime: "image/png", size: 3, createdAt: "2026-11-01T00:00:00Z" }]);
    expect(rows).toEqual([{ id: "att:Attachments/photo.png", path: "Attachments/photo.png", name: "photo.png", updatedAt: "2026-11-01T00:00:00Z" }]);
    expect(isAttachmentRow(rows[0].id)).toBe(true);
    expect(isAttachmentRow("0b7c1f9e-0000-4000-8000-000000000000")).toBe(false);
    expect(attachmentRowPath(rows[0].id)).toBe("Attachments/photo.png");
  });
});

describe("upload placeholders", () => {
  const start = (doc: string, files: { id: number; name: string; pos: number }[]) =>
    EditorState.create({ doc, extensions: [uploadPlaceholders] }).update({ effects: addPlaceholders.of(files) }).state;

  it("adds no text to the note while uploading", () => {
    const s = start("Hello world", [{ id: 1, name: "a.png", pos: 5 }]);
    expect(s.doc.toString()).toBe("Hello world");
    expect(placeholders(s)).toEqual([{ id: 1, pos: 5, name: "a.png" }]);
  });

  it("follows edits made before it", () => {
    let s = start("Hello world", [{ id: 1, name: "a.png", pos: 6 }]);
    s = s.update({ changes: { from: 0, insert: "Oh. " } }).state;
    expect(placeholders(s)[0].pos).toBe(10);
  });

  it("is replaced by the embed on success", () => {
    let s = start("Look: ", [{ id: 1, name: "a.png", pos: 6 }]);
    s = s.update(finishUpload(s, 1, "Attachments/a.png", 0)!).state;
    expect(s.doc.toString()).toBe("Look: ![[Attachments/a.png]]");
    expect(placeholders(s)).toEqual([]);
  });

  it("is removed without text on failure", () => {
    let s = start("Look: ", [{ id: 1, name: "a.png", pos: 6 }]);
    s = s.update(finishUpload(s, 1, null, 0)!).state;
    expect(s.doc.toString()).toBe("Look: ");
    expect(placeholders(s)).toEqual([]);
  });

  it("keeps a batch in order, one embed per line, skipping failures", () => {
    let s = start("x", [
      { id: 1, name: "a.png", pos: 1 },
      { id: 2, name: "b.pdf", pos: 1 },
      { id: 3, name: "c.png", pos: 1 },
    ]);
    s = s.update(finishUpload(s, 1, "a.png", 0)!).state;
    s = s.update(finishUpload(s, 2, null, 1)!).state;
    s = s.update(finishUpload(s, 3, "c.png", 1)!).state;
    expect(s.doc.toString()).toBe("x![[a.png]]\n![[c.png]]");
  });

  it("never glues an embed to the heading it was dropped before", () => {
    let s = start("# Plan\nBody", [
      { id: 1, name: "a.png", pos: 0 },
      { id: 2, name: "b.png", pos: 0 },
    ]);
    s = s.update(finishUpload(s, 1, "a.png", 0)!).state;
    s = s.update(finishUpload(s, 2, "b.png", 1)!).state;
    expect(s.doc.toString()).toBe("![[a.png]]\n![[b.png]]\n# Plan\nBody");
  });

  it("puts the embed after the frontmatter if the placeholder ended up inside it", () => {
    let s = start("---\ntitle: Roadmap\n---\nBody", [{ id: 1, name: "a.png", pos: 0 }]);
    s = s.update(finishUpload(s, 1, "a.png", 0, frontmatterEnd(s))!).state;
    expect(s.doc.toString()).toBe("---\ntitle: Roadmap\n---\n![[a.png]]\nBody");
    expect(placeholders(s)).toEqual([]);
  });

  it("returns null once the placeholder is gone", () => {
    const s = start("x", []);
    expect(finishUpload(s, 9, "a.png", 0)).toBeNull();
  });
});

describe("live preview image alt", () => {
  const alt = (inner: string, path = "Attachments/a.png") => {
    const { target, alt: written } = wikiEmbedParts(inner);
    return { target, ...imageAlt(written, path) };
  };

  it("falls back to the file name when only a size is written", () => {
    expect(alt("a.png|300")).toEqual({ target: "a.png", alt: "a.png", width: 300, height: undefined });
    expect(alt("a.png|300x200")).toEqual({ target: "a.png", alt: "a.png", width: 300, height: 200 });
  });

  it("uses an alias as the alt text, with or without a size", () => {
    expect(alt("a.png|Caption")).toEqual({ target: "a.png", alt: "Caption", width: undefined, height: undefined });
    expect(alt("a.png|Site plan|300")).toEqual({ target: "a.png", alt: "Site plan", width: 300, height: undefined });
  });

  it("uses the file name without a pipe, and markdown alt as written", () => {
    expect(alt("a.png")).toEqual({ target: "a.png", alt: "a.png", width: undefined, height: undefined });
    expect(imageAlt("Floor plan|640", "b.png")).toEqual({ alt: "Floor plan", width: 640, height: undefined });
  });
});
