import { afterEach, describe, expect, it } from "vitest";
import { authOptions } from "@/lib/auth";
import { SIGNUP_DONE, SIGNUP_DONE_URL } from "@/components/auth-form";

const saved = process.env.NEXUS_ALLOW_SIGNUP;
afterEach(() => {
  if (saved === undefined) delete process.env.NEXUS_ALLOW_SIGNUP;
  else process.env.NEXUS_ALLOW_SIGNUP = saved;
});

describe("sign-up enumeration protection", () => {
  it("never signs in from sign-up, which makes Better Auth answer a registered email like a new one", () => {
    process.env.NEXUS_ALLOW_SIGNUP = "true";
    const opts = authOptions();
    expect(opts.emailAndPassword.autoSignIn).toBe(false);
    expect(opts.emailAndPassword.disableSignUp).toBe(false);
  });

  it("keeps sign-up off by default and the password endpoints rate limited", () => {
    delete process.env.NEXUS_ALLOW_SIGNUP;
    const opts = authOptions();
    expect(opts.emailAndPassword.disableSignUp).toBe(true);
    expect(opts.rateLimit.customRules["/sign-in/email"]).toEqual({ window: 60, max: 5 });
    expect(opts.rateLimit.customRules["/sign-up/email"]).toEqual({ window: 3600, max: 5 });
  });

  it("sends every accepted sign-up to sign-in with copy that fits a new and a registered email", () => {
    expect(SIGNUP_DONE_URL).toBe("/login?created=1");
    expect(SIGNUP_DONE).toMatch(/^If this email is new/);
    expect(SIGNUP_DONE).toMatch(/If you already had a vault/);
  });
});
