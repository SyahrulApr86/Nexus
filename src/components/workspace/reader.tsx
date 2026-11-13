"use client";

import { useMemo } from "react";
import { renderMarkdown } from "@/lib/markdown/render";
import { maskCode } from "@/lib/markdown/parse";

/** Reading view: sanitized HTML from the note, with wikilinks, tags and clickable tasks. */
export function Reader({
  content,
  exists,
  onOpenLink,
  onOpenTag,
  onToggleTask,
}: {
  content: string;
  exists: (t: string) => boolean;
  onOpenLink: (t: string, newTab?: boolean) => void;
  onOpenTag: (t: string) => void;
  onToggleTask: (content: string) => void;
}) {
  const html = useMemo(
    () =>
      renderMarkdown(content, exists)
        // GFM renders disabled checkboxes; tasks are interactive here.
        .replace(/(<input[^>]*?)\sdisabled(?:="")?/g, "$1")
        // Give each task box an accessible name; its state is announced as checked or not.
        .replace(/<input type="checkbox"/g, '<input type="checkbox" aria-label="Task"'),
    [content, exists],
  );

  if (!content.trim()) {
    return <p className="font-note text-[17px] text-faint">This note is empty. Switch to editing to start writing.</p>;
  }

  return (
    <article
      className="reading"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const el = e.target as HTMLElement;
        if (el instanceof HTMLInputElement && el.type === "checkbox") {
          e.preventDefault();
          const boxes = [...e.currentTarget.querySelectorAll('input[type="checkbox"]')];
          onToggleTask(toggleTask(content, boxes.indexOf(el)));
          return;
        }
        const a = el.closest("a");
        if (!a) return;
        const href = a.getAttribute("href") ?? "";
        if (href.startsWith("wikilink:")) {
          e.preventDefault();
          const target = decodeURIComponent(href.slice(9).split("#")[0]);
          if (target) onOpenLink(target, e.ctrlKey || e.metaKey);
        } else if (href.startsWith("tag:")) {
          e.preventDefault();
          onOpenTag(decodeURIComponent(href.slice(4)));
        } else if (/^https?:/.test(href)) {
          e.preventDefault();
          window.open(href, "_blank", "noopener,noreferrer");
        }
      }}
    />
  );
}

/** Flip the nth GFM task checkbox in the source markdown (code blocks ignored). */
export function toggleTask(md: string, nth: number): string {
  if (nth < 0) return md;
  const masked = maskCode(md);
  const re = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/gm;
  let i = 0;
  for (const m of masked.matchAll(re)) {
    if (i++ === nth) {
      const pos = m.index! + m[1].length;
      return md.slice(0, pos) + (m[2] === " " ? "x" : " ") + md.slice(pos + 1);
    }
  }
  return md;
}
