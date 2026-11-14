/**
 * Heading and block links (`[[Note#Heading]]`, `[[Note#^id]]`): after the target note opens, its
 * reading view or editor scrolls to the heading or block and flashes it.
 *
 * The link is followed by the workspace's ordinary note opening; the fragment waits here, keyed by
 * the target note's id, until that note's view mounts (or, when it is already open, is told). A
 * pending fragment expires after a few seconds so a later, unrelated open never jumps.
 */

import { blockIdOf, stripBlockId } from "./blocks";
import { extractHeadings } from "./parse";

export type Fragment = { kind: "heading"; text: string } | { kind: "block"; id: string };

/** "Heading" or "^id" (as written after the "#"), or null for an empty fragment. */
export function parseFragment(raw: string | undefined | null): Fragment | null {
  const f = (raw ?? "").trim();
  if (!f) return null;
  if (f.startsWith("^")) {
    const id = f.slice(1).trim();
    return /^[A-Za-z0-9-]+$/.test(id) ? { kind: "block", id } : null;
  }
  return { kind: "heading", text: f };
}

/** Headings compare like Obsidian's: case, repeated spaces and inline markup do not matter. */
export function headingKey(s: string): string {
  return s
    .replace(/[*_`~=]|\[\[|\]\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** 0-based line of the fragment's heading or block in `md`, or null. */
export function fragmentLine(md: string, fragment: Fragment): number | null {
  if (fragment.kind === "heading") {
    const want = headingKey(fragment.text);
    const h = extractHeadings(md).find((x) => headingKey(stripBlockId(x.text)) === want);
    return h ? h.line : null;
  }
  const lines = md.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(?:>\s?)*\s*(```|~~~)/.test(lines[i])) inFence = !inFence;
    else if (!inFence && blockIdOf(lines[i]) === fragment.id) {
      // An id on its own line stands for the block above it.
      if (!stripBlockId(lines[i]).trim()) for (let k = i - 1; k >= 0; k--) if (lines[k].trim()) return k;
      return i;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Pending fragment, handed from the link to the opened note's view    */
/* ------------------------------------------------------------------ */

const TTL = 8_000;
let pending: { noteId: string; fragment: Fragment; at: number } | null = null;
const listeners = new Set<() => void>();

/** Remember that note `noteId`, about to open, should scroll to `fragment`. */
export function queueFragment(noteId: string, fragment: Fragment) {
  pending = { noteId, fragment, at: Date.now() };
  for (const fn of listeners) fn();
}

/** The fragment waiting for note `noteId`, consumed; null when there is none (or it expired). */
export function takeFragment(noteId: string | undefined): Fragment | null {
  if (!pending || !noteId || pending.noteId !== noteId) return null;
  const { fragment, at } = pending;
  pending = null;
  return Date.now() - at <= TTL ? fragment : null;
}

/** Called whenever a fragment is queued; returns the unsubscribe function. */
export function onFragment(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/* ------------------------------------------------------------------ */
/* Reading view: find, scroll, flash                                   */
/* ------------------------------------------------------------------ */

/** The element of `root` (outside embedded notes) that the fragment names, or null. */
export function findFragment(root: HTMLElement, fragment: Fragment): HTMLElement | null {
  const own = (el: Element) => !el.closest(".embed-body");
  if (fragment.kind === "block") {
    return (
      [...root.querySelectorAll<HTMLElement>("[data-block]")].find((el) => own(el) && el.dataset.block === fragment.id) ?? null
    );
  }
  const want = headingKey(fragment.text);
  return (
    [...root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")].find(
      (el) => own(el) && headingKey(el.textContent ?? "") === want,
    ) ?? null
  );
}

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Scroll `el` into view, move focus to it (so keyboard and screen reader follow) and flash it. */
export function revealElement(el: HTMLElement) {
  el.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" });
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
  el.classList.remove("fragment-flash");
  // Restart the animation when the same target is revealed twice in a row.
  void el.offsetWidth;
  el.classList.add("fragment-flash");
  window.setTimeout(() => el.classList.remove("fragment-flash"), 1600);
}
