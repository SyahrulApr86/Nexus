import { NextResponse, type NextRequest } from "next/server";
import { resolveShare } from "@/lib/shares";

/**
 * Public share pages answer an unknown, revoked or expired link with a real HTTP 404.
 *
 * The page itself streams (Cache Components send the shell first), so by the time it knows the
 * token is dead the status line has gone out as 200, and a rewrite carrying `status: 404` is not
 * honoured by `next start` for an App Router page. So here, before rendering, one lookup on the
 * unique token-hash index decides it and a dead link gets a small self-contained 404 page with the
 * same wording as `app/s/[token]/not-found.tsx`. Live links pass straight through. Nothing else
 * runs this file.
 */
export async function proxy(request: NextRequest) {
  const token = request.nextUrl.pathname.slice("/s/".length);
  let live: boolean;
  try {
    live = !!(await resolveShare(decodeURIComponent(token)));
  } catch {
    // A database hiccup is the page's to report; never turn it into a misleading 404.
    return NextResponse.next();
  }
  if (live) return NextResponse.next();
  return new NextResponse(GONE_HTML, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

/** Same page for an unknown, revoked or expired link, so the answer never tells which. */
const GONE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>Link not available</title>
<style>
:root{color-scheme:dark;--bg:#02070a;--panel:#0b131a;--fg:#e8eef2;--muted:#a9b5c0;--border:#1f2b36;--blue:#0297de}
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;display:flex;flex-direction:column;background:var(--bg);color:var(--fg);font-family:"Hanken Grotesk",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
header{display:flex;align-items:center;min-height:56px;padding:0 16px;border-bottom:1px solid var(--border);font-size:18px;font-weight:650;letter-spacing:-.03em} /* taste-skill-ignore: owner-approved hairline structure (DESIGN/ reference) */
header span{color:var(--blue);font-weight:400}
main{flex:1;width:100%;max-width:calc(68ch + 32px);margin:0 auto;padding:clamp(48px,9vw,120px) 16px}
@media (min-width:768px){header{padding:0 40px}main{max-width:calc(68ch + 80px);padding-inline:40px}}
h1{margin:0;font-family:"Hanken Grotesk",system-ui,-apple-system,"Segoe UI",sans-serif;font-size:clamp(36px,5.2vw,60px);line-height:1.05;letter-spacing:-.04em;font-weight:500;text-wrap:balance}
p{margin:24px 0 0;max-width:52ch;font-size:18px;line-height:1.55;color:var(--muted);text-wrap:pretty}
</style>
</head>
<body>
<header><span aria-hidden="true">[[</span>Nexus<span aria-hidden="true">]]</span></header>
<main>
<h1>This link is not available</h1>
<p>It may have been revoked or may have expired, or the address may be incomplete. Ask the person who shared it for a new link.</p>
</main>
</body>
</html>
`;

export const config = {
  // One path segment under /s/: the share page only, never its assets or any other route.
  matcher: "/s/:token",
};
