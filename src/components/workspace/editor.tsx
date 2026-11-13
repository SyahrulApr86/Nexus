"use client";

import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
  drawSelection,
  keymap,
  placeholder,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { HighlightStyle, syntaxHighlighting, syntaxTree, indentOnInput, bracketMatching } from "@codemirror/language";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type CompletionContext,
} from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { tags as t } from "@lezer/highlight";

export type EditorHandle = { scrollToLine: (line: number) => void; focus: () => void };

type Props = {
  initial: string;
  label: string;
  onChange: (content: string) => void;
  noteNames: () => string[];
  tagNames: () => string[];
  exists: (target: string) => boolean;
  onOpenLink: (target: string, newTab: boolean) => void;
  onOpenTag: (tag: string) => void;
  handleRef?: React.RefObject<EditorHandle | null>;
};

/* Note text is the document: Literata on a ~70ch measure. Chrome stays in the UI face. */
const theme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--fg)", fontSize: "17px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-note)", lineHeight: "1.65", overflow: "visible" },
  ".cm-content": { padding: "4px 0 45vh", caretColor: "var(--accent)" },
  ".cm-line": { padding: "0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "var(--selection)" },
  ".cm-gutters": { display: "none" },
});

const highlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.6em", fontWeight: "600", lineHeight: "1.3" },
  { tag: t.heading2, fontSize: "1.35em", fontWeight: "600" },
  { tag: t.heading3, fontSize: "1.15em", fontWeight: "600" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "600" },
  { tag: t.strong, fontWeight: "650" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--muted)" },
  { tag: t.link, color: "var(--accent-ink)" },
  { tag: t.url, color: "var(--faint)" },
  {
    tag: t.monospace,
    fontFamily: "var(--font-code)",
    fontSize: "0.84em",
    backgroundColor: "var(--code-bg)",
    borderRadius: "4px",
  },
  { tag: t.quote, color: "var(--muted)" },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: "var(--faint)" },
  { tag: [t.keyword, t.operator], color: "var(--accent-ink)" },
  { tag: [t.string, t.special(t.string)], color: "var(--positive)" },
  { tag: [t.number, t.bool, t.atom], color: "var(--mark-ink)" },
  { tag: t.comment, color: "var(--faint)" },
  { tag: [t.function(t.variableName), t.typeName, t.className], color: "var(--accent-ink)" },
]);

/** True when `pos` sits inside inline code or a code block. */
function inCode(view: EditorView, pos: number) {
  let n: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(view.state).resolveInner(pos, 1);
  for (; n; n = n.parent) if (/Code/.test(n.name)) return true;
  return false;
}

function decorator(matcher: MatchDecorator) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = matcher.createDeco(view);
      }
      update(u: ViewUpdate) {
        this.decorations = matcher.updateDeco(u, this.decorations);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

const linkDecorations = (exists: () => (target: string) => boolean) =>
  decorator(
    new MatchDecorator({
      regexp: /!?\[\[([^\[\]\n]+?)\]\]/g,
      decorate: (add, from, to, m, view) => {
        if (inCode(view, from)) return;
        const target = m[1].split("|")[0].split("#")[0].trim();
        const ok = !target || exists()(target);
        add(
          from,
          to,
          Decoration.mark({
            class: ok ? "cm-wikilink" : "cm-wikilink cm-wikilink-ghost",
            attributes: { "data-target": target, title: ok ? `Ctrl+click to open ${target}` : `${target} (not created yet)` },
          }),
        );
      },
    }),
  );

const tagDecorations = decorator(
  new MatchDecorator({
    regexp: /(^|[\s(])(#[\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu,
    decorate: (add, from, _to, m, view) => {
      const start = from + m[1].length;
      if (inCode(view, start)) return;
      add(start, start + m[2].length, Decoration.mark({ class: "cm-tag", attributes: { "data-tag": m[2].slice(1) } }));
    },
  }),
);

const highlightDecorations = decorator(
  new MatchDecorator({
    regexp: /==([^=\n]+)==/g,
    decorate: (add, from, to, _m, view) => {
      if (inCode(view, from)) return;
      add(from, to, Decoration.mark({ class: "cm-highlight" }));
    },
  }),
);

export function Editor({ initial, label, onChange, noteNames, tagNames, exists, onOpenLink, onOpenTag, handleRef }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const cb = useRef({ onChange, noteNames, tagNames, exists, onOpenLink, onOpenTag });
  useEffect(() => {
    cb.current = { onChange, noteNames, tagNames, exists, onOpenLink, onOpenTag };
  });

  useEffect(() => {
    if (!host.current) return;

    const linkCompletion = (ctx: CompletionContext) => {
      const m = ctx.matchBefore(/\[\[[^\]\n|#]*/);
      if (!m) return null;
      const after = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2);
      return {
        from: m.from + 2,
        options: cb.current.noteNames().map((name) => ({
          label: name,
          type: "text",
          apply: after === "]]" ? name : `${name}]]`,
        })),
        validFor: /^[^\]\n|#]*$/,
      };
    };

    const tagCompletion = (ctx: CompletionContext) => {
      const m = ctx.matchBefore(/(^|[\s(])#[\p{L}\p{N}_\-/]*/u);
      if (!m) return null;
      const hash = m.text.indexOf("#");
      return {
        from: m.from + hash + 1,
        options: cb.current.tagNames().map((tag) => ({ label: tag, type: "keyword" })),
        validFor: /^[\p{L}\p{N}_\-/]*$/u,
      };
    };

    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial,
        extensions: [
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightSelectionMatches(),
          EditorView.lineWrapping,
          theme,
          placeholder("Start writing. Type [[ to link a note."),
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          syntaxHighlighting(highlight),
          autocompletion({ override: [linkCompletion, tagCompletion], icons: false }),
          linkDecorations(() => cb.current.exists),
          tagDecorations,
          highlightDecorations,
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, ...completionKeymap, indentWithTab]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cb.current.onChange(u.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            mousedown(e) {
              if (!(e.ctrlKey || e.metaKey)) return false;
              const el = e.target as HTMLElement;
              const link = el.closest<HTMLElement>("[data-target]");
              if (link?.dataset.target) {
                e.preventDefault();
                cb.current.onOpenLink(link.dataset.target, e.shiftKey);
                return true;
              }
              const tag = el.closest<HTMLElement>("[data-tag]");
              if (tag?.dataset.tag) {
                e.preventDefault();
                cb.current.onOpenTag(tag.dataset.tag);
                return true;
              }
              return false;
            },
          }),
          EditorView.contentAttributes.of({
            spellcheck: "true",
            autocapitalize: "sentences",
            "aria-label": label,
            "aria-multiline": "true",
          }),
        ],
      }),
    });

    if (handleRef)
      handleRef.current = {
        focus: () => view.focus(),
        scrollToLine: (line: number) => {
          const l = view.state.doc.line(Math.min(line + 1, view.state.doc.lines));
          view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: "start", yMargin: 80 }) });
          view.focus();
        },
      };

    return () => view.destroy();
    // The editor is keyed by note id by the parent; `initial` only seeds it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} />;
}
