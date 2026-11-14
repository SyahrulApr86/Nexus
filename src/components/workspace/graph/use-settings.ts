"use client";

import { useCallback, useSyncExternalStore } from "react";
import { api, getActiveVault } from "../api";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type GraphSettings } from "./model";

/*
 * Graph settings as an external store: read from localStorage once per vault, shared by every
 * graph tab, and the defaults during server rendering (so hydration never disagrees).
 *
 * Kept under the vault's id. On the default vault the client may not know that id yet (the server
 * picks the vault), so settings are read from this account's default slot at once and the id is
 * looked up in the background; from then on every save goes to both, so the next visit reads the
 * same thing either way and opening that vault by id later finds them too.
 */

type Entry = { current: GraphSettings | null; defaultId: string | null; lookingUp: boolean };
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** The default vault's slot for one account (hashed, so no email is stored as a key). */
function slotFor(user: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < user.length; i++) h = Math.imul(h ^ user.charCodeAt(i), 0x01000193);
  return `default-${(h >>> 0).toString(36)}`;
}

function entry(slot: string) {
  let e = entries.get(slot);
  if (!e) entries.set(slot, (e = { current: null, defaultId: null, lookingUp: false }));
  return e;
}

function lookUpDefault(e: Entry) {
  if (e.lookingUp || getActiveVault()) return;
  e.lookingUp = true;
  api.vault().then(
    (v) => {
      e.defaultId = v.id;
      if (getActiveVault()) return;
      // Settings saved under the id (from a visit that named the vault) win over the slot.
      const byId = loadSettings(v.id);
      if (JSON.stringify(byId) !== JSON.stringify(DEFAULT_SETTINGS) && JSON.stringify(byId) !== JSON.stringify(e.current)) {
        e.current = byId;
        notify();
      }
    },
    () => {
      e.lookingUp = false;
    },
  );
}

function read(slot: string): GraphSettings {
  const e = entry(slot);
  if (!e.current) {
    e.current = loadSettings(getActiveVault() ?? slot);
    lookUpDefault(e);
  }
  return e.current;
}

const serverSnapshot = () => DEFAULT_SETTINGS;

export function useGraphSettings(user: string) {
  const slot = slotFor(user);
  const snapshot = useCallback(() => read(slot), [slot]);
  const settings = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const patch = useCallback(
    (p: Partial<GraphSettings>) => {
      const e = entry(slot);
      const next = { ...read(slot), ...p };
      e.current = next;
      const vault = getActiveVault();
      if (vault) saveSettings(vault, next);
      else {
        saveSettings(slot, next);
        if (e.defaultId) saveSettings(e.defaultId, next);
      }
      notify();
    },
    [slot],
  );
  return [settings, patch] as const;
}
