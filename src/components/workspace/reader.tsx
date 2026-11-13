"use client";

import "katex/dist/katex.min.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { renderMarkdown } from "@/lib/markdown/render";
import { maskCode } from "@/lib/markdown/parse";
import { hydrateEmbeds, type EmbedLoader } from "@/lib/markdown/embeds-client";
import { renderMermaid } from "@/lib/markdown/mermaid-client";
import { api } from "./api";

/** Changes whenever the theme does (system preference or the data-theme attribute). */
function useThemeKey() {
  const [key, setKey] = useState(0);
  useEffect(() => {
    const bump = () => setKey((k) => k + 1);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", bump);
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      media.removeEventListener("change", bump);
      observer.disconnect();
    };
  }, []);
  return key;
}

/** Reading view: sanitized HTML from the note, with wikilinks, tags, clickable tasks, embeds, math and diagrams. */
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
  const ref = useRef<HTMLElement>(null);
  const themeKey = useThemeKey();
  const html = useMemo(
    () =>
      renderMarkdown(content, exists)
        // GFM renders disabled checkboxes; tasks are interactive here (embedded notes stay read-only).
        .replace(/(<input[^>]*?)\sdisabled(?:="")?/g, "$1")
        // Give each task box an accessible name; its state is announced as checked or not.
        .replace(/<input type="checkbox"/g, '<input type="checkbox" aria-label="Task"'),
    [content, exists],
  );

  // Fill note embeds, then draw diagrams (in the note and inside each embed).
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const signal = { cancelled: false };
    const cache = new Map<string, ReturnType<EmbedLoader>>();
    const load: EmbedLoader = (target) => {
      const key = target.toLowerCase();
      let hit = cache.get(key);
      if (!hit) {
        hit = api.resolve(target).then(async (r) => {
          if (!r.id) return null;
          const n = await api.get(r.id);
          return { id: n.id, content: n.content };
        });
        cache.set(key, hit);
      }
      return hit;
    };
    void renderMermaid(root, signal);
    void hydrateEmbeds(root, {
      load,
      render: (md) => renderMarkdown(md, exists),
      signal,
      onRendered: (body) => void renderMermaid(body, signal),
    });
    return () => {
      signal.cancelled = true;
    };
  }, [html, exists]);

  // Redraw diagrams in the new theme's colours.
  useEffect(() => {
    if (!themeKey || !ref.current) return;
    const signal = { cancelled: false };
    void renderMermaid(ref.current, signal);
    return () => {
      signal.cancelled = true;
    };
  }, [themeKey]);

  if (!content.trim()) {
    return <p className="font-note text-[17px] text-faint">This note is empty. Switch to editing to start writing.</p>;
  }

  return (
    <article
      ref={ref}
      className="reading"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const el = e.target as HTMLElement;
        if (el instanceof HTMLInputElement && el.type === "checkbox") {
          e.preventDefault();
          if (el.closest(".embed-body")) return; // embedded notes are read-only here
          const boxes = [...e.currentTarget.querySelectorAll('input[type="checkbox"]')].filter((b) => !b.closest(".embed-body"));
          onToggleTask(toggleTask(content, boxes.indexOf(el)));
          return;
        }
        const a = el.closest("a");
        if (!a) return;
        const href = a.getAttribute("href") ?? "";
        if (href.startsWith("#")) {
          // Footnotes: scroll inside the note instead of changing the page URL.
          e.preventDefault();
          let id = href.slice(1);
          try {
            id = decodeURIComponent(id);
          } catch {}
          const scope = a.closest(".embed-body") ?? e.currentTarget;
          const target = scope.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
          if (target) {
            target.scrollIntoView({ block: "center" });
            if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
            target.focus({ preventScroll: true });
          }
        } else if (href.startsWith("wikilink:")) {
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
