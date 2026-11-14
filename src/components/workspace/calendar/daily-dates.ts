/**
 * Daily notes as dates: where a day's note lives, which notes are daily notes, and the month
 * grid the calendar draws. Pure functions, no React, so they are unit tested on their own.
 */

import { DEFAULT_DATE_FORMAT, formatDate, normalizeFolder } from "@/lib/templates";

export type WeekStart = "locale" | "sunday" | "monday" | "saturday";

export type DailyConfig = {
  /** Folder for daily notes; "" puts them at the vault root. */
  folder: string;
  /** Moment-style name format, e.g. "YYYY-MM-DD". Slashes make subfolders. */
  format: string;
};

/** Midnight of the day, local time. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Same day of month in another month, clamped to that month's last day (31 Jan + 1 month = 28 or 29 Feb). */
export function addMonths(d: Date, n: number): Date {
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), last));
}

/** "2026-11-14": a stable key for a day. */
export function dayKey(d: Date): string {
  return formatDate(d, "YYYY-MM-DD");
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** The note path for a day, without ".md". */
export function dailyPath(d: Date, c: DailyConfig): string {
  const name = formatDate(d, c.format.trim() || DEFAULT_DATE_FORMAT).replace(/^\/+|\/+$/g, "");
  const folder = normalizeFolder(c.folder);
  return folder ? `${folder}/${name}` : name;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Same tokens as formatDate, longest first; [text] is literal.
const TOKEN_RE = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|Do|DD|D|dddd|ddd|HH|H|hh|h|mm|m|ss|s|A|a/g;

type Field = "year" | "year2" | "month" | "monthName" | "monthShort" | "day" | null;

/**
 * A parser for names in a format: "YYYY-MM-DD" reads "2026-11-14" back as a date. Returns null for
 * a name that is not a real day in that format (2026-02-30 included), so any note is safe to test.
 */
export function dateParser(format: string): (name: string) => Date | null {
  const fields: Field[] = [];
  let source = "";
  let last = 0;
  const f = format.trim() || DEFAULT_DATE_FORMAT;
  for (const m of f.matchAll(TOKEN_RE)) {
    source += escape(f.slice(last, m.index));
    last = m.index + m[0].length;
    const tok = m[0];
    if (m[1] !== undefined) {
      source += escape(m[1]);
      continue;
    }
    const [re, field]: [string, Field] =
      tok === "YYYY"
        ? ["(\\d{4})", "year"]
        : tok === "YY"
          ? ["(\\d{2})", "year2"]
          : tok === "MMMM"
            ? ["([A-Za-z]+)", "monthName"]
            : tok === "MMM"
              ? ["([A-Za-z]{3})", "monthShort"]
              : tok === "MM" || tok === "DD"
                ? ["(\\d{2})", tok === "MM" ? "month" : "day"]
                : tok === "M" || tok === "D"
                  ? ["(\\d{1,2})", tok === "M" ? "month" : "day"]
                  : tok === "Do"
                    ? ["(\\d{1,2})(?:st|nd|rd|th)", "day"]
                    : tok === "dddd" || tok === "ddd"
                      ? ["[A-Za-z]+", null]
                      : tok === "A" || tok === "a"
                        ? ["[AaPp][Mm]", null]
                        : ["\\d{1,2}", null];
    source += re;
    if (field) fields.push(field);
  }
  source += escape(f.slice(last));
  const re = new RegExp(`^${source}$`, "i");
  return (name) => {
    const m = re.exec(name);
    if (!m) return null;
    let year = NaN;
    let month = NaN;
    let day = NaN;
    fields.forEach((field, i) => {
      const v = m[i + 1];
      if (field === "year") year = Number(v);
      else if (field === "year2") year = 2000 + Number(v);
      else if (field === "month") month = Number(v) - 1;
      else if (field === "monthName") month = MONTHS.indexOf(v.toLowerCase());
      else if (field === "monthShort") month = MONTHS.findIndex((x) => x.startsWith(v.toLowerCase()));
      else if (field === "day") day = Number(v);
    });
    if (!(year >= 1 && month >= 0 && month <= 11 && day >= 1 && day <= 31)) return null;
    const d = new Date(year, month, day);
    // Rejects 30 February and names whose weekday or padding disagree with the format.
    if (d.getMonth() !== month || formatDate(d, f).toLowerCase() !== name.toLowerCase()) return null;
    return d;
  };
}

/** The day a note path stands for, or null when it is not a daily note under this config. */
export function dailyDate(path: string, c: DailyConfig, parse = dateParser(c.format)): Date | null {
  const folder = normalizeFolder(c.folder).toLowerCase();
  if (folder && !path.toLowerCase().startsWith(`${folder}/`)) return null;
  return parse(folder ? path.slice(folder.length + 1) : path);
}

/** Every daily note by day key. A day with two notes (another format) keeps the first one listed. */
export function dailyIndex<T extends { path: string }>(notes: T[], c: DailyConfig): Map<string, T> {
  const parse = dateParser(c.format);
  const out = new Map<string, T>();
  for (const n of notes) {
    const d = dailyDate(n.path, c, parse);
    if (d && !out.has(dayKey(d))) out.set(dayKey(d), n);
  }
  return out;
}

/** The nearest daily note before (-1) or after (1) a day, or null at either end. */
export function adjacentDaily<T extends { path: string }>(notes: T[], c: DailyConfig, from: Date, dir: -1 | 1): { date: Date; note: T } | null {
  const parse = dateParser(c.format);
  const at = startOfDay(from).getTime();
  let best: { date: Date; note: T } | null = null;
  for (const n of notes) {
    const d = dailyDate(n.path, c, parse);
    if (!d) continue;
    const t = d.getTime();
    if (dir < 0 ? t >= at : t <= at) continue;
    if (!best || (dir < 0 ? t > best.date.getTime() : t < best.date.getTime())) best = { date: d, note: n };
  }
  return best;
}

/** Day index the week starts on (0 Sunday, 1 Monday, 6 Saturday), from the setting or the locale. */
export function weekStartDay(setting: WeekStart, locale?: string): number {
  if (setting === "sunday") return 0;
  if (setting === "monday") return 1;
  if (setting === "saturday") return 6;
  try {
    const loc = new Intl.Locale(locale || "en-US") as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    if (info) return info.firstDay % 7;
    // No week info (Firefox): the regions that start on Sunday, by region code.
    const region = loc.maximize().region ?? "";
    return SUNDAY_REGIONS.has(region) ? 0 : 1;
  } catch {
    return 1;
  }
}

const SUNDAY_REGIONS = new Set(["US", "CA", "MX", "BR", "JP", "KR", "TW", "HK", "PH", "IL", "ID", "IN", "ZA", "SA", "AU", "NZ"]);

/** Six weeks of days covering the month of `month`, starting on the week's first day. */
export function monthGrid(month: Date, firstDay: number): Date[][] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = addDays(first, -((first.getDay() - firstDay + 7) % 7));
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, i) => addDays(start, w * 7 + i)));
}

/** The first and last day of the week holding `d`. */
export function weekBounds(d: Date, firstDay: number): [Date, Date] {
  const start = addDays(d, -((d.getDay() - firstDay + 7) % 7));
  return [start, addDays(start, 6)];
}
