/**
 * Upload placeholders in the editor: an inline "Uploading photo.png…" label at the paste or drop
 * position. The label is a widget, not text, so a half-finished upload is never saved into the
 * note. Each placeholder follows edits made around it; on success the embed is inserted where it
 * stands, on failure it is removed. Kept free of DOM-only code paths so the state logic runs in
 * unit tests (tests/unit/attachments-ui.test.ts).
 */
import { StateEffect, StateField, type EditorState, type Transaction } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { embedInsert, embedLink, uploadingLabel } from "./model";

export type Placeholder = { id: number; pos: number; name: string };

export const addPlaceholders = StateEffect.define<{ id: number; name: string; pos: number }[]>({
  map: (list, change) => list.map((p) => ({ ...p, pos: change.mapPos(p.pos, 1) })),
});
export const removePlaceholder = StateEffect.define<number>();

class UploadingWidget extends WidgetType {
  constructor(
    readonly id: number,
    readonly name: string,
  ) {
    super();
  }
  eq(other: UploadingWidget) {
    return other.id === this.id && other.name === this.name;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-att-uploading";
    el.setAttribute("role", "status");
    el.textContent = uploadingLabel(this.name);
    return el;
  }
}

const deco = (p: { id: number; name: string }) =>
  // side 1: text typed at the placeholder's position goes before it, and stays there.
  Decoration.widget({ widget: new UploadingWidget(p.id, p.name), side: 1, uploadId: p.id });

export const uploadPlaceholders = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(set, tr: Transaction) {
    set = set.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(addPlaceholders))
        set = set.update({ add: e.value.map((p) => deco(p).range(Math.min(p.pos, tr.newDoc.length))), sort: true });
      else if (e.is(removePlaceholder)) set = set.update({ filter: (_f, _t, d) => d.spec.uploadId !== e.value });
    }
    return set;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** The placeholders in document order, with their current positions. */
export function placeholders(state: EditorState): Placeholder[] {
  const out: Placeholder[] = [];
  const set = state.field(uploadPlaceholders, false);
  if (!set) return out;
  for (let it = set.iter(); it.value; it.next()) {
    const spec = it.value.spec as { uploadId: number; widget: UploadingWidget };
    out.push({ id: spec.uploadId, pos: it.from, name: spec.widget.name });
  }
  return out;
}

/**
 * The transaction spec that ends an upload: insert the embed where its placeholder stands (on
 * success) and drop the placeholder. `insertedBefore` counts embeds already placed by this batch,
 * so a batch lands one embed per line. `frontmatterEnd` is the end of the note's YAML frontmatter
 * (0 for none): a placeholder that ended up inside it, after edits around it, puts its embed on
 * its own line after the closing fence instead, so the frontmatter never breaks. Null when the
 * placeholder is gone.
 */
export function finishUpload(state: EditorState, id: number, path: string | null, insertedBefore: number, frontmatterEnd = 0) {
  const p = placeholders(state).find((x) => x.id === id);
  if (!p) return null;
  const effects = removePlaceholder.of(id);
  if (path === null) return { effects };
  if (frontmatterEnd > 0 && p.pos <= frontmatterEnd)
    return { changes: { from: frontmatterEnd, insert: `\n${embedLink(path)}` }, effects, userEvent: "input.upload" };
  const line = state.doc.lineAt(p.pos);
  const insert = embedInsert(path, insertedBefore, { lineStart: p.pos === line.from, restOfLine: line.text.slice(p.pos - line.from) });
  return { changes: { from: p.pos, insert }, effects, userEvent: "input.upload" };
}
