/**
 * Templates, as in Obsidian's core Templates plugin: notes in a template folder whose text
 * is inserted into another note, with {{title}}, {{date}} and {{time}} filled in.
 * Pure functions only; the workspace wires them to the editor and the save path.
 */

import { frontmatterRange, frontmatterSource, mergeFrontmatter } from "./markdown/frontmatter-edit";

export const DEFAULT_TEMPLATE_FOLDER = "Templates";
export const DEFAULT_DATE_FORMAT = "YYYY-MM-DD";
export const DEFAULT_TIME_FORMAT = "HH:mm";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
};

// Longest tokens first; [text] is literal, as in moment.js.
const TOKEN_RE = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|Do|DD|D|dddd|ddd|HH|H|hh|h|mm|m|ss|s|A|a/g;

/** Format a date with moment-style tokens (YYYY, MM, DD, HH, mm, ss, dddd, MMM, …). No dependency. */
export function formatDate(d: Date, format: string): string {
  return format.replace(TOKEN_RE, (tok, literal: string | undefined) => {
    if (literal !== undefined) return literal;
    const h12 = d.getHours() % 12 || 12;
    switch (tok) {
      case "YYYY":
        return pad(d.getFullYear(), 4);
      case "YY":
        return pad(d.getFullYear() % 100);
      case "MMMM":
        return MONTHS[d.getMonth()];
      case "MMM":
        return MONTHS[d.getMonth()].slice(0, 3);
      case "MM":
        return pad(d.getMonth() + 1);
      case "M":
        return String(d.getMonth() + 1);
      case "Do":
        return ordinal(d.getDate());
      case "DD":
        return pad(d.getDate());
      case "D":
        return String(d.getDate());
      case "dddd":
        return DAYS[d.getDay()];
      case "ddd":
        return DAYS[d.getDay()].slice(0, 3);
      case "HH":
        return pad(d.getHours());
      case "H":
        return String(d.getHours());
      case "hh":
        return pad(h12);
      case "h":
        return String(h12);
      case "mm":
        return pad(d.getMinutes());
      case "m":
        return String(d.getMinutes());
      case "ss":
        return pad(d.getSeconds());
      case "s":
        return String(d.getSeconds());
      case "A":
        return d.getHours() < 12 ? "AM" : "PM";
      case "a":
        return d.getHours() < 12 ? "am" : "pm";
      default:
        return tok;
    }
  });
}

export type TemplateContext = {
  /** The name of the note the template goes into. */
  title: string;
  now: Date;
  dateFormat?: string;
  timeFormat?: string;
};

const VAR_RE = /\{\{\s*(title|date|time)\s*(?::([^}]*))?\}\}/gi;

/** Fill in {{title}}, {{date}}, {{time}}, {{date:FORMAT}} and {{time:FORMAT}}. Unknown variables stay as written. */
export function renderTemplate(template: string, ctx: TemplateContext): string {
  return template.replace(VAR_RE, (_m, name: string, fmt: string | undefined) => {
    const kind = name.toLowerCase();
    if (kind === "title") return ctx.title;
    const f = fmt?.trim() || (kind === "date" ? ctx.dateFormat || DEFAULT_DATE_FORMAT : ctx.timeFormat || DEFAULT_TIME_FORMAT);
    return formatDate(ctx.now, f);
  });
}

/** Normalise a folder setting: no leading or trailing slashes, no ".md". */
export function normalizeFolder(folder: string): string {
  return folder.trim().replace(/^\/+|\/+$/g, "");
}

/** Notes inside the template folder (any depth), sorted by path. */
export function templatesIn<T extends { path: string }>(notes: T[], folder: string): T[] {
  const f = normalizeFolder(folder).toLowerCase();
  if (!f) return [];
  return notes
    .filter((n) => n.path.toLowerCase().startsWith(`${f}/`))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

/** Find a note by a path setting ("Templates/Daily" or "Templates/Daily.md"), ignoring case. */
export function findByPath<T extends { path: string }>(notes: T[], path: string): T | undefined {
  const p = normalizeFolder(path).replace(/\.md$/i, "").toLowerCase();
  if (!p) return undefined;
  return notes.find((n) => n.path.toLowerCase() === p);
}

/**
 * Insert a rendered template into a note.
 * - An empty note becomes the template.
 * - Otherwise the template's body goes in at `cursor` (moved past the note's own frontmatter),
 *   and its frontmatter merges into the note's: new keys are added, existing keys are kept.
 * Returns the new text and the caret position after the inserted body.
 */
export function applyTemplate(note: string, rendered: string, cursor: number): { text: string; cursor: number } {
  const tplFm = frontmatterSource(rendered);
  const body = rendered.slice(tplFm.length);
  if (!note.trim()) return { text: rendered, cursor: rendered.length };
  let c = Math.max(0, Math.min(cursor, note.length));
  const own = frontmatterRange(note);
  if (own && c < own.to) c = own.to;
  let text = note.slice(0, c) + body + note.slice(c);
  c += body.length;
  if (tplFm) {
    // The merge only touches the block at the top, which ends before the caret.
    const before = text.length;
    text = mergeFrontmatter(text, tplFm);
    c += text.length - before;
  }
  return { text, cursor: c };
}
