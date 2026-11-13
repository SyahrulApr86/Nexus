"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { renderMarkdown } from "@/lib/markdown/render";
import { toggleTask, toggleTaskAt } from "@/lib/markdown/tasks";
import { hydrateEmbeds, type EmbedLoader } from "@/lib/markdown/embeds-client";
import { renderMermaid } from "@/lib/markdown/mermaid-client";
import { renderMath } from "@/lib/markdown/math-client";
import { api } from "./api";
import type { AttachmentLookup } from "@/lib/markdown/attachments";
import { useAttachmentLookup } from "./attachments/context";
import { Lightbox, type LightboxImage } from "./attachments/lightbox";

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
function safeRender(md: string, exists: (t: string) => boolean, attachments?: AttachmentLookup): string {
  try {
    return renderMarkdown(md, exists, attachments);
  } catch (err) {
    console.error("Reading view: could not render note", err);
    return `<p class="render-error">This note couldn’t be formatted, so it is shown as plain text.</p><pre class="render-plain">${escapeHtml(md)}</pre>`;
  }
}

/** A vault image in the note (not a linked one): it opens in the lightbox. */
const zoomable = (el: Element): el is HTMLImageElement =>
  el instanceof HTMLImageElement && (el.getAttribute("src") ?? "").startsWith("/api/attachments/file?") && !el.closest("a");

/** Reading view: sanitized HTML from the note, with wikilinks, tags, clickable tasks, embeds, attachments, math and diagrams. */
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
  // After a task toggle: the toggled box's offset, and which own callouts were open.
  const restore = useRef<{ offset: number; focus: boolean; open: number[] } | null>(null);
  const existsRef = useRef(exists);
  useEffect(() => {
    existsRef.current = exists;
  });
  const themeKey = useThemeKey();
  // Images, audio, video and PDFs resolve against the vault's attachments; the HTML is rebuilt when they change.
  const lookup = useAttachmentLookup();
  const lookupRef = useRef(lookup);
  useEffect(() => {
    lookupRef.current = lookup;
  });
  const [zoom, setZoom] = useState<LightboxImage | null>(null);
  const html = useMemo(
    () =>
      // GFM renders disabled checkboxes; this note's tasks are interactive (embeds stay read-only).
      safeRender(content, exists, lookup).replace(/(<input type="checkbox"(?: checked)?) disabled>/g, "$1>"),
    [content, exists, lookup],
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
      // Vault images open full size: reachable by keyboard, named for what they do.
      for (const img of el.querySelectorAll("img")) {
        if (!zoomable(img) || img.hasAttribute("tabindex")) continue;
        img.tabIndex = 0;
        img.setAttribute("role", "button");
        img.setAttribute("aria-haspopup", "dialog");
        img.setAttribute("aria-label", `View ${img.alt || "image"} full size`);
      }
    };
    draw(root);
    void hydrateEmbeds(root, {
      load,
      render: (md) => safeRender(md, (t) => existsRef.current(t), lookupRef.current),
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
    <>
      {zoom && <Lightbox image={zoom} onClose={() => setZoom(null)} />}
      <article
        ref={ref}
        className="reading"
        dangerouslySetInnerHTML={{ __html: html }}
        onKeyDown={(e) => {
          const el = e.target as Element;
          if ((e.key === "Enter" || e.key === " ") && zoomable(el)) {
            e.preventDefault();
            setZoom({ src: el.currentSrc || el.src, alt: el.alt });
          }
        }}
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
          if (zoomable(el)) {
            setZoom({ src: el.currentSrc || el.src, alt: el.alt });
            return;
          }
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
    </>
  );
}
