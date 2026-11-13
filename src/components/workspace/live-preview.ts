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
 * markers, blockquote marks, horizontal rules and code fences.
 * Left as source on purpose: tables, HTML, frontmatter, images, embeds
 * (![[note]]), ordered list numbers, setext headings.
 */
import { Prec, type Extension, type Range, type EditorState } from "@codemirror/state";
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

export type LivePreviewHandlers = {
  /** Open a [[wikilink]] target; same callback the editor's Ctrl+click uses. */
  openLink: (target: string, newTab: boolean) => void;
};

const WIKILINK = /(!?)\[\[([^\[\]\n]+?)\]\]/g;
const HIGHLIGHT = /==([^=\n]+)==/g;
const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;
const LIST_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+)/;
const SAFE_URL = /^(?:https?:|mailto:)/i;

/* ------------------------------------------------------------------ */
/* Widgets                                                             */
/* ------------------------------------------------------------------ */

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.checked;
    box.className = "cm-lp-checkbox";
    box.setAttribute("aria-label", "Task");
    // The native control handles mouse and Space; we mirror its state into the source.
    box.addEventListener("change", () => toggleTaskAt(view, view.posAtDOM(box)));
    return box;
  }
  ignoreEvent() {
    // Let the checkbox own its events so clicking it neither moves the cursor nor reveals the source.
    return true;
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

const hide = Decoration.replace({});
const bullet = Decoration.replace({ widget: new TextWidget("•", "cm-lp-bullet") });
const headingSep = Decoration.replace({ widget: new TextWidget("›", "cm-lp-sep") });
const rule = Decoration.replace({ widget: new RuleWidget() });
const doneText = Decoration.mark({ class: "cm-lp-done" });
const quoteLine = Decoration.line({ class: "cm-lp-quote" });
const fenceLine = Decoration.line({ class: "cm-lp-fence" });
const linkText = (href: string) => Decoration.mark({ class: "cm-lp-link", attributes: { "data-href": href } });

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
function frontmatterEnd(state: EditorState): number {
  const { doc } = state;
  if (doc.lines < 2 || doc.line(1).text !== "---") return 0;
  for (let n = 2; n <= Math.min(doc.lines, 200); n++) {
    const text = doc.line(n).text;
    if (text === "---" || text === "...") return doc.line(n).to;
  }
  return 0;
}

function inCode(state: EditorState, pos: number) {
  let n: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(pos, 1);
  for (; n; n = n.parent) if (/Code/.test(n.name)) return true;
  return false;
}

/** Flip `[ ]` ↔ `[x]` on the task line that starts at or contains `pos`. */
function toggleTaskAt(view: EditorView, pos: number) {
  const line = view.state.doc.lineAt(pos);
  const m = TASK_LINE.exec(line.text);
  if (!m) return false;
  const at = line.from + m[1].length;
  view.dispatch({ changes: { from: at, to: at + 1, insert: m[2] === " " ? "x" : " " }, userEvent: "input.toggle" });
  return true;
}

/** Mod-l: plain line → task, list item → task, task → toggled (Obsidian's "Toggle checkbox status"). */
function toggleChecklist(view: EditorView) {
  const { state } = view;
  const changes: { from: number; to?: number; insert: string }[] = [];
  const seen = new Set<number>();
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const line = state.doc.line(n);
      const task = TASK_LINE.exec(line.text);
      const list = LIST_LINE.exec(line.text);
      if (task) {
        const at = line.from + task[1].length;
        changes.push({ from: at, to: at + 1, insert: task[2] === " " ? "x" : " " });
      } else if (list) {
        changes.push({ from: line.from + list[1].length, insert: "[ ] " });
      } else {
        const indent = /^\s*/.exec(line.text)![0].length;
        changes.push({ from: line.from + indent, insert: "- [ ] " });
      }
    }
  }
  if (!changes.length) return false;
  view.dispatch({ changes, userEvent: "input.toggle" });
  return true;
}

function openExternal(href: string) {
  const url = /^www\./i.test(href) ? `https://${href}` : href;
  if (!SAFE_URL.test(url)) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

/* ------------------------------------------------------------------ */
/* Decoration builder                                                  */
/* ------------------------------------------------------------------ */

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const { doc } = state;
  const active = activeLines(view);
  const isActive = (pos: number) => active.has(doc.lineAt(pos).number);
  const fmEnd = frontmatterEnd(state);
  const tree = syntaxTree(state);
  const out: Range<Decoration>[] = [];
  const keys = new Set<string>();
  const add = (deco: Decoration, from: number, to = from, kind = "") => {
    if (to < from || (to === from && !kind)) return;
    const key = `${kind}:${from}:${to}`;
    if (keys.has(key)) return;
    keys.add(key);
    out.push(deco.range(from, to));
  };
  const wikiRanges: [number, number][] = [];
  const insideWiki = (from: number, to: number) => wikiRanges.some(([a, b]) => from < b && to > a);

  for (const { from, to } of view.visibleRanges) {
    const text = doc.sliceString(from, to);

    // Wikilinks and highlights are Obsidian syntax, not part of the markdown grammar.
    for (const m of text.matchAll(WIKILINK)) {
      const start = from + m.index!;
      const end = start + m[0].length;
      if (start < fmEnd || inCode(state, start)) continue;
      wikiRanges.push([start, end]);
      if (m[1] === "!" || isActive(start)) continue; // embeds stay as source
      const inner = m[2];
      const innerFrom = start + 2;
      const pipe = inner.indexOf("|");
      add(hide, start, start + 2, "h");
      if (pipe !== -1) {
        add(hide, innerFrom, innerFrom + pipe + 1, "h");
      } else {
        const hash = inner.indexOf("#");
        if (hash > 0) add(headingSep, innerFrom + hash, innerFrom + hash + 1, "h");
      }
      add(hide, end - 2, end, "h");
    }
    for (const m of text.matchAll(HIGHLIGHT)) {
      const start = from + m.index!;
      const end = start + m[0].length;
      if (start < fmEnd || inCode(state, start) || isActive(start)) continue;
      add(hide, start, start + 2, "h");
      add(hide, end - 2, end, "h");
    }

    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (node.to <= fmEnd) return false;
        switch (node.name) {
          case "FencedCode": {
            const first = doc.lineAt(node.from);
            const last = doc.lineAt(node.to);
            let touched = false;
            for (let n = first.number; n <= last.number && !touched; n++) touched = active.has(n);
            if (!touched) {
              add(fenceLine, first.from, first.from, "line");
              add(hide, first.from, first.to, "h");
              if (last.number !== first.number && /^\s*(```|~~~)/.test(last.text)) {
                add(fenceLine, last.from, last.from, "line");
                add(hide, last.from, last.to, "h");
              }
            }
            return false; // never touch code content
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
            const leading = doc.sliceString(line.from, node.from).trim() === "";
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
            if (node.node.parent?.name === "InlineCode" && !isActive(node.from)) add(hide, node.from, node.to, "h");
            return;
          case "Blockquote": {
            const first = doc.lineAt(Math.max(node.from, from)).number;
            const last = doc.lineAt(Math.min(node.to, to)).number;
            for (let n = first; n <= last; n++) add(quoteLine, doc.line(n).from, doc.line(n).from, "line");
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
            if (task && marker) {
              const checked = /x/i.test(doc.sliceString(marker.from, marker.to));
              let end = marker.to;
              if (doc.sliceString(end, end + 1) === " ") end += 1;
              add(Decoration.replace({ widget: new CheckboxWidget(checked) }), listMark.from, end, "h");
              const lineEnd = Math.min(doc.lineAt(listMark.from).to, task.to);
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
            const href = doc.sliceString(url.from, url.to);
            if (close.from > open.to) add(linkText(href), open.to, close.from, "m");
            if (!isActive(n.from)) {
              add(hide, open.from, open.to, "h");
              add(hide, close.from, n.to, "h");
            }
            return;
          }
          case "Autolink": {
            const n = node.node;
            const url = n.getChild("URL");
            if (!url) return false;
            add(linkText(doc.sliceString(url.from, url.to)), url.from, url.to, "m");
            if (!isActive(n.from)) {
              add(hide, n.from, url.from, "h");
              add(hide, url.to, n.to, "h");
            }
            return false;
          }
          case "URL": {
            const parent = node.node.parent?.name;
            if (parent === "Link" || parent === "Image" || parent === "Autolink" || insideWiki(node.from, node.to)) return;
            add(linkText(doc.sliceString(node.from, node.to)), node.from, node.to, "m");
            return;
          }
        }
      },
    });
  }
  return Decoration.set(out, true);
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
});

export function livePreview(handlers: LivePreviewHandlers): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view);
      }
      update(u: ViewUpdate) {
        if (
          u.docChanged ||
          u.selectionSet ||
          u.viewportChanged ||
          u.focusChanged ||
          syntaxTree(u.startState) !== syntaxTree(u.state)
        ) {
          this.decorations = buildDecorations(u.view);
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
        // Ctrl/Cmd+click is the editor's own handler; a plain click opens only a rendered link.
        if (modifier || !rendered || !wiki.dataset.target) return false;
        e.preventDefault();
        handlers.openLink(wiki.dataset.target, false);
        return true;
      }
      if (rendered || modifier) {
        e.preventDefault();
        openExternal(ext!.dataset.href ?? "");
        return true;
      }
      return false;
    },
  });

  return [plugin, clicks, theme, Prec.high(keymap.of([{ key: "Mod-l", run: toggleChecklist }]))];
}
