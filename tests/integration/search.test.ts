import { describe, expect, it } from "vitest";
import { createNote } from "@/lib/notes";
import { search } from "@/lib/search";
import { describeDb, useVaults } from "./fixtures";

describeDb("vault search (src/lib/search.ts)", () => {
  const v = useVaults();
  const names = async (q: string) => (await search(v.a, q)).map((r) => r.name).sort();

  describe("bare #tag (contract R6)", () => {
    it("returns the same notes as tag:", async () => {
      await createNote(v.a, "Standup", "Notes from today #work/meetings");
      await createNote(v.a, "Plan", "Roadmap #work");
      await createNote(v.a, "Hashless", "the word work alone");
      await createNote(v.a, "Shopping", "Milk #home");
      expect(await names("#work")).toEqual(["Plan", "Standup"]);
      expect(await names("#work")).toEqual(await names("tag:work"));
      expect(await names("#WORK/meetings")).toEqual(["Standup"]);
      expect(await names("-#work")).toEqual(await names("-tag:work"));
      expect(await names("roadmap #work")).toEqual(["Plan"]);
    });
  });

  describe("line: with exclusions", () => {
    it("line:-x matches notes with a non-blank line without x", async () => {
      await createNote(v.a, "Only draft", "draft one\n\ndraft two\n---");
      await createNote(v.a, "Mixed", "draft one\nfinal copy");
      expect(await names("line:-draft")).toEqual(["Mixed"]);
      expect(await names("line:(-draft)")).toEqual(["Mixed"]);
      // Not mis-read as line:draft.
      expect(await names("line:draft")).toEqual(["Mixed", "Only draft"]);
    });

    it("combines with other terms and with -(...)", async () => {
      await createNote(v.a, "A", "alpha beta\nalpha gamma");
      await createNote(v.a, "B", "alpha beta");
      expect(await names("alpha line:(-beta)")).toEqual(["A"]);
      expect(await names("line:(alpha -beta)")).toEqual(["A"]);
      expect(await names("-line:(-beta)")).toEqual(["B"]);
    });
  });
});
