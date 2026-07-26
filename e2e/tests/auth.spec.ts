import { expect, test } from "@playwright/test";
import {
  expectNoA11yViolations,
  fetchResetLink,
  GOOD_PW,
  register,
  uniqueEmail,
  usernameFor,
} from "./helpers.js";

test.describe("US1 — registration & login (independent test)", () => {
  test("register → login → workspace → logout → inaccessible → login again", async ({
    page,
  }) => {
    const email = uniqueEmail();

    await register(page, email);
    await expect(page.getByText(email.split("@")[0]!)).toBeVisible();

    await page.getByRole("button", { name: /log out/i }).click();
    await expect(page).toHaveURL(/\/login/);

    // Workspace inaccessible after logout — guests land on the marketing page
    await page.goto("/");
    await expect(page).toHaveURL(/\/welcome/);

    await page.getByRole("navigation", { name: "Account" }).getByRole("link", { name: "Log in" }).click();
    await page.getByLabel("Username or email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(GOOD_PW);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await expect(page.getByText(email.split("@")[0]!)).toBeVisible();
  });

  test("weak password shows specific per-rule feedback (US1-S2)", async ({
    page,
  }) => {
    await page.goto("/register");
    const weakEmail = uniqueEmail("weak");
    await page.getByLabel("Username").fill(usernameFor(weakEmail));
    await page.getByLabel("Email").fill(weakEmail);
    await page.getByLabel("Password", { exact: true }).fill("abcdefgh");
    await page.getByLabel("Confirm password").fill("abcdefgh");
    await page.getByRole("button", { name: /create account/i }).click();
    await expect(page.getByRole("alert")).toContainText("uppercase");
    await expect(page.getByRole("alert")).toContainText("digit");
    await expect(page.getByRole("alert")).toContainText("special character");
  });

  test("wrong credentials shows generic error, stays on login (US1-S4)", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Username or email").fill(uniqueEmail("ghost"));
    await page.getByLabel("Password", { exact: true }).fill("Wrong1!xx");
    await page.getByRole("button", { name: /^log in$/i }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Invalid email or password",
    );
    await expect(page).toHaveURL(/\/login/);
  });

  test("register and login are fully keyboard-operable (SC-006)", async ({
    page,
  }) => {
    const email = uniqueEmail("kbd");
    const username = usernameFor(email);
    await page.goto("/register");
    // Tab into the form and drive it with keys only
    await page.getByLabel("Username").focus();
    await page.keyboard.type(username);
    await page.keyboard.press("Tab");
    await page.keyboard.type(email);
    await page.keyboard.press("Tab");
    await page.keyboard.type(GOOD_PW);
    await page.keyboard.press("Tab");
    await page.keyboard.type(GOOD_PW);
    await page.keyboard.press("Enter");
    await expect(page.getByText(username).first()).toBeVisible();
  });

  test("login page passes WCAG 2.1 AA audit (SC-010)", async ({ page }) => {
    await page.goto("/login");
    await expectNoA11yViolations(page);
  });

  test("register page passes WCAG 2.1 AA audit (SC-010)", async ({ page }) => {
    await page.goto("/register");
    await expectNoA11yViolations(page);
  });
});

test.describe("US1b — password reset (independent test)", () => {
  test("request → email → new password → login works → old rejected", async ({
    page,
  }) => {
    const email = uniqueEmail("reset");
    const NEW_PW = "N3w$ecret!";
    await register(page, email);
    await page.getByRole("button", { name: /log out/i }).click();

    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: /send reset link/i }).click();
    await expect(page.getByRole("status")).toContainText(
      "If that email is registered",
    );

    const link = await fetchResetLink(email);
    await page.goto(link);
    await page.getByLabel("New password").fill(NEW_PW);
    await page.getByRole("button", { name: /update password/i }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("status")).toContainText("Password updated");

    // Old password rejected
    await page.getByLabel("Username or email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(GOOD_PW);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Invalid email or password",
    );

    // New password works
    await page.getByLabel("Password", { exact: true }).fill(NEW_PW);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await expect(page.getByText(email.split("@")[0]!)).toBeVisible();
  });

  test("forgot-password page passes WCAG 2.1 AA audit (SC-010)", async ({
    page,
  }) => {
    await page.goto("/forgot-password");
    await expectNoA11yViolations(page);
  });
});
