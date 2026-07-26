import { expect, test } from "@playwright/test";
import {
  GOOD_PW,
  register,
  uniqueEmail,
  usernameFor,
} from "./helpers.js";

test.describe("signing in with a username", () => {
  test("register, log out, then sign back in with the username", async ({
    page,
  }) => {
    const email = uniqueEmail("uname");
    const username = usernameFor(email);
    await register(page, email);
    await page.getByRole("button", { name: /log out/i }).click();

    await page.getByLabel("Username or email").fill(username);
    await page.getByLabel("Password", { exact: true }).fill(GOOD_PW);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await expect(page.getByText(username).first()).toBeVisible();
  });

  test("the same field still accepts the email", async ({ page }) => {
    const email = uniqueEmail("both");
    await register(page, email);
    await page.getByRole("button", { name: /log out/i }).click();

    await page.getByLabel("Username or email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(GOOD_PW);
    await page.getByRole("button", { name: /^log in$/i }).click();
    await expect(page.getByText(usernameFor(email)).first()).toBeVisible();
  });

  test("a taken username is reported on the username field", async ({
    page,
  }) => {
    const first = uniqueEmail("dup");
    await register(page, first);
    await page.getByRole("button", { name: /log out/i }).click();

    await page.goto("/register");
    await page.getByLabel("Username").fill(usernameFor(first));
    await page.getByLabel("Email").fill(uniqueEmail("other"));
    await page.getByLabel("Password", { exact: true }).fill(GOOD_PW);
    await page.getByLabel("Confirm password").fill(GOOD_PW);
    await page.getByRole("button", { name: /create account/i }).click();
    await expect(page.getByRole("alert")).toContainText(/username is taken/i);
    await expect(page).toHaveURL(/\/register/);
  });
});

test.describe("wordmark and landing behaviour", () => {
  test("the wordmark returns to the landing page", async ({ page }) => {
    await register(page, uniqueEmail("mark"));
    await page.getByRole("link", { name: "Nexus home" }).click();
    await expect(page).toHaveURL(/\/welcome/);
    await expect(
      page.getByRole("heading", { name: /that know each other/ }),
    ).toBeVisible();
  });

  test("a signed-in visitor sees the workspace link, not log in / register", async ({
    page,
  }) => {
    const email = uniqueEmail("signedin");
    await register(page, email);
    await page.goto("/welcome");

    const account = page.getByRole("navigation", { name: "Account" });
    await expect(
      account.getByRole("link", { name: "Open workspace" }),
    ).toBeVisible();
    await expect(account.getByRole("link", { name: "Log in" })).toHaveCount(0);
    await expect(
      account.getByRole("link", { name: "Create your vault" }),
    ).toHaveCount(0);
    await expect(page.getByText(`Signed in as ${usernameFor(email)}`)).toBeVisible();

    // The hero call to action points at the workspace too
    await expect(
      page.getByRole("main").getByRole("link", { name: "Open your workspace" }).first(),
    ).toBeVisible();
    await page
      .getByRole("main")
      .getByRole("link", { name: "Open your workspace" })
      .first()
      .click();
    await expect(page.getByRole("button", { name: /^new note$/i })).toBeVisible();
  });

  test("a guest still sees log in and register", async ({ page }) => {
    await page.goto("/welcome");
    const account = page.getByRole("navigation", { name: "Account" });
    await expect(account.getByRole("link", { name: "Log in" })).toBeVisible();
    await expect(
      account.getByRole("link", { name: "Create your vault" }),
    ).toBeVisible();
  });
});
