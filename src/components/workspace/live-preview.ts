/**
 * Obsidian-style Live Preview for CodeMirror 6.
 *
 * Markdown syntax is hidden and rendered on every line except the lines the
 * selection touches (those show raw source, so editing is never blocked).
 * Built from the lezer markdown tree over the visible ranges only, and rebuilt
 * on document, selection, focus, viewport and parse changes.
 *
 * Rendered: ATX heading marks, emphasis/strong/strikethrough/inline-code marks,
 * ==highlight== marks, [text](url) links, <autolinks>, bare URLs, [[wikilinks]]
 * (brackets, alias targets, heading separators), task checkboxes, bullet
 * markers, blockquote marks, horizontal rules and code fence markers.
 * Callouts (`> [!tip]- Title`) render as the reading view's callout block,
 * folding included, until the selection enters them. Trailing `^blockid`
 * markers are hidden. Heading and block links (`[[Note#Heading]]`,
 * `[[Note#^id]]`) carry their fragment to `openLink`.
 * Left as source on purpose: tables, HTML, frontmatter, images, embeds
 * (![[note]]), ordered list numbers, setext headings, links whose syntax spans
 * lines, and everything inside those regions.
 *
 * Safety: a replace decoration never crosses a line break (CodeMirror forbids
 * that from plugins), and any unexpected parser edge case falls back to no
 * decorations instead of breaking the editor.
 */
import {
  EditorSelection,
  Prec,
  StateEffect,
  StateField,
  type Extension,
  type Range,
  type EditorState,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { renderMarkdown } from "@/lib/markdown/render";
import { renderMath } from "@/lib/markdown/math-client";
import { fragmentLine, type Fragment } from "@/lib/markdown/fragment-nav";
import type { AttachmentLookup } from "@/lib/markdown/attachments";

export type LivePreviewHandlers = {
  /**
   * Open a [[wikilink]] target; same callback the editor's Ctrl+click uses. `fragment` is what
   * follows the "#" ("Heading" or "^blockid"), when the link has one; the target is empty for a
   * link into this note (`[[#Heading]]`).
   */
  openLink: (target: string, newTab: boolean, fragment?: string) => void;
  /** Whether a note exists, so links in rendered callouts show missing notes as such. */
  exists?: () => (target: string) => boolean;
  /** Open a #tag (a tag inside a rendered callout). */
  openTag?: (tag: string) => void;
  /** Attachments, so images inside a rendered callout resolve. */
  attachments?: () => AttachmentLookup | undefined;
};

const WIKILINK = /(!?)\[\[([^\[\]\n]+?)\]\]/g;
/** A trailing block id: ` ^id` at the end of a line, or `^id` alone on it. */
const BLOCK_ID = /(^|[ \t])\^[A-Za-z0-9-]+[ \t]*$/gm;
/** First line of a callout: `> [!type]` (optionally `+`/`-` and a title). */
const CALLOUT_HEAD = /^ {0,3}>[ \t]?\[![A-Za-z][\w-]*\][+-]?/;
const HIGHLIGHT = /==([^=\n]+)==/g;
// Quote prefixes and stacked list markers are allowed ("> - [ ] x", "- - [ ] x").
const TASK_LINE = /^(\s*(?:>\s?)*\s*(?:(?:[-*+]|\d+[.)])\s+)+\[)([ xX])(\])/;
const LIST_LINE = /^(\s*(?:>\s?)*\s*(?:(?:[-*+]|\d+[.)])\s+)+)/;
const QUOTE_PREFIX = /^(\s*(?:>\s?)*\s*)/;
const RAW_REGIONS = /^(?:InlineCode|FencedCode|CodeBlock|CodeText|Table|HTMLBlock|HTMLTag|CommentBlock|Comment|Image|ProcessingInstructionBlock)$/;
const EMAIL = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/;

/* ------------------------------------------------------------------ */
/* Widgets                                                             */
/* ------------------------------------------------------------------ */

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly label: string,
  ) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.label === this.label;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-lp-checkbox";
    // One Tab stop for the editor, not one per task: Mod-L and the source cover keyboard use.
    box.tabIndex = -1;
    this.sync(box);
    box.addEventListener("change", () => {
      if (!toggleTaskAt(view, view.posAtDOM(box))) box.checked = !box.checked; // keep UI and source in step
    });
    return box;
  }
  /** Reuse the same element after a toggle so focus and undo history are not lost. */
  updateDOM(dom: HTMLElement) {
    this.sync(dom as HTMLInputElement);
    return true;
  }
  private sync(box: HTMLInputElement) {
    box.checked = this.checked;
    box.setAttribute("aria-label", this.label ? `Task: ${this.label}` : "Task");
  }
  ignoreEvent(e: Event) {
    // The checkbox owns its pointer events and Space, so clicking it neither moves the cursor nor
    // reveals the source. Modified keys (Ctrl/Cmd+Z, Mod-L, Ctrl+F, ...) still reach the editor's
    // keymap, so undo works right after a toggle while the checkbox keeps focus.
    return !(e instanceof KeyboardEvent && (e.ctrlKey || e.metaKey || e.altKey));
  }
}

class TextWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly className: string,
  ) {
    super();
  }
  eq(other: TextWidget) {
    return other.text === this.text && other.className === this.className;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = this.className;
    el.textContent = this.text;
    el.setAttribute("aria-hidden", "true");
    return el;
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-lp-hr";
    el.setAttribute("aria-hidden", "true");
    return el;
  }
}

/**
 * A callout drawn as the reading view draws it: the same renderer and the same `.reading .callout`
 * styles. Links, tags and task boxes inside it work; a foldable callout's title folds it; any other
 * click places the caret there, which turns the callout back into source for editing.
 */
class CalloutWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly handlers: LivePreviewHandlers,
  ) {
    super();
  }
  eq(other: CalloutWidget) {
    // Same source: keep the DOM, so a callout folded or opened here stays that way.
    return other.source === this.source;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-lp-callout reading";
    const exists = this.handlers.exists?.() ?? (() => true);
    let html: string;
    try {
      html = renderMarkdown(this.source, exists, this.handlers.attachments?.());
    } catch {
      html = "";
    }
    wrap.innerHTML = html;
    if (!wrap.querySelector(".callout")) {
      wrap.textContent = this.source; // never hide text the renderer could not draw
    }
    // Task boxes in the source text; links and tags open as in the reading view.
    for (const box of wrap.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      box.disabled = false;
      box.tabIndex = -1;
    }
    for (const a of wrap.querySelectorAll("a")) a.tabIndex = -1;
    for (const s of wrap.querySelectorAll("summary")) s.tabIndex = -1;
    void renderMath(wrap, { cancelled: false });

    wrap.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const el = e.target as HTMLElement;
      const summary = el.closest("summary");
      const a = el.closest("a");
      const box = el instanceof HTMLInputElement && el.type === "checkbox" ? el : null;
      if (!summary && !a && !box) return; // the editor places the caret
      e.preventDefault();
      if (box) {
        const at = Number(box.closest("li[data-task-offset]")?.getAttribute("data-task-offset"));
        const pos = view.posAtDOM(wrap) + at;
        const ch = view.state.doc.sliceString(pos, pos + 1);
        if (Number.isFinite(at) && /[ xX]/.test(ch))
          view.dispatch({ changes: { from: pos, to: pos + 1, insert: ch === " " ? "x" : " " }, userEvent: "input.toggle" });
        return;
      }
      if (a) {
        const href = a.getAttribute("href") ?? "";
        const decode = (s: string) => {
          try {
            return decodeURIComponent(s);
          } catch {
            return s;
          }
        };
        if (href.startsWith("wikilink:")) {
          if (a.classList.contains("ghost") && !(e.ctrlKey || e.metaKey)) return;
          const [t, ...f] = href.slice(9).split("#");
          this.handlers.openLink(decode(t), e.ctrlKey || e.metaKey, decode(f.join("#")) || undefined);
        } else if (href.startsWith("tag:")) this.handlers.openTag?.(decode(href.slice(4)));
        else if (safeHref(href)) window.open(safeHref(href)!, "_blank", "noopener,noreferrer");
        return;
      }
      const details = summary!.closest("details");
      if (details) {
        details.open = !details.open;
        view.requestMeasure();
      }
    });
    // The browser's own <summary> toggle would undo the one above.
    wrap.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("summary, a")) e.preventDefault();
    });
    return wrap;
  }
  ignoreEvent(e: Event) {
    const el = e.target as HTMLElement | null;
    // Links, task boxes and fold toggles belong to the widget; everything else to the editor.
    return !!el?.closest?.("summary, a, input");
  }
  get estimatedHeight() {
    return Math.max(48, this.source.split("\n").length * 29 + 24);
  }
}

/** Top-level callouts as whole-line ranges, from the syntax tree. */
function calloutRanges(state: EditorState): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  const fmEnd = frontmatterEnd(state);
  for (let n = syntaxTree(state).topNode.firstChild; n; n = n.nextSibling) {
    if (n.name !== "Blockquote" || n.from < fmEnd) continue;
    const first = state.doc.lineAt(n.from);
    if (!CALLOUT_HEAD.test(first.text)) continue;
    out.push({ from: first.from, to: state.doc.lineAt(n.to).to });
  }
  return out;
}

/** Callouts drawn as widgets: all of them, except one the selection touches while the editor has focus. */
function renderedCallouts(state: EditorState, focused: boolean) {
  return calloutRanges(state).filter(
    (c) => !(focused && state.selection.ranges.some((r) => r.from <= c.to && r.to >= c.from)),
  );
}

const calloutFocus = StateEffect.define<boolean>();

/**
 * Up and Down step into a rendered callout instead of over it (a block widget is one unit for
 * vertical motion): the caret lands on its first line going down, its last going up, which turns
 * it into source.
 */
const enterCallout = (dir: 1 | -1) => (view: EditorView) => {
  const sel = view.state.selection.main;
  if (!sel.empty || view.state.selection.ranges.length > 1) return false;
  const { doc } = view.state;
  const n = doc.lineAt(sel.head).number + dir;
  if (n < 1 || n > doc.lines) return false;
  const next = doc.line(n);
  const c = renderedCallouts(view.state, true).find((r) => (dir > 0 ? r.from === next.from : r.to === next.to));
  if (!c) return false;
  view.dispatch({ selection: { anchor: dir > 0 ? c.from : doc.lineAt(c.to).from }, scrollIntoView: true, userEvent: "select" });
  return true;
};

/** Line flashed after a heading or block link lands on it (null clears it). */
const flashEffect = StateEffect.define<number | null>();
const flashLine = Decoration.line({ class: "cm-fragment-flash" });
const flashField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects)
      if (e.is(flashEffect)) deco = e.value === null ? Decoration.none : Decoration.set([flashLine.range(e.value)]);
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Put the caret on the heading or block that `fragment` names, scroll it to the middle and flash
 * it. False when the note has no such heading or block.
 */
export function revealFragment(view: EditorView, fragment: Fragment): boolean {
  const n = fragmentLine(view.state.doc.toString(), fragment);
  if (n === null || n + 1 > view.state.doc.lines) return false;
  const line = view.state.doc.line(n + 1);
  view.dispatch({
    selection: { anchor: line.from },
    effects: [EditorView.scrollIntoView(line.from, { y: "center" }), flashEffect.of(line.from)],
  });
  view.focus();
  window.setTimeout(() => {
    if (view.dom.isConnected) view.dispatch({ effects: flashEffect.of(null) });
  }, 1600);
  return true;
}

const hide = Decoration.replace({});
const bullet = Decoration.replace({ widget: new TextWidget("•", "cm-lp-bullet") });
const headingSep = Decoration.replace({ widget: new TextWidget("›", "cm-lp-sep") });
const rule = Decoration.replace({ widget: new RuleWidget() });
const doneText = Decoration.mark({ class: "cm-lp-done" });
const quoteLine = Decoration.line({ class: "cm-lp-quote" });
const fenceLine = Decoration.line({ class: "cm-lp-fence" });
const linkText = (href: string) =>
  Decoration.mark({ class: "cm-lp-link", attributes: { "data-href": href, role: "link", title: href } });

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Line numbers that show raw source: every line the selection touches, while the editor has focus. */
function activeLines(view: EditorView): Set<number> {
  const lines = new Set<number>();
  if (!view.hasFocus) return lines;
  const { doc, selection } = view.state;
  for (const r of selection.ranges) {
    const a = doc.lineAt(r.from).number;
    const b = doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) lines.add(n);
  }
  return lines;
}

/** End offset of a leading YAML frontmatter block, or 0. Frontmatter stays as source. */
export function frontmatterEnd(state: EditorState): number {
  const { doc } = state;
  if (doc.lines < 2 || doc.line(1).text !== "---") return 0;
  for (let n = 2; n <= Math.min(doc.lines, 200); n++) {
    const text = doc.line(n).text;
    if (text === "---" || text === "...") return doc.line(n).to;
  }
  return 0;
}

/** True inside code, tables, HTML, comments or images: regions that stay as source. */
function inRaw(state: EditorState, pos: number) {
  let n: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(pos, 1);
  for (; n; n = n.parent) if (RAW_REGIONS.test(n.name)) return true;
  return false;
}

/** The `[ ]` / `[x]` marker on the line containing `pos`, found in the syntax tree, falling back to text. */
function taskMarkerOn(state: EditorState, pos: number): { at: number; checked: boolean } | null {
  const line = state.doc.lineAt(pos);
  let found: { at: number; checked: boolean } | null = null;
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter: (n) => {
      if (found) return false;
      if (n.name === "TaskMarker" && n.from >= line.from && n.to <= line.to) {
        found = { at: n.from + 1, checked: /x/i.test(state.doc.sliceString(n.from, n.to)) };
        return false;
      }
    },
  });
  if (found) return found;
  const m = TASK_LINE.exec(line.text);
  return m ? { at: line.from + m[1].length, checked: m[2] !== " " } : null;
}

/** Flip `[ ]` ↔ `[x]` on the task line that contains `pos`. */
function toggleTaskAt(view: EditorView, pos: number) {
  const marker = taskMarkerOn(view.state, pos);
  if (!marker) return false;
  view.dispatch({
    changes: { from: marker.at, to: marker.at + 1, insert: marker.checked ? " " : "x" },
    userEvent: "input.toggle",
  });
  return true;
}

/**
 * Mod-L: plain line → task, list item → task, task → toggled. This mirrors
 * Obsidian's "Toggle checkbox status" hotkey and deliberately replaces
 * CodeMirror's default Mod-L (select line) inside notes.
 */
function toggleChecklist(view: EditorView) {
  const { state } = view;
  const changes: { from: number; to?: number; insert: string }[] = [];
  const seen = new Set<number>();
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const line = state.doc.line(n);
      const marker = taskMarkerOn(state, line.from);
      const list = LIST_LINE.exec(line.text);
      if (marker) changes.push({ from: marker.at, to: marker.at + 1, insert: marker.checked ? " " : "x" });
      else if (list) changes.push({ from: line.from + list[1].length, insert: "[ ] " });
      else changes.push({ from: line.from + QUOTE_PREFIX.exec(line.text)![1].length, insert: "- [ ] " });
    }
  }
  if (!changes.length) return false;
  const cs = state.changes(changes);
  // A caret at the insertion point ends up after the new marker (assoc 1). A selection keeps
  // markers inserted at its edges inside it: its start maps with assoc -1, its end with assoc 1.
  const selection = EditorSelection.create(
    state.selection.ranges.map((r) => {
      if (r.empty) return r.map(cs, 1);
      const forward = r.anchor < r.head;
      return EditorSelection.range(cs.mapPos(r.anchor, forward ? -1 : 1), cs.mapPos(r.head, forward ? 1 : -1));
    }),
    state.selection.mainIndex,
  );
  view.dispatch({ changes: cs, selection, userEvent: "input.toggle" });
  return true;
}

/** A URL this preview may open, or null (relative paths, javascript: and the like are refused). */
function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^(?:https?:|mailto:)/i.test(h)) return h;
  if (/^www\./i.test(h)) return `https://${h}`;
  if (EMAIL.test(h)) return `mailto:${h}`;
  return null;
}

/**
 * The `[` that opens the link text ending at the `]` at `close`, on the same line, with
 * balanced, unescaped brackets in between; null for empty text, an image (`![`), or no match.
 */
function bracketLinkOpen(state: EditorState, close: number): number | null {
  const line = state.doc.lineAt(close);
  const text = line.text;
  const escaped = (i: number) => {
    let n = 0;
    for (let j = i - 1; j >= 0 && text[j] === "\\"; j--) n++;
    return n % 2 === 1;
  };
  let depth = 0;
  for (let i = close - line.from - 1; i >= 0; i--) {
    const c = text[i];
    if ((c !== "[" && c !== "]") || escaped(i)) continue;
    if (c === "]") depth++;
    else if (depth > 0) depth--;
    else {
      const open = line.from + i;
      if (text[i - 1] === "!" || close - open < 2 || inRaw(state, open)) return null;
      return open;
    }
  }
  return null;
}

/** The link under the caret: a [[wikilink]] target (and fragment), or an openable URL. */
function linkAt(state: EditorState, pos: number): { target: string; fragment: string } | { href: string } | null {
  const line = state.doc.lineAt(pos);
  const col = pos - line.from;
  const within = (m: RegExpMatchArray) => m.index! <= col && col <= m.index! + m[0].length;
  if (inRaw(state, pos) || pos < frontmatterEnd(state)) return null;
  for (const m of line.text.matchAll(WIKILINK)) {
    if (!within(m)) continue;
    const part = m[2].split("|")[0];
    const hash = part.indexOf("#");
    const target = (hash === -1 ? part : part.slice(0, hash)).trim();
    const fragment = hash === -1 ? "" : part.slice(hash + 1).trim();
    return target || fragment ? { target, fragment } : null;
  }
  for (const m of line.text.matchAll(/\[(?:[^[\]\n]|\[[^[\]\n]*\])*\]\(\s*<?([^\s()<>]+)>?(?:\s+"[^"\n]*")?\s*\)|<([^\s<>]+)>|((?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,;:!?'"])/g)) {
    if (!within(m)) continue;
    // A bare URL right after `](` belongs to bracket text that is not a link; it is not styled as one either.
    if (m[3] && line.text.slice(m.index! - 2, m.index) === "](") return null;
    const href = safeHref(m[1] ?? m[2] ?? m[3]);
    return href ? { href } : null;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Decoration builder                                                  */
/* ------------------------------------------------------------------ */

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const { doc } = state;
  const active = activeLines(view);
  const isActive = (pos: number) => active.has(doc.lineAt(pos).number);
  const isActiveRange = (from: number, to: number) => {
    for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) if (active.has(n)) return true;
    return false;
  };
  const sameLine = (from: number, to: number) => doc.lineAt(from).number === doc.lineAt(to).number;
  const fmEnd = frontmatterEnd(state);
  const tree = syntaxTree(state);
  const out: Range<Decoration>[] = [];
  const keys = new Set<string>();
  /** kind "h" = replace (must stay on one line), "m" = mark, anything else = a line decoration of that kind. */
  const add = (deco: Decoration, from: number, to: number, kind: string) => {
    if (to < from) return;
    if (kind === "h") {
      if (to === from || !sameLine(from, to)) return; // never replace a line break from a plugin
    } else if (kind === "m") {
      if (to === from) return;
    }
    const key = `${kind}:${from}:${to}`;
    if (keys.has(key)) return;
    keys.add(key);
    out.push(deco.range(from, to));
  };
  const wikiRanges: [number, number][] = [];
  const insideWiki = (from: number, to: number) => wikiRanges.some(([a, b]) => from < b && to > a);
  // Callouts drawn as widgets (calloutField) get no inline decorations of their own.
  const callouts = renderedCallouts(state, view.hasFocus);
  const inCallout = (pos: number) => callouts.some((c) => pos >= c.from && pos <= c.to);

  for (const { from, to } of view.visibleRanges) {
    const text = doc.sliceString(from, to);

    // Trailing ^blockid markers are hidden like Obsidian's, except on the lines being edited.
    for (const m of text.matchAll(BLOCK_ID)) {
      const start = from + m.index! + m[1].length;
      const end = from + m.index! + m[0].length;
      if (start < fmEnd || inRaw(state, start) || isActive(start) || inCallout(start)) continue;
      add(hide, start - m[1].length, end, "h");
    }

    // Wikilinks and highlights are Obsidian syntax, not part of the markdown grammar.
    for (const m of text.matchAll(WIKILINK)) {
      const start = from + m.index!;
      const end = start + m[0].length;
      if (start < fmEnd || inRaw(state, start)) continue;
      wikiRanges.push([start, end]);
      if (inCallout(start)) continue;
      if (m[1] === "!" || isActive(start)) continue; // embeds stay as source
      const inner = m[2];
      const innerFrom = start + 2;
      const pipe = inner.indexOf("|");
      const alias = pipe === -1 ? "" : inner.slice(pipe + 1).trim();
      add(hide, start, start + 2, "h");
      if (pipe !== -1 && alias) {
        add(hide, innerFrom, innerFrom + pipe + 1, "h");
      } else if (pipe !== -1) {
        add(hide, innerFrom + pipe, innerFrom + inner.length, "h"); // empty alias: show the target
      } else {
        const hash = inner.indexOf("#");
        if (hash > 0) add(headingSep, innerFrom + hash, innerFrom + hash + 1, "h");
      }
      add(hide, end - 2, end, "h");
    }
    for (const m of text.matchAll(HIGHLIGHT)) {
      const start = from + m.index!;
      const end = start + m[0].length;
      if (start < fmEnd || inRaw(state, start) || isActive(start) || inCallout(start)) continue;
      add(hide, start, start + 2, "h");
      add(hide, end - 2, end, "h");
    }

    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (node.to <= fmEnd) return false;
        if (node.name === "Blockquote" && inCallout(node.from)) return false;
        switch (node.name) {
          case "FencedCode": {
            if (isActiveRange(node.from, node.to)) return false;
            // Hide only the fence markers and the info string, never quote/list prefixes or code.
            for (const child of [...node.node.getChildren("CodeMark"), ...node.node.getChildren("CodeInfo")]) {
              add(fenceLine, doc.lineAt(child.from).from, doc.lineAt(child.from).from, "fence");
              add(hide, child.from, child.to, "h");
            }
            // A fence inside a blockquote keeps the quote rendering on its lines.
            for (const qm of node.node.getChildren("QuoteMark"))
              add(hide, qm.from, qm.to + (doc.sliceString(qm.to, qm.to + 1) === " " ? 1 : 0), "h");
            return false;
          }
          case "CodeBlock":
          case "HTMLBlock":
          case "Table":
          case "Image":
          case "CommentBlock":
          case "ProcessingInstructionBlock":
            return false;
          case "HeaderMark": {
            const parent = node.node.parent;
            if (!parent || !parent.name.startsWith("ATXHeading") || isActive(node.from)) return;
            const line = doc.lineAt(node.from);
            const leading = doc.sliceString(line.from, node.from).replace(/>/g, "").trim() === "";
            if (leading) {
              add(hide, node.from, node.to + (doc.sliceString(node.to, node.to + 1) === " " ? 1 : 0), "h");
            } else {
              add(hide, node.from - (doc.sliceString(node.from - 1, node.from) === " " ? 1 : 0), node.to, "h");
            }
            return;
          }
          case "EmphasisMark":
          case "StrikethroughMark":
            if (!isActive(node.from)) add(hide, node.from, node.to, "h");
            return;
          case "CodeMark":
            if (node.node.parent?.name === "InlineCode" && !isActiveRange(node.node.parent.from, node.node.parent.to))
              add(hide, node.from, node.to, "h");
            return;
          case "Blockquote": {
            const first = doc.lineAt(Math.max(node.from, from)).number;
            const last = doc.lineAt(Math.min(node.to, to)).number;
            for (let n = first; n <= last; n++) add(quoteLine, doc.line(n).from, doc.line(n).from, "quote");
            return;
          }
          case "QuoteMark": {
            if (isActive(node.from)) return;
            add(hide, node.from, node.to + (doc.sliceString(node.to, node.to + 1) === " " ? 1 : 0), "h");
            return;
          }
          case "HorizontalRule":
            if (!isActive(node.from)) add(rule, node.from, node.to, "h");
            return false;
          case "ListItem": {
            const listMark = node.node.getChild("ListMark");
            if (!listMark || isActive(listMark.from)) return;
            const task = node.node.getChild("Task");
            const marker = task?.getChild("TaskMarker");
            const ordered = node.node.parent?.name === "OrderedList";
            if (task && marker && sameLine(listMark.from, marker.to)) {
              const checked = /x/i.test(doc.sliceString(marker.from, marker.to));
              let end = marker.to;
              if (doc.sliceString(end, end + 1) === " ") end += 1;
              const lineEnd = Math.min(doc.lineAt(listMark.from).to, task.to);
              const label = doc.sliceString(end, lineEnd).replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2").trim();
              // Ordered tasks keep their number: replace only the [ ] marker.
              add(Decoration.replace({ widget: new CheckboxWidget(checked, label) }), ordered ? marker.from : listMark.from, end, "h");
              if (checked && lineEnd > end) add(doneText, end, lineEnd, "m");
            } else if (node.node.parent?.name === "BulletList") {
              add(bullet, listMark.from, listMark.to, "h");
            }
            return;
          }
          case "Link": {
            const n = node.node;
            const url = n.getChild("URL");
            if (!url || insideWiki(n.from, n.to)) return; // [[wikilinks]] parse as nested links; shortcut refs have no URL
            const marks = n.getChildren("LinkMark");
            const open = marks[0];
            const close = marks.find((m) => doc.sliceString(m.from, m.to) === "]");
            if (!open || !close) return;
            const href = safeHref(doc.sliceString(url.from, url.to));
            // Links that cannot be opened here (javascript:, relative paths) and links whose syntax
            // spans lines stay as source, so nothing looks clickable that is not.
            // A link with empty text, `[](url)`, would render as nothing: it stays as source too.
            if (!href || !sameLine(close.from, n.to) || close.from <= open.to) return;
            add(linkText(href), open.to, close.from, "m");
            if (!isActiveRange(n.from, n.to)) {
              add(hide, open.from, open.to, "h");
              add(hide, close.from, n.to, "h");
            }
            return;
          }
          case "Autolink": {
            const n = node.node;
            const url = n.getChild("URL");
            if (!url) return false;
            const href = safeHref(doc.sliceString(url.from, url.to));
            if (href) add(linkText(href), url.from, url.to, "m");
            if (!isActive(n.from)) {
              add(hide, n.from, url.from, "h");
              add(hide, url.to, n.to, "h");
            }
            return false;
          }
          case "URL": {
            const parent = node.node.parent?.name;
            if (parent === "Link" || parent === "Image" || parent === "Autolink" || insideWiki(node.from, node.to)) return;
            // `[text [with] brackets](url)`: the parser takes `[with]` for a link and leaves the URL
            // bare. Render the whole thing as one link, as the reading view does, or leave it as source.
            if (doc.sliceString(node.from - 2, node.from) === "](") {
              const open = bracketLinkOpen(state, node.from - 2);
              const href = safeHref(doc.sliceString(node.from, node.to));
              if (open === null || !href || doc.sliceString(node.to, node.to + 1) !== ")") return;
              add(linkText(href), open + 1, node.from - 2, "m");
              if (!isActiveRange(open, node.to + 1)) {
                add(hide, open, open + 1, "h");
                add(hide, node.from - 2, node.to + 1, "h");
              }
              return;
            }
            const href = safeHref(doc.sliceString(node.from, node.to));
            if (href) add(linkText(href), node.from, node.to, "m");
            return;
          }
        }
      },
    });
  }
  return Decoration.set(out, true);
}

/** Never let a parser edge case take the editor down: fall back to plain source. */
function safeBuild(view: EditorView): DecorationSet {
  try {
    return buildDecorations(view);
  } catch (err) {
    console.error("Live preview disabled for this update:", err);
    return Decoration.none;
  }
}

/* ------------------------------------------------------------------ */
/* Extension                                                           */
/* ------------------------------------------------------------------ */

const theme = EditorView.baseTheme({
  ".cm-lp-checkbox": {
    width: "15px",
    height: "15px",
    margin: "0 0.45em 0 0",
    verticalAlign: "-2px",
    accentColor: "var(--accent)",
    cursor: "pointer",
  },
  ".cm-lp-done": {
    color: "var(--muted)",
    textDecoration: "line-through",
    textDecorationColor: "var(--faint)",
  },
  ".cm-lp-bullet": {
    display: "inline-block",
    minWidth: "0.6em",
    color: "var(--faint)",
    textAlign: "center",
  },
  ".cm-lp-sep": { color: "var(--faint)", padding: "0 0.25em" },
  ".cm-lp-hr": {
    display: "inline-block",
    width: "100%",
    height: "1px",
    verticalAlign: "middle",
    backgroundColor: "var(--border)",
  },
  ".cm-lp-link": {
    color: "var(--accent-ink)",
    textDecoration: "underline",
    textDecorationThickness: "1px",
    textUnderlineOffset: "3px",
    textDecorationColor: "color-mix(in srgb, var(--accent-ink) 40%, transparent)",
    cursor: "pointer",
  },
  // Syntax-highlight spans inside a link (the URL token is faint by default) take the link colour.
  ".cm-lp-link *": { color: "var(--accent-ink)" },
  ".cm-line.cm-lp-quote": {
    borderLeft: "1px solid var(--control)",
    paddingLeft: "1em",
    color: "var(--muted)",
  },
  // Hidden fence lines collapse into a little padding at the top and bottom of the code band.
  ".cm-line.cm-codeblock.cm-lp-fence": { fontSize: "0.5em", lineHeight: "1" },
  // A rendered callout: the reading view's block, its outer margin as padding (CodeMirror
  // measures block widgets by their border box, so margins would throw its heights off).
  ".cm-lp-callout": { padding: "6px 0", cursor: "text", whiteSpace: "normal" },
  ".cm-lp-callout > .callout": { margin: "0" },
  ".cm-lp-callout summary, .cm-lp-callout a, .cm-lp-callout input": { cursor: "pointer" },
});

export function livePreview(handlers: LivePreviewHandlers): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = safeBuild(view);
      }
      update(u: ViewUpdate) {
        if (
          u.docChanged ||
          u.selectionSet ||
          u.viewportChanged ||
          u.focusChanged ||
          syntaxTree(u.startState) !== syntaxTree(u.state)
        ) {
          this.decorations = safeBuild(u.view);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );

  const clicks = EditorView.domEventHandlers({
    mousedown(e, view) {
      if (e.button !== 0) return false;
      const el = e.target as HTMLElement;
      const wiki = el.closest<HTMLElement>(".cm-wikilink[data-target]");
      const ext = wiki ? null : el.closest<HTMLElement>(".cm-lp-link[data-href]");
      if (!wiki && !ext) return false;
      const modifier = e.ctrlKey || e.metaKey;
      const pos = view.posAtDOM((wiki ?? ext)!);
      const rendered = !activeLines(view).has(view.state.doc.lineAt(pos).number);
      if (wiki) {
        // Ctrl/Cmd+click is the editor's own handler. A plain click opens a rendered link to an
        // existing note; a link to a note not created yet needs Ctrl/Cmd+click, so a stray tap
        // never creates a note. `[[#Heading]]` (no target) jumps within this note.
        const fragment = wiki.dataset.fragment || undefined;
        if (modifier || !rendered || !(wiki.dataset.target || fragment) || wiki.classList.contains("cm-wikilink-ghost")) return false;
        e.preventDefault();
        handlers.openLink(wiki.dataset.target ?? "", false, fragment);
        return true;
      }
      const href = safeHref(ext!.dataset.href ?? "");
      if (!href || !(rendered || modifier)) return false; // let the click place the caret
      e.preventDefault();
      window.open(href, "_blank", "noopener,noreferrer");
      return true;
    },
  });

  /** Alt+Enter follows the link under the caret (Shift+Alt+Enter: a wikilink in a new tab). */
  const followLink = (newTab: boolean) => (view: EditorView) => {
    const link = linkAt(view.state, view.state.selection.main.head);
    if (!link) return false;
    if ("target" in link) handlers.openLink(link.target, newTab, link.fragment || undefined);
    else window.open(link.href, "_blank", "noopener,noreferrer");
    return true;
  };

  const calloutField = StateField.define<{ focused: boolean; deco: DecorationSet }>({
    create: (state) => ({ focused: false, deco: calloutDecorations(state, false) }),
    update(value, tr) {
      let focused = value.focused;
      for (const e of tr.effects) if (e.is(calloutFocus)) focused = e.value;
      if (focused === value.focused && !tr.docChanged && !tr.selection && syntaxTree(tr.startState) === syntaxTree(tr.state))
        return value;
      return { focused, deco: calloutDecorations(tr.state, focused) };
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  });
  function calloutDecorations(state: EditorState, focused: boolean): DecorationSet {
    try {
      return Decoration.set(
        renderedCallouts(state, focused).map((c) =>
          Decoration.replace({ widget: new CalloutWidget(state.doc.sliceString(c.from, c.to), handlers), block: true }).range(
            c.from,
            c.to,
          ),
        ),
      );
    } catch (err) {
      console.error("Live preview: callouts left as source:", err);
      return Decoration.none;
    }
  }

  return [
    calloutField,
    EditorView.focusChangeEffect.of((_state, focusing) => calloutFocus.of(focusing)),
    flashField,
    plugin,
    clicks,
    theme,
    Prec.high(
      keymap.of([
        { key: "Mod-l", run: toggleChecklist },
        { key: "ArrowDown", run: enterCallout(1) },
        { key: "ArrowUp", run: enterCallout(-1) },
        { key: "Alt-Enter", run: followLink(false) },
        { key: "Shift-Alt-Enter", run: followLink(true) },
      ]),
    ),
  ];
}
