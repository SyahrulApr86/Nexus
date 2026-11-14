"use client";

/**
 * Focus mode: the rail, both sidebars, the tab bar, the view header, the status bar and the
 * phone bars step away (globals.css, the "calendar/focus" block, keyed on data-focus-mode on
 * the shell), and only the focused pane shows. Escape, the same shortcut or the small exit
 * control leaves it. The control shows when the pointer nears the top right corner, when it
 * has keyboard focus, for a moment after entering, and always on touch screens.
 */

import { useEffect, useState } from "react";
import { Minimize2 } from "lucide-react";
import { shallowEqual, useWorkspaceActions, useWorkspaceSelector } from "../store";
import { Shortcut, keyShortcuts } from "../ui";
import { setFocusPrefs, useFocusPrefs } from "./focus-prefs";

export const FOCUS_SHORTCUT = "Mod+Shift+Enter";

export function FocusModeHost() {
  const { focus } = useFocusPrefs();
  if (!focus) return null;
  return <FocusModeOn />;
}

function FocusModeOn() {
  const a = useWorkspaceActions();
  const { drawer, pane, panes, sides, restoring } = useWorkspaceSelector(
    (w) => ({
      restoring: w.restoring,
      drawer: w.drawer,
      pane: w.layout.focus,
      panes: w.layout.groups.length,
      sides: `${w.prefs.leftOpen}:${w.prefs.leftView}:${w.prefs.rightOpen}:${w.prefs.rightView}`,
    }),
    shallowEqual,
  );
  // Shown for a moment after entering, so the way out is seen once.
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setIntro(false), 2400);
    return () => clearTimeout(t);
  }, []);

  // A drawer left open would cover the note: close it on the way in.
  const [entryDrawer] = useState(drawer);
  useEffect(() => {
    if (entryDrawer) a.setDrawer(null);
  }, [entryDrawer, a]);
  // Asking for a sidebar (a command, a shortcut) is asking to leave focus mode. The saved
  // layout is still being read on a reload, so the baseline is taken once it has settled.
  const [baseline, setBaseline] = useState<string | null>(null);
  if (!restoring && baseline === null) setBaseline(sides);
  const [cleared, setCleared] = useState(!entryDrawer);
  if (!cleared && !drawer) setCleared(true);
  useEffect(() => {
    if ((drawer && cleared) || (baseline !== null && sides !== baseline)) setFocusPrefs({ focus: false });
  }, [drawer, cleared, sides, baseline]);

  // Escape leaves focus mode, after anything that wants Escape first (completion, search, menus, dialogs).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || e.repeat) return;
      if (document.querySelector("dialog[open]")) return;
      setFocusPrefs({ focus: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      {panes > 1 && <style>{`[data-focus-mode] #workbench > section:not(:nth-child(${pane + 1})) { display: none !important; }`}</style>}
      <div className="focus-exit" data-intro={intro || undefined}>
        <button
          type="button"
          onClick={() => setFocusPrefs({ focus: false })}
          aria-keyshortcuts={`Escape ${keyShortcuts(FOCUS_SHORTCUT)}`}
          className="flex h-8 items-center gap-2 rounded-md border border-border bg-sheet pl-2 pr-1.5 text-[13px] font-medium text-muted transition-colors hover:border-control hover:text-fg pointer-coarse:h-11"
        >
          <Minimize2 aria-hidden="true" className="size-4 stroke-[1.5]" />
          Exit focus mode
          <span className="pointer-coarse:hidden">
            <Shortcut keys="Esc" />
          </span>
        </button>
      </div>
    </>
  );
}
