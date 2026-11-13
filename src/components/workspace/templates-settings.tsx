"use client";

/**
 * Preferences for templates and properties, kept on this device like the other workspace
 * preferences. A tiny external store, so the settings dialog, the note view and the
 * workspace actions read the same values without going through the workspace state.
 */

import { useSyncExternalStore } from "react";
import type { PropType } from "@/lib/markdown/frontmatter-edit";
import { DEFAULT_DATE_FORMAT, DEFAULT_TEMPLATE_FOLDER, DEFAULT_TIME_FORMAT } from "@/lib/templates";

export type ShowProperties = "visible" | "hidden" | "source";

export type TemplatePrefs = {
  /** Folder whose notes are templates. */
  folder: string;
  /** Path of the template for new daily notes; "" for none. */
  dailyTemplate: string;
  dateFormat: string;
  timeFormat: string;
  /** How frontmatter shows in a note: as a properties form, not at all, or as YAML source. */
  showProperties: ShowProperties;
  /** The properties block is folded. */
  propertiesCollapsed: boolean;
  /** Types the person picked per key, like Obsidian's types.json. */
  propertyTypes: Record<string, PropType>;
};

const KEY = "nexus-templates";
export const DEFAULT_TEMPLATE_PREFS: TemplatePrefs = {
  folder: DEFAULT_TEMPLATE_FOLDER,
  dailyTemplate: "",
  dateFormat: DEFAULT_DATE_FORMAT,
  timeFormat: DEFAULT_TIME_FORMAT,
  showProperties: "visible",
  propertiesCollapsed: false,
  propertyTypes: {},
};

let current: TemplatePrefs | null = null;
const listeners = new Set<() => void>();

function load(): TemplatePrefs {
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<TemplatePrefs>) : {};
    const show = saved.showProperties;
    return {
      ...DEFAULT_TEMPLATE_PREFS,
      ...saved,
      showProperties: show === "hidden" || show === "source" ? show : "visible",
      propertyTypes: { ...(saved.propertyTypes ?? {}) },
    };
  } catch {
    return DEFAULT_TEMPLATE_PREFS;
  }
}

/** The current preferences, outside React (workspace actions). */
export function readTemplatePrefs(): TemplatePrefs {
  if (typeof window === "undefined") return DEFAULT_TEMPLATE_PREFS;
  current ??= load();
  return current;
}

export function setTemplatePrefs(patch: Partial<TemplatePrefs> | ((p: TemplatePrefs) => Partial<TemplatePrefs>)) {
  const prev = readTemplatePrefs();
  current = { ...prev, ...(typeof patch === "function" ? patch(prev) : patch) };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {}
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  // Another tab changed them.
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

export function useTemplatePrefs(): TemplatePrefs {
  return useSyncExternalStore(subscribe, readTemplatePrefs, () => DEFAULT_TEMPLATE_PREFS);
}

/* ------------------------------------------------------------------ */
/* One-shot requests: open the template picker, add a property         */
/* ------------------------------------------------------------------ */

type Requests = { picker: boolean; addProperty: { id: string; seq: number } | null };
let requests: Requests = { picker: false, addProperty: null };
const requestListeners = new Set<() => void>();
const setRequests = (r: Partial<Requests>) => {
  requests = { ...requests, ...r };
  requestListeners.forEach((fn) => fn());
};
const subscribeRequests = (fn: () => void) => {
  requestListeners.add(fn);
  return () => requestListeners.delete(fn);
};
const SERVER_REQUESTS: Requests = { picker: false, addProperty: null };

export function useRequests(): Requests {
  return useSyncExternalStore(subscribeRequests, () => requests, () => SERVER_REQUESTS);
}

export const openTemplatePicker = () => setRequests({ picker: true });
export const closeTemplatePicker = () => setRequests({ picker: false });

let addSeq = 0;
/** Ask the note's properties block to start a new property row. */
export const requestAddProperty = (id: string) => setRequests({ addProperty: { id, seq: ++addSeq } });
export const clearAddProperty = () => setRequests({ addProperty: null });
