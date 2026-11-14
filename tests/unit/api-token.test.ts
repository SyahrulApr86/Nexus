import { describe, expect, it } from "vitest";
import {
  API_TOKEN_LIMITS,
  CreateTokenBody,
  TOKEN_SHAPE,
  canWrite,
  generateToken,
  hashToken,
  tokenPrefix,
} from "@/lib/api-tokens";
import { bearerCredential, unauthorized } from "@/lib/bearer";

describe("token format", () => {
  it("is nxs_ and 43 base64url characters (256 random bits)", () => {
    const t = generateToken();
    expect(t).toMatch(TOKEN_SHAPE);
    expect(t).toHaveLength(4 + 43);
  });

  it("never repeats", () => {
    const seen = new Set(Array.from({ length: 200 }, generateToken));
    expect(seen.size).toBe(200);
  });

  it("hashes to 64 lowercase hex characters, deterministically", () => {
    const t = generateToken();
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toBe(hashToken(generateToken()));
    // Known vector: sha256("nxs_test").
    expect(hashToken("nxs_test")).toBe("8528adcc8081d11f35e5b09e7d9a4905a0f8ec23e64815084e14284bbf2fe144");
  });

  it("keeps nxs_ and 8 characters as the display prefix, never the whole token", () => {
    const t = generateToken();
    expect(tokenPrefix(t)).toBe(t.slice(0, 12));
    expect(tokenPrefix(t).length).toBeLessThan(t.length);
  });
});

describe("scope", () => {
  it("only write can write", () => {
    expect(canWrite("write")).toBe(true);
    expect(canWrite("read")).toBe(false);
  });
});

describe("CreateTokenBody", () => {
  it("accepts a minimal body and trims the name", () => {
    expect(CreateTokenBody.parse({ name: "  Laptop ", scope: "read" })).toEqual({ name: "Laptop", scope: "read" });
  });

  it("refuses an unknown scope, an empty or long name and unknown keys", () => {
    expect(() => CreateTokenBody.parse({ name: "x", scope: "admin" })).toThrow();
    expect(() => CreateTokenBody.parse({ name: "   ", scope: "read" })).toThrow();
    expect(() => CreateTokenBody.parse({ name: "x".repeat(API_TOKEN_LIMITS.nameLength + 1), scope: "read" })).toThrow();
    expect(() => CreateTokenBody.parse({ name: "x", scope: "read", userId: "someone" })).toThrow();
  });

  it("refuses control and bidi characters in the name", () => {
    expect(() => CreateTokenBody.parse({ name: "a‮b", scope: "read" })).toThrow();
    expect(() => CreateTokenBody.parse({ name: "a\nb", scope: "read" })).toThrow();
  });

  it("bounds the expiry and checks the vault id shape", () => {
    expect(CreateTokenBody.parse({ name: "x", scope: "write", expiresInDays: null }).expiresInDays).toBeNull();
    expect(() => CreateTokenBody.parse({ name: "x", scope: "write", expiresInDays: 0 })).toThrow();
    expect(() => CreateTokenBody.parse({ name: "x", scope: "write", expiresInDays: API_TOKEN_LIMITS.maxDays + 1 })).toThrow();
    expect(() => CreateTokenBody.parse({ name: "x", scope: "write", expiresInDays: 1.5 })).toThrow();
    expect(() => CreateTokenBody.parse({ name: "x", scope: "write", vaultId: "not-a-uuid" })).toThrow();
  });
});

describe("bearerCredential", () => {
  const h = (v?: string) => new Headers(v === undefined ? {} : { authorization: v });

  it("reads Bearer credentials, case-insensitive scheme", () => {
    expect(bearerCredential(h("Bearer nxs_abc"))).toBe("nxs_abc");
    expect(bearerCredential(h("bearer   nxs_abc"))).toBe("nxs_abc");
  });

  it("ignores missing headers, other schemes and malformed values", () => {
    expect(bearerCredential(h())).toBeNull();
    expect(bearerCredential(h("Basic nxs_abc"))).toBeNull();
    expect(bearerCredential(h("Bearer"))).toBeNull();
    expect(bearerCredential(h("Bearer a b"))).toBeNull();
    expect(bearerCredential(h("nxs_abc"))).toBeNull();
  });

  it("never reads a cookie", () => {
    expect(bearerCredential(new Headers({ cookie: "better-auth.session_token=abc" }))).toBeNull();
  });
});

describe("unauthorized", () => {
  it("answers 401 with a Bearer challenge; invalid_token only when a token was sent", async () => {
    const missing = unauthorized("missing");
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toBe('Bearer realm="nexus"');
    const invalid = unauthorized("invalid");
    expect(invalid.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect(await invalid.json()).toMatchObject({ jsonrpc: "2.0", id: null });
  });
});
