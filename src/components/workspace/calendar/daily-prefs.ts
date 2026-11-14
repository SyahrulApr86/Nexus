"use client";

/**
 * Daily note preferences, kept on this device like the template preferences: the folder,
 * the name format and the first day of the week. The template path stays with the template
 * preferences (dailyTemplate), so an existing setting keeps working.
 */

import { useSyncExternalStore } from "react";
import { DEFAULT_DATE_FORMAT } from "@/lib/templates";
import type { DailyConfig, WeekStart } from "./daily-dates";

export type DailyPrefs = DailyConfig & { weekStart: WeekStart };

const KEY = "nexus-daily";
const WEEK_STARTS: readonly WeekStart[] = ["locale", "sunday", "monday", "saturday"];
export const DEFAULT_DAILY_PREFS: DailyPrefs = { folder: "Daily", format: DEFAULT_DATE_FORMAT, weekStart: "locale" };

let current: DailyPrefs | null = null;
const listeners = new Set<() => void>();

/** Saved values, with anything unknown or of the wrong type replaced by the default. */
export function parseDailyPrefs(raw: string | null): DailyPrefs {
  try {
    const saved = raw ? (JSON.parse(raw) as Partial<Record<keyof DailyPrefs, unknown>>) : {};
    return {
      folder: typeof saved.folder === "string" ? saved.folder : DEFAULT_DAILY_PREFS.folder,
      format: typeof saved.format === "string" ? saved.format : DEFAULT_DAILY_PREFS.format,
      weekStart: WEEK_STARTS.includes(saved.weekStart as WeekStart) ? (saved.weekStart as WeekStart) : "locale",
    };
  } catch {
    return DEFAULT_DAILY_PREFS;
  }
}

function load(): DailyPrefs {
  try {
    return parseDailyPrefs(localStorage.getItem(KEY));
  } catch {
    return DEFAULT_DAILY_PREFS;
  }
}

/** The current preferences, outside React (workspace actions). */
export function readDailyPrefs(): DailyPrefs {
  if (typeof window === "undefined") return DEFAULT_DAILY_PREFS;
  current ??= load();
  return current;
}

/** The config a daily note path is built from: an empty format falls back to the default. */
export function dailyConfig(p: DailyPrefs = readDailyPrefs()): DailyConfig {
  return { folder: p.folder, format: p.format.trim() || DEFAULT_DATE_FORMAT };
}

export function setDailyPrefs(patch: Partial<DailyPrefs>) {
  current = { ...readDailyPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {}
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    current = load();
    fn();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

export function useDailyPrefs(): DailyPrefs {
  return useSyncExternalStore(subscribe, readDailyPrefs, () => DEFAULT_DAILY_PREFS);
}
