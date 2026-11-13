"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Toast } from "../ui";
import {
  bindOfflineUser,
  getOfflineStatus,
  getServerOfflineStatus,
  setSyncBridge,
  subscribeOfflineStatus,
  type OfflineStatus,
  type SyncBridge,
} from "./offline-api";
import { onServiceWorkerUpdate } from "./sw-events";

/** Connectivity and the number of edits waiting to sync. */
export function useOfflineStatus(): OfflineStatus {
  return useSyncExternalStore(subscribeOfflineStatus, getOfflineStatus, getServerOfflineStatus);
}

type Notify = (message: string, opts?: Toast["action"] | { action?: Toast["action"]; tone?: "error" }) => number;

export type OfflineWiring = SyncBridge & {
  notify: Notify;
  /** Save what the editors hold before a reload swaps in the new version. */
  flushAll: () => Promise<void>;
};

/**
 * Wires the workspace to the offline layer: binds this user's offline store before the first
 * request, lets the outbox replay through the workspace's save, and tells the user when the
 * connection drops and when a new version is ready.
 */
export function useOfflineSync(email: string, wiring: OfflineWiring) {
  // During the first render, so the tree request that follows already reads this user's mirror.
  useState(() => bindOfflineUser(email));
  const ref = useRef(wiring);
  useLayoutEffect(() => {
    ref.current = wiring;
  });

  useEffect(() => {
    setSyncBridge({
      save: (op) => ref.current.save(op),
      created: (tempId, real) => ref.current.created(tempId, real),
      dropped: (op, err) => ref.current.dropped(op, err),
      finished: (r) => ref.current.finished(r),
    });
    return () => setSyncBridge(null);
  }, []);

  // Say once when the connection drops; the status bar keeps saying it.
  const toldOffline = useRef(false);
  useEffect(() => {
    let was = getOfflineStatus().online;
    if (!was && !toldOffline.current) {
      toldOffline.current = true;
      ref.current.notify("You’re offline. Showing what’s saved on this device; changes sync when you reconnect.");
    }
    return subscribeOfflineStatus(() => {
      const now = getOfflineStatus().online;
      if (was && !now) ref.current.notify("You’re offline. Changes are saved on this device and sync when you reconnect.");
      if (!now) toldOffline.current = true;
      was = now;
    });
  }, []);

  useEffect(
    () =>
      onServiceWorkerUpdate((apply) =>
        ref.current.notify("Update available", {
          label: "Reload",
          run: () => void ref.current.flushAll().finally(apply),
        }),
      ),
    [],
  );
}
