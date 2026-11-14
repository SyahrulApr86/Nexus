import { beforeEach, describe, expect, it, vi } from "vitest";

const offline = vi.hoisted(() => ({
  get: vi.fn<(id: string) => Promise<{ content: string }>>(),
  save: vi.fn<(id: string, content: string) => Promise<{ id: string; updatedAt: string }>>(),
  isOffline: vi.fn(() => false),
}));
vi.mock("@/components/workspace/offline/offline-api", () => ({
  offlineApi: { get: offline.get, save: offline.save },
  isOffline: offline.isOffline,
}));
vi.mock("@/components/workspace/templates-settings", () => ({
  readTemplatePrefs: () => ({ dailyTemplate: "Templates/Daily", dateFormat: "YYYY-MM-DD", timeFormat: "HH:mm" }),
}));

import { applyDailyTemplate } from "@/components/workspace/templates-daily";

const TREE = [{ id: "tpl", path: "Templates/Daily", name: "Daily", updatedAt: "2026-11-01T00:00:00.000Z" }];
const DAY = new Date(2026, 10, 20);

describe("applyDailyTemplate", () => {
  beforeEach(() => {
    offline.get.mockReset();
    offline.save.mockReset().mockResolvedValue({ id: "n", updatedAt: "2026-11-20T00:00:00.000Z" });
    offline.isOffline.mockReset().mockReturnValue(false);
  });

  it("fills the note with the template for the note's own day", async () => {
    offline.get.mockResolvedValue({ content: "# {{date}}\n" });
    await expect(applyDailyTemplate("n", "2026-11-20", TREE, DAY)).resolves.toEqual({ applied: true });
    expect(offline.save).toHaveBeenCalledWith("n", "# 2026-11-20\n");
  });

  it("uses a copy already on this device before asking the network", async () => {
    const res = await applyDailyTemplate("n", "2026-11-20", TREE, DAY, (id) => (id === "tpl" ? "Plan {{date}}" : undefined));
    expect(res).toEqual({ applied: true });
    expect(offline.get).not.toHaveBeenCalled();
    expect(offline.save).toHaveBeenCalledWith("n", "Plan 2026-11-20");
  });

  it("does not throw offline when the template is not cached, so the note still opens", async () => {
    offline.isOffline.mockReturnValue(true);
    offline.get.mockRejectedValue(new Error("This note isn’t saved on this device yet."));
    await expect(applyDailyTemplate("n", "2026-11-20", TREE, DAY)).resolves.toEqual({
      applied: false,
      problem: "Daily note template is not available offline",
    });
    expect(offline.save).not.toHaveBeenCalled();
  });

  it("reports a failed save instead of throwing", async () => {
    offline.get.mockResolvedValue({ content: "x" });
    offline.save.mockRejectedValue(new Error("boom"));
    await expect(applyDailyTemplate("n", "2026-11-20", TREE, DAY)).resolves.toEqual({
      applied: false,
      problem: "Could not apply the daily note template",
    });
  });

  it("leaves the note alone without a template", async () => {
    await expect(applyDailyTemplate("n", "x", [], DAY)).resolves.toEqual({ applied: false });
    expect(offline.get).not.toHaveBeenCalled();
  });
});
