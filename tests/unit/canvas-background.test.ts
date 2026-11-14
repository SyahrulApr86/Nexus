import { describe, expect, it } from "vitest";
import { backgroundCss, groupBackground, parseCanvas, serializeCanvas } from "@/lib/canvas";

describe("group background images", () => {
  it("loads an image from the vault, cover by default", () => {
    expect(groupBackground({ background: "Attachments/Sky photo.png" })).toEqual({
      url: "/api/attachments/file?path=Attachments%2FSky%20photo.png",
      path: "Attachments/Sky photo.png",
      style: "cover",
    });
    expect(groupBackground({ background: "/boards/map.webp", backgroundStyle: "repeat" })?.style).toBe("repeat");
    expect(groupBackground({ background: "map.jpg", backgroundStyle: "ratio" })?.style).toBe("ratio");
    expect(groupBackground({ background: "map.jpg", backgroundStyle: "stretch" })?.style).toBe("cover");
  });

  it("never fetches a web address, a non-image or a path that climbs out", () => {
    for (const background of ["https://example.com/a.png", "//example.com/a.png", "javascript:alert(1).png", "data:image/png;base64,AA", "notes/plan.md", "../secret.png", "a/./b.png", "", "   "])
      expect(groupBackground({ background })).toBeNull();
    expect(groupBackground({})).toBeNull();
  });

  it("keeps the URL inside its CSS string", () => {
    const bg = groupBackground({ background: 'odd") ; x: url("y.png' })!;
    expect(bg).not.toBeNull();
    expect(backgroundCss(bg).backgroundImage).toBe(`url("${bg.url}")`);
    expect(bg.url).not.toContain('"');
  });

  it("maps each style to CSS", () => {
    const url = "/api/attachments/file?path=a.png";
    expect(backgroundCss({ url, style: "cover" })).toMatchObject({ backgroundSize: "cover", backgroundRepeat: "no-repeat" });
    expect(backgroundCss({ url, style: "ratio" })).toMatchObject({ backgroundSize: "contain", backgroundRepeat: "no-repeat" });
    expect(backgroundCss({ url, style: "repeat" })).toMatchObject({ backgroundSize: "auto", backgroundRepeat: "repeat" });
  });

  it("round-trips background and backgroundStyle through a canvas file", () => {
    const file = JSON.stringify({
      nodes: [{ id: "g", type: "group", x: 0, y: 0, width: 400, height: 300, label: "Map", background: "img/map.png", backgroundStyle: "ratio" }],
      edges: [],
    });
    const parsed = parseCanvas(file);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const again = parseCanvas(serializeCanvas(parsed.doc));
    expect(again.ok && again.doc.nodes[0]).toMatchObject({ background: "img/map.png", backgroundStyle: "ratio" });
  });
});
