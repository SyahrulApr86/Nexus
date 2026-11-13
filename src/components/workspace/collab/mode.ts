/**
 * Live collaboration: the rules for switching a note between live mode (bound to the collab
 * service, collab/README.md) and REST autosave. Pure functions, so every switch is unit-tested
 * without a socket (tests/unit/collab-editor.test.ts).
 */
import { simpleDiffString } from "lib0/diff";

/** Delete `remove` characters at `index`, then insert `insert` (UTF-16 offsets, like Y.Text and CodeMirror). */
export type Splice = { index: number; remove: number; insert: string };

/** One splice that turns `from` into `to`, or none when they are equal. */
export function diff(from: string, to: string): Splice[] {
  if (from === to) return [];
  return [simpleDiffString(from, to)];
}

export function applySplices(text: string, splices: Splice[]): string {
  let out = text;
  for (const s of splices) out = out.slice(0, s.index) + s.insert + out.slice(s.index + s.remove);
  return out;
}

/**
 * The service URL for one note, or null when live mode is off.
 *
 * `configured` is NEXT_PUBLIC_COLLAB_URL (ws:// or wss://, no path needed). Without it the service is
 * expected behind the same origin at /collab (the reverse proxy in collab/README.md), so the page's
 * own origin is used with the matching ws/wss scheme. Anything that is not a ws(s) or http(s) URL
 * turns live mode off rather than guessing.
 */
export function collabUrl(configured: string | undefined, page: { protocol: string; host: string }): string | null {
  const raw = configured?.trim();
  if (raw) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return null;
    }
    const scheme = u.protocol === "https:" ? "wss:" : u.protocol === "http:" ? "ws:" : u.protocol;
    if (scheme !== "ws:" && scheme !== "wss:") return null;
    const path = u.pathname.replace(/\/+$/, "");
    return `${scheme}//${u.host}${path.endsWith("/collab") ? path : `${path}/collab`}`;
  }
  if (!page.host) return null;
  return `${page.protocol === "https:" ? "wss:" : "ws:"}//${page.host}/collab`;
}

/** What a closed socket means for the editor (close codes from collab/README.md). */
export type CloseAction =
  /** 4401: the session ended. Stop; the REST save path shows the existing "signed out" flow. */
  | "signed-out"
  /** 4404: the note was deleted. Stop; the REST save path shows the existing deleted-note flow. */
  | "deleted"
  /** 4413, 1009: the note would pass 5 MiB. Stop for this note; REST answers with its own limit. */
  | "too-large"
  /** Anything else (1001 deploy, 4408 idle, 1006 network, refused handshake): REST meanwhile, reconnect with backoff. */
  | "reconnect";

export function closeAction(code: number): CloseAction {
  if (code === 4401) return "signed-out";
  if (code === 4404) return "deleted";
  if (code === 4413 || code === 1009) return "too-large";
  return "reconnect";
}

/** Reconnect delay after `failures` attempts in a row: 1 s doubling to 30 s, with up to 20% jitter. */
export function backoff(failures: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, failures - 1));
  return Math.round(base * (1 + 0.2 * random()));
}

/**
 * REST to live: the text to put in the shared document before the editor binds to it.
 *
 * - `server`: the note text the REST path last saw on the server (its save base).
 * - `doc`: the shared text just synced from the service.
 * - `editor`: what this editor shows, which may hold edits the REST path never saved.
 *
 * Without local edits the editor simply takes the document. With them, the local change (from
 * `server` to `editor`) is replayed onto the document, so edits made by others in the meantime stay
 * too; when both touch the same place the local text wins, like a later save does. Never loses
 * what this device typed.
 */
export function seedSplices(server: string | undefined, doc: string, editor: string): Splice[] {
  if (editor === doc || editor === server) return [];
  // No known base: keep what this device shows rather than guess.
  if (server === undefined || doc === server) return diff(doc, editor);
  const theirs = simpleDiffString(server, doc);
  const mine = simpleDiffString(server, editor);
  const theirsEnd = theirs.index + theirs.remove;
  // Wholly before the document's change: offsets are unchanged (an insert at the same point goes first).
  if (mine.index + mine.remove <= theirs.index) return [mine];
  // Wholly after it: shift by what the document's change added or removed.
  if (mine.index >= theirsEnd) return [{ ...mine, index: mine.index + theirs.insert.length - theirs.remove }];
  // Overlapping: the local text wins.
  return diff(doc, editor);
}

/**
 * Live to REST: does the editor's text need a REST save?
 * `server` is the note text a fresh GET returned (undefined when it could not be fetched).
 */
export function needsRestSave(text: string, server: string | undefined): boolean {
  return server === undefined || text !== server;
}

/** The number of people on a note, said the way the view header says it. */
export function presenceLabel(count: number): string {
  return count === 1 ? "Only you here" : `${count} people here`;
}

/** Palette slots for presence colours (globals.css, collab block). */
export const PRESENCE_SLOTS = 6;

/** A stable colour slot per name, so one person keeps one colour on every device. */
export function presenceSlot(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return (Math.abs(h) % PRESENCE_SLOTS) + 1;
}

/** Awareness colours as CSS custom properties, so remote cursors follow the theme. */
export function presenceColors(slot: number): { color: string; colorLight: string } {
  const n = Math.min(PRESENCE_SLOTS, Math.max(1, Math.round(slot) || 1));
  return { color: `var(--collab-${n})`, colorLight: `var(--collab-${n}-soft)` };
}

/** Only our own colour values are rendered: anything else in a remote awareness state falls back to slot 1. */
export function safeColor(value: unknown): string {
  return typeof value === "string" && /^var\(--collab-[1-6](-soft)?\)$/.test(value) ? value : "var(--collab-1)";
}

/** Up to two initials for an avatar. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = [...parts[0]][0] ?? "";
  const last = parts.length > 1 ? ([...parts[parts.length - 1]][0] ?? "") : "";
  return (first + last).toUpperCase();
}
