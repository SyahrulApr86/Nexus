"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { Compartment, EditorState, RangeSetBuilder, type Extension } from "@codemirror/state";
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
import { defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { typewriter } from "./focus/typewriter"; // focus
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
import { frontmatterEnd, livePreview } from "./live-preview";
import { isMac } from "./ui";
/* render: heading and block links (follow, autocomplete, "Copy block link") */
import { useState } from "react";
import { revealFragment } from "./live-preview";
import { Menu, type MenuAnchor, type MenuItem } from "./ui";
import { api } from "./api";
import { blockTargetAt, extractBlockIds, newBlockId } from "@/lib/markdown/blocks";
import { extractHeadings } from "@/lib/markdown/parse";
import { onFragment, parseFragment, queueFragment, takeFragment } from "@/lib/markdown/fragment-nav";
/* end render */
/* attachments-ui: paste and drop uploads, image previews, attachment links */
import { useAttachments } from "./attachments/context";
import { attachmentUploads } from "./attachments/editor-uploads";
import { imageEmbeds, refreshImages } from "./attachments/image-embeds";
import { uploadFolder } from "./attachments/model";
/* end attachments-ui */
/* collab-editor: live collaboration binding */
import { bindCollab, collabExtensions, collabSlots } from "./collab/binding";
/* end collab-editor */

export type EditorHandle = {
  scrollToLine: (line: number) => void;
  focus: () => void;
  /* templates-properties: insert at the cursor (templates) and rewrite frontmatter (properties) */
  /** The caret's offset in the note text. */
  cursor: () => number;
  /** Replace a range as one undoable edit, past any edit filters; `select` puts the caret there (new text offsets). */
  apply: (change: { from: number; to: number; insert: string }, select?: number) => void;
  /* end templates-properties */
  /* render: "Copy block link" (or "Copy link to heading") for the caret's line, for a palette command */
  copyBlockLink: () => void;
  /* end render */
};

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
  /** templates-properties: extra extensions, read when the editor mounts (it is keyed to remount). */
  extensions?: Extension[];
  /* attachments-ui: the note's path, for "same folder as the note" uploads */
  notePath?: string;
  /* collab-editor: the note to bind to the live session, when the collab service is reachable */
  noteId?: string;
  /* end collab-editor */
};

/* Note text is the document: Literata on a ~70ch measure. Chrome stays in the UI face. */
const theme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--fg)", fontSize: "17px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-note)", lineHeight: "1.7", overflow: "visible" },
  ".cm-content": { padding: "4px 0 45vh", caretColor: "var(--accent)" },
  ".cm-line": { padding: "0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "var(--selection)" },
  ".cm-gutters": { display: "none" },
  ".cm-line.cm-codeblock": {
    fontFamily: "var(--font-code)",
    fontSize: "0.84em",
    lineHeight: "1.7",
    backgroundColor: "var(--code-bg)",
    padding: "0 16px",
  },
  ".cm-line.cm-codeblock.cm-codeblock-first": { paddingTop: "8px", borderTopLeftRadius: "8px", borderTopRightRadius: "8px" },
  ".cm-line.cm-codeblock.cm-codeblock-last": { paddingBottom: "8px", borderBottomLeftRadius: "8px", borderBottomRightRadius: "8px" },
  // Frontmatter is YAML, not note text: the code face on the same band as the reading view,
  // with markdown styling (setext headings, [links]) switched off inside it.
  ".cm-line.cm-frontmatter": {
    fontFamily: "var(--font-code)",
    fontSize: "0.84em",
    lineHeight: "1.7",
    color: "var(--muted)",
    backgroundColor: "var(--code-bg)",
    padding: "0 16px",
  },
  ".cm-line.cm-frontmatter *": {
    font: "inherit",
    color: "inherit",
    textDecoration: "none",
    backgroundColor: "transparent",
  },
  ".cm-line.cm-frontmatter.cm-frontmatter-first": { paddingTop: "8px", borderTopLeftRadius: "8px", borderTopRightRadius: "8px" },
  ".cm-line.cm-frontmatter.cm-frontmatter-last": { paddingBottom: "8px", borderBottomLeftRadius: "8px", borderBottomRightRadius: "8px" },
  // Markup characters ([[ ]], target|, == ==) recede in source, like # and list marks.
  ".cm-formatting, .cm-formatting *": { color: "var(--faint)" },
  ".cm-wikilink-ghost, .cm-wikilink-ghost *": { color: "var(--faint)" },
  // Off-palette CodeMirror defaults, mapped onto the tokens.
  "&.cm-focused .cm-matchingBracket": { backgroundColor: "transparent", outline: "1px solid var(--accent)", borderRadius: "2px" },
  "&.cm-focused .cm-nonmatchingBracket": {
    backgroundColor: "transparent",
    textDecoration: "underline wavy var(--negative)",
    textUnderlineOffset: "3px",
  },
  ".cm-selectionMatch": { backgroundColor: "var(--accent-soft)" },
  ".cm-searchMatch": { backgroundColor: "var(--mark-soft)", outline: "1px solid var(--mark)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--hl)" },
  // In-note find and replace panel (Ctrl/Cmd+F) in the app's tokens, both themes.
  ".cm-panels": { backgroundColor: "var(--frame)", color: "var(--fg)", borderColor: "var(--border)" },
  ".cm-panel.cm-search": { padding: "6px 40px 6px 8px", fontFamily: "var(--font-ui)", fontSize: "13px" },
  ".cm-textfield": {
    backgroundColor: "var(--sheet)",
    color: "var(--fg)",
    border: "1px solid var(--control)",
    borderRadius: "6px",
    fontSize: "13px",
    padding: "4px 8px",
  },
  ".cm-textfield:focus-visible": { outline: "2px solid var(--focus)", outlineOffset: "1px" },
  ".cm-button, .cm-button:active": {
    backgroundImage: "none",
    backgroundColor: "var(--sheet)",
    color: "var(--fg)",
    border: "1px solid var(--control)",
    borderRadius: "6px",
    fontSize: "13px",
    padding: "4px 10px",
  },
  ".cm-button:hover": { backgroundColor: "var(--hover)" },
  ".cm-panel.cm-search label": { fontSize: "13px", color: "var(--muted)" },
  ".cm-panel.cm-search input[type=checkbox]": { accentColor: "var(--accent)" },
  ".cm-panel.cm-search [name=close]": {
    color: "var(--faint)",
    width: "28px",
    height: "28px",
    top: "4px",
    right: "6px",
    borderRadius: "6px",
  },
});

const searchPhrases = EditorState.phrases.of({
  next: "Next",
  previous: "Previous",
  all: "Select all",
  "match case": "Match case",
  regexp: "Regex",
  "by word": "Whole word",
  replace: "Replace",
  "replace all": "Replace all",
  close: "Close",
  Find: "Find",
});

/** Fenced and indented code blocks get the code face on a tinted band, line by line. */
const codeMid = Decoration.line({ class: "cm-codeblock" });
const codeFirst = Decoration.line({ class: "cm-codeblock cm-codeblock-first" });
const codeLast = Decoration.line({ class: "cm-codeblock cm-codeblock-last" });
const codeOnly = Decoration.line({ class: "cm-codeblock cm-codeblock-first cm-codeblock-last" });
const codeBlocks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = this.build(u.view);
    }
    build(view: EditorView) {
      const b = new RangeSetBuilder<Decoration>();
      let last = -1;
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from,
          to,
          enter: (node) => {
            if (node.name !== "FencedCode" && node.name !== "CodeBlock") return;
            const firstFrom = view.state.doc.lineAt(node.from).from;
            const lastFrom = view.state.doc.lineAt(node.to).from;
            for (let pos = node.from; pos <= node.to; ) {
              const line = view.state.doc.lineAt(pos);
              if (line.from > last) {
                const isFirst = line.from === firstFrom;
                const isLast = line.from === lastFrom;
                b.add(line.from, line.from, isFirst && isLast ? codeOnly : isFirst ? codeFirst : isLast ? codeLast : codeMid);
                last = line.from;
              }
              pos = line.to + 1;
            }
            return false;
          },
        });
      }
      return b.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

/** A leading YAML frontmatter block gets the code band, line by line. */
const fmMid = Decoration.line({ class: "cm-frontmatter" });
const fmFirst = Decoration.line({ class: "cm-frontmatter cm-frontmatter-first" });
const fmLast = Decoration.line({ class: "cm-frontmatter cm-frontmatter-last" });
function frontmatterLines(state: EditorState): DecorationSet {
  const end = frontmatterEnd(state);
  if (!end) return Decoration.none;
  const b = new RangeSetBuilder<Decoration>();
  const last = state.doc.lineAt(end).number;
  for (let n = 1; n <= last; n++) b.add(state.doc.line(n).from, state.doc.line(n).from, n === 1 ? fmFirst : n === last ? fmLast : fmMid);
  return b.finish();
}
const frontmatterBand = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = frontmatterLines(view.state);
    }
    update(u: ViewUpdate) {
      if (u.docChanged) this.decorations = frontmatterLines(u.state);
    }
  },
  { decorations: (v) => v.decorations },
);

const highlight = HighlightStyle.define([
  // Headings in the interface face, set tight: Literata carries the prose, Hanken the structure.
  { tag: t.heading1, fontFamily: "var(--font-ui)", fontSize: "1.6em", fontWeight: "600", lineHeight: "1.25", letterSpacing: "-0.025em" },
  { tag: t.heading2, fontFamily: "var(--font-ui)", fontSize: "1.32em", fontWeight: "600", letterSpacing: "-0.02em" },
  { tag: t.heading3, fontFamily: "var(--font-ui)", fontSize: "1.1em", fontWeight: "600", letterSpacing: "-0.01em" },
  { tag: [t.heading4, t.heading5, t.heading6], fontFamily: "var(--font-ui)", fontWeight: "600" },
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
  // Code uses neutral steps only: blue means link, orange means tag, green means saved.
  { tag: t.keyword, color: "var(--muted)", fontWeight: "600" },
  { tag: t.operator, color: "var(--muted)" },
  { tag: [t.string, t.special(t.string)], color: "var(--fg)" },
  { tag: [t.number, t.bool], color: "var(--fg)" },
  { tag: t.atom, color: "var(--faint)" }, // task markers [ ] stay neutral
  { tag: t.comment, color: "var(--faint)", fontStyle: "italic" },
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

const formatting = Decoration.mark({ class: "cm-formatting" });
const highlightMark = Decoration.mark({ class: "cm-highlight" });

/** A shortcut in the platform's words, as the app's tooltips show it: "Mod+Click" is "Ctrl+click" or "⌘-click". */
function keyLabel(keys: string, mac = isMac()) {
  const parts = keys
    .split("+")
    .map((k) => (k === "Mod" ? (mac ? "\u2318" : "Ctrl") : !mac ? k : k === "Alt" ? "\u2325" : k === "Shift" ? "\u21e7" : k === "Enter" ? "\u21a9" : k));
  if (parts.at(-1) === "Click") return `${parts.slice(0, -1).join(mac ? "" : "+")}${mac ? "-" : "+"}click`;
  return parts.join(mac ? "" : "+");
}
const noopSubscribe = () => () => {};

const linkDecorations = (exists: () => (target: string) => boolean) =>
  decorator(
    new MatchDecorator({
      regexp: /!?\[\[([^\[\]\n]+?)\]\]/g,
      decorate: (add, from, to, m, view) => {
        if (inCode(view, from)) return;
        const target = m[1].split("|")[0].split("#")[0].trim();
        /* render: the "#Heading" or "#^id" part travels with the link */
        const hashAt = m[1].split("|")[0].indexOf("#");
        const fragment = hashAt === -1 ? "" : m[1].split("|")[0].slice(hashAt + 1).trim();
        // `[[#Rollback]]` goes to "#Rollback" here; `[[Spec#^fields]]` opens "Spec › ^fields".
        const shown = !target ? `#${fragment}` : fragment ? `${target} \u203a ${fragment}` : target;
        /* end render */
        const ok = !target || exists()(target);
        const open = m[0].startsWith("!") ? 3 : 2;
        const pipe = m[1].indexOf("|");
        const textFrom = pipe !== -1 && m[1].slice(pipe + 1).trim() ? from + open + pipe + 1 : from + open;
        const textTo = pipe !== -1 && textFrom === from + open ? from + open + pipe : to - 2;
        // Marks must be added in ascending order.
        add(from, textFrom, formatting);
        if (textTo > textFrom)
          add(
            textFrom,
            textTo,
            Decoration.mark({
              class: ok ? "cm-wikilink" : "cm-wikilink cm-wikilink-ghost",
              attributes: {
                "data-target": target,
                "data-fragment": fragment, // render
                role: "link",
                title: ok
                  ? `${target ? "Open" : "Go to"} ${shown}: ${keyLabel("Mod+Click")}, or ${keyLabel("Alt+Enter")} at the caret` // render
                  : `${target} is not created yet. ${keyLabel("Mod+Click")}, or ${keyLabel("Alt+Enter")} at the caret, creates it`,
              },
            }),
          );
        if (to - 2 > textTo) add(textTo, to - 2, formatting);
        add(to - 2, to, formatting);
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
      add(from, from + 2, formatting);
      add(from + 2, to - 2, highlightMark);
      add(to - 2, to, formatting);
    },
  }),
);

export function Editor({ initial, label, onChange, noteNames, tagNames, exists, onOpenLink, onOpenTag, handleRef, extensions, notePath, noteId }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const labelSlot = useRef(new Compartment());
  /* collab-editor */
  const collab = useRef(collabSlots());
  /* end collab-editor */
  const hintId = useId();
  // Platform is client-only; the server snapshot uses the Ctrl wording.
  const mac = useSyncExternalStore(noopSubscribe, isMac, () => false);
  const cb = useRef({ onChange, noteNames, tagNames, exists, onOpenLink, onOpenTag });
  useEffect(() => {
    cb.current = { onChange, noteNames, tagNames, exists, onOpenLink, onOpenTag };
  });

  /* attachments-ui: a link or embed that names an attachment is not a missing note; following it opens the file */
  const att = useAttachments();
  const attRef = useRef({ att, notePath });
  useEffect(() => {
    attRef.current = { att, notePath };
    const a = att;
    if (!a) return;
    cb.current.exists = (t) => exists(t) || !!a.lookup(t);
    cb.current.onOpenLink = (t, newTab) => {
      const file = exists(t) ? null : a.lookup(t);
      if (file) a.open(file.path, newTab ? "tab" : "current");
      else onOpenLink(t, newTab);
    };
  });
  // New or deleted files change which embeds resolve: redraw the previews.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: refreshImages.of(null) });
  }, [att?.lookup]);
  /* end attachments-ui */

  /* render: heading and block links */
  const [blockMenu, setBlockMenu] = useState<{ anchor: MenuAnchor; items: MenuItem[] } | null>(null);
  const lastPointer = useRef({ type: "mouse", button: 0, at: 0 });
  /** Follow a link; a "#Heading" or "#^id" fragment scrolls the opened note (or this one) to it. */
  const followRef = useRef<(target: string, newTab: boolean, fragment?: string) => void>(() => {});
  /** The caret's block or heading as a link, copied; a block without an id gets one first. */
  const copyBlockLinkRef = useRef<(view: EditorView, pos: number) => void>(() => {});
  useEffect(() => {
    followRef.current = (target, newTab, fragment) => {
      const f = parseFragment(fragment);
      const view = viewRef.current;
      if (!f) {
        if (target) cb.current.onOpenLink(target, newTab);
        return;
      }
      if (!target) {
        if (view) revealFragment(view, f);
        return;
      }
      void api
        .resolve(target)
        .then((r) => {
          if (r.id && r.id === noteId && !newTab && view && revealFragment(view, f)) return;
          if (r.id) queueFragment(r.id, f);
          cb.current.onOpenLink(target, newTab);
        })
        .catch(() => cb.current.onOpenLink(target, newTab));
    };
    copyBlockLinkRef.current = (view, pos) => {
      const notify = (message: string, error?: boolean) => attRef.current.att?.notify(message, error);
      const doc = view.state.doc.toString();
      const t = blockTargetAt(doc, view.state.doc.lineAt(pos).number - 1);
      if (t.kind === "none") return;
      const name = (notePath ? notePath.slice(notePath.lastIndexOf("/") + 1) : label.replace(/, note text$/, "")).replace(/\.md$/i, "");
      let link: string;
      if (t.kind === "heading") link = `[[${name}#${t.text}]]`;
      else {
        const id = t.id ?? newBlockId(doc);
        if (!t.id) {
          const line = view.state.doc.line(t.line + 1);
          view.dispatch({
            changes: { from: line.to, insert: `${/\s$/.test(line.text) ? "" : " "}^${id}` },
            userEvent: "input.blockid",
          });
        }
        link = `[[${name}#^${id}]]`;
      }
      navigator.clipboard.writeText(link).then(
        () => notify(t.kind === "heading" ? "Heading link copied" : "Block link copied"),
        () => notify("Couldn’t copy the link. Check the browser’s clipboard permission.", true),
      );
    };
  });
  // A heading or block link that opened this note: scroll to it once the view exists. Deferred a
  // tick, so a development double mount reveals on the view that stays.
  useEffect(() => {
    let timer = 0;
    const show = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const view = viewRef.current;
        const f = view ? takeFragment(noteId) : null;
        if (view && f) revealFragment(view, f);
      }, 0);
    };
    show();
    const off = onFragment(show);
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [noteId]);
  /* end render */

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

    /* render: `[[Note#` offers that note's headings, `[[Note#^` its block ids (`[[#` this note's) */
    const notes = new Map<string, { at: number; text: Promise<string | null> }>();
    const noteText = (target: string) => {
      const key = target.toLowerCase();
      const hit = notes.get(key);
      if (hit && Date.now() - hit.at < 15_000) return hit.text;
      const text = api
        .resolve(target)
        .then(async (r) => (r.id ? (await api.get(r.id)).content : null))
        .catch(() => null);
      notes.set(key, { at: Date.now(), text });
      return text;
    };
    const fragmentCompletion = async (ctx: CompletionContext) => {
      const m = ctx.matchBefore(/\[\[[^\]\n|#]*#\^?[^\]\n|#^]*/);
      if (!m) return null;
      const inner = m.text.slice(2);
      const hash = inner.indexOf("#");
      const target = inner.slice(0, hash).trim();
      const block = inner[hash + 1] === "^";
      const content = target ? await noteText(target) : ctx.state.doc.toString();
      if (content === null || ctx.aborted) return null;
      const close = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2) === "]]" ? "" : "]]";
      return {
        from: m.from + 2 + hash + 1 + (block ? 1 : 0),
        options: block
          ? extractBlockIds(content).map((b) => ({ label: b.id, detail: b.text, type: "text", apply: `${b.id}${close}` }))
          : extractHeadings(content).map((h) => ({
              label: h.text,
              detail: `Heading ${h.level}`,
              type: "text",
              apply: `${h.text}${close}`,
            })),
        validFor: /^[^\]\n|#^]*$/,
      };
    };
    /* end render */

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
          /* collab-editor: CodeMirror history in REST mode, yCollab (and its undo) while live */
          collabExtensions(collab.current),
          /* end collab-editor */
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
          autocompletion({ override: [linkCompletion, fragmentCompletion /* render */, tagCompletion], icons: false }),
          linkDecorations(() => cb.current.exists),
          tagDecorations,
          highlightDecorations,
          codeBlocks,
          frontmatterBand,
          /* render: links carry their fragment; rendered callouts resolve notes, tags and images */
          livePreview({
            openLink: (target, newTab, fragment) => followRef.current(target, newTab, fragment),
            exists: () => cb.current.exists,
            openTag: (tag) => cb.current.onOpenTag(tag),
            attachments: () => attRef.current.att?.lookup,
          }),
          /* end render */
          /* attachments-ui */
          imageEmbeds(() => attRef.current.att?.lookup ?? (() => null)),
          attachmentUploads(() => {
            const a = attRef.current.att;
            if (!a) return null;
            return {
              upload: (file) => a.upload(file, uploadFolder(a.settings, attRef.current.notePath)),
              notify: (message, error) => a.notify(message, error),
            };
          }),
          /* end attachments-ui */
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, ...completionKeymap, indentWithTab]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cb.current.onChange(u.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            mousedown(e) {
              if (!(e.ctrlKey || e.metaKey)) return false;
              const el = e.target as HTMLElement;
              const link = el.closest<HTMLElement>("[data-target]");
              /* render: follow with the fragment; `[[#Heading]]` has no target */
              if (link && (link.dataset.target || link.dataset.fragment)) {
                e.preventDefault();
                followRef.current(link.dataset.target ?? "", e.shiftKey, link.dataset.fragment || undefined);
                return true;
              }
              /* end render */
              const tag = el.closest<HTMLElement>("[data-tag]");
              if (tag?.dataset.tag) {
                e.preventDefault();
                cb.current.onOpenTag(tag.dataset.tag);
                return true;
              }
              return false;
            },
          }),
          /* render: the editor's context menu (right click, the Menu key, Shift+F10 or a long press).
             Shift+right click keeps the browser's own menu (spelling); so does a long press that
             selected text, for the selection handles. A long press with nothing selected opens this
             menu, so a phone without a keyboard can still copy a block link. */
          EditorView.domEventHandlers({
            pointerdown(e) {
              lastPointer.current = { type: e.pointerType, button: e.button, at: Date.now() };
              return false;
            },
            contextmenu(e, view) {
              const p = lastPointer.current;
              const recent = Date.now() - p.at < 1000;
              const byTouch = recent && (p.type === "touch" || p.type === "pen");
              if (e.shiftKey) return false;
              if (byTouch) {
                const dom = document.getSelection();
                const domSelected = !!dom && !dom.isCollapsed && view.contentDOM.contains(dom.anchorNode);
                if (domSelected || !view.state.selection.main.empty) return false;
              }
              const byPointer = recent && (p.button === 2 || byTouch);
              let pos = view.state.selection.main.head;
              if (byPointer) {
                const at = view.posAtCoords({ x: e.clientX, y: e.clientY });
                const sel = view.state.selection.main;
                if (at !== null && !(at >= sel.from && at <= sel.to)) {
                  view.dispatch({ selection: { anchor: at } });
                  pos = at;
                }
              }
              const caret = view.coordsAtPos(pos);
              // A long press opens the menu below the line, clear of the finger.
              const anchor: MenuAnchor = byTouch
                ? { x: e.clientX, y: (caret?.bottom ?? e.clientY) + 8 }
                : byPointer
                  ? { x: e.clientX, y: e.clientY }
                  : { x: caret?.left ?? 0, y: caret?.bottom ?? 0 };
              if (byTouch) {
                // The finger lifting must not move focus out of the menu or pick an item: drop the
                // mouse events a browser may still send for that touch.
                const until = Date.now() + 700;
                const drop = (ev: MouseEvent) => {
                  if (Date.now() > until) return;
                  ev.preventDefault();
                  ev.stopPropagation();
                };
                for (const type of ["mousedown", "mouseup", "click"]) document.addEventListener(type, drop as EventListener, true);
                window.setTimeout(() => {
                  for (const type of ["mousedown", "mouseup", "click"]) document.removeEventListener(type, drop as EventListener, true);
                }, 700);
              }
              const sel = view.state.selection.main;
              const selected = view.state.sliceDoc(sel.from, sel.to);
              const target = blockTargetAt(view.state.doc.toString(), view.state.doc.lineAt(pos).number - 1);
              const notify = (message: string, error?: boolean) => attRef.current.att?.notify(message, error);
              const copy = (cut: boolean) =>
                navigator.clipboard.writeText(selected).then(
                  () => {
                    if (cut) view.dispatch({ changes: { from: sel.from, to: sel.to }, userEvent: "delete.cut" });
                  },
                  () => notify(`Couldn’t ${cut ? "cut" : "copy"}. Use ${isMac() ? "⌘" : "Ctrl+"}${cut ? "X" : "C"} instead.`, true),
                );
              e.preventDefault();
              setBlockMenu({
                anchor,
                items: [
                  { label: "Cut", shortcut: "Mod+X", disabled: !selected, onSelect: () => void copy(true) },
                  { label: "Copy", shortcut: "Mod+C", disabled: !selected, onSelect: () => void copy(false) },
                  {
                    label: "Paste",
                    shortcut: "Mod+V",
                    onSelect: () =>
                      void navigator.clipboard.readText().then(
                        (text) => view.dispatch(view.state.replaceSelection(text), { userEvent: "input.paste", scrollIntoView: true }),
                        () => notify(`Couldn’t paste here. Use ${isMac() ? "⌘V" : "Ctrl+V"} instead.`, true),
                      ),
                  },
                  "separator",
                  {
                    label: target.kind === "heading" ? "Copy link to heading" : "Copy block link",
                    disabled: target.kind === "none",
                    onSelect: () => copyBlockLinkRef.current(view, pos),
                  },
                ],
              });
              return true;
            },
          }),
          /* end render */
          EditorView.contentAttributes.of({
            spellcheck: "true",
            autocapitalize: "sentences",
            "aria-multiline": "true",
            "aria-describedby": hintId,
          }),
          labelSlot.current.of(EditorView.contentAttributes.of({ "aria-label": label })),
          searchPhrases,
          typewriter(), // focus: typewriter mode keeps the caret line centred (src/components/workspace/focus)
          extensions ?? [],
        ],
      }),
    });

    viewRef.current = view;
    /* collab-editor */
    const releaseCollab = noteId ? bindCollab(view, noteId, collab.current) : () => {};
    /* end collab-editor */
    return () => {
      viewRef.current = null;
      releaseCollab(); // collab-editor: unbind before the view goes
      view.destroy();
    };
    // The editor is keyed by note id by the parent; `initial` only seeds it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the accessible name current when the note is renamed.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: labelSlot.current.reconfigure(EditorView.contentAttributes.of({ "aria-label": label })),
    });
  }, [label]);

  // Handle contract: set while mounted (and whenever the parent hands over a ref), reset to null
  // on unmount or ref change if it is still ours, so a closed pane never receives focus calls.
  useEffect(() => {
    if (!handleRef) return;
    const handle: EditorHandle = {
      focus: () => viewRef.current?.focus(),
      scrollToLine: (line: number) => {
        const view = viewRef.current;
        if (!view) return;
        const l = view.state.doc.line(Math.min(line + 1, view.state.doc.lines));
        view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: "start", yMargin: 80 }) });
        view.focus();
      },
      /* templates-properties */
      cursor: () => viewRef.current?.state.selection.main.head ?? 0,
      apply: (change, select) => {
        const view = viewRef.current;
        if (!view) return;
        const to = Math.min(change.to, view.state.doc.length);
        view.dispatch({
          changes: { from: Math.min(change.from, to), to, insert: change.insert },
          selection: select === undefined ? undefined : { anchor: select },
          scrollIntoView: select !== undefined,
          // Programmatic: frontmatter guards (properties-extension.tsx) must not block it.
          filter: false,
          userEvent: "input.properties",
        });
      },
      /* end templates-properties */
      /* render */
      copyBlockLink: () => {
        const view = viewRef.current;
        if (view) copyBlockLinkRef.current(view, view.state.selection.main.head);
      },
      /* end render */
    };
    handleRef.current = handle;
    return () => {
      if (handleRef.current === handle) handleRef.current = null;
    };
  }, [handleRef]);

  return (
    <>
      <div ref={host} />
      {/* render */}
      {blockMenu && (
        <Menu anchor={blockMenu.anchor} items={blockMenu.items} label="Editor actions" onClose={() => setBlockMenu(null)} />
      )}
      {/* end render */}
      <p id={hintId} className="sr-only">
        Tab indents. To leave the editor, press Escape, then Tab. {mac ? "Shift+Option+M" : "Ctrl+M"} switches Tab to
        moving focus. {mac ? "Option+Return" : "Alt+Enter"} opens the link at the caret.
      </p>
    </>
  );
}
