/**
 * The public origin is read when a request arrives, not when the app is built: a Docker image is
 * built without .env, so a build-time value would bake http://localhost:3000 into canonical and
 * og:* URLs. BETTER_AUTH_URL is required at runtime anyway. NEXT_PUBLIC_APP_URL is read with a
 * computed key so the bundler does not inline its build-time value. The Host header is not used, so
 * a forged header cannot change the canonical URL. The page body stays prerendered; only this
 * metadata (and the session-aware vault link) is resolved per request.
 */
export function publicOrigin(): URL {
  const env = process.env;
  const candidates = [env.BETTER_AUTH_URL, env["NEXT_PUBLIC_" + "APP_URL"]];
  for (const value of candidates) {
    if (!value) continue;
    try {
      return new URL(new URL(value).origin);
    } catch {
      // Ignore a malformed value and try the next one.
    }
  }
  return new URL("http://localhost:3000");
}
