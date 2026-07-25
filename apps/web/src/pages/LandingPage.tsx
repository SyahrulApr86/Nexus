import { Link } from "@tanstack/react-router";
import { Icon } from "../components/Icon.js";

/**
 * Public marketing page (DESIGN.md): centered hero text stack, Z-pattern
 * two-column sections with product mockups floating on Lavender Wash,
 * minimal nav, 64px section rhythm. The product itself is the imagery.
 */

function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-accent-fill text-[15px] font-semibold text-on-accent"
      >
        N
      </span>
      <span className="text-[18px] font-semibold tracking-heading text-ink">
        Nexus
      </span>
    </span>
  );
}

/** Editor mockup — the "product screenshot" hero card. */
function EditorCard() {
  return (
    <div className="rounded-card border border-border bg-card p-6 text-left">
      <p className="text-[20px] font-semibold tracking-heading text-ink">
        Reading list
      </p>
      <div className="mt-3 space-y-2 text-[14px] leading-relaxed text-muted">
        <p>
          Finished{" "}
          <span className="border-b border-accent text-accent">
            [[Thinking in Systems]]
          </span>{" "}
          — pairs well with{" "}
          <span className="border-b border-accent text-accent">
            [[Feedback Loops]]
          </span>
          .
        </p>
        <p>
          Next up: queue notes for{" "}
          <span className="border-b border-dashed border-broken text-broken">
            [[Antifragile]]
          </span>
        </p>
        <p>
          <span className="tag-chip">#books</span>{" "}
          <span className="tag-chip">#q3</span>
        </p>
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-[12px] text-muted">
        <span>Autosaved just now</span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
          Synced
        </span>
      </div>
    </div>
  );
}

/** Graph mockup card. */
function GraphCard() {
  const nodes = [
    { cx: 90, cy: 60, r: 10 },
    { cx: 200, cy: 40, r: 7 },
    { cx: 170, cy: 130, r: 8 },
    { cx: 60, cy: 150, r: 6 },
    { cx: 260, cy: 100, r: 6 },
  ];
  return (
    <div className="rounded-card border border-border bg-card p-6">
      <p className="text-[14px] font-medium text-ink">Knowledge graph</p>
      <svg
        viewBox="0 0 320 190"
        role="img"
        aria-label="Illustration of linked notes forming a graph"
        className="mt-2 w-full"
      >
        <g stroke="var(--t-mist)" strokeWidth="1.2">
          <path d="M90 60 200 40M90 60 170 130M90 60 60 150M170 130 260 100M200 40 260 100" />
        </g>
        {nodes.map((n, i) => (
          <circle
            key={i}
            cx={n.cx}
            cy={n.cy}
            r={n.r}
            fill={i === 0 ? "var(--t-accent)" : "var(--t-mist)"}
          />
        ))}
        <text
          x="104"
          y="56"
          fontSize="12"
          fill="var(--t-ink)"
          fontFamily="inherit"
        >
          Systems
        </text>
      </svg>
      <p className="text-[12px] text-muted">
        Every [[wikilink]] becomes an edge you can explore.
      </p>
    </div>
  );
}

const FEATURES = [
  {
    title: "Markdown-native, preview live",
    body: "CommonMark in a split pane that renders as you type. No proprietary format — export your whole vault as plain .md files any time.",
    card: <EditorCard />,
  },
  {
    title: "Notes that know each other",
    body: "Type [[ to link any note, with autocomplete. Broken links are styled honestly and offer to create the missing note. The graph view maps how your thinking connects.",
    card: <GraphCard />,
  },
] as const;

export function LandingPage() {
  return (
    <div className="min-h-full bg-bg text-ink">
      <header className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-4">
        <Wordmark />
        <nav aria-label="Account" className="flex items-center gap-2">
          <Link
            to="/login"
            className="rounded-control border border-border px-4 py-2 text-[14px] font-medium text-ink hover:bg-surface"
          >
            Log in
          </Link>
          <Link
            to="/register"
            className="rounded-control bg-accent-fill px-4 py-2 text-[14px] font-medium text-on-accent hover:bg-accent-fill-hover"
          >
            Create your vault
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-[760px] px-6 pb-16 pt-20 text-center">
          <h1 className="text-[44px] font-semibold leading-[1.15] tracking-display sm:text-[56px]">
            Notes that link, sync, and stay yours.
          </h1>
          <p className="mx-auto mt-5 max-w-[540px] text-[18px] leading-relaxed text-muted">
            Nexus is a keyboard-first Markdown workspace in your browser.
            Wikilinks weave your notes into a graph; the server keeps every
            device on the same page.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              to="/register"
              className="rounded-control bg-accent-fill px-6 py-3 text-[16px] font-medium text-on-accent hover:bg-accent-fill-hover"
            >
              Create your vault
            </Link>
            <Link
              to="/login"
              className="rounded-control border border-border px-6 py-3 text-[16px] font-medium text-ink hover:bg-surface"
            >
              Log in
            </Link>
          </div>
          <p className="mt-4 text-[13px] text-muted">
            Free while in development · export anytime · no lock-in
          </p>
        </section>

        <section className="bg-surface py-16">
          <div className="mx-auto flex max-w-[1200px] flex-col gap-16 px-6">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className={`flex flex-col items-center gap-10 md:flex-row ${
                  i % 2 === 1 ? "md:flex-row-reverse" : ""
                }`}
              >
                <div className="max-w-[440px] flex-1">
                  <h2 className="text-[32px] font-semibold leading-tight tracking-heading">
                    {f.title}
                  </h2>
                  <p className="mt-4 text-[16px] leading-relaxed text-muted">
                    {f.body}
                  </p>
                </div>
                <div className="w-full max-w-[420px] flex-1 md:-rotate-1">
                  {f.card}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-[900px] px-6 py-16">
          <ul className="grid gap-4 sm:grid-cols-3">
            {[
              ["search", "Fuzzy search", "Typo-tolerant, across 5,000 notes in under a second."],
              ["upload", "Bring your vault", "Import folders of .md or a whole ZIP — structure intact."],
              ["trash", "Nothing lost", "Versioned trash keeps every revision until you say otherwise."],
            ].map(([icon, title, body]) => (
              <li
                key={title}
                className="rounded-card border border-border bg-card p-5"
              >
                <Icon name={icon as "search"} size={18} className="text-accent" />
                <p className="mt-2 text-[15px] font-semibold text-ink">{title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">
                  {body}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-6 text-[13px] text-muted">
          <Wordmark />
          <p>Markdown in, Markdown out.</p>
        </div>
      </footer>
    </div>
  );
}
