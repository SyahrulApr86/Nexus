import { NextResponse, type NextRequest } from "next/server";
import { resolveShare } from "@/lib/shares";

/**
 * Public share pages answer an unknown, revoked or expired link with a real HTTP 404.
 *
 * The page itself streams (Cache Components send the shell first), so by the time it knows the
 * token is dead the status line has gone out as 200. Here, before rendering, one lookup on the
 * unique token-hash index decides it; the page still renders its own "This link is not available"
 * view, only with the right status. Live links pass straight through. Nothing else runs this file.
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
  return NextResponse.rewrite(request.nextUrl, { status: 404 });
}

export const config = {
  // One path segment under /s/: the share page only, never its assets or any other route.
  matcher: "/s/:token",
};
