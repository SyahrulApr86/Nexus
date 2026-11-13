"use client";

import { findByPath, renderTemplate } from "@/lib/templates";
import { api, type TreeNote } from "./api";
import { readTemplatePrefs } from "./templates-settings";

/**
 * Fill a just-created daily note from the daily note template in Settings, through the
 * normal save route. Returns true when the note got text. A missing template leaves the
 * note empty, as before.
 */
export async function applyDailyTemplate(id: string, title: string, notes: TreeNote[]): Promise<boolean> {
  const p = readTemplatePrefs();
  const tpl = p.dailyTemplate.trim() ? findByPath(notes, p.dailyTemplate) : undefined;
  if (!tpl) return false;
  const source = await api.get(tpl.id);
  const text = renderTemplate(source.content, { title, now: new Date(), dateFormat: p.dateFormat, timeFormat: p.timeFormat });
  if (!text) return false;
  // The note was created a moment ago with an empty body, so there is no base to conflict with.
  await api.save(id, text);
  return true;
}
