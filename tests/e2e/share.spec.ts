import { test, expect, openVault, JSON_HEADERS } from "./support/fixtures";
import { openNote, runCommand } from "./support/workspace";

test("share link: create, open signed out, revoke, then the link stops working", async ({ page, api, browser }) => {
  await api.createNote("Tide tables", "# Tide tables\n\nHigh water at 06:12.\n\nPrivate: [[Budget]]");
  await api.createNote("Budget", "Not shared.");
  await openVault(page);
  await openNote(page, "Tide tables");

  await runCommand(page, "Share note…");
  const dialog = page.getByRole("dialog", { name: "Share “Tide tables”" });
  await expect(dialog.getByText("No active links. This note is private.")).toBeVisible();
  await dialog.getByRole("button", { name: "Create link" }).click();
  const url = await dialog.getByRole("textbox", { name: "New link" }).inputValue();
  expect(url).toMatch(/\/s\/[A-Za-z0-9_-]+$/);

  // Opened by someone who is not signed in.
  const visitor = await browser.newContext();
  try {
    const guest = await visitor.newPage();
    const res = await guest.goto(url);
    expect(res?.status()).toBe(200);
    await expect(guest.getByText("High water at 06:12.")).toBeVisible();
    // Linked notes stay private.
    await expect(guest.getByText("Not shared.")).toHaveCount(0);

    await dialog.getByRole("button", { name: /^Revoke link created/ }).click();
    await expect(dialog.getByRole("status")).toHaveText("Link revoked. It no longer opens the note.");
    await expect(dialog.getByText("No active links. This note is private.")).toBeVisible();

    await guest.goto(url);
    await expect(guest.getByRole("heading", { name: "This link is not available" })).toBeVisible();
    await expect(guest.getByText("High water at 06:12.")).toHaveCount(0);
  } finally {
    await visitor.close();
  }
});

test("a revoked or unknown share link answers HTTP 404", async ({ page, api }) => {
  const note = await api.createNote("Shared then revoked", "Gone soon.");
  const created = await page.request.post(`/api/notes/${note.id}/share`, { headers: JSON_HEADERS, data: {} });
  expect(created.ok()).toBe(true);
  const link = (await created.json()) as { id: string; url: string };
  expect((await page.request.get(link.url)).status()).toBe(200);
  const revoked = await page.request.delete(`/api/shares/${link.id}`, { headers: JSON_HEADERS });
  expect(revoked.ok()).toBe(true);

  expect((await page.request.get(link.url)).status()).toBe(404);
  expect((await page.request.get("/s/not-a-real-token")).status()).toBe(404);
});
