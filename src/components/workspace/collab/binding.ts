/**
 * The CodeMirror side of a live note: two compartments in the editor (history, collab) that swap
 * between plain CodeMirror and yCollab without remounting, so the caret and scroll stay put.
 */
import { Compartment, Prec, Transaction, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { history } from "@codemirror/commands";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import { diff } from "./mode";
import { attachEditor, type Binder } from "./session";

export type CollabSlots = { history: Compartment; collab: Compartment };

export function collabSlots(): CollabSlots {
  return { history: new Compartment(), collab: new Compartment() };
}

/** The initial extensions: REST mode (CodeMirror's own history, no collab). */
export function collabExtensions(slots: CollabSlots): Extension[] {
  return [slots.history.of(history()), slots.collab.of([]), remoteSelectionTheme];
}

/** Bind `view` to the note's live session while it is available. Returns the release function. */
export function bindCollab(view: EditorView, noteId: string, slots: CollabSlots): () => void {
  let bound = false;
  const binder: Binder = {
    bind(text, awareness, undo) {
      // The shared text first, as one plain change, so the caret maps through it; then the binding.
      const target = text.toString();
      const changes = diff(view.state.doc.toString(), target).map((s) => ({ from: s.index, to: s.index + s.remove, insert: s.insert }));
      if (changes.length)
        view.dispatch({
          changes,
          filter: false,
          annotations: [Transaction.addToHistory.of(false), Transaction.remote.of(true)],
          userEvent: "input.collab",
        });
      view.dispatch({
        effects: [
          slots.history.reconfigure([]),
          slots.collab.reconfigure([yCollab(text, awareness, { undoManager: undo }), Prec.high(keymap.of(yUndoManagerKeymap))]),
        ],
      });
      bound = true;
    },
    unbind() {
      if (!bound) return;
      bound = false;
      // A fresh history: undo must not step back into edits that were shared live.
      view.dispatch({ effects: [slots.collab.reconfigure([]), slots.history.reconfigure(history())] });
    },
  };
  return attachEditor(noteId, binder);
}

/**
 * Remote carets and selections in the palette (DESIGN.md): a 1px caret, a small name label in the
 * interface face above it, no dot, no glow, no animation. Colours come from the awareness state as
 * var(--collab-N) and follow the theme; the label text is the sheet colour, >= 4.5:1 on every slot
 * (globals.css, collab-editor block).
 */
const remoteSelectionTheme = EditorView.theme({
  ".cm-ySelectionCaret": {
    position: "relative",
    borderLeft: "1px solid",
    borderRight: "none",
    marginLeft: "-0.5px",
    marginRight: "-0.5px",
    boxSizing: "border-box",
    display: "inline",
  },
  ".cm-ySelectionCaretDot": { display: "none" },
  ".cm-ySelectionInfo": {
    position: "absolute",
    top: "-1.35em",
    left: "-1px",
    fontFamily: "var(--font-ui)",
    fontSize: "11px",
    fontStyle: "normal",
    fontWeight: "500",
    lineHeight: "15px",
    padding: "0 4px",
    borderRadius: "2px 2px 2px 0",
    color: "var(--sheet)",
    backgroundColor: "inherit",
    whiteSpace: "nowrap",
    userSelect: "none",
    pointerEvents: "none",
    zIndex: "5",
    opacity: "1",
    transition: "none",
  },
  ".cm-ySelectionCaret:hover > .cm-ySelectionInfo": { opacity: "1" },
});
