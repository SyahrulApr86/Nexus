"use client";

import type { ReactNode } from "react";
import { CloudOff } from "lucide-react";
import { useWorkspaceSelector } from "../store";
import { useOfflineStatus } from "./use-offline-sync";

const nf = new Intl.NumberFormat("en");
const changes = (n: number) => `${nf.format(n)} ${n === 1 ? "change" : "changes"}`;

/** What the status bar says about connectivity, or null when there is nothing to say. */
export function offlineText(s: { online: boolean; queued: number }) {
  if (!s.online) return `Offline — changes saved on this device${s.queued ? ` · ${changes(s.queued)} to sync` : ""}`;
  if (s.queued) return `Syncing ${changes(s.queued)}…`;
  return null;
}

/**
 * Status bar: while offline (or syncing), says so in place of "Saved", since saves land on this
 * device. A save problem (a conflict, signed out) still shows next to it.
 */
export function OfflineLabel({ children }: { children: ReactNode }) {
  const s = useOfflineStatus();
  const bad = useWorkspaceSelector((w) => w.save === "error" || w.save === "signedOut");
  const text = offlineText(s);
  if (!text) return children;
  return (
    <>
      <span className="tabular">{text}</span>
      {bad && children}
    </>
  );
}

/** Phone top bar: a quiet mark beside the title while offline. */
export function OfflineMark() {
  const s = useOfflineStatus();
  const text = offlineText(s);
  if (s.online || !text) return null;
  return (
    <span className="shrink-0 text-faint" title={text}>
      <CloudOff aria-hidden="true" className="size-3.5" strokeWidth={2} />
      <span className="sr-only">{text}</span>
    </span>
  );
}
