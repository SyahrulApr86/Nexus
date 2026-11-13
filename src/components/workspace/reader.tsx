"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { renderMarkdown } from "@/lib/markdown/render";
import { toggleTask, toggleTaskAt } from "@/lib/markdown/tasks";
import { hydrateEmbeds, type EmbedLoader } from "@/lib/markdown/embeds-client";
import { renderMermaid } from "@/lib/markdown/mermaid-client";
import { renderMath } from "@/lib/markdown/math-client";
import { api } from "./api";

export { toggleTask, toggleTaskAt };

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

/** Elements matching `selector` that belong to this note, not to an embedded one. */
const own = <T extends Element>(root: Element, selector: string) =>
  [...root.querySelectorAll<T>(selector)].filter((el) => !el.closest(".embed-body"));

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Render, or show the note as escaped plain text if the renderer throws, so one odd note cannot take down the workspace. */
function safeRender(md: string, exists: (t: string) => boolean): string {
  try {
    return renderMarkdown(md, exists);
  } catch (err) {
    console.error("Reading view: could not render note", err);
    return `<p class="render-error">This note couldn’t be formatted, so it is shown as plain text.</p><pre class="render-plain">${escapeHtml(md)}</pre>`;
  }
}

/** Reading view: sanitized HTML from the note, with wikilinks, tags, clickable tasks, embeds, math and diagrams. */
export function Reader({
  content,
  noteId,
  exists,
  onOpenLink,
  onOpenTag,
  onToggleTask,
  hideFrontmatter,
}: {
  content: string;
  /** The open note; lets the embed cycle guard stop at the note itself. */
  noteId?: string;
  exists: (t: string) => boolean;
  onOpenLink: (t: string, newTab?: boolean) => void;
  onOpenTag: (t: string) => void;
  onToggleTask: (content: string) => void;
  /** templates-properties: the properties block shows the frontmatter, so the raw box is hidden. */
  hideFrontmatter?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  // After a task toggle: the toggled box's offset, and which own callouts were open.
  const restore = useRef<{ offset: number; focus: boolean; open: number[] } | null>(null);
  const existsRef = useRef(exists);
  useEffect(() => {
    existsRef.current = exists;
  });
  const themeKey = useThemeKey();
  const html = useMemo(
    () =>
      // GFM renders disabled checkboxes; this note's tasks are interactive (embeds stay read-only).
      safeRender(content, exists).replace(/(<input type="checkbox"(?: checked)?) disabled>/g, "$1>"),
    [content, exists],
  );

  // React swapped the HTML after a task toggle: reopen the folded callouts that were
  // open (the new <details> start closed), then focus the toggled box's replacement.
  useLayoutEffect(() => {
    const r = restore.current;
    restore.current = null;
    const root = ref.current;
    if (!r || !root) return;
    const details = own<HTMLDetailsElement>(root, "details");
    for (const i of r.open) if (details[i]) details[i].open = true;
    if (r.focus)
      own<HTMLInputElement>(root, `li[data-task-offset="${r.offset}"] input[type="checkbox"]`)[0]?.focus({
        preventScroll: true,
      });
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
      render: (md) => safeRender(md, (t) => existsRef.current(t)),
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
      className={hideFrontmatter ? "reading hide-frontmatter" : "reading"}
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
          // The <li>'s source offset, not the box's position: rendered order differs
          // from source order (footnote definitions move to the end).
          const at = Number(el.closest("li[data-task-offset]")?.getAttribute("data-task-offset"));
          const next = toggleTaskAt(content, at);
          if (next === content) return;
          const open = own<HTMLDetailsElement>(e.currentTarget, "details").flatMap((d, i) => (d.open ? [i] : []));
          restore.current = { offset: at, focus: document.activeElement === el, open };
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
