import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "@/lib/markdown/parse";
import { renderMarkdown } from "@/lib/markdown/render";
import { taskOffsets, toggleTaskAt } from "@/lib/markdown/tasks";

describe("parseFrontmatter object shape", () => {
  it("returns a plain object so ORMs can read .constructor", () => {
    const fm = parseFrontmatter("tags: [a]");
    expect(Object.getPrototypeOf(fm)).toBe(Object.prototype);
    expect(fm.constructor).toBe(Object);
  });

  it("keeps __proto__ as an own field without polluting prototypes", () => {
    const fm = parseFrontmatter("__proto__: x\nconstructor: y");
    expect(Object.prototype.hasOwnProperty.call(fm, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(fm)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe("taskOffsets with frontmatter", () => {
  it("ignores %% inside frontmatter", () => {
    const md = "---\ntitle: 50%% off\n---\n- [ ] one\n- [ ] two\n";
    const offsets = taskOffsets(md);
    expect(offsets).toHaveLength(2);
    for (const at of offsets) expect(md[at]).toBe(" ");
    expect(toggleTaskAt(md, offsets[1])).toBe("---\ntitle: 50%% off\n---\n- [ ] one\n- [x] two\n");
  });

  it("still hides tasks inside a body comment", () => {
    const md = "---\na: 1\n---\n%%\n- [ ] hidden\n%%\n- [ ] shown\n";
    expect(taskOffsets(md)).toHaveLength(1);
  });
});

describe("taskOffsets with private-use mark characters", () => {
  const rendered = (md: string) =>
    [...renderMarkdown(md, () => true).matchAll(/data-task-offset="(\d+)"/g)].map((m) => Number(m[1]));

  it("gives every rendered checkbox an offset that toggles it", () => {
    for (const md of ["- [\uE000 ] a\n- [ ] b\n", "- [ \uE001] a\n", "\uE000x\n- [x] a\n", "---\nt: 1\n---\n- [\uE000x] a\n"]) {
      const offsets = taskOffsets(md);
      expect(offsets).toEqual(rendered(md));
      for (const at of offsets) {
        expect(md[at]).toMatch(/[ xX]/);
        expect(toggleTaskAt(md, at)).not.toBe(md);
        expect(toggleTaskAt(toggleTaskAt(md, at), at)).toBe(md);
      }
    }
  });
});
