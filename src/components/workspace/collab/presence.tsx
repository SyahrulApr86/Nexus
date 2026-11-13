"use client";

import { initials, presenceLabel } from "./mode";
import { useCollab } from "./use-collab";

/**
 * Who else has this note open, for the view header: up to three initials in each person's
 * presence colour, then "2 people here". Shown only while the note is live and someone else is
 * on it. One accessible name lists everyone; the avatars are decoration.
 */
export function Presence({ noteId }: { noteId: string }) {
  const { state, peers } = useCollab(noteId);
  if (state !== "live" || peers.length < 2) return null;
  const others = peers.filter((p) => !p.self);
  const label = presenceLabel(peers.length);
  const names = ["you", ...others.map((p) => p.name)].join(", ");
  const shown = peers.slice(0, 3);
  return (
    <p className="collab-presence" title={`${label}: ${names}`}>
      <span aria-hidden="true" className="collab-avatars">
        {shown.map((p) => (
          <span key={p.clientId} className="collab-avatar" style={{ backgroundColor: p.color }}>
            {initials(p.name)}
          </span>
        ))}
      </span>
      <span className="tabular">{label}</span>
      <span className="sr-only">: {names}</span>
    </p>
  );
}
