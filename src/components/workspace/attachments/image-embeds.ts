/**
 * Live Preview for image embeds: `![[photo.png]]`, `![[photo.png|300]]`, `![[photo.png|300x200]]`
 * and `![alt](photo.png)` show the image itself, resolved with the same lookup as the reading
 * view. Off the caret's lines the source is replaced by the image; on them the source stays
 * editable and the image follows it, so the line does not jump while you type.
 * Remote images, other attachment kinds, code and frontmatter stay as source.
 */
import { StateEffect, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { attachmentUrl, kindOf, splitSize, type AttachmentLookup } from "@/lib/markdown/attachments";
import { frontmatterEnd } from "../live-preview";
import { baseName } from "./model";

/** Dispatch when the lookup changed (an upload finished, a file was deleted). */
export const refreshImages = StateEffect.define<null>();

const WIKI_EMBED = /!\[\[([^[\]\n]+?)\]\]/g;
const MD_IMAGE = /!\[([^\]\n]*)\]\(\s*<?([^()\s<>]+)>?\s*\)/g;

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly width?: number,
    readonly height?: number,
  ) {
    super();
  }
  eq(o: ImageWidget) {
    return o.src === this.src && o.alt === this.alt && o.width === this.width && o.height === this.height;
  }
  toDOM() {
    const img = document.createElement("img");
    img.className = "cm-att-image";
    img.src = this.src;
    img.alt = this.alt;
    img.loading = "lazy";
    img.decoding = "async";
    if (this.width) img.width = this.width;
    if (this.height) img.height = this.height;
    return img;
  }
  ignoreEvent() {
    return false; // a click places the caret, which reveals the source
  }
}

/** Code regions keep their text: no image inside `code` or fences. */
function inCode(view: EditorView, pos: number) {
  for (let n: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(view.state).resolveInner(pos, 1); n; n = n.parent)
    if (/Code|HTML|Comment/.test(n.name)) return true;
  return false;
}

/** Lines the selection touches while the editor has focus (the same rule as live-preview.ts). */
function activeLines(view: EditorView) {
  const lines = new Set<number>();
  if (!view.hasFocus) return lines;
  for (const r of view.state.selection.ranges)
    for (let n = view.state.doc.lineAt(r.from).number; n <= view.state.doc.lineAt(r.to).number; n++) lines.add(n);
  return lines;
}

/** An image the lookup resolves `target` to, with the size written in `alt`. */
function resolveImage(lookup: AttachmentLookup, target: string, alt: string) {
  if (/^(?:[a-z][a-z0-9+.-]*:|[/\\]{2})/i.test(target)) return null; // remote or another scheme
  const clean = target.split("#")[0].trim();
  if (!clean) return null;
  const ref = lookup(clean);
  if (!ref || kindOf(ref.mime) !== "image") return null;
  const { text, width, height } = splitSize(alt);
  return new ImageWidget(attachmentUrl(ref), text || baseName(ref.path), width, height);
}

function build(view: EditorView, lookup: AttachmentLookup): DecorationSet {
  const { doc } = view.state;
  const fm = frontmatterEnd(view.state);
  const active = activeLines(view);
  const out: Range<Decoration>[] = [];
  const add = (from: number, to: number, widget: ImageWidget) => {
    if (from < fm || inCode(view, from)) return;
    const line = doc.lineAt(from);
    if (line.number !== doc.lineAt(to).number) return;
    if (active.has(line.number)) out.push(Decoration.widget({ widget, side: 1 }).range(to));
    else out.push(Decoration.replace({ widget }).range(from, to));
  };
  for (const { from, to } of view.visibleRanges) {
    const text = doc.sliceString(from, to);
    for (const m of text.matchAll(WIKI_EMBED)) {
      const pipe = m[1].indexOf("|");
      const target = pipe === -1 ? m[1] : m[1].slice(0, pipe);
      const w = resolveImage(lookup, target, pipe === -1 ? "" : `x${m[1].slice(pipe)}`);
      if (w) add(from + m.index!, from + m.index! + m[0].length, w);
    }
    for (const m of text.matchAll(MD_IMAGE)) {
      const w = resolveImage(lookup, safeDecode(m[2]), m[1]);
      if (w) add(from + m.index!, from + m.index! + m[0].length, w);
    }
  }
  return Decoration.set(out, true);
}

export function imageEmbeds(getLookup: () => AttachmentLookup): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.safe(view);
      }
      update(u: ViewUpdate) {
        if (
          u.docChanged ||
          u.selectionSet ||
          u.viewportChanged ||
          u.focusChanged ||
          u.transactions.some((t) => t.effects.some((e) => e.is(refreshImages))) ||
          syntaxTree(u.startState) !== syntaxTree(u.state)
        )
          this.decorations = this.safe(u.view);
      }
      safe(view: EditorView) {
        try {
          return build(view, getLookup());
        } catch (err) {
          console.error("Image previews disabled for this update:", err);
          return Decoration.none;
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
  return [
    plugin,
    EditorView.baseTheme({
      ".cm-att-image": {
        display: "inline-block",
        maxWidth: "100%",
        height: "auto",
        verticalAlign: "middle",
        borderRadius: "8px",
        cursor: "text",
      },
    }),
  ];
}
