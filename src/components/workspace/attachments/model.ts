/**
 * Attachments in the workspace: pure helpers shared by the explorer, the editor (paste and drop
 * uploads), the reading view and the attachment tab. No React, no DOM, so they are unit tested
 * (tests/unit/attachments-ui.test.ts).
 */
import { kindOf, type AttachmentKind } from "@/lib/markdown/attachments";

/** One stored attachment, as GET /api/attachments lists it. */
export type AttachmentItem = {
  id: string;
  path: string;
  mime: string;
  size: number;
  sha256?: string;
  createdAt?: string;
};

/** A tab showing one attachment (store.tsx View). */
export type AttachmentView = { type: "attachment"; path: string };

/** Where a pasted or dropped file goes, like Obsidian's "Default location for new attachments". */
export type AttachmentLocation = "root" | "note" | "folder";

export type AttachmentSettings = {
  location: AttachmentLocation;
  /** The named folder, used when `location` is "folder". */
  folder: string;
  /** List attachments in the file explorer next to the notes. */
  show: boolean;
};

export const DEFAULT_ATTACHMENT_SETTINGS: AttachmentSettings = { location: "folder", folder: "Attachments", show: true };

/** Prefix of the explorer's row keys for attachments; note ids are UUIDs and never start with it. */
export const ATTACHMENT_ROW = "att:";

export const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
export const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** Trims a folder setting to a clean vault-relative path ("/Assets/ " → "Assets"). */
export function cleanFolder(folder: string): string {
  return folder
    .split("/")
    .map((p) => p.trim())
    .filter((p) => p && p !== "." && p !== "..")
    .join("/");
}

/** Saved settings, or the defaults for anything missing or malformed. */
export function parseSettings(raw: unknown): AttachmentSettings {
  const d = DEFAULT_ATTACHMENT_SETTINGS;
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<Record<keyof AttachmentSettings, unknown>>;
  const location = r.location === "root" || r.location === "note" || r.location === "folder" ? r.location : d.location;
  const folder = typeof r.folder === "string" ? cleanFolder(r.folder) : d.folder;
  return { location, folder: folder || d.folder, show: typeof r.show === "boolean" ? r.show : d.show };
}

/**
 * The folder a new attachment is uploaded into. `notePath` is the note being edited (no ".md"),
 * when there is one; without it "same folder as the note" falls back to the vault root.
 */
export function uploadFolder(settings: AttachmentSettings, notePath?: string | null): string {
  if (settings.location === "root") return "";
  if (settings.location === "note") return notePath ? folderOf(notePath) : "";
  return cleanFolder(settings.folder) || DEFAULT_ATTACHMENT_SETTINGS.folder;
}

/** Characters that end or split a `[[wikilink]]`; a path with one is embedded as a markdown image. */
const WIKI_UNSAFE = /[[\]|#^]/;

/**
 * The embed for an uploaded file. `![[path]]` like Obsidian; a path a wikilink cannot carry
 * becomes `![](<url-encoded path>)`, which the reading view resolves the same way.
 */
export function embedLink(path: string): string {
  if (!WIKI_UNSAFE.test(path)) return `![[${path}]]`;
  return `![](${path.split("/").map(encodeURIComponent).join("/")})`;
}

/**
 * The text inserted when an upload succeeds. Several files dropped at once land one per line:
 * an embed after the first in a batch starts on a new line. At the start of a line that has text
 * (a heading, a list item) the embed gets a line of its own, so it never changes that line's meaning.
 */
export function embedInsert(path: string, insertedBefore: number, at?: { lineStart: boolean; restOfLine: string }): string {
  const own = !!at?.lineStart && at.restOfLine.length > 0;
  const lead = insertedBefore > 0 && !at?.lineStart ? "\n" : "";
  return `${lead}${embedLink(path)}${own ? "\n" : ""}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The name a file is uploaded under. A screenshot pasted from the clipboard arrives as
 * "image.png"; like Obsidian it becomes "Pasted image 20261114093012.png".
 */
export function uploadName(name: string, mime: string, pasted: boolean, now = new Date()): string {
  const generic = !name || /^image\.(png|jpe?g|gif|webp|avif)$/i.test(name);
  if (!pasted || !generic) return name || "file";
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : (mime.split("/")[1] ?? "png");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `Pasted image ${stamp}.${ext === "jpeg" ? "jpg" : ext}`;
}

/** "Uploading photo.png…": the inline placeholder while a file uploads. */
export const uploadingLabel = (name: string) => `Uploading ${name}…`;

export function attachmentKind(mime: string): AttachmentKind {
  return kindOf(mime);
}

/** "2.4 MB", "830 KB", "512 bytes". */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

const KIND_LABEL: Record<AttachmentKind, string> = { image: "Image", pdf: "PDF", audio: "Audio", video: "Video", file: "File" };
export const kindLabel = (mime: string) => KIND_LABEL[kindOf(mime)];

/** Explorer rows for attachments, shaped like notes so the tree sorts and nests them the same way. */
export function attachmentTreeRows(items: readonly AttachmentItem[]) {
  return items.map((a) => ({
    id: `${ATTACHMENT_ROW}${a.path}`,
    path: a.path,
    name: baseName(a.path),
    updatedAt: a.createdAt ?? new Date(0).toISOString(),
  }));
}

export const isAttachmentRow = (id: string) => id.startsWith(ATTACHMENT_ROW);
export const attachmentRowPath = (id: string) => id.slice(ATTACHMENT_ROW.length);

/** Files from a DataTransfer (paste or drop), in the order the user picked them. */
export function filesOf(data: DataTransfer | null): File[] {
  if (!data) return [];
  if (data.files?.length) return [...data.files];
  return [...(data.items ?? [])].flatMap((it) => (it.kind === "file" ? [it.getAsFile()].filter((f): f is File => !!f) : []));
}
