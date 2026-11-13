import { useSyncExternalStore } from "react";
import { collabSnapshot, subscribeCollab, type CollabSnapshot } from "./session";

/** The live state and the people on a note; "off" when live mode is not in use for it. */
export function useCollab(noteId: string | undefined): CollabSnapshot {
  return useSyncExternalStore(
    (fn) => subscribeCollab(noteId, fn),
    () => collabSnapshot(noteId),
    () => collabSnapshot(undefined),
  );
}
