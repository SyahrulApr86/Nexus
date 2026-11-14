import "@/components/landing/tokens.css";
import "./share.css";
import Link from "next/link";
import { sharePolicy } from "@/lib/shares";

/** The brand mark, set in type as in the app: the product name written as a wikilink. */
function Wordmark() {
  return (
    <span translate="no" className="sh-wordmark">
      <span aria-hidden="true">[[</span>
      Nexus
      <span aria-hidden="true">]]</span>
    </span>
  );
}

/**
 * Frame of the public share pages, a reading page in the landing's blueprint atlas: the product name
 * and a hairline above, the note on the canvas at a 68ch measure, and a small signed close below.
 * No app chrome. Light and dark follow the system (or data-theme).
 */
export default function ShareLayout({ children }: LayoutProps<"/s">) {
  return (
    <>
      {/* Narrows the app-wide header CSP for these pages (a browser enforces both). */}
      <meta httpEquiv="Content-Security-Policy" content={sharePolicy()} />
      <div className="lp-scope sh">
        <header className="sh-bar">
          <Link href="/" aria-label="Nexus home" className="sh-home">
            <Wordmark />
          </Link>
          <span className="sh-kind">Read-only shared note</span>
        </header>
        <main className="sh-main">{children}</main>
        <footer className="sh-foot">
          <p>Anyone with this link can read this note. Links to other notes show as plain text.</p>
          <Link href="/" className="sh-made">
            Shared from <Wordmark />
          </Link>
        </footer>
      </div>
    </>
  );
}
