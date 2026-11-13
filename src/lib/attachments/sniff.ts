/**
 * What an uploaded file really is, from its first bytes ("magic numbers"), never from the name or
 * the Content-Type the client sent. A file is accepted only when the sniffed type is on the
 * allowlist AND its extension belongs to that type, so `evil.html` renamed `evil.png` (or a PNG
 * named `x.pdf`) is refused. Pure and dependency-free: shared by the upload route, the vault
 * import and the unit tests.
 */

export type AttachmentKind = "image" | "pdf" | "audio" | "video";

export type FileType = {
  mime: string;
  kind: AttachmentKind;
  /** Extensions (lowercase, no dot) a file of this type may carry. */
  exts: readonly string[];
  /**
   * Served with `Content-Disposition: attachment` even though it is an image: SVG is a document
   * that can carry script, so it is never shown inline at its own URL. `<img>` still displays it
   * (images never run script).
   */
  download?: boolean;
};

export const FILE_TYPES = {
  png: { mime: "image/png", kind: "image", exts: ["png"] },
  jpeg: { mime: "image/jpeg", kind: "image", exts: ["jpg", "jpeg"] },
  gif: { mime: "image/gif", kind: "image", exts: ["gif"] },
  webp: { mime: "image/webp", kind: "image", exts: ["webp"] },
  avif: { mime: "image/avif", kind: "image", exts: ["avif"] },
  svg: { mime: "image/svg+xml", kind: "image", exts: ["svg"], download: true },
  pdf: { mime: "application/pdf", kind: "pdf", exts: ["pdf"] },
  mp3: { mime: "audio/mpeg", kind: "audio", exts: ["mp3"] },
  m4a: { mime: "audio/mp4", kind: "audio", exts: ["m4a"] },
  ogg: { mime: "audio/ogg", kind: "audio", exts: ["ogg"] },
  wav: { mime: "audio/wav", kind: "audio", exts: ["wav"] },
  mp4: { mime: "video/mp4", kind: "video", exts: ["mp4"] },
  webm: { mime: "video/webm", kind: "video", exts: ["webm"] },
} as const satisfies Record<string, FileType>;

export type FileTypeId = keyof typeof FILE_TYPES;

/** Every extension that may be uploaded, lowercase, no dot. */
export const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set(
  Object.values(FILE_TYPES).flatMap((t) => [...t.exts]),
);

/** Lowercase extension of the last path segment, without the dot; "" when there is none. */
export function extensionOf(name: string): string {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

const ascii = (b: Uint8Array, from: number, to: number) => {
  let s = "";
  for (let i = from; i < Math.min(to, b.length); i++) s += String.fromCharCode(b[i]);
  return s;
};

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0) =>
  b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);

/** ISO base media (MP4 family) brands: the major brand and the compatible brands of the `ftyp` box. */
function ftypBrands(b: Uint8Array): string[] | null {
  if (b.length < 12 || ascii(b, 4, 8) !== "ftyp") return null;
  const size = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  const end = Math.min(size >= 16 ? size : 12, b.length, 4096);
  const brands = [ascii(b, 8, 12)];
  for (let at = 16; at + 4 <= end; at += 4) brands.push(ascii(b, at, at + 4));
  return brands;
}

const AVIF_BRANDS = new Set(["avif", "avis"]);
/** Brands of audio-only or general MP4 files that an .m4a may carry. */
const M4A_BRANDS = new Set(["M4A ", "M4B ", "mp42", "mp41", "isom", "iso2", "dash"]);
const MP4_BRANDS = new Set(["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "dash", "M4V ", "mmp4", "MSNV", "f4v "]);

/** "<svg" root after an optional BOM, XML declaration, comments and doctype. */
function looksLikeSvg(b: Uint8Array): boolean {
  const head = new TextDecoder("utf-8", { fatal: false }).decode(b.subarray(0, 4096)).replace(/^﻿/, "");
  let rest = head.trimStart();
  for (let guard = 0; guard < 32; guard++) {
    const prolog = /^(?:<\?xml[^>]*\?>|<!--[\s\S]*?-->|<!DOCTYPE\s+svg[^>]*>)/i.exec(rest);
    if (!prolog) break;
    rest = rest.slice(prolog[0].length).trimStart();
  }
  return /^<svg[\s>/]/i.test(rest);
}

/**
 * The type of `bytes` by signature, or null when it matches nothing on the allowlist. `ext` only
 * decides between types that share a container (an MP4 file is audio as .m4a, video as .mp4).
 */
export function sniffType(bytes: Uint8Array, ext = ""): FileTypeId | null {
  const b = bytes;
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "jpeg";
  if (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a") return "gif";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WAVE") return "wav";
  if (ascii(b, 0, 5) === "%PDF-") return "pdf";
  if (ascii(b, 0, 4) === "OggS") return "ogg";
  if (ascii(b, 0, 3) === "ID3") return "mp3";
  // MPEG audio frame sync (11 set bits), layer bits not "reserved".
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0) return "mp3";
  if (startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) {
    // EBML: Matroska or WebM; only the WebM doc type is on the list.
    return ascii(b, 0, 64).includes("webm") ? "webm" : null;
  }
  const brands = ftypBrands(b);
  if (brands) {
    if (brands.some((x) => AVIF_BRANDS.has(x))) return "avif";
    if (brands[0] === "M4A " || brands[0] === "M4B ") return "m4a";
    if (ext === "m4a" && brands.some((x) => M4A_BRANDS.has(x))) return "m4a";
    if (brands.some((x) => MP4_BRANDS.has(x))) return ext === "m4a" ? "m4a" : "mp4";
    return null;
  }
  if (looksLikeSvg(b)) return "svg";
  return null;
}

export type SniffResult = { ok: true; type: FileTypeId; mime: string; kind: AttachmentKind } | { ok: false; reason: string };

/**
 * Accepts `bytes` named `name` when its sniffed type is allowed and the extension matches it.
 * The reasons are user-facing (English, sentence case).
 */
export function checkFile(bytes: Uint8Array, name: string): SniffResult {
  const ext = extensionOf(name);
  if (!ALLOWED_EXTENSIONS.has(ext))
    return { ok: false, reason: ext ? `.${ext} files can’t be attached` : "The file needs an extension, like .png" };
  const type = sniffType(bytes, ext);
  if (!type) return { ok: false, reason: "The file’s contents are not a supported image, PDF, audio or video file" };
  const info: FileType = FILE_TYPES[type];
  if (!info.exts.includes(ext)) return { ok: false, reason: `The file is a ${type.toUpperCase()}, not a .${ext} file` };
  return { ok: true, type, mime: info.mime, kind: info.kind };
}

/** Whether a stored mime type is shown inline at its own URL (images except SVG, PDF, audio, video). */
export function servedInline(mime: string): boolean {
  const t = Object.values(FILE_TYPES).find((x) => x.mime === mime) as FileType | undefined;
  return !!t && !t.download;
}
