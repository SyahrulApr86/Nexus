import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The landing's first screen as a share card, dark like the page: the headline set large on navy, the
// vault drawn as a floor of bars along the foot, one blue bar for the open note and orange for a tag.
// Literata is the one face bundled for images (src/app/fonts/, licence alongside).

export const alt = "Nexus: plain notes, linked. Markdown notes with [[links]], backlinks and a graph, on your own server.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const NAVY = "#02070a";
const INK = "#e8eef2";
const SLATE = "#a9b5c0";
const MIST = "#2c3a47";
const BLUE = "#0297de";
const ORANGE = "#fc734d";

/** Seeded bar heights, so every render of the card is the same picture. */
function bars(count: number) {
  let s = 11;
  const out: Array<{ h: number; c: string }> = [];
  for (let i = 0; i < count; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const r = s / 4294967296;
    s = (s * 1664525 + 1013904223) >>> 0;
    const k = s / 4294967296;
    out.push({ h: 8 + Math.round(r ** 1.8 * 88), c: i === 47 ? BLUE : k > 0.94 ? ORANGE : MIST });
  }
  return out;
}

export default async function Image() {
  const literata = await readFile(join(process.cwd(), "src/app/fonts", "Literata-Display-Medium.ttf"));

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          background: NAVY,
          color: INK,
          fontFamily: "Literata",
          padding: "56px 64px 0",
        }}
      >
        <div style={{ display: "flex", fontSize: 30, letterSpacing: "-0.02em" }}>
          <span style={{ color: BLUE }}>[[</span>
          <span>Nexus</span>
          <span style={{ color: BLUE }}>]]</span>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 64,
            fontSize: 116,
            lineHeight: 0.98,
            letterSpacing: "-0.035em",
          }}
        >
          <div style={{ display: "flex" }}>Plain notes,</div>
          <div style={{ display: "flex" }}>linked.</div>
        </div>
        <div style={{ display: "flex", marginTop: 32, fontSize: 30, color: SLATE }}>
          Markdown notes with backlinks and a graph, on your own server.
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, marginTop: "auto", height: 100 }}>
          {bars(134).map((b, i) => (
            <div key={i} style={{ width: 2, height: b.h, background: b.c }} />
          ))}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Literata", data: literata, weight: 500, style: "normal" }],
    },
  );
}
