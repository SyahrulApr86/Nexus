import { describe, expect, it } from "vitest";
import { BAD_CREDENTIALS, SIGNUP_DISABLED, SIGNUP_FAILED, TOO_MANY, describeAuthError } from "@/components/auth-form";

describe("describeAuthError", () => {
  it("never reveals that an email is already registered at sign-up", () => {
    const dup = describeAuthError({ status: 422, code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" }, true);
    const other = describeAuthError({ status: 422, code: "FAILED_TO_CREATE_USER" }, true);
    const unknown = describeAuthError({ status: 500 }, true);
    expect(dup).toEqual({ form: SIGNUP_FAILED });
    expect(other).toEqual(dup);
    expect(unknown).toEqual(dup);
    expect(describeAuthError({ status: 422, code: "USER_ALREADY_EXISTS" }, true)).toEqual(dup);
  });

  it("explains disabled sign-up and rate limits with fixed copy", () => {
    expect(describeAuthError({ status: 400, code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" }, true)).toEqual({ form: SIGNUP_DISABLED });
    expect(describeAuthError({ status: 429 }, true)).toEqual({ form: TOO_MANY });
    expect(describeAuthError({ status: 429 }, false)).toEqual({ form: TOO_MANY });
  });

  it("keeps sign-in generic for wrong email and wrong password", () => {
    expect(describeAuthError({ status: 401, code: "INVALID_EMAIL_OR_PASSWORD" }, false)).toEqual({ form: BAD_CREDENTIALS });
  });

  it("maps field errors to their field and offline to a connection message", () => {
    expect(describeAuthError({ status: 400, code: "INVALID_EMAIL" }, true).email).toBeTruthy();
    expect(describeAuthError({ status: 400, code: "PASSWORD_TOO_SHORT" }, true).password).toBeTruthy();
    expect(describeAuthError({ status: 0 }, false).form).toMatch(/can’t be reached/);
  });
});
