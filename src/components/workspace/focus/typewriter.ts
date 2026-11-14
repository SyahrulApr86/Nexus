"use client";

/**
 * Typewriter mode for the editor: while typing or moving the caret by keyboard, the caret's
 * line stays in the middle of the view. A pointer click does not scroll, so the text under the
 * mouse stays put. Turned on and off live from the focus preferences; scrolling is instant, so
 * there is no motion to reduce.
 */

import { Compartment, EditorState, type Extension, type Transaction } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { readFocusPrefs, subscribeFocusPrefs } from "./focus-prefs";

/** User events that move the caret where the writer is looking. Pointer selection is left alone. */
export function centersCaret(tr: Transaction): boolean {
  if (!tr.selection && !tr.docChanged) return false;
  if (tr.isUserEvent("select.pointer")) return false;
  return ["input", "delete", "move", "select", "undo", "redo"].some((e) => tr.isUserEvent(e));
}

const on: Extension = [
  EditorState.transactionExtender.of((tr) =>
    centersCaret(tr) ? { effects: EditorView.scrollIntoView(tr.newSelection.main.head, { y: "center" }) } : null,
  ),
  // Room below the last line, so the end of a note can sit in the middle too.
  EditorView.theme({ ".cm-content": { paddingBottom: "45vh" } }),
];

export function typewriter(): Extension {
  const slot = new Compartment();
  let enabled = readFocusPrefs().typewriter;
  return [
    slot.of(enabled ? on : []),
    ViewPlugin.define((view) => {
      const off = subscribeFocusPrefs(() => {
        const next = readFocusPrefs().typewriter;
        if (next === enabled) return;
        enabled = next;
        view.dispatch({
          effects: [
            slot.reconfigure(enabled ? on : []),
            ...(enabled && view.hasFocus ? [EditorView.scrollIntoView(view.state.selection.main.head, { y: "center" })] : []),
          ],
        });
      });
      return { destroy: off };
    }),
  ];
}
