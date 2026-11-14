"use client";

/** Settings rows for focus mode and typewriter mode. Both are kept on this device. */

import type { ReactNode } from "react";
import { setFocusPrefs, useFocusPrefs } from "./focus-prefs";

type RowComponent = (props: { title: string; description?: string; children: ReactNode }) => ReactNode;

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-hover">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 size-4 accent-[var(--accent)]" />
      <span>
        <span className="block">{label}</span>
        <span className="block text-[12px] text-faint">{hint}</span>
      </span>
    </label>
  );
}

export function FocusSettings({ Row }: { Row: RowComponent }) {
  const prefs = useFocusPrefs();
  return (
    <Row title="Writing" description="Focus mode hides everything but the note; Escape brings it all back. Both stay on this device.">
      <div className="flex flex-col gap-1">
        <Toggle
          checked={prefs.focus}
          onChange={(focus) => setFocusPrefs({ focus })}
          label="Focus mode"
          hint="No rail, sidebars, tabs or status bar"
        />
        <Toggle
          checked={prefs.typewriter}
          onChange={(typewriter) => setFocusPrefs({ typewriter })}
          label="Typewriter mode"
          hint="The line you are typing stays in the middle"
        />
      </div>
    </Row>
  );
}
