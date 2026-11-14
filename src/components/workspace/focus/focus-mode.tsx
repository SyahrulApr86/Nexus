"use client";

/**
 * Focus mode: the rail, both sidebars, the tab bar, the view header, the status bar and the
 * phone bars step away (globals.css, the "calendar/focus" block, keyed on data-focus-mode on
 * the shell), and only the focused pane shows. Escape, the same shortcut or the small exit
 * control leaves it. The control shows when the pointer nears the top right corner, when it
 * has keyboard focus, for a moment after entering, and always on touch screens.
 */

import { useEffect, useRef, useState } from "react";
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

  // Where keyboard focus was on the way in, so the exit control can hand it back.
  const entryFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = document.activeElement;
    entryFocus.current = el instanceof HTMLElement && el !== document.body ? el : null;
  }, []);
  // The exit control unmounts on click: keyboard focus goes to the note, never to the page body.
  const exit = () => {
    const target = focusTarget(entryFocus.current, pane);
    target?.focus({ preventScroll: true });
    setFocusPrefs({ focus: false });
    requestAnimationFrame(() => {
      if (document.activeElement === document.body || !document.activeElement) focusTarget(null, pane)?.focus({ preventScroll: true });
    });
  };

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
          onClick={exit}
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

/**
 * Where focus lands when the exit control is used: the element focused on the way in, when it
 * is still on the page and not in a closed palette or menu; else the focused pane's editor;
 * else something focusable in that pane; else the workbench itself (tabindex -1).
 */
function focusTarget(entry: HTMLElement | null, pane: number): HTMLElement | null {
  if (entry?.isConnected && !entry.closest("dialog, [role='dialog'], [role='menu'], .focus-exit") && entry.checkVisibility?.() !== false) return entry;
  const section = document.querySelector<HTMLElement>(`#workbench > section:nth-child(${pane + 1})`);
  return (
    section?.querySelector<HTMLElement>(".cm-content") ??
    section?.querySelector<HTMLElement>("[role='tabpanel'], a[href], button:not([disabled]), [tabindex='0']") ??
    document.getElementById("workbench")
  );
}
