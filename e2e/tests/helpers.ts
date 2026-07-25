import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

export const GOOD_PW = "Sup3r$ecret";

export function uniqueEmail(prefix = "user") {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@e2e.test`;
}

/** SC-010: WCAG 2.1 AA automated audit on the current page state. */
export async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
}

export async function register(page: Page, email: string, password = GOOD_PW) {
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page.getByText(email)).toBeVisible();
}

/** Fetch the newest Mailpit message for a recipient and extract the reset URL. */
export async function fetchResetLink(email: string): Promise<string> {
  const res = await fetch(
    `http://localhost:8025/api/v1/search?query=to:${encodeURIComponent(email)}`,
  );
  const data = (await res.json()) as { messages: { ID: string }[] };
  if (!data.messages?.length) throw new Error(`no mail for ${email}`);
  const msg = await fetch(
    `http://localhost:8025/api/v1/message/${data.messages[0]!.ID}`,
  );
  const body = (await msg.json()) as { Text: string };
  const m = body.Text.match(/https?:\/\/\S+token=[\w-]+/);
  if (!m) throw new Error(`no reset link in mail: ${body.Text}`);
  return m[0];
}
