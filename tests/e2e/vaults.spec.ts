import { test, expect, openVault } from "./support/fixtures";
import { openNote, openQuickSwitcher, runCommand } from "./support/workspace";

test("create a vault, switch between vaults, notes stay in their vault", async ({ page, api }) => {
  await api.createNote("Home vault note", "Only in My Vault.");
  await openVault(page);
  const switcher = page.getByRole("button", { name: /^Vault: My Vault\./ });
  await expect(switcher).toBeVisible();

  // Create: a prompt, then the new vault opens.
  await runCommand(page, "Create vault…");
  const prompt = page.getByRole("dialog", { name: "Create vault" });
  await prompt.getByRole("textbox", { name: "Vault name" }).fill("Research");
  await prompt.getByRole("button", { name: "Create vault" }).click();
  await expect(page.getByRole("button", { name: /^Vault: Research\./ })).toBeVisible();

  // The new vault is empty: the other vault's note is not offered.
  const box = await openQuickSwitcher(page);
  await box.fill("Home vault note");
  await expect(page.getByRole("option").first()).toHaveText(/Create “Home vault note”/);
  // Create a note here instead.
  await box.fill("Kelp density");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Kelp density");

  const vaults = (await (await page.request.get("/api/vaults")).json()) as { id: string; name: string }[] | { vaults: { id: string; name: string }[] };
  const list = Array.isArray(vaults) ? vaults : vaults.vaults;
  const research = list.find((v) => v.name === "Research")!;
  await expect.poll(async () => (await api.inVault(research.id).tree()).notes.map((n) => n.path)).toEqual(["Kelp density"]);
  expect((await api.tree()).notes.map((n) => n.path)).toEqual(["Home vault note"]);

  // Switch back through the Vaults dialog.
  await runCommand(page, "Switch vault…");
  const dialog = page.getByRole("dialog", { name: "Vaults" });
  await dialog.getByRole("button", { name: /^My Vault/ }).click();
  await expect(page.getByRole("button", { name: /^Vault: My Vault\./ })).toBeVisible();
  await openNote(page, "Home vault note");
  const again = await openQuickSwitcher(page);
  await again.fill("Kelp density");
  await expect(page.getByRole("option").first()).toHaveText(/Create “Kelp density”/);
  await page.keyboard.press("Escape");
});
