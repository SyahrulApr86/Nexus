"use client";

import { findByPath, renderTemplate } from "@/lib/templates";
import { api, type TreeNote } from "./api";
import { readTemplatePrefs } from "./templates-settings";

/**
 * Fill a just-created daily note from the daily note template in Settings, through the
 * normal save route (or the offline outbox). Returns true when the note got text. A missing
 * template leaves the note empty, as before. {{date}} in the template is the note's own day,
 * so a note made for last Tuesday from the calendar says last Tuesday.
 */
export async function applyDailyTemplate(id: string, title: string, notes: TreeNote[], day: Date = new Date()): Promise<boolean> {
  const p = readTemplatePrefs();
  const tpl = p.dailyTemplate.trim() ? findByPath(notes, p.dailyTemplate) : undefined;
  if (!tpl) return false;
  const source = await api.get(tpl.id);
  // Today keeps the clock for {{time}}; another day has no meaningful time, so it reads midnight.
  const now = new Date();
  const at = day.toDateString() === now.toDateString() ? now : day;
  const text = renderTemplate(source.content, { title, now: at, dateFormat: p.dateFormat, timeFormat: p.timeFormat });
  if (!text) return false;
  // The note was created a moment ago with an empty body, so there is no base to conflict with.
  await api.save(id, text);
  return true;
}
