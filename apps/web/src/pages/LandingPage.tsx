import { Link } from "@tanstack/react-router";
import { Icon } from "../components/Icon.js";
import { HeroDemo } from "../components/HeroDemo.js";

/**
 * Public marketing page (DESIGN.md palette + rhythm). The hero shows the real
 * editor typing into itself rather than describing it; everything below stays
 * quiet so that demo carries the page.
 */

function Wordmark({ size = "md" }: { size?: "md" | "sm" }) {
  const box = size === "md" ? "h-7 w-7 text-[15px]" : "h-6 w-6 text-[13px]";
  const text = size === "md" ? "text-[18px]" : "text-[15px]";
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className={`flex items-center justify-center rounded-[8px] bg-accent-fill font-semibold text-on-accent ${box}`}
      >
        N
      </span>
      <span className={`font-semibold tracking-heading text-ink ${text}`}>
        Nexus
      </span>
    </span>
  );
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded-[5px] border border-border bg-card px-1.5 py-0.5 font-mono text-[12px] text-ink">
      {children}
    </kbd>
  );
}

const CAPABILITIES = [
  {
    icon: "search",
    title: "Search that forgives typos",
    body: "Fuzzy matching over titles and content. Five thousand notes come back in well under a second, with title matches on top.",
  },
  {
    icon: "graph",
    title: "A graph you can actually read",
    body: "Every wikilink is an edge. Pan and zoom a thousand notes without the browser breaking a sweat; unlinked notes sit at the edge instead of vanishing.",
  },
  {
    icon: "trash",
    title: "Deleting is never final",
    body: "Notes and folders go to a versioned trash. Restore puts them back where they were, with the full revision history intact.",
  },
  {
    icon: "upload",
    title: "Yours to take back",
    body: "Import a folder of .md files or a whole ZIP; export the vault the same way. Wikilinks and tags stay plain text on the way out.",
  },
] as const;

const SHORTCUTS = [
  ["Ctrl+P", "Command palette — every action, no mouse"],
  ["[[", "Link a note, with autocomplete"],
  ["#topic", "Tag as you write; the sidebar keeps count"],
  ["Alt+↑↓", "Reorder notes from the keyboard"],
] as const;

export function LandingPage() {
  return (
    <div className="min-h-full bg-bg text-ink">
      <header className="mx-auto flex max-w-[1120px] items-center justify-between px-6 py-4">
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
        <section className="mx-auto max-w-[1120px] px-6 pb-14 pt-14">
          <div className="mx-auto max-w-[720px] text-center">
            <h1 className="text-[44px] font-semibold leading-[1.12] tracking-display sm:text-[56px]">
              Notes that link, sync, and stay yours.
            </h1>
            <p className="mx-auto mt-5 max-w-[560px] text-[18px] leading-relaxed text-muted">
              A keyboard-first Markdown workspace that runs in the browser.
              Wikilinks weave your notes into a graph; the server keeps every
              device on the same page.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
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
          </div>

          <div className="mx-auto mt-14 max-w-[880px]">
            <HeroDemo />
            <p className="mt-3 text-center text-[13px] text-muted">
              The editor above is the real one — same preview, same autosave.
            </p>
          </div>
        </section>

        <section className="border-y border-border bg-surface py-16">
          <div className="mx-auto max-w-[1120px] px-6">
            <h2 className="max-w-[520px] text-[32px] font-semibold leading-tight tracking-heading">
              Built for the way linked notes actually get used
            </h2>
            <ul className="mt-10 grid gap-6 sm:grid-cols-2">
              {CAPABILITIES.map((c) => (
                <li
                  key={c.title}
                  className="rounded-card border border-border bg-card p-6"
                >
                  <Icon
                    name={c.icon as "search"}
                    size={20}
                    className="text-accent"
                  />
                  <h3 className="mt-3 text-[17px] font-semibold tracking-heading text-ink">
                    {c.title}
                  </h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted">
                    {c.body}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-[1120px] px-6 py-16">
          <div className="flex flex-col gap-10 md:flex-row md:items-center">
            <div className="max-w-[440px] flex-1">
              <h2 className="text-[32px] font-semibold leading-tight tracking-heading">
                Hands stay on the keyboard
              </h2>
              <p className="mt-4 text-[16px] leading-relaxed text-muted">
                Creating, linking, searching, reordering, restoring — every core
                action has a key path. The command palette is one keystroke away
                from anywhere in the app.
              </p>
            </div>
            <dl className="flex-1 divide-y divide-border rounded-card border border-border bg-card">
              {SHORTCUTS.map(([keys, label]) => (
                <div
                  key={keys}
                  className="flex items-center justify-between gap-4 px-5 py-3.5"
                >
                  <dt className="shrink-0">
                    <Kbd>{keys}</Kbd>
                  </dt>
                  <dd className="text-right text-[14px] text-muted">{label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="border-t border-border bg-surface">
          <div className="mx-auto max-w-[720px] px-6 py-16 text-center">
            <h2 className="text-[28px] font-semibold leading-tight tracking-heading">
              Start with an empty vault or bring your own
            </h2>
            <p className="mx-auto mt-3 max-w-[480px] text-[16px] leading-relaxed text-muted">
              Import your existing Markdown in one step. If you ever want out,
              export gives you the same files back.
            </p>
            <Link
              to="/register"
              className="mt-7 inline-block rounded-control bg-accent-fill px-6 py-3 text-[16px] font-medium text-on-accent hover:bg-accent-fill-hover"
            >
              Create your vault
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-3 px-6 py-6 text-[13px] text-muted">
          <Wordmark size="sm" />
          <p>Markdown in, Markdown out.</p>
        </div>
      </footer>
    </div>
  );
}
