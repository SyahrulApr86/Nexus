import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, count, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import katex from "katex";
import { z } from "zod";
import { db } from "@/db";
import { attachment, note, share, vault } from "@/db/schema";
import { trustedProxies } from "@/lib/auth";
import { renderMarkdown } from "@/lib/markdown/render";
import { attachmentTargets, createAttachmentLookup, kindOf, type AttachmentLookup } from "@/lib/markdown/attachments";
import { headingKey, parseFragment } from "@/lib/markdown/fragment-nav";
import { linkKey } from "@/lib/markdown/parse";
import { HttpError } from "@/lib/session";

/* ------------------------------------------------------------------ */
/* Policy                                                              */
/* ------------------------------------------------------------------ */

export const SHARE_LIMITS = {
  /** Live (not revoked, not expired) links per note. */
  activePerNote: 10,
  /** Longest expiry a link can be given, in days. Links without an expiry live until revoked. */
  maxDays: 365,
  /** Public page views per client IP per minute. */
  viewsPerMinute: 60,
  /** Attachment files fetched through share links, per client IP per minute (a page may hold many images). */
  filesPerMinute: 300,
} as const;

/** Random bytes in a token: 256 bits, so a token can be neither guessed nor enumerated. */
const TOKEN_BYTES = 32;
/** base64url of 32 bytes, without padding. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** POST /api/notes/[id]/share body: an optional expiry in whole days (absent or null: no expiry). */
export const ShareOptions = z
  .object({
    expiresInDays: z.number().int().min(1).max(SHARE_LIMITS.maxDays).nullable().optional(),
  })
  .strict();

const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

/** Live links: not revoked and not past their expiry. */
const live = (now: Date) => and(isNull(share.revokedAt), or(isNull(share.expiresAt), gt(share.expiresAt, now)));

/** Fields of a link the owner may see. The token is never stored, so it is never listed. */
const publicFields = {
  id: share.id,
  noteId: share.noteId,
  createdAt: share.createdAt,
  expiresAt: share.expiresAt,
};

/* ------------------------------------------------------------------ */
/* Owner side (signed in, scoped to a vault)                           */
/* ------------------------------------------------------------------ */

/**
 * Makes a public link to note `noteId` of vault `vaultId`. Returns the token once; only its hash is
 * stored. 404 when the note is not in that vault (another user's note id included).
 */
export async function createShare(vaultId: string, noteId: string, opts: z.infer<typeof ShareOptions> = {}) {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const now = new Date();
  const expiresAt = opts.expiresInDays ? new Date(now.getTime() + opts.expiresInDays * 86_400_000) : null;
  const row = await db.transaction(async (tx) => {
    // Locks the note row, so concurrent requests cannot pass the per-note limit together.
    const [n] = await tx
      .select({ id: note.id })
      .from(note)
      .where(and(eq(note.vaultId, vaultId), eq(note.id, noteId)))
      .for("update");
    if (!n) throw new HttpError(404, "Note not found");
    const [{ active }] = await tx
      .select({ active: count() })
      .from(share)
      .where(and(eq(share.noteId, noteId), live(now)));
    if (active >= SHARE_LIMITS.activePerNote)
      throw new HttpError(409, `A note can have at most ${SHARE_LIMITS.activePerNote} active links. Revoke one first.`);
    const [created] = await tx
      .insert(share)
      .values({ vaultId, noteId, tokenHash: hashToken(token), expiresAt })
      .returning(publicFields);
    return created;
  });
  return { ...row, token };
}

/** Live links of one note in the vault, newest first, without tokens. 404 when the note is not in the vault. */
export async function listShares(vaultId: string, noteId: string) {
  const [n] = await db
    .select({ id: note.id })
    .from(note)
    .where(and(eq(note.vaultId, vaultId), eq(note.id, noteId)))
    .limit(1);
  if (!n) throw new HttpError(404, "Note not found");
  return db
    .select(publicFields)
    .from(share)
    .where(and(eq(share.vaultId, vaultId), eq(share.noteId, noteId), live(new Date())))
    .orderBy(desc(share.createdAt));
}

/**
 * Revokes link `shareId` when it belongs to one of `userId`'s vaults (any of them, so the share
 * dialog works whichever vault is active). Idempotent; 404 for another user's link or a missing one.
 */
export async function revokeShare(userId: string, shareId: string) {
  const [s] = await db
    .select({ id: share.id, revokedAt: share.revokedAt })
    .from(share)
    .innerJoin(vault, eq(vault.id, share.vaultId))
    .where(and(eq(share.id, shareId), eq(vault.ownerId, userId)))
    .limit(1);
  if (!s) throw new HttpError(404, "Link not found");
  if (!s.revokedAt)
    await db
      .update(share)
      .set({ revokedAt: new Date() })
      .where(and(eq(share.id, s.id), isNull(share.revokedAt)));
  return { ok: true as const, id: s.id };
}

/**
 * The public URL of a token: the app's configured origin, else the origin the request came to.
 * NEXT_PUBLIC_APP_URL is read with a computed key so the bundler does not inline its build-time
 * value (see lib/public-origin.ts): an image built with one origin must not mint links for another.
 */
export function shareUrl(token: string, requestUrl: string) {
  let origin: string;
  try {
    origin = new URL(process.env["NEXT_PUBLIC_" + "APP_URL"] || process.env.BETTER_AUTH_URL || requestUrl).origin;
  } catch {
    origin = new URL(requestUrl).origin;
  }
  return `${origin}/s/${token}`;
}

/* ------------------------------------------------------------------ */
/* Public side (no session)                                            */
/* ------------------------------------------------------------------ */

export type SharedNote = { name: string; content: string; updatedAt: Date; vaultId: string; noteId: string };

/**
 * The note behind a public token, or null for a malformed, unknown, revoked or expired token (and
 * for a deleted note, whose links cascade away). The caller answers every null the same way.
 */
export async function resolveShare(token: string, now = new Date()): Promise<SharedNote | null> {
  if (!TOKEN_SHAPE.test(token)) return null;
  const hash = hashToken(token);
  const [row] = await db
    .select({
      tokenHash: share.tokenHash,
      revokedAt: share.revokedAt,
      expiresAt: share.expiresAt,
      name: note.name,
      content: note.content,
      updatedAt: note.updatedAt,
      vaultId: share.vaultId,
      noteId: note.id,
    })
    .from(share)
    .innerJoin(note, eq(note.id, share.noteId))
    .where(eq(share.tokenHash, hash))
    .limit(1);
  if (!row) return null;
  // Constant-time check of the stored hash, so no comparison in this process leaks how much matched.
  if (!timingSafeEqual(Buffer.from(row.tokenHash, "hex"), Buffer.from(hash, "hex"))) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return null;
  return { name: row.name, content: row.content, updatedAt: row.updatedAt, vaultId: row.vaultId, noteId: row.noteId };
}

/** The share-scoped URL of one attachment of the shared note. */
export const sharedAttachmentUrl = (token: string, sha256: string) => `/s/${token}/a/${sha256}`;

export type SharedFile = { path: string; mime: string; size: number; sha256: string };

/**
 * The attachments the shared note refers to, resolved the way the reading view resolves them
 * (exact path, else the shortest path with that file name), and nothing else of the vault. The
 * lookup hands out token-bound URLs (/s/<token>/a/<sha256>); `files` is what that route may serve.
 */
export async function sharedAttachments(
  token: string,
  shared: Pick<SharedNote, "vaultId" | "content">,
): Promise<{ lookup: AttachmentLookup; files: Map<string, SharedFile> }> {
  const targets = attachmentTargets(shared.content);
  const names = [...new Set(targets.map((t) => t.slice(t.lastIndexOf("/") + 1).toLowerCase()))];
  const files = new Map<string, SharedFile>();
  if (!names.length) return { lookup: () => null, files };
  const rows = await db
    .select({ path: attachment.path, mime: attachment.mime, size: attachment.size, sha256: attachment.sha256 })
    .from(attachment)
    .where(
      and(eq(attachment.vaultId, shared.vaultId), inArray(sql`lower(regexp_replace(${attachment.path}, '^.*/', ''))`, names)),
    )
    .limit(1000);
  const all = createAttachmentLookup(
    rows.map((r) => ({ ...r, url: sharedAttachmentUrl(token, r.sha256), download: kindOf(r.mime) !== "image" })),
  );
  // Only targets the note names: another file that merely shares a name is never reachable.
  for (const t of targets) {
    const ref = all(t);
    const row = ref && rows.find((r) => r.path === ref.path);
    if (row) files.set(row.sha256, row);
  }
  return {
    lookup: (t) => {
      const ref = all(t);
      return ref?.sha256 && files.has(ref.sha256) ? ref : null;
    },
    files,
  };
}

const decodeEntities = (s: string) =>
  s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi, (_m, dec: string, hex: string, name: string) =>
    dec
      ? String.fromCodePoint(Number(dec))
      : hex
        ? String.fromCodePoint(parseInt(hex, 16))
        : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[name.toLowerCase()],
  );

/** In-page id of a heading on the share page, from its text. */
const headingId = (text: string) =>
  `h-${
    headingKey(text)
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "section"
  }`;

const KATEX = { trust: false, strict: "ignore", throwOnError: false, maxSize: 20, maxExpand: 500, errorColor: "var(--negative)" } as const;

/** A formula as KaTeX HTML (with MathML for screen readers); the source as code if KaTeX fails. */
function mathHtml(source: string, display: boolean): string {
  try {
    const out = katex.renderToString(decodeEntities(source), { ...KATEX, displayMode: display });
    return display ? `<div class="math math-block">${out}</div>` : `<span class="math">${out}</span>`;
  } catch {
    return display ? `<pre><code>${source}</code></pre>` : `<code>${source}</code>`;
  }
}

/**
 * The shared note as HTML, from the same sanitising renderer as the reading view, then made safe
 * for a page that shows one note to anyone:
 * - [[wikilinks]] and note embeds become plain text: no other note is reachable from a share, and
 *   whether a linked note exists is not revealed (every target renders the same). Links to a
 *   heading or block of the shared note itself (`[[#Heading]]`, `[[This note#^id]]`) jump there;
 * - #tags become plain tag chips (no tag search outside the app);
 * - attachments the note names resolve through `attachments` (share-scoped URLs, see
 *   sharedAttachments): images inline, other files as download links; unresolved ones show their name;
 * - formulas are rendered here with KaTeX (trust off); mermaid blocks stay code for the page's
 *   client script to draw;
 * - images on other sites become links, since the share page's CSP loads images from this origin
 *   only (a remote image would tell its host who opened the link);
 * - links to other sites get rel="nofollow noopener noreferrer".
 */
export function renderSharedNote(content: string, opts: { name?: string; attachments?: AttachmentLookup } = {}): string {
  // Every target "exists", so no link is drawn as a dangling (ghost) link that leaks vault contents.
  let html = renderMarkdown(content, () => true, opts.attachments);
  // Note embeds: <div class="embed" data-embed="…"><a …>title</a><div class="embed-body embed-note">…</div></div>
  html = html.replace(
    /<div class="embed" data-embed="[^"]*"(?: data-embed-missing="")?><a [^>]*>([\s\S]*?)<\/a><div class="embed-body embed-note">[^<]*<\/div><\/div>/g,
    (_m, label: string) => `<p class="share-embed">↳ ${label}</p>`,
  );
  // Attachments not in the vault (or not named by this note): the file name only.
  html = html.replace(/<span class="ghost-attachment"[^>]*>([\s\S]*?)<\/span>/g, '<span class="share-link">↳ $1</span>');

  // Anchors for heading and block links into this note.
  const ids = new Set<string>();
  html = html.replace(/<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/g, (_m, level: string, attrs: string, inner: string) => {
    const base = headingId(decodeEntities(inner.replace(/<[^>]*>/g, "")));
    let id = base;
    for (let n = 1; ids.has(id); n++) id = `${base}-${n}`;
    ids.add(id);
    return `<h${level}${attrs} id="${id}">${inner}</h${level}>`;
  });
  html = html.replace(/<((?!h[1-6]\b)[a-z]+)([^>]*?) data-block="([A-Za-z0-9-]+)"/g, (_m, tag: string, attrs: string, id: string) => {
    ids.add(`b-${id}`);
    return `<${tag}${attrs} data-block="${id}" id="b-${id}"`;
  });
  const self = opts.name ? linkKey(opts.name) : null;
  html = html.replace(/<a href="wikilink:([^"#]*)#([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (m, rawTarget: string, rawFrag: string, label: string) => {
    let target = rawTarget;
    let frag = rawFrag;
    try {
      target = decodeURIComponent(decodeEntities(rawTarget));
      frag = decodeURIComponent(decodeEntities(rawFrag));
    } catch {}
    const f = parseFragment(frag);
    if (!f || (target.trim() && linkKey(target) !== self)) return m;
    const id = f.kind === "block" ? `b-${f.id}` : headingId(f.text);
    return ids.has(id) ? `<a class="share-anchor" href="#${id}">${label}</a>` : m;
  });

  // Anchors never nest, so the first </a> after an opening tag closes it.
  html = html.replace(/<a href="wikilink:[^"]*"[^>]*>([\s\S]*?)<\/a>/g, '<span class="share-link">$1</span>');
  html = html.replace(/<a href="tag:[^"]*"[^>]*>([\s\S]*?)<\/a>/g, '<span class="share-tag">$1</span>');
  html = html.replace(/<a href="(https?:\/\/[^"]*)"/g, '<a rel="nofollow noopener noreferrer" href="$1"');
  // Remote images: the renderer already made them links; mark them and keep them out of the referrer.
  html = html.replace(
    /<a (?:rel="nofollow noopener noreferrer" )?href="([^"]*)" class="external-image">([\s\S]*?)<\/a>/g,
    (_m, src: string, label: string) => `<a href="${src}" rel="nofollow noopener noreferrer">${label || "Image"} (external image)</a>`,
  );
  html = html.replace(
    /<img ([^>]*?)src="(https?:\/\/[^"]*)"([^>]*)>/g,
    (_m, before: string, src: string, after: string) => {
      const alt = /alt="([^"]*)"/.exec(before + after)?.[1];
      return `<a href="${src}" rel="nofollow noopener noreferrer">${alt || "Image"} (external image)</a>`;
    },
  );
  // Formulas: rendered on the server, so the page needs no script for them.
  html = html.replace(/<pre><code class="language-math math-display">([\s\S]*?)<\/code><\/pre>/g, (_m, src: string) => mathHtml(src, true));
  html = html.replace(/<code class="language-math math-(inline|display)">([\s\S]*?)<\/code>/g, (_m, kind: string, src: string) =>
    mathHtml(src, kind === "display"),
  );
  // Task boxes are read-only here: remark-gfm already marks them disabled; make sure of it.
  html = html.replace(/<input type="checkbox"(?![^>]*disabled)/g, '<input type="checkbox" disabled');
  return html;
}

/* ------------------------------------------------------------------ */
/* Client address (rate-limit key for the public page)                 */
/* ------------------------------------------------------------------ */

/**
 * The client address behind the reverse proxy: the right-most X-Forwarded-For entry that is not a
 * trusted proxy (NEXUS_TRUSTED_PROXIES, exact addresses). The right-most entry is the one the
 * nearest proxy wrote, so a client cannot choose its own key by sending the header itself, as long
 * as the app port is reachable only through that proxy (README, Deploy).
 */
export function clientIp(h: Headers, trusted = trustedProxies()): string {
  const chain = (h.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (let i = chain.length - 1; i >= 0; i--) if (!trusted.includes(chain[i])) return chain[i];
  return h.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Content-Security-Policy for the share page, stricter than the app's: images, fonts, styles and
 * scripts from this origin only, nothing may be framed, posted or embedded. Sent as a <meta> tag,
 * which narrows the app-wide header policy (both apply).
 */
export function sharePolicy(isDev = process.env.NODE_ENV !== "production") {
  return [
    "default-src 'none'",
    // Next's inline bootstrap needs 'unsafe-inline'; dev adds eval and the HMR socket.
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join("; ");
}
