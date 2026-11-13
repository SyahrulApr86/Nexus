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
:root{color-scheme:light dark;--bg:#f1f4f7;--sheet:#fff;--fg:#02070a;--muted:#4a5560;--border:#d9e0e6}
@media (prefers-color-scheme:dark){:root{--bg:#02070a;--sheet:#0a141b;--fg:#e8eef2;--muted:#9aa8b3;--border:#1c2a33}}
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;background:var(--bg);color:var(--fg);font-family:"Hanken Grotesk",system-ui,sans-serif;padding:48px 16px}
main{max-width:760px;margin:0 auto;border:1px solid var(--border);border-radius:14px;background:var(--sheet);padding:28px 20px}
@media (min-width:768px){main{padding:48px 40px}}
h1{margin:0;font-family:Literata,Georgia,serif;font-size:24px;line-height:32px;font-weight:600;text-wrap:balance}
p{margin:12px 0 0;max-width:60ch;font-size:15px;line-height:24px;color:var(--muted)}
</style>
</head>
<body>
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
