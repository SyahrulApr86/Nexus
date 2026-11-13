import "server-only";
import { headers } from "next/headers";
import { asc, eq } from "drizzle-orm";
import { getAuth } from "@/lib/auth";
import { db } from "@/db";
import { vault } from "@/db/schema";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function getSessionUser() {
  // Read the request first: during prerender this is where rendering stops,
  // so auth/DB are never initialised at build time.
  const h = await headers();
  const s = await getAuth().api.getSession({ headers: h });
  return s?.user ?? null;
}

/** Returns the user's first vault, creating "My Vault" on first use. */
export async function getDefaultVaultId(userId: string): Promise<string> {
  const [existing] = await db
    .select({ id: vault.id })
    .from(vault)
    .where(eq(vault.ownerId, userId))
    .orderBy(asc(vault.createdAt))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(vault)
    .values({ ownerId: userId, name: "My Vault" })
    .returning({ id: vault.id });
  return created.id;
}

/* ------------------------------------------------------------------ */
/* Request origin (CSRF defence in depth)                              */
/* ------------------------------------------------------------------ */

/** Origins this app is served from: BETTER_AUTH_URL and NEXT_PUBLIC_APP_URL, when set. */
function appOrigins(): string[] {
  const out: string[] = [];
  for (const v of [process.env.BETTER_AUTH_URL, process.env.NEXT_PUBLIC_APP_URL]) {
    if (!v) continue;
    try {
      out.push(new URL(v).origin);
    } catch {
      // A malformed value is a deploy error; auth.ts reports it. Just do not trust it here.
    }
  }
  return out;
}

/**
 * Refuses a request another site made with the user's cookie. Browsers send
 * `Sec-Fetch-Site` on every request and `Origin` on every non-GET one, so:
 * - `Sec-Fetch-Site` other than `same-origin` (or `none`, a typed URL or bookmark) is refused,
 *   which also covers a sibling subdomain ("same-site");
 * - an `Origin` that is not the app's own origin is refused.
 * Clients that send neither (curl, tests) are not browsers riding a cookie, so they pass.
 */
export function assertSameOrigin(h: Headers) {
  const site = h.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new HttpError(403, "Cross-site request refused");
  const origin = h.get("origin");
  if (!origin) return;
  const allowed = appOrigins();
  if (allowed.length) {
    if (!allowed.includes(origin)) throw new HttpError(403, "Cross-site request refused");
    return;
  }
  // No configured origin (local dev without .env): compare with the Host the request was sent to.
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    throw new HttpError(403, "Cross-site request refused");
  }
  if (host !== h.get("host")) throw new HttpError(403, "Cross-site request refused");
}

/** For API routes: same-origin check, then the authenticated user + vault, or throws 403/401. */
export async function requireVault() {
  assertSameOrigin(await headers());
  const user = await getSessionUser();
  if (!user) throw new HttpError(401, "Unauthorized");
  const vaultId = await getDefaultVaultId(user.id);
  return { user, vaultId };
}

/* ------------------------------------------------------------------ */
/* Request bodies with a size limit                                    */
/* ------------------------------------------------------------------ */

export const KiB = 1024;
export const MiB = 1024 * KiB;

/**
 * Reads the whole body, but never more than `limit` bytes: a larger Content-Length is refused
 * before anything is read, and a body without one (chunked) is cut off as soon as it passes the
 * limit. Next sets no body limit for route handlers, so every handler that reads a body uses this.
 */
export async function readBody(req: Request, limit: number): Promise<Uint8Array> {
  const declared = req.headers.get("content-length");
  if (declared !== null && !(Number(declared) <= limit)) throw new HttpError(413, "Request too large");
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new HttpError(413, "Request too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/**
 * JSON body of at most `limit` bytes. Anything but `Content-Type: application/json` is refused
 * with 415, so a cross-site form or `text/plain` fetch can never reach a JSON handler without
 * a CORS preflight (which this app never answers).
 */
export async function readJson(req: Request, limit: number): Promise<unknown> {
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") throw new HttpError(415, "Expected application/json");
  const buf = await readBody(req, limit);
  try {
    return JSON.parse(new TextDecoder().decode(buf));
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

/** multipart/form-data body of at most `limit` bytes. */
export async function readForm(req: Request, limit: number): Promise<FormData> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("multipart/form-data")) throw new HttpError(415, "Expected multipart/form-data");
  const buf = await readBody(req, limit);
  try {
    return await new Response(buf as BodyInit, { headers: { "content-type": type } }).formData();
  } catch {
    throw new HttpError(400, "Invalid form data");
  }
}

/* ------------------------------------------------------------------ */
/* Per-user rate limits (in memory, one process)                       */
/* ------------------------------------------------------------------ */

const buckets = new Map<string, number[]>();

/**
 * Sliding-window limit: at most `max` calls of `key` per `windowMs`, else 429. The counters live
 * in this process, which is enough for the single-container deploy (docker-compose.yml); they
 * reset on restart.
 */
export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    buckets.set(key, hits);
    throw new HttpError(429, "Too many requests, try again later");
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 10_000) for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
}

/* ------------------------------------------------------------------ */
/* Route wrapper                                                       */
/* ------------------------------------------------------------------ */

/**
 * Only the error's class and code are logged. A DrizzleQueryError's message embeds every bound
 * parameter (whole note bodies, ids), so the error object or its message never reaches the log.
 */
export function logError(scope: string, err: unknown) {
  const e = (err ?? {}) as { name?: unknown; code?: unknown; cause?: { name?: unknown; code?: unknown } };
  const code = e.cause?.code ?? e.code;
  console.error(`[${scope}] unhandled error`, {
    name: typeof e.name === "string" ? e.name : typeof err,
    ...(typeof code === "string" || typeof code === "number" ? { code } : {}),
    ...(typeof e.cause?.name === "string" ? { cause: e.cause.name } : {}),
  });
}

/** Wrap a route handler body: maps HttpError/validation errors to JSON responses. */
export async function handle<T>(fn: () => Promise<T>): Promise<Response> {
  try {
    const data = await fn();
    if (data instanceof Response) return data;
    return Response.json(data ?? { ok: true });
  } catch (err) {
    if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
    if (err && typeof err === "object" && "issues" in err)
      return Response.json({ error: "Invalid input", issues: (err as { issues: unknown }).issues }, { status: 400 });
    logError("api", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
