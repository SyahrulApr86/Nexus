/**
 * Content-Security-Policy of every attachment response (/api/attachments/file). `sandbox` gives a
 * file opened at its own URL an opaque origin with no script, forms or popups, so even a file that
 * slipped past sniffing could not act as the app. The rest only lets an opened image or media file
 * display itself. Set by next.config.ts (which would otherwise send the page policy) and by the
 * route itself.
 */
export const ATTACHMENT_CSP = "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'";
