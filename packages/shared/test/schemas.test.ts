import { describe, expect, it } from "vitest";
import { validatePassword, registerSchema } from "../src/schemas.js";

describe("validatePassword (FR-001)", () => {
  it("accepts a conforming password", () => {
    expect(validatePassword("Abcdef1!")).toEqual([]);
  });

  it("reports length failure", () => {
    expect(validatePassword("Ab1!")).toContain(
      "Password must be at least 8 characters",
    );
  });

  it("reports missing uppercase", () => {
    expect(validatePassword("abcdef1!")).toContain(
      "Password must include at least one uppercase letter",
    );
  });

  it("reports missing lowercase", () => {
    expect(validatePassword("ABCDEF1!")).toContain(
      "Password must include at least one lowercase letter",
    );
  });

  it("reports missing digit", () => {
    expect(validatePassword("Abcdefg!")).toContain(
      "Password must include at least one digit",
    );
  });

  it("reports missing special character", () => {
    expect(validatePassword("Abcdefg1")).toContain(
      "Password must include at least one special character",
    );
  });

  it("reports ALL failures at once (field-level feedback)", () => {
    expect(validatePassword("abc")).toHaveLength(4);
  });
});

describe("registerSchema", () => {
  it("accepts valid input", () => {
    const r = registerSchema.safeParse({
      email: "a@b.com",
      password: "Abcdef1!",
    });
    expect(r.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const r = registerSchema.safeParse({
      email: "not-an-email",
      password: "Abcdef1!",
    });
    expect(r.success).toBe(false);
  });

  it("rejects weak password with specific messages", () => {
    const r = registerSchema.safeParse({
      email: "a@b.com",
      password: "weak",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msgs = r.error.issues.map((i) => i.message);
      expect(msgs.some((m) => m.includes("8 characters"))).toBe(true);
    }
  });
});
