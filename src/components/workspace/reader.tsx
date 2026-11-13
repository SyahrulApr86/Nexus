"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { renderMarkdown } from "@/lib/markdown/render";
import { toggleTask } from "@/lib/markdown/tasks";
import { hydrateEmbeds, type EmbedLoader } from "@/lib/markdown/embeds-client";
import { renderMermaid } from "@/lib/markdown/mermaid-client";
import { renderMath } from "@/lib/markdown/math-client";
import { api } from "./api";

export { toggleTask };

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

/** The task checkboxes that belong to this note (embedded notes are read-only). */
const ownBoxes = (root: Element) =>
  [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].filter((b) => !b.closest(".embed-body"));

/** Reading view: sanitized HTML from the note, with wikilinks, tags, clickable tasks, embeds, math and diagrams. */
export function Reader({
  content,
  noteId,
  exists,
  onOpenLink,
  onOpenTag,
  onToggleTask,
}: {
  content: string;
  /** The open note; lets the embed cycle guard stop at the note itself. */
  noteId?: string;
  exists: (t: string) => boolean;
  onOpenLink: (t: string, newTab?: boolean) => void;
  onOpenTag: (t: string) => void;
  onToggleTask: (content: string) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const refocus = useRef<number | null>(null);
  const existsRef = useRef(exists);
  useEffect(() => {
    existsRef.current = exists;
  });
  const themeKey = useThemeKey();
  const html = useMemo(
    () =>
      // GFM renders disabled checkboxes; this note's tasks are interactive (embeds stay read-only).
      renderMarkdown(content, exists).replace(/(<input type="checkbox"(?: checked)?) disabled>/g, "$1>"),
    [content, exists],
  );

  // React swapped the HTML, which replaced the focused checkbox: focus its replacement.
  useLayoutEffect(() => {
    const i = refocus.current;
    refocus.current = null;
    if (i != null && ref.current) ownBoxes(ref.current)[i]?.focus({ preventScroll: true });
  }, [html]);

  // Fill note embeds, then draw formulas and diagrams (in the note and in each embed).
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
    const draw = (el: HTMLElement) => {
      void renderMath(el, signal);
      void renderMermaid(el, signal);
    };
    draw(root);
    void hydrateEmbeds(root, {
      load,
      render: (md) => renderMarkdown(md, (t) => existsRef.current(t)),
      signal,
      onRendered: draw,
      chain: noteId ? [noteId] : [],
    });
    return () => {
      signal.cancelled = true;
    };
  }, [html, noteId]);

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

  const openNoteLink = (href: string, newTab: boolean) => {
    const target = decodeURIComponent(href.slice(9).split("#")[0]);
    if (target) onOpenLink(target, newTab);
  };

  return (
    <article
      ref={ref}
      className="reading"
      dangerouslySetInnerHTML={{ __html: html }}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        const href = (e.target as HTMLElement).closest("a")?.getAttribute("href") ?? "";
        if (href.startsWith("wikilink:")) {
          e.preventDefault();
          openNoteLink(href, true);
        } else if (href.startsWith("tag:")) {
          e.preventDefault();
          onOpenTag(decodeURIComponent(href.slice(4)));
        }
      }}
      onClick={(e) => {
        const el = e.target as HTMLElement;
        if (el instanceof HTMLInputElement && el.type === "checkbox") {
          e.preventDefault();
          if (el.closest(".embed-body")) return; // embedded notes are read-only here
          const i = ownBoxes(e.currentTarget).indexOf(el);
          const next = toggleTask(content, i);
          if (next === content) return;
          if (document.activeElement === el) refocus.current = i;
          onToggleTask(next);
          return;
        }
        const a = el.closest("a");
        if (!a) return;
        const href = a.getAttribute("href") ?? "";
        if (href.startsWith("#")) {
          // Footnotes: scroll inside the note instead of changing the page URL.
          e.preventDefault();
          const raw = href.slice(1);
          let decoded = raw;
          try {
            decoded = decodeURIComponent(raw);
          } catch {}
          const scope = a.closest(".embed-body");
          const find = (id: string) =>
            [...e.currentTarget.querySelectorAll<HTMLElement>(`[id="${CSS.escape(id)}"]`)].find(
              (n) => n.closest(".embed-body") === scope,
            );
          const target = find(raw) ?? find(decoded);
          if (target) {
            target.scrollIntoView({ block: "center" });
            if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
            target.focus({ preventScroll: true });
          }
        } else if (href.startsWith("wikilink:")) {
          e.preventDefault();
          openNoteLink(href, e.ctrlKey || e.metaKey);
        } else if (href.startsWith("tag:")) {
          e.preventDefault();
          onOpenTag(decodeURIComponent(href.slice(4)));
        } else {
          // Anything that leaves the app opens in a new tab, never in this one.
          let url: URL;
          try {
            url = new URL(href, window.location.href);
          } catch {
            e.preventDefault();
            return;
          }
          if (url.origin === window.location.origin) return;
          if (url.protocol === "http:" || url.protocol === "https:") {
            e.preventDefault();
            window.open(url.href, "_blank", "noopener,noreferrer");
          }
        }
      }}
    />
  );
}
