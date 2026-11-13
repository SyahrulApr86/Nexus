import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "@/db";
import * as schema from "@/db/schema";

/** Self-registration is off unless NEXUS_ALLOW_SIGNUP=true (turn it on to create the owner account). */
export function signupAllowed() {
  return process.env.NEXUS_ALLOW_SIGNUP === "true";
}

/**
 * Production must run on an https:// base URL: Better Auth derives the cookie Secure flag and
 * the __Secure- prefix from its scheme. http://localhost and http://127.0.0.1 stay allowed so
 * the prod profile can be tried locally.
 */
export function assertSecureBaseUrl(url = process.env.BETTER_AUTH_URL, env = process.env.NODE_ENV) {
  if (env !== "production") return;
  let parsed: URL;
  try {
    parsed = new URL(url ?? "");
  } catch {
    throw new Error("BETTER_AUTH_URL must be set to the public https:// origin of this app.");
  }
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:"))
    throw new Error("BETTER_AUTH_URL must use https:// in production.");
}

/**
 * Proxies whose X-Forwarded-For entries are skipped when looking for the client address
 * (comma-separated IPs or CIDRs, e.g. "127.0.0.1,::1,10.231.47.0/24"). Leave it unset when the
 * one reverse proxy overwrites X-Forwarded-For with the peer address (README, Deploy): then only a
 * single-value header is trusted. Either way the app port must not be reachable except through
 * that proxy, or a client can choose its own rate-limit key.
 */
export function trustedProxies(value = process.env.NEXUS_TRUSTED_PROXIES): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function authOptions() {
  return {
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      disableSignUp: !signupAllowed(),
      // No session from sign-up: Better Auth then answers a registered email with the same 200 and
      // body shape as a new one (a synthetic user, token null) and still hashes the password, so the
      // endpoint cannot be used to check which emails have accounts. The new owner signs in next.
      autoSignIn: false,
    },
    advanced: {
      ipAddress: {
        ipAddressHeaders: ["x-forwarded-for"],
        trustedProxies: trustedProxies(),
      },
    },
    // Better Auth enables this in production only; the rules below are stricter than its
    // defaults (3 per 10 s) for the two endpoints that hash a password.
    rateLimit: {
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60 * 60, max: 5 },
      },
    },
  };
}

function create() {
  assertSecureBaseUrl();
  return betterAuth({
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    ...authOptions(),
    plugins: [nextCookies()], // must stay last
  });
}

let instance: ReturnType<typeof create> | undefined;

/** Built on first request, so secrets/DB are only required at runtime, not at build time. */
export function getAuth() {
  return (instance ??= create());
}
