import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The landing hero as a share card: the daily note on a white sheet, typed tokens hung in the gutter.
// Fonts are OFL instances subset to Latin (src/app/fonts/, licences alongside).

export const alt =
  "A daily note in Nexus: “Friday, 13 November — [[Project kickoff]] moved [[Q4 roadmap]] up a week. #planning”";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#02070a";
const FAINT = "#566470";
const MUTED = "#36424c";
const LINK = "#01669a";
const TAG = "#b42a03";

const NOTE = 76;
const TOK = 32; // 0.42 of the note size, as on the page

function Hung({ token, children }: { token: string; children: React.ReactNode }) {
  // JetBrains Mono cells are 0.6em wide; the token is pulled left by its width plus the gap.
  const gap = 14;
  return (
    <div style={{ display: "flex", alignItems: "baseline", marginLeft: -(token.length * 0.6 * TOK + gap) }}>
      <span style={{ fontFamily: "JetBrains Mono", fontSize: TOK, color: FAINT, marginRight: gap }}>{token}</span>
      {children}
    </div>
  );
}

function Close() {
  return <span style={{ fontFamily: "JetBrains Mono", fontSize: TOK, color: FAINT }}>]]</span>;
}

export default async function Image() {
  const dir = join(process.cwd(), "src/app/fonts");
  const [literata, mono] = await Promise.all([
    readFile(join(dir, "Literata-Display-Medium.ttf")),
    readFile(join(dir, "JetBrainsMono-Regular.ttf")),
  ]);

  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: "#f1f4f7", padding: 40 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "100%",
            background: "#ffffff",
            border: "1px solid #dce3e9",
            borderRadius: 20,
            padding: "44px 56px 40px 150px",
            fontFamily: "Literata",
            color: INK,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: "JetBrains Mono", fontSize: 22, color: FAINT }}>Daily notes/2026-11-13.md</div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                marginTop: 26,
                fontSize: NOTE,
                lineHeight: 1.06,
                letterSpacing: "-0.02em",
              }}
            >
              <div style={{ display: "flex" }}>Friday, 13 November —</div>
              <Hung token="[[">
                <span style={{ color: LINK }}>Project kickoff</span>
                <Close />
                <span style={{ marginLeft: 18 }}>moved</span>
              </Hung>
              <Hung token="[[">
                <span style={{ color: LINK }}>Q4 roadmap</span>
                <Close />
                <span style={{ marginLeft: 18 }}>up a week.</span>
              </Hung>
              <Hung token="#">
                <span style={{ color: TAG }}>planning</span>
              </Hung>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", fontSize: 26, color: MUTED }}>
            <span style={{ fontFamily: "JetBrains Mono", color: FAINT }}>[[</span>
            <span style={{ color: INK }}>Nexus</span>
            <span style={{ fontFamily: "JetBrains Mono", color: FAINT }}>]]</span>
            <span style={{ marginLeft: 20 }}>Notes that link to each other, in plain markdown.</span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Literata", data: literata, weight: 500, style: "normal" },
        { name: "JetBrains Mono", data: mono, weight: 400, style: "normal" },
      ],
    },
  );
}
