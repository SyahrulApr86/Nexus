import type { NextConfig } from "next";
import { ATTACHMENT_CSP } from "./src/lib/attachments/headers";

const dev = process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy without nonces (pages are prerendered with Cache Components, so a
 * per-request nonce is not available). 'unsafe-inline' scripts cover Next's inline bootstrap and
 * the theme script in layout.tsx; dev adds 'unsafe-eval' and the HMR websocket. Everything else is
 * same-origin only: fonts are self-hosted by next/font, the API is same-origin, and no page may
 * frame this app.
 *
 * Images and media are same-origin too (attachments come from /api/attachments/file); `data:` and
 * `blob:` cover the app's own generated images. Remote images are deliberately not allowed: a note
 * could otherwise make every reader's browser call a third party (tracking pixels, IP leaks), so
 * the reading view renders `![](https://…)` as a link instead (src/lib/markdown/attachments.ts).
 */
export function contentSecurityPolicy(isDev = dev) {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self'",
    "font-src 'self'",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
  ].join("; ");
}

export function securityHeaders(isDev = dev) {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(isDev) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    // No includeSubDomains: a self-hoster's sibling subdomains are not ours to force onto HTTPS.
    // Browsers ignore HSTS on plain-http localhost, so it is harmless in development.
    ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000" }]),
  ];
}

const nextConfig: NextConfig = {
  output: "standalone",
  cacheComponents: true,
  poweredByHeader: false,
  devIndicators: { position: "bottom-right" },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders() },
      // Vault data must never sit in a shared or back/forward cache. Attachment files set their own
      // private Cache-Control (immutable per content version), so they are left out here.
      {
        source: "/api/:path((?!attachments/file$).*)",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
      // Last match wins: attachment files get the sandbox policy instead of the page policy.
      { source: "/api/attachments/file", headers: [{ key: "Content-Security-Policy", value: ATTACHMENT_CSP }] },
      // The service worker is checked for updates on every load, never served from an HTTP cache.
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
