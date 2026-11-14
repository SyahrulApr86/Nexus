/**
 * Attachments in the reading view: `![[photo.png]]`, `![[photo.png|300]]`, `![[photo.png|300x200]]`,
 * `![alt](photo.png)`, `![alt](sub/file%20name.png)`, `[[doc.pdf]]` and `[text](doc.pdf)`.
 *
 * The renderer never queries anything: the caller passes a lookup (`createAttachmentLookup`, built
 * from GET /api/attachments) and every target is resolved the way Obsidian does it: the exact
 * vault path first, else the file whose name matches, the shortest path winning. Then, after
 * sanitising (so every attribute below is ours, built from resolved data):
 * - images (SVG included: an <img> never runs script) become <img src="/api/attachments/file?…">;
 * - audio and video become <audio controls> / <video controls>;
 * - a PDF becomes a link card that opens it in a new tab (the CSP forbids framing, so no <iframe>);
 * - an unresolved target becomes a ghost label styled like a link to a missing note, but inert: a
 *   click must not create a note named "photo.png";
 * - a remote image (`![](https://…)`) becomes a plain link, since the CSP keeps images same-origin
 *   (next.config.ts): a note cannot make its reader's browser call a third party.
 */

export type AttachmentKind = "image" | "pdf" | "audio" | "video" | "file";

/**
 * What the renderer needs to know about one stored attachment. `url` replaces the vault URL (the
 * share page serves files through its token); `download` makes anything but an image a download
 * link instead of a player or a new-tab card.
 */
export type AttachmentRef = { path: string; mime: string; sha256?: string; url?: string; download?: boolean };

/** Resolves a link target ("photo.png", "Assets/photo.png") to an attachment, or null. */
export type AttachmentLookup = (target: string) => AttachmentRef | null;

/** File names an embed treats as attachments even when they do not resolve (a missing image). */
export const ATTACHMENT_NAME =
  /\.(png|jpe?g|gif|webp|avif|bmp|svg|pdf|mp3|wav|ogg|m4a|flac|mp4|webm|mov|canvas)$/i;

const lower = (s: string) => s.toLowerCase();
const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** Trims a target and drops a leading "./" or "/" (vault-absolute). */
function cleanTarget(target: string) {
  return target.trim().replace(/^(?:\.\/|\/)+/, "");
}

export function createAttachmentLookup(items: readonly AttachmentRef[]): AttachmentLookup {
  const exact = new Map<string, AttachmentRef>();
  const byPath = new Map<string, AttachmentRef>();
  const byName = new Map<string, AttachmentRef[]>();
  for (const item of items) {
    exact.set(item.path, item);
    if (!byPath.has(lower(item.path))) byPath.set(lower(item.path), item);
    const key = lower(baseName(item.path));
    const list = byName.get(key);
    if (list) list.push(item);
    else byName.set(key, [item]);
  }
  for (const list of byName.values())
    list.sort((a, b) => a.path.length - b.path.length || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return (target) => {
    const t = cleanTarget(target);
    if (!t) return null;
    const hit = exact.get(t) ?? byPath.get(lower(t));
    if (hit) return hit;
    const candidates = byName.get(lower(baseName(t)));
    if (!candidates) return null;
    if (!t.includes("/")) return candidates[0];
    // "sub/photo.png" also matches "Assets/sub/photo.png", never "other/photo.png".
    const suffix = `/${lower(t)}`;
    return candidates.find((c) => lower(c.path).endsWith(suffix)) ?? null;
  };
}

export function kindOf(mime: string): AttachmentKind {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "file";
}

/** Same-origin URL of an attachment; `v` pins the content, so the browser may cache it for good. */
export function attachmentUrl(ref: AttachmentRef): string {
  if (ref.url) return ref.url;
  const v = ref.sha256 ? `&v=${ref.sha256.slice(0, 16)}` : "";
  return `/api/attachments/file?path=${encodeURIComponent(ref.path)}${v}`;
}

/** Markdown for an attachment embed or link, turned into media by `rehypeAttachments`. */
export function attachmentMarkdown(label: string, target: string, embed: boolean, fragment = ""): string {
  const hash = fragment ? `#${encodeURIComponent(fragment)}` : "";
  return `${embed ? "!" : ""}[${label}](attachment:${encodeURIComponent(target)}${hash})`;
}

/** "Cover|300x200" → { text: "Cover", width: 300, height: 200 }. */
export function splitSize(alt: string): { text: string; width?: number; height?: number } {
  const m = /\|(\d{1,5})(?:x(\d{1,5}))?$/.exec(alt);
  if (!m) return { text: alt.trim() };
  return { text: alt.slice(0, m.index).trim(), width: Number(m[1]), ...(m[2] ? { height: Number(m[2]) } : {}) };
}

type HNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HNode[];
};

const text = (value: string): HNode => ({ type: "text", value });
const el = (tagName: string, properties: Record<string, unknown>, children: HNode[] = []): HNode => ({
  type: "element",
  tagName,
  properties,
  children,
});

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The vault target of a src/href: `attachment:` links and relative URLs; null for anything else. */
function targetOf(url: string): { target: string; fragment: string } | null {
  const attachment = url.startsWith("attachment:");
  // A scheme ("https:", "mailto:"), a protocol-relative "//host" or an in-page "#id" is not a file.
  if (!attachment && (!url || /^[a-z][a-z0-9+.-]*:/i.test(url) || /^[/\\]{2}/.test(url) || url.startsWith("#"))) return null;
  const rest = attachment ? url.slice("attachment:".length) : url;
  const at = rest.indexOf("#");
  const path = at === -1 ? rest : rest.slice(0, at);
  const fragment = at === -1 ? "" : safeDecode(rest.slice(at + 1));
  return { target: safeDecode(attachment ? path : path.split("?")[0]), fragment };
}

/** "#page=3" kept on a PDF link, re-encoded so it can only ever be a fragment. */
const hashOf = (fragment: string) => (fragment ? `#${encodeURI(fragment).replace(/#/g, "%23")}` : "");

/** Text of a node, for link labels. */
const textOf = (n: HNode): string => (n.type === "text" ? (n.value ?? "") : (n.children ?? []).map(textOf).join(""));

/** The label to show: the author's text, or the file name when the text is just its stem (the default alt). */
function display(label: string, name: string) {
  return !label || label === name.replace(/\.[^.]+$/, "") ? name : label;
}

/** Inert stand-in for an attachment that is not in the vault. */
function ghost(label: string, target: string): HNode {
  return el("span", { className: ["ghost-attachment"], dataAttachmentMissing: target }, [text(label || target)]);
}

function media(src: string, alt: string, lookup: AttachmentLookup | undefined): HNode {
  // Protocol-relative "//host/x.png" is remote too (rehypeReadingView then drops the href).
  const remote = /^(?:https?:)?[/\\]{2}/i.test(src);
  const { text: label, width, height } = splitSize(alt);
  if (remote) return el("a", { href: src, className: ["external-image"] }, [text(label || src)]);
  const t = targetOf(src);
  if (!t) return el("img", { src, alt });
  const ref = lookup?.(t.target) ?? null;
  if (!ref) return ghost(display(label, baseName(cleanTarget(t.target))), cleanTarget(t.target));
  const url = attachmentUrl(ref);
  const name = baseName(ref.path);
  const size = { ...(width ? { width } : {}), ...(height ? { height } : {}) };
  const kind = kindOf(ref.mime);
  if (ref.download && kind !== "image") return downloadCard(url, display(label, name), name, kind);
  switch (kind) {
    case "image":
      // rehypeReadingView adds loading/decoding and applies the size written in the alt text.
      return el("img", { src: url, alt });
    case "audio":
      return el("audio", { controls: true, preload: "metadata", src: url, ariaLabel: display(label, name) }, [
        el("a", { href: url, download: name }, [text(`Download ${name}`)]),
      ]);
    case "video":
      return el("video", { controls: true, preload: "metadata", playsInline: true, src: url, ariaLabel: display(label, name), ...size }, [
        el("a", { href: url, download: name }, [text(`Download ${name}`)]),
      ]);
    case "pdf":
      return card(url + hashOf(t.fragment), display(label, name), "PDF, opens in a new tab");
    default:
      return card(url, display(label, name), "File, opens in a new tab");
  }
}

function card(href: string, name: string, meta: string): HNode {
  return el("a", { href, className: ["attachment-card"], target: "_blank", rel: ["noopener"] }, [
    el("span", { className: ["attachment-name"] }, [text(name)]),
    el("span", { className: ["attachment-meta"] }, [text(meta)]),
  ]);
}

const KIND_LABEL: Record<AttachmentKind, string> = { image: "Image", pdf: "PDF", audio: "Audio", video: "Video", file: "File" };

/** A file offered as a download (share page): the card look, with the kind and the action. */
function downloadCard(href: string, label: string, name: string, kind: AttachmentKind): HNode {
  return el("a", { href, className: ["attachment-card"], download: name }, [
    el("span", { className: ["attachment-name"] }, [text(label)]),
    el("span", { className: ["attachment-meta"] }, [text(`${KIND_LABEL[kind]}, download`)]),
  ]);
}

/** Vault targets a note refers to: `[[x]]`/`![[x]]` targets and relative markdown links and images. */
export function attachmentTargets(md: string, max = 200): string[] {
  const out = new Set<string>();
  // Code is masked by the caller's choice of text; here only obvious code spans are skipped.
  const body = md.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g, " ");
  for (const m of body.matchAll(/!?\[\[([^\[\]\n]+?)\]\]/g)) {
    const t = m[1].split("|")[0].split("#")[0].trim();
    if (t) out.add(t);
  }
  for (const m of body.matchAll(/!?\[[^\]\n]*\]\(\s*<?([^\s()<>]+)>?/g)) {
    const t = targetOf(m[1]);
    if (t?.target.trim()) out.add(cleanTarget(t.target));
  }
  return [...out].slice(0, max);
}

/** A link to an attachment (`[[doc.pdf]]`, `[text](doc.pdf)`): opens the file in a new tab. */
function relink(a: HNode, lookup: AttachmentLookup | undefined): HNode {
  const href = String(a.properties?.href ?? "");
  const t = targetOf(href);
  if (!t) return a;
  const ref = lookup?.(t.target) ?? null;
  if (!ref) {
    // Only our own `attachment:` links turn into ghosts; other relative links stay as written.
    return href.startsWith("attachment:") ? ghost(textOf(a), cleanTarget(t.target)) : a;
  }
  if (ref.download && kindOf(ref.mime) !== "image") {
    a.properties = { ...a.properties, href: attachmentUrl(ref), download: baseName(ref.path) };
    return a;
  }
  a.properties = {
    ...a.properties,
    href: attachmentUrl(ref) + hashOf(t.fragment),
    target: "_blank",
    rel: ["noopener"],
  };
  return a;
}

/** Runs after sanitising; reads the lookup from `file.data.attachments` (see render.ts). */
export function rehypeAttachments() {
  return (tree: unknown, file: { data: object }) => {
    const lookup = (file.data as { attachments?: AttachmentLookup }).attachments;
    const visit = (node: HNode) => {
      const kids = node.children;
      if (!kids) return;
      for (let i = 0; i < kids.length; i++) {
        const k = kids[i];
        if (k.type !== "element") continue;
        if (k.tagName === "img") {
          const src = String(k.properties?.src ?? "");
          if (!src) continue;
          kids[i] = media(src, String(k.properties?.alt ?? ""), lookup);
          continue;
        }
        if (k.tagName === "a") kids[i] = relink(k, lookup);
        visit(kids[i]);
      }
    };
    visit(tree as HNode);
  };
}
