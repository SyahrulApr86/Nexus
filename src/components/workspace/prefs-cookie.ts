/**
 * The layout-relevant preferences, mirrored into a small cookie so the server
 * renders the first paint with the sidebars the user left open or closed.
 * localStorage stays the source of truth; the cookie holds no secrets.
 * Shared by the server (vault page) and the client (store): no "use client".
 */

export const PREFS_COOKIE = "nexus-layout-prefs";
const MAX_LENGTH = 1024;

export type LeftView = "files" | "search";
export type RightView = "backlinks" | "outgoing" | "tags" | "outline" | "calendar";
export type SortOrder = "name-asc" | "name-desc" | "modified-desc" | "modified-asc";

export type LayoutPrefs = {
  leftOpen?: boolean;
  leftView?: LeftView;
  rightOpen?: boolean;
  rightView?: RightView;
  sort?: SortOrder;
};

const LEFT_VIEWS: readonly string[] = ["files", "search"];
const RIGHT_VIEWS: readonly string[] = ["backlinks", "outgoing", "tags", "outline", "calendar"];
const SORTS: readonly string[] = ["name-asc", "name-desc", "modified-desc", "modified-asc"];

/** Only known keys with valid values survive; anything else (or a broken cookie) is ignored. */
export function parsePrefsCookie(raw: string | undefined | null): LayoutPrefs {
  if (!raw || raw.length > MAX_LENGTH) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw.startsWith("%7B") ? decodeURIComponent(raw) : raw);
  } catch {
    return {};
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const d = data as Record<string, unknown>;
  const out: LayoutPrefs = {};
  if (typeof d.leftOpen === "boolean") out.leftOpen = d.leftOpen;
  if (typeof d.rightOpen === "boolean") out.rightOpen = d.rightOpen;
  if (typeof d.leftView === "string" && LEFT_VIEWS.includes(d.leftView)) out.leftView = d.leftView as LeftView;
  if (typeof d.rightView === "string" && RIGHT_VIEWS.includes(d.rightView)) out.rightView = d.rightView as RightView;
  if (typeof d.sort === "string" && SORTS.includes(d.sort)) out.sort = d.sort as SortOrder;
  return out;
}

/** Client only: write the cookie for the next server render (a year, whole site, Lax). */
export function writePrefsCookie(p: Required<LayoutPrefs>) {
  const value = encodeURIComponent(
    JSON.stringify({ leftOpen: p.leftOpen, leftView: p.leftView, rightOpen: p.rightOpen, rightView: p.rightView, sort: p.sort }),
  );
  if (value.length > MAX_LENGTH) return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  try {
    document.cookie = `${PREFS_COOKIE}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  } catch {}
}
