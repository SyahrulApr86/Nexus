import { useEffect, useRef } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  extensions?: Extension[];
  ariaLabel?: string;
}

/**
 * CodeMirror 6 markdown editor (FR-004). Uncontrolled internally; external
 * `value` changes (note switch, conflict reload) reset the doc only when they
 * differ from the current doc to preserve cursor during normal typing.
 */
export function Editor({
  value,
  onChange,
  extensions = [],
  ariaLabel = "Note content",
}: EditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          // Custom extensions first — their keymaps (e.g. autocomplete Enter)
          // must take precedence over defaultKeymap's Enter
          ...extensions,
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown({ base: markdownLanguage }),
          placeholder("Start writing…"),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": ariaLabel,
            role: "textbox",
            "aria-multiline": "true",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return <div ref={hostRef} className="h-full min-h-0 overflow-auto" />;
}
