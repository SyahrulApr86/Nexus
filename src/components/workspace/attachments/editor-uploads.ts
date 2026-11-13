/**
 * Paste or drop files into the editor: each file uploads (POST /api/attachments, one after the
 * other so they land in the order given) behind an "Uploading <name>…" placeholder, which turns
 * into `![[<path>]]` on success or disappears with an error toast on failure.
 */
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { frontmatterEnd } from "../live-preview";
import { filesOf, uploadName } from "./model";
import { addPlaceholders, finishUpload, uploadPlaceholders } from "./upload-field";
import type { UploadResult } from "./context";

export type UploadHandlers = {
  /** Upload one file into the folder the settings pick for this note. */
  upload: (file: File) => Promise<UploadResult>;
  notify: (message: string, error?: boolean) => void;
};

let nextId = 1;

async function run(view: EditorView, picked: File[], pos: number, pasted: boolean, get: () => UploadHandlers | null, replace?: { from: number; to: number }) {
  // A pasted screenshot ("image.png") gets its final name now, so the placeholder shows it too.
  const files = pasted
    ? picked.map((f) => {
        const name = uploadName(f.name, f.type, true);
        return name === f.name ? f : new File([f], name, { type: f.type, lastModified: f.lastModified });
      })
    : picked;
  // Never inside the YAML frontmatter: an embed there would break it. Land on the line after it.
  const fm = frontmatterEnd(view.state);
  const inFm = fm > 0 && (replace ? replace.from : pos) <= fm;
  const atEnd = inFm && fm === view.state.doc.length;
  const at = inFm ? fm + 1 : replace ? replace.from : pos;
  const batch = files.map((f) => ({ id: nextId++, name: f.name || "file", pos: at }));
  view.dispatch({
    ...(atEnd
      ? { changes: { from: fm, insert: "\n" } }
      : !inFm && replace && replace.to > replace.from
        ? { changes: { from: replace.from, to: replace.to } }
        : {}),
    effects: addPlaceholders.of(batch),
    userEvent: "input.upload",
  });
  let inserted = 0;
  for (let i = 0; i < files.length; i++) {
    const h = get();
    if (!h) return;
    const r = await h.upload(files[i]);
    // The note may have been closed meanwhile: the file is stored, it just isn't embedded.
    const alive = view.dom.isConnected;
    const spec = alive ? finishUpload(view.state, batch[i].id, r.ok ? r.item.path : null, inserted) : null;
    if (spec) view.dispatch(spec);
    if (!r.ok) h.notify(r.message, true);
    else if (spec) inserted++;
    else h.notify(`Uploaded ${r.item.path}, but the note was closed before it could be embedded.`);
  }
}

export function attachmentUploads(get: () => UploadHandlers | null): Extension {
  return [
    uploadPlaceholders,
    EditorView.domEventHandlers({
      paste(e, view) {
        const data = e.clipboardData;
        // Text wins: copying from a web page can carry an image too, but the user meant the text.
        if (!data || data.types.includes("text/plain") || !get()) return false;
        const files = filesOf(data);
        if (!files.length) return false;
        e.preventDefault();
        const { from, to } = view.state.selection.main;
        void run(view, files, from, true, get, { from, to });
        return true;
      },
      dragover(e) {
        if (!e.dataTransfer?.types.includes("Files") || !get()) return false;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        return false; // CodeMirror still draws its drop cursor
      },
      drop(e, view) {
        if (!e.dataTransfer?.types.includes("Files") || !get()) return false;
        const files = filesOf(e.dataTransfer);
        if (!files.length) return false;
        e.preventDefault();
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
        void run(view, files, pos, false, get);
        return true;
      },
    }),
    EditorView.baseTheme({
      ".cm-att-uploading": {
        fontFamily: "var(--font-ui)",
        fontSize: "13px",
        color: "var(--muted)",
        backgroundColor: "var(--code-bg)",
        borderRadius: "4px",
        padding: "1px 6px",
        margin: "0 2px",
        whiteSpace: "nowrap",
      },
    }),
  ];
}
