/**
 * Editor extension for "Show properties: visible / hidden": the YAML frontmatter lines are
 * folded out of the editor (the properties block above it edits them), the caret skips over
 * them, and typing cannot break the block. Undo, redo and programmatic edits (sent with
 * `filter: false`) pass through untouched.
 */

import { EditorState, StateField, type Extension, type TransactionSpec } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { frontmatterRange } from "@/lib/markdown/frontmatter-edit";
import { MAX_FRONTMATTER_CHARS } from "@/lib/markdown/parse";

type Hidden = { end: number; deco: DecorationSet } | null;

/** The hidden range, from the opening `---` to the end of the closing `---` line. */
function build(state: EditorState): Hidden {
  const head = state.sliceDoc(0, Math.min(state.doc.length, MAX_FRONTMATTER_CHARS + 16));
  const r = frontmatterRange(head);
  if (!r) return null;
  // r.to sits after the closing line break, when there is one.
  const closing = state.doc.lineAt(head[r.to - 1] === "\n" ? r.to - 1 : r.to);
  return { end: closing.to, deco: Decoration.set([Decoration.replace({ block: true }).range(0, closing.to)]) };
}

const hidden = StateField.define<Hidden>({
  create: build,
  update: (v, tr) => (tr.docChanged ? build(tr.state) : v),
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v?.deco ?? Decoration.none),
    EditorView.atomicRanges.of((view) => view.state.field(f)?.deco ?? Decoration.none),
  ],
});

/**
 * Typing never reaches the hidden lines: an edit that would touch them (or the line break
 * after them) is clipped to start at the first line of the note body.
 */
const guard = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.isUserEvent("undo") || tr.isUserEvent("redo")) return tr;
  const h = tr.startState.field(hidden, false);
  if (!h) return tr;
  const body = Math.min(h.end + 1, tr.startState.doc.length);
  if (!tr.changes.touchesRange(0, h.end)) return tr;
  const changes: { from: number; to: number; insert: string }[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const from = Math.max(fromA, body);
    const to = Math.max(toA, body);
    let text = inserted.toString();
    if (from === to && !text) return;
    // A note that is only frontmatter: the body starts on a new line.
    if (body === h.end && from === body) text = "\n" + text;
    changes.push({ from, to, insert: text });
  });
  if (!changes.length) return [];
  const spec: TransactionSpec = { changes, scrollIntoView: true };
  if (changes.length === 1) spec.selection = { anchor: changes[0].from + changes[0].insert.length };
  return [spec];
});

/** Hide the frontmatter in the editor. A single shared instance, so remounts reuse it. */
export const hideFrontmatter: Extension = [hidden, guard];
