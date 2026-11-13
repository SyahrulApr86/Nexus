import "./share.css";
import Link from "next/link";
import { sharePolicy } from "@/lib/shares";

/** The brand mark, set in type as in the app: the product name written as a wikilink. */
function Wordmark() {
  return (
    <span translate="no" className="font-semibold tracking-[-0.01em]">
      <span aria-hidden="true" className="text-accent-ink">
        [[
      </span>
      Nexus
      <span aria-hidden="true" className="text-accent-ink">
        ]]
      </span>
    </span>
  );
}

/**
 * Frame of the public share pages: no app chrome, only the product name, the note on its sheet and
 * a small footer. The sheet sets the note on the reading measure (700px) with 40px side padding,
 * so the column is 700 + 2 x 40 + 2 x 24 = 828px wide at most. Light and dark follow the app's theme.
 */
export default function ShareLayout({ children }: LayoutProps<"/s">) {
  return (
    <>
      {/* Narrows the app-wide header CSP for these pages (a browser enforces both). */}
      <meta httpEquiv="Content-Security-Policy" content={sharePolicy()} />
      <div
        className="flex min-h-dvh flex-col bg-frame text-fg"
        style={{
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <header className="mx-auto flex h-14 w-full max-w-[828px] items-center justify-between gap-4 px-4 font-ui text-sm md:px-6">
          <Link href="/" aria-label="Nexus home" className="-mx-2 inline-flex h-11 items-center rounded-md px-2 text-[15px] hover:bg-hover">
            <Wordmark />
          </Link>
          <span className="text-muted">Read-only shared note</span>
        </header>
        <main className="mx-auto w-full max-w-[828px] flex-1 px-2 pb-6 md:px-6">{children}</main>
        <footer className="mx-auto flex w-full max-w-[828px] items-center justify-center px-4 pb-6 font-ui text-[13px] leading-5 text-muted md:px-6">
          <Link href="/" className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 underline-offset-4 hover:text-fg hover:underline">
            Made with <Wordmark />
          </Link>
        </footer>
      </div>
    </>
  );
}
