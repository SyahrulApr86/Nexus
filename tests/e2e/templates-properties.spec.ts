import { test, expect, openVault } from "./support/fixtures";
import { editor, focusEditorEnd, openNote, runCommand } from "./support/workspace";

test("insert a template into a note", async ({ page, api }) => {
  await api.createNote("Templates/Meeting", "## Attendees\n\nNotes for {{title}}\n");
  await api.createNote("Templates/Daily review", "## Wins\n");
  const target = await api.createNote("Standup 14 Nov", "Agenda first.\n");
  await openVault(page);
  await openNote(page, "Standup 14 Nov");
  await focusEditorEnd(page, "Standup 14 Nov");

  await runCommand(page, "Insert template");
  const picker = page.getByRole("dialog", { name: "Insert template" });
  const find = picker.getByRole("combobox", { name: "Find a template" });
  await expect(find).toBeFocused();
  await find.fill("meet");
  await expect(picker.getByRole("option").first()).toContainText("Meeting");
  await page.keyboard.press("Enter");
  await expect(picker).toBeHidden();

  await expect(page.getByText("Inserted “Meeting”")).toBeVisible();
  // {{title}} is filled in with the note's name; the note's own text stays.
  await expect(editor(page, "Standup 14 Nov")).toContainText("Notes for Standup 14 Nov");
  await expect
    .poll(async () => (await api.getNote(target.id)).content)
    .toMatch(/^Agenda first\.\n[\s\S]*## Attendees[\s\S]*Notes for Standup 14 Nov/);
});

test("edit and add properties", async ({ page, api }) => {
  const note = await api.createNote(
    "Field trip",
    "---\nstatus: draft\nattendees: 4\n---\nMeet at the pier.\n",
  );
  await openVault(page);
  await openNote(page, "Field trip");

  const props = page.getByRole("list", { name: "Properties" });
  const status = props.getByRole("textbox", { name: "status" });
  await expect(status).toHaveValue("draft");
  await status.fill("confirmed");
  await status.press("Enter");
  await expect.poll(async () => (await api.getNote(note.id)).content).toContain("status: confirmed");

  const attendees = props.getByRole("spinbutton", { name: "attendees" });
  await expect(attendees).toHaveValue("4");
  await attendees.fill("6");
  await attendees.press("Enter");
  await expect.poll(async () => (await api.getNote(note.id)).content).toContain("attendees: 6");

  // A new property from the command palette.
  await runCommand(page, "Add file property");
  const name = page.getByRole("textbox", { name: "New property name" });
  await expect(name).toBeFocused();
  await name.fill("location");
  await name.press("Enter");
  const location = props.getByRole("textbox", { name: "location" });
  await expect(location).toBeFocused();
  await location.fill("North pier");
  await location.press("Enter");
  await expect.poll(async () => (await api.getNote(note.id)).content).toMatch(/^---\n[\s\S]*location: North pier\n[\s\S]*---\nMeet at the pier\./);
});
