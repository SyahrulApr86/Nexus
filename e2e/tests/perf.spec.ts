import { expect, test } from "@playwright/test";
import { register, uniqueEmail } from "./helpers.js";

/**
 * SC-004 / SC-005 performance gates. Uses the dev-only seed endpoint
 * (ENABLE_DEV_SEED) to build large vaults quickly.
 */

test.describe("performance criteria", () => {
  test("SC-005: sidebar with 10,000 notes renders fast with bounded DOM", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await register(page, uniqueEmail("perf10k"));
    const seed = await page.request.post("/api/dev/seed", {
      data: { notes: 10_000, withLinks: false },
    });
    expect(seed.ok()).toBeTruthy();

    const t0 = Date.now();
    await page.reload();
    await expect(
      page
        .locator('[aria-label="Folders and notes"]')
        .getByRole("link")
        .first(),
    ).toBeVisible({ timeout: 15_000 });
    const total = Date.now() - t0;

    // Windowing must bound the DOM regardless of vault size
    const renderedRows = await page
      .locator('[aria-label="Folders and notes"] a')
      .count();
    expect(renderedRows).toBeLessThan(300);

    // Client render cost after data arrival stays within SC-005's 500ms;
    // full reload (network + hydrate + fetch) is bounded generously.
    const renderMs = await page.evaluate(() => {
      const notesReq = performance
        .getEntriesByType("resource")
        .find((e) => e.name.includes("/api/notes"));
      return notesReq ? performance.now() - notesReq.responseEnd : -1;
    });
    expect(renderMs).toBeGreaterThan(0);
    expect(renderMs).toBeLessThan(500);
    expect(total).toBeLessThan(10_000);

    // Scrolling the windowed list stays responsive and keeps DOM bounded
    await page
      .locator('[aria-label="Folders and notes"]')
      .locator("xpath=ancestor::div[1]")
      .evaluate((el) => (el.scrollTop = 5000 * 26));
    await page.waitForTimeout(200);
    expect(
      await page.locator('[aria-label="Folders and notes"] a').count(),
    ).toBeLessThan(300);
  });

  test("SC-004: graph with 1,000 linked notes sustains >30fps pan/zoom", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await register(page, uniqueEmail("perfgraph"));
    const seed = await page.request.post("/api/dev/seed", {
      data: { notes: 1_000, withLinks: true },
    });
    expect(seed.ok()).toBeTruthy();

    await page.goto("/graph");
    await expect(page.getByTestId("graph-canvas")).toBeVisible();
    await expect(page.getByText(/1,?000 notes|1000 notes/)).toBeVisible({
      timeout: 15_000,
    });
    // Let the simulation settle a moment
    await page.waitForTimeout(1500);

    const fps = await page.evaluate(async () => {
      const canvas = document.querySelector(
        '[data-testid="graph-canvas"]',
      ) as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      let frames = 0;
      let running = true;
      const count = () => {
        frames++;
        if (running) requestAnimationFrame(count);
      };
      requestAnimationFrame(count);

      // Continuous zoom + pan stimulation for 2 seconds
      const start = performance.now();
      while (performance.now() - start < 2000) {
        canvas.dispatchEvent(
          new WheelEvent("wheel", {
            clientX: cx,
            clientY: cy,
            deltaY: Math.random() > 0.5 ? -40 : 40,
            bubbles: true,
            cancelable: true,
          }),
        );
        await new Promise((r) => setTimeout(r, 16));
      }
      running = false;
      return frames / 2;
    });

    expect(fps).toBeGreaterThan(30);
  });
});
