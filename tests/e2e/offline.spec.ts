import { test, expect, openVault } from "./support/fixtures";
import { editor, expectSaved, focusEditorEnd, openNote } from "./support/workspace";

/**
 * Offline editing against the production build: the service worker (public/sw.js) serves the app
 * shell, edits queue on the device (IndexedDB outbox) and sync when the connection returns.
 */
test("edit offline, reconnect: the edit syncs", async ({ page, api, context }) => {
  const note = await api.createNote("Ferry times", "Monday 07:40.\n");
  await openVault(page);

  // The worker registers on load; it controls the page from the next navigation on.
  const registered = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const ready = await Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 15_000))]);
    return ready;
  });
  test.skip(!registered, "The service worker did not register under this harness (it needs the production build).");
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await openNote(page, "Ferry times");
  // Let the worker cache the note and the vault page before the network goes away.
  await expectSaved(page);

  await context.setOffline(true);
  try {
    const status = page.getByRole("contentinfo", { name: "Status bar" });
    await expect(status).toContainText("Offline — changes saved on this device");
    await focusEditorEnd(page, "Ferry times");
    await page.keyboard.type("Tuesday 08:15.");
    await expect(status).toContainText("1 change to sync");

    // A reload while offline comes from the worker, with the queued edit still there.
    await page.reload();
    await openNote(page, "Ferry times");
    await expect(editor(page, "Ferry times")).toContainText("Tuesday 08:15.");
  } finally {
    await context.setOffline(false);
  }

  await expectSaved(page);
  await expect.poll(async () => (await api.getNote(note.id)).content, { timeout: 20_000 }).toBe("Monday 07:40.\nTuesday 08:15.");
});
