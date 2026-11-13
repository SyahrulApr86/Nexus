import { normalizePath } from "@/lib/markdown/parse";
import { LIMITS, pathProblem } from "@/lib/notes";
import { ALLOWED_EXTENSIONS, extensionOf } from "./sniff";

/**
 * Attachment paths follow the note path rules (normalizePath, then pathProblem: length, depth,
 * segment size, no "." or ".." segment) but keep their real extension, and the file name must
 * have a stem and an allowed extension (".png" alone is refused).
 */
export function normalizeAttachmentPath(raw: string, folder = ""): string {
  if (raw.length > LIMITS.rawPath || folder.length > LIMITS.rawPath) return "";
  // normalizePath strips one trailing ".md"; no allowed extension ends in it, so nothing is lost.
  return normalizePath(folder ? `${folder}/${raw}` : raw);
}

/** Why a normalised attachment path is refused, or null when it is fine. */
export function attachmentPathProblem(path: string): string | null {
  const problem = pathProblem(path);
  if (problem) return problem;
  const base = path.slice(path.lastIndexOf("/") + 1);
  const ext = extensionOf(path);
  // ".png" alone is a hidden file with no name, not a PNG.
  if (!ext && base.startsWith(".")) return "Invalid file name";
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) return "Unsupported file type";
  return null;
}

/** "a/photo.png" with n = 2 → "a/photo 2.png": the note naming rule, before the extension. */
export function numberedPath(path: string, n: number): string {
  const dot = path.lastIndexOf(".");
  return `${path.slice(0, dot)} ${n}${path.slice(dot)}`;
}
