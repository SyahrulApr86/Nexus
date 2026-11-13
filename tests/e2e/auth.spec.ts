import { test, expect, newAccount } from "./support/fixtures";
import { runCommand } from "./support/workspace";

test.describe("accounts @smoke", () => {
  test("sign up, sign in and sign out through the forms", async ({ page }) => {
    const account = newAccount();

    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: "Create your vault" })).toBeVisible();
    await page.getByRole("textbox", { name: "Name" }).fill(account.name);
    await page.getByRole("textbox", { name: "Email" }).fill(account.email);
    await page.getByRole("textbox", { name: "Password" }).fill(account.password);
    await page.getByRole("button", { name: "Create vault" }).click();

    // Sign-up never signs in (src/lib/auth.ts): it lands on the sign-in form with a notice.
    await expect(page).toHaveURL(/\/login\?created=1$/);
    await expect(page.locator("form").getByRole("status")).toContainText("Sign in to open it");
    await expect(page.getByRole("textbox", { name: "Email" })).toBeFocused();

    await page.getByRole("textbox", { name: "Email" }).fill(account.email);
    await page.getByRole("textbox", { name: "Password" }).fill(account.password);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/vault/);
    await expect(page.locator("#workbench")).toBeVisible();

    await runCommand(page, "Sign out");
    await expect(page).toHaveURL(/\/login$/);

    // The session is gone: the workspace sends the visitor back to sign in.
    await page.goto("/vault");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("a wrong password is refused with a message next to the form", async ({ page, account }) => {
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByRole("textbox", { name: "Email" }).fill(account.email);
    await page.getByRole("textbox", { name: "Password" }).fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator("form").getByRole("alert")).toHaveText("That email and password don’t match. Check them and try again.");
    await expect(page.getByRole("textbox", { name: "Email" })).toBeFocused();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("sign-in is rate limited per client", async ({ page, account }) => {
    await page.context().clearCookies();
    const attempt = () =>
      page.request.post("/api/auth/sign-in/email", {
        headers: { Origin: new URL(page.url() || "http://localhost").origin, "Content-Type": "application/json" },
        data: { email: account.email, password: "not-the-password" },
        failOnStatusCode: false,
      });
    await page.goto("/login");
    // The account fixture already signed in once from this address; the limit is 5 a minute.
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await attempt()).status());
    expect(statuses).toContain(429);
  });
});
