"use client";

/**
 * Focus mode and typewriter mode, remembered per device. A tiny external store, so the shell,
 * the settings dialog and the editor extension read the same values without workspace state.
 */

import { useSyncExternalStore } from "react";

export type FocusPrefs = {
  /** The rail, sidebars, tab bar and status bar are hidden; only the note shows. */
  focus: boolean;
  /** The caret's line stays in the middle of the screen while typing. */
  typewriter: boolean;
};

const KEY = "nexus-focus";
export const DEFAULT_FOCUS_PREFS: FocusPrefs = { focus: false, typewriter: false };

let current: FocusPrefs | null = null;
const listeners = new Set<() => void>();

export function parseFocusPrefs(raw: string | null): FocusPrefs {
  try {
    const saved = raw ? (JSON.parse(raw) as Partial<Record<keyof FocusPrefs, unknown>>) : {};
    return { focus: saved.focus === true, typewriter: saved.typewriter === true };
  } catch {
    return DEFAULT_FOCUS_PREFS;
  }
}

function load(): FocusPrefs {
  try {
    return parseFocusPrefs(localStorage.getItem(KEY));
  } catch {
    return DEFAULT_FOCUS_PREFS;
  }
}

export function readFocusPrefs(): FocusPrefs {
  if (typeof window === "undefined") return DEFAULT_FOCUS_PREFS;
  current ??= load();
  return current;
}

export function setFocusPrefs(patch: Partial<FocusPrefs>) {
  const prev = readFocusPrefs();
  const next = { ...prev, ...patch };
  if (next.focus === prev.focus && next.typewriter === prev.typewriter) return;
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {}
  listeners.forEach((fn) => fn());
}

export const toggleFocusMode = () => setFocusPrefs({ focus: !readFocusPrefs().focus });
export const toggleTypewriter = () => setFocusPrefs({ typewriter: !readFocusPrefs().typewriter });

/** Listen for changes; also follows another tab on this device. Returns the unsubscribe. */
export function subscribeFocusPrefs(fn: () => void) {
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

export function useFocusPrefs(): FocusPrefs {
  return useSyncExternalStore(subscribeFocusPrefs, readFocusPrefs, () => DEFAULT_FOCUS_PREFS);
}
