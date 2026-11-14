"use client";

import { findByPath, renderTemplate } from "@/lib/templates";
import type { TreeNote } from "./api";
// The offline-aware client: it reads the note cache on this device and queues the save in the outbox.
import { isOffline, offlineApi as api } from "./offline/offline-api";
import { readTemplatePrefs } from "./templates-settings";

export type DailyTemplateResult = { applied: boolean; problem?: string };

/**
 * Fill a just-created daily note from the daily note template in Settings, through the
 * normal save route (or the offline outbox). A missing template leaves the note empty, as
 * before. {{date}} in the template is the note's own day, so a note made for last Tuesday
 * from the calendar says last Tuesday.
 *
 * Never throws: the note exists already and must still open. When the template cannot be
 * read (offline and not cached on this device) or the filled text cannot be saved, the
 * result carries a message to show, and the note stays empty.
 *
 * `cached` reads a copy this device already holds (an open tab, the note cache), so a
 * template opened earlier works offline even when the service worker never stored it.
 */
export async function applyDailyTemplate(
  id: string,
  title: string,
  notes: TreeNote[],
  day: Date = new Date(),
  cached?: (id: string) => string | undefined,
): Promise<DailyTemplateResult> {
  const p = readTemplatePrefs();
  const tpl = p.dailyTemplate.trim() ? findByPath(notes, p.dailyTemplate) : undefined;
  if (!tpl) return { applied: false };
  let source: string;
  try {
    source = cached?.(tpl.id) ?? (await api.get(tpl.id)).content;
  } catch {
    return {
      applied: false,
      problem: isOffline() ? "Daily note template is not available offline" : "Could not read the daily note template",
    };
  }
  // Today keeps the clock for {{time}}; another day has no meaningful time, so it reads midnight.
  const now = new Date();
  const at = day.toDateString() === now.toDateString() ? now : day;
  const text = renderTemplate(source, { title, now: at, dateFormat: p.dateFormat, timeFormat: p.timeFormat });
  if (!text) return { applied: false };
  try {
    // The note was created a moment ago with an empty body, so there is no base to conflict with.
    await api.save(id, text);
  } catch {
    return { applied: false, problem: "Could not apply the daily note template" };
  }
  return { applied: true };
}
