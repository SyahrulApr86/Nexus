/*
 * ```query blocks in Live Preview: each closed, top-level query block becomes its results (the
 * <nexus-query> element) as a block widget. When the selection touches the block, its source shows
 * instead, as with every other Live Preview construct. Block widgets cannot come from a view
 * plugin, so this is a state field; the block list is rebuilt only when the document or its parse
 * changes, and the decorations when the selection moves.
 *
 * The editor's own vertical motion jumps over a block widget, so ArrowDown on the line just above a
 * block and ArrowUp on the line just below it step into the block instead: the source shows, and
 * keyboard users reach every query as they would any other text.
 */
import { StateField, type EditorState, type Extension, type Range, type Transaction } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { QUERY_TAG, defineQueryElement, type QueryElement } from "./element";

type OpenLink = (target: string, newTab: boolean) => void;
type Block = { from: number; to: number; source: string };

/** Closed ```query fences at the top level of the document. */
export function queryBlocksIn(state: EditorState): Block[] {
  const out: Block[] = [];
  const { doc } = state;
  syntaxTree(state).iterate({
    enter: (n) => {
      if (n.name === "Document") return;
      if (n.name === "FencedCode") {
        const info = n.node.getChild("CodeInfo");
        const marks = n.node.getChildren("CodeMark");
        if (info && marks.length >= 2 && doc.sliceString(info.from, info.to).trim().toLowerCase() === "query") {
          const text = n.node.getChild("CodeText");
          out.push({
            from: doc.lineAt(n.from).from,
            to: doc.lineAt(n.to).to,
            source: text ? doc.sliceString(text.from, text.to) : "",
          });
        }
      }
      return false;
    },
  });
  return out;
}

class QueryWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly openLink: OpenLink,
  ) {
    super();
  }
  eq(other: QueryWidget) {
    return other.source === this.source;
  }
  toDOM(view: EditorView) {
    defineQueryElement();
    const dom = document.createElement(QUERY_TAG) as QueryElement;
    dom.source = this.source;
    dom.openLink = this.openLink;
    dom.onEdit = () => {
      // The caret on the block's first line of query text: the source shows, ready to edit.
      const line = view.state.doc.lineAt(view.posAtDOM(dom));
      const anchor = Math.min(line.to + 1, view.state.doc.length);
      view.dispatch({ selection: { anchor }, scrollIntoView: true });
      view.focus();
    };
    dom.classList.add("cm-query-widget");
    return dom;
  }
  get estimatedHeight() {
    return 120;
  }
  ignoreEvent() {
    return true;
  }
}

type Value = { blocks: Block[]; decorations: DecorationSet };

function decorate(state: EditorState, blocks: Block[], openLink: OpenLink): DecorationSet {
  const ranges = state.selection.ranges;
  const out: Range<Decoration>[] = [];
  for (const b of blocks) {
    if (ranges.some((r) => r.from <= b.to && r.to >= b.from)) continue;
    out.push(Decoration.replace({ widget: new QueryWidget(b.source, openLink), block: true }).range(b.from, b.to));
  }
  return Decoration.set(out, true);
}

export function queryBlockPreview(openLink: OpenLink): Extension {
  const build = (state: EditorState): Value => {
    try {
      const blocks = queryBlocksIn(state);
      return { blocks, decorations: decorate(state, blocks, openLink) };
    } catch (err) {
      console.error("Query blocks: Live Preview disabled for this update:", err);
      return { blocks: [], decorations: Decoration.none };
    }
  };
  const field = StateField.define<Value>({
    create: build,
    update(value, tr: Transaction) {
      if (tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return build(tr.state);
      if (tr.selection) return { blocks: value.blocks, decorations: decorate(tr.state, value.blocks, openLink) };
      return value;
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
  });
  const step = (down: boolean) => (view: EditorView) => {
    const { state } = view;
    const sel = state.selection.main;
    if (!sel.empty || state.selection.ranges.length > 1) return false;
    const line = state.doc.lineAt(sel.head);
    const n = line.number + (down ? 1 : -1);
    if (n < 1 || n > state.doc.lines) return false;
    const near = state.doc.line(n);
    const block = state.field(field).blocks.find((b) => (down ? b.from === near.from : b.to === near.to));
    if (!block) return false;
    view.dispatch({ selection: { anchor: down ? block.from : state.doc.lineAt(block.to).from }, scrollIntoView: true });
    return true;
  };
  return [field, keymap.of([{ key: "ArrowDown", run: step(true) }, { key: "ArrowUp", run: step(false) }])];
}
