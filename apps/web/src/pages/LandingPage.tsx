import { lazy, Suspense } from "react";
import { Link } from "@tanstack/react-router";
import { HeroDemo } from "../components/HeroDemo.js";
import { Mark } from "../components/Mark.js";
import { useCurrentUser } from "../api/auth.js";
import { LinkGraphIllustration } from "../components/LinkGraphIllustration.js";

// Three.js only ships to visitors who actually land here.
const ConstellationField = lazy(() =>
  import("../components/ConstellationField.js").then((m) => ({
    default: m.ConstellationField,
  })),
);

/**
 * Public marketing page. One idea carries it: raw syntax sitting next to its
 * result. The hero types into the real editor; everything below is set as an
 * outline — hairline rules and monospace labels, the shape of the thing being
 * sold — so nothing competes with that demo.
 */

function Wordmark({ size = "md" }: { size?: "md" | "sm" }) {
  const text = size === "md" ? "text-[18px]" : "text-[15px]";
  return (
    <span className="flex items-center gap-2">
      <Mark size={size === "md" ? 26 : 22} className="text-accent" />
      <span className={`font-semibold tracking-heading text-ink ${text}`}>
        Nexus
      </span>
    </span>
  );
}

/** Decorative colour fields behind the hero, kept faint on purpose. */
function HeroAtmosphere() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-20 overflow-hidden"
    >
      <div
        className="blob blob-drift-a left-[-8vw] top-[-14vh] h-[46vw] w-[46vw] max-h-[560px] max-w-[560px]"
        style={{ background: "var(--t-accent)" }}
      />
      <div
        className="blob blob-drift-b right-[-10vw] top-[-6vh] h-[38vw] w-[38vw] max-h-[480px] max-w-[480px]"
        style={{ background: "#7c5cff" }}
      />
    </div>
  );
}

function Section({
  eyebrow,
  children,
  className = "",
}: {
  eyebrow: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`border-t border-border ${className}`}>
      <div className="mx-auto max-w-[1120px] px-6 py-16">
        <p className="eyebrow">{eyebrow}</p>
        <div className="mt-6">{children}</div>
      </div>
    </section>
  );
}

/** Syntax rendered as display type — the one typographic flourish. */
function Syn({ children }: { children: string }) {
  return (
    <span className="font-mono font-medium text-accent">{children}</span>
  );
}

const CAPABILITIES = [
  {
    label: "search",
    title: "Finds it even when you misspell it",
    body: "Fuzzy matching across titles and content. Five thousand notes answer in tens of milliseconds, titles ranked first.",
  },
  {
    label: "graph",
    title: "Shows how the notes connect",
    body: "Pan and zoom a thousand notes without the browser stuttering. Notes with no links sit at the edge rather than disappearing.",
  },
  {
    label: "trash",
    title: "Keeps what you delete",
    body: "Notes and folders go to a versioned trash. Restore returns them to where they were, revision history intact.",
  },
  {
    label: "import / export",
    title: "Hands the files back",
    body: "Bring in a folder of .md or a whole ZIP; take the vault out the same way. Wikilinks and tags stay plain text.",
  },
] as const;

const SHORTCUTS = [
  ["Ctrl+P", "Open the command palette"],
  ["[[", "Link a note, with autocomplete"],
  ["#topic", "Tag as you write"],
  ["Alt+↑↓", "Reorder notes"],
] as const;

const NOT_DOING = [
  "Real-time co-editing. A vault belongs to one person.",
  "Native mobile or desktop apps. The browser is the app.",
  "Image and file hosting. Media is referenced by URL.",
  "Offline-first sync. The server is the system of record.",
] as const;

export function LandingPage() {
  const { data: user, isPending } = useCurrentUser();
  // Signed in: the page still explains the product, but the calls to action
  // point at the workspace instead of asking for an account again.
  const signedIn = Boolean(user);

  const primaryCta = signedIn ? (
    <Link
      to="/"
      className="rounded-control bg-accent-fill px-6 py-3 text-[16px] font-medium text-on-accent hover:bg-accent-fill-hover"
    >
      Open your workspace
    </Link>
  ) : (
    <>
      <Link
        to="/register"
        className="rounded-control bg-accent-fill px-6 py-3 text-[16px] font-medium text-on-accent hover:bg-accent-fill-hover"
      >
        Create your vault
      </Link>
      <Link
        to="/login"
        className="rounded-control border border-border bg-bg/70 px-6 py-3 text-[16px] font-medium text-ink hover:bg-surface"
      >
        Log in
      </Link>
    </>
  );

  return (
    <div className="min-h-full bg-bg text-ink">
      <header className="sticky top-0 z-30 border-b border-transparent backdrop-blur supports-[backdrop-filter]:bg-bg/80">
        <div className="mx-auto flex max-w-[1120px] items-center justify-between px-6 py-4">
          <Wordmark />
          <nav aria-label="Account" className="flex items-center gap-2">
            {isPending ? null : signedIn ? (
              <>
                <span className="hidden text-[14px] text-muted sm:inline">
                  Signed in as {user!.username}
                </span>
                <Link
                  to="/"
                  className="rounded-control bg-accent-fill px-4 py-2 text-[14px] font-medium text-on-accent hover:bg-accent-fill-hover"
                >
                  Open workspace
                </Link>
              </>
            ) : (
              <>
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
              </>
            )}
          </nav>
        </div>
      </header>

      <main>
        <section className="relative isolate overflow-hidden">
          <HeroAtmosphere />
          <Suspense fallback={null}>
            <ConstellationField />
          </Suspense>
          <div className="mx-auto max-w-[1120px] px-6 pb-16 pt-16">
            <div className="mx-auto max-w-[760px] text-center">
              <h1 className="text-[42px] font-semibold leading-[1.12] tracking-display sm:text-[56px]">
                Write <Syn>[[</Syn>notes<Syn>]]</Syn> that know each other.
              </h1>
              <p className="mx-auto mt-5 max-w-[540px] text-[18px] leading-relaxed text-muted">
                A keyboard-first Markdown workspace in the browser. Type two
                brackets to link a note; the connection becomes navigation, a
                backlink, and an edge in your graph.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                {primaryCta}
              </div>
              {!signedIn && (
                <p className="mt-4 font-mono text-[12px] text-muted">
                  free while in development · export anytime · no lock-in
                </p>
              )}
            </div>

            <div className="mx-auto mt-14 max-w-[880px]">
              <HeroDemo />
              <p className="mt-3 text-center font-mono text-[12px] text-muted">
                that is the real editor, with the same preview and autosave
              </p>
            </div>
          </div>
        </section>

        <Section eyebrow="what the links do">
          <div className="flex flex-col gap-10 md:flex-row md:items-center">
            <div className="max-w-[400px] flex-1">
              <h2 className="text-[32px] font-semibold leading-tight tracking-heading">
                A link is a real thing, not a convention
              </h2>
              <p className="mt-4 text-[16px] leading-relaxed text-muted">
                Write <Syn>[[Feedback Loops]]</Syn> and it becomes clickable in
                the preview, an edge in the graph, and a backlink waiting on the
                other side.
              </p>
              <ul className="mt-6 space-y-3 text-[14px] text-muted">
                <li className="flex items-start gap-2.5">
                  <span
                    aria-hidden="true"
                    className="mt-[6px] inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-accent"
                  />
                  <span>A note that exists</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span
                    aria-hidden="true"
                    className="mt-[6px] inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-dashed border-broken"
                  />
                  <span>
                    A link to a note you haven't written yet. Click it to
                    create one.
                  </span>
                </li>
              </ul>
            </div>
            <div className="flex-1">
              <LinkGraphIllustration />
            </div>
          </div>
        </Section>

        <Section eyebrow="what it does well">
          <h2 className="max-w-[560px] text-[32px] font-semibold leading-tight tracking-heading">
            Built for notes that pile up
          </h2>
          <ul className="mt-8">
            {CAPABILITIES.map((c) => (
              <li
                key={c.title}
                className="grid gap-2 border-t border-border py-6 md:grid-cols-[160px_1fr] md:gap-10"
              >
                <p className="eyebrow pt-1">{c.label}</p>
                <div>
                  <h3 className="text-[19px] font-semibold tracking-heading text-ink">
                    {c.title}
                  </h3>
                  <p className="mt-1.5 max-w-[620px] text-[15px] leading-relaxed text-muted">
                    {c.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section eyebrow="keyboard">
          <div className="flex flex-col gap-10 md:flex-row md:items-start">
            <div className="max-w-[420px] flex-1">
              <h2 className="text-[32px] font-semibold leading-tight tracking-heading">
                Hands stay where you type
              </h2>
              <p className="mt-4 text-[16px] leading-relaxed text-muted">
                Every core action has a key path: creating, linking, searching,
                reordering, restoring. The palette is one keystroke away from
                anywhere in the app.
              </p>
            </div>
            <dl className="flex-1">
              {SHORTCUTS.map(([keys, label]) => (
                <div
                  key={keys}
                  className="flex items-baseline justify-between gap-6 border-t border-border py-3.5"
                >
                  <dt>
                    <kbd className="font-mono text-[14px] font-medium text-ink">
                      {keys}
                    </kbd>
                  </dt>
                  <dd className="text-right text-[14px] text-muted">{label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Section>

        <Section eyebrow="boundaries">
          <div className="flex flex-col gap-10 md:flex-row md:items-start">
            <div className="max-w-[420px] flex-1">
              <h2 className="text-[28px] font-semibold leading-tight tracking-heading">
                What Nexus doesn't do
              </h2>
              <p className="mt-3 text-[16px] leading-relaxed text-muted">
                Worth knowing before you move your notes in. Deliberate
                omissions, not gaps waiting to be patched next week.
              </p>
            </div>
            <ul className="flex-1">
              {NOT_DOING.map((item) => (
                <li
                  key={item}
                  className="border-t border-border py-3.5 text-[15px] text-muted"
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </Section>

        <section className="border-t border-border bg-surface">
          <div className="mx-auto max-w-[720px] px-6 py-16 text-center">
            <h2 className="text-[28px] font-semibold leading-tight tracking-heading">
              Start empty, or bring what you have
            </h2>
            <p className="mx-auto mt-3 max-w-[480px] text-[16px] leading-relaxed text-muted">
              Import your existing Markdown in one step. If you ever want out,
              export gives you the same files back.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              {primaryCta}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-3 px-6 py-6">
          <Wordmark size="sm" />
          <p className="font-mono text-[12px] text-muted">
            markdown in, markdown out
          </p>
        </div>
      </footer>
    </div>
  );
}
