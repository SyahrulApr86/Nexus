/**
 * Shared fixtures. Every test gets its own throwaway account, signed in through the API so a flow
 * starts on its own subject; the auth spec drives the sign-up and sign-in forms instead.
 *
 * Rate limits: the app limits sign-up (5 per hour) and sign-in (5 per minute) per client address,
 * taken from a single X-Forwarded-For value. Each test sends its own private address, so tests do
 * not share a bucket. The limits themselves stay on.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";
import { BASE_URL } from "./env";

export type Account = { email: string; password: string; name: string };
export type Note = { id: string; path: string; content: string; updatedAt: string };

/** A private 10.x.y.z address, different for every test. */
function clientAddress() {
  const [a, b, c] = randomBytes(3);
  return `10.${a}.${b}.${Math.max(c, 1)}`;
}

export function newAccount(): Account {
  const id = randomUUID().slice(0, 8);
  // example.test is reserved (RFC 6761): never a real mailbox.
  return { email: `e2e-${id}@example.test`, password: `pw-${randomUUID()}`, name: `E2E ${id}` };
}

/** Headers the app requires on a mutating API call from a browser (src/lib/session.ts). */
export const JSON_HEADERS = { Origin: BASE_URL, "Content-Type": "application/json" };

export async function signUpViaApi(request: APIRequestContext, account: Account) {
  const res = await request.post("/api/auth/sign-up/email", { headers: JSON_HEADERS, data: account });
  expect(res.status(), await res.text()).toBe(200);
}

export async function signInViaApi(request: APIRequestContext, account: Account) {
  const res = await request.post("/api/auth/sign-in/email", {
    headers: JSON_HEADERS,
    data: { email: account.email, password: account.password },
  });
  expect(res.status(), await res.text()).toBe(200);
}

/** Thin JSON client for seeding data through the app's own API, as the signed-in user. */
export class Api {
  constructor(
    private request: APIRequestContext,
    private vaultId?: string,
  ) {}

  private headers() {
    return this.vaultId ? { ...JSON_HEADERS, "X-Nexus-Vault": this.vaultId } : JSON_HEADERS;
  }

  inVault(vaultId: string) {
    return new Api(this.request, vaultId);
  }

  async createNote(path: string, content = ""): Promise<Note> {
    const res = await this.request.post("/api/notes", { headers: this.headers(), data: { path, content } });
    expect(res.ok(), await res.text()).toBe(true);
    return res.json();
  }

  async getNote(id: string): Promise<Note> {
    const res = await this.request.get(`/api/notes/${id}`, { headers: this.headers() });
    expect(res.ok(), await res.text()).toBe(true);
    return res.json();
  }

  async tree(): Promise<{ notes: { id: string; path: string }[]; folders: string[] }> {
    const res = await this.request.get("/api/notes", { headers: this.headers() });
    expect(res.ok(), await res.text()).toBe(true);
    return res.json();
  }

  async noteByPath(path: string) {
    const found = (await this.tree()).notes.find((n) => n.path === path);
    return found ? this.getNote(found.id) : undefined;
  }
}

type Fixtures = {
  account: Account;
  /** The signed-in user's API client (default vault). */
  api: Api;
};

// The fixture callback is named `provide`, not Playwright's usual `use`, so the React hooks lint
// rule does not mistake it for React's use().
export const test = base.extend<Fixtures>({
  extraHTTPHeaders: async ({ extraHTTPHeaders }, provide) => {
    await provide({ ...extraHTTPHeaders, "X-Forwarded-For": clientAddress() });
  },
  account: async ({ page }, provide) => {
    const account = newAccount();
    await signUpViaApi(page.request, account);
    await signInViaApi(page.request, account);
    await provide(account);
  },
  api: async ({ page, account }, provide) => {
    void account; // signed in first
    await provide(new Api(page.request));
  },
});

export { expect };

/** Opens the workspace and waits until the file tree has loaded. */
export async function openVault(page: Page) {
  await page.goto("/vault");
  await expect(page.locator("#workbench")).toBeVisible();
}

export const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;
