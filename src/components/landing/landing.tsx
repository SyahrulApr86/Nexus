import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import "./tokens.css";
import "./landing.css";
import { VaultAtlas, VaultBars } from "./atlas";
import { CopyButton } from "./copy-button";
import { BacklinksFragment, CanvasFragment, FilesFragment, GraphFragment, PhoneFragment, SearchFragment } from "./fragments";
import { LiveNote } from "./live-note";
import { Reveal } from "./reveal";
import { VaultLink, VaultLinkFallback } from "./vault-link";

function OpenVault({ className, children = "Open your vault" }: { className: string; children?: ReactNode }) {
  return (
    <Suspense fallback={<VaultLinkFallback className={className}>{children}</VaultLinkFallback>}>
      <VaultLink className={className}>{children}</VaultLink>
    </Suspense>
  );
}

export function Wordmark({ className = "lp-wordmark" }: { className?: string }) {
  return (
    <Link href="/" className={className} translate="no" aria-label="Nexus home">
      <span aria-hidden="true" className="lp-wordmark-b">
        [[
      </span>
      Nexus
      <span aria-hidden="true" className="lp-wordmark-b">
        ]]
      </span>
    </Link>
  );
}

function Arrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="lp-chev">
      <path d="m6 4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

const NAV = [
  ["#write", "Write"],
  ["#links", "Links and graph"],
  ["#search", "Search"],
  ["#more", "Canvas and more"],
  ["#devices", "Every device"],
  ["#self-host", "Self-host"],
] as const;

// From README "Deploy": the commands a self-hoster runs.
const COMPOSE = `# On the server, in a checkout of Nexus:
cp .env.example .env
# Fill in .env:
#   POSTGRES_PASSWORD, APP_DB_PASSWORD   openssl rand -hex 32
#   BETTER_AUTH_SECRET                   openssl rand -base64 32
#   BETTER_AUTH_URL=https://notes.example.com   (must be https)
docker compose --profile prod up -d --build`;

function Compose() {
  return COMPOSE.split("\n").map((line, k) => (
    <span key={k} className={line.startsWith("#") ? "lp-comment" : undefined}>
      {line}
      {"\n"}
    </span>
  ));
}

function Code({ children }: { children: string }) {
  return <code className="lp-code-inline">{children}</code>;
}

/** The reference's two-column section header: title and subhead left, description right. */
function SectionHead({ id, title, sub, children }: { id: string; title: string; sub: string; children: ReactNode }) {
  return (
    <div className="lp-head">
      <div>
        <h2 id={id} data-reveal>
          {title}
        </h2>
        <p className="lp-sub" data-reveal style={{ ["--d" as string]: 1 }}>
          {sub}
        </p>
      </div>
      <div className="lp-head-body" data-reveal style={{ ["--d" as string]: 2 }}>
        {children}
      </div>
    </div>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="lp-fact" data-reveal>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Landing() {
  return (
    <div className="lp-scope lp-page">
      <a href="#main" className="lp-skip">
        Skip to content
      </a>
      <Reveal />

      <aside className="lp-rail" aria-label="Site">
        <Wordmark />
        <nav aria-label="Sections" className="lp-rail-nav">
          {NAV.map(([href, label]) => (
            <a key={href} href={href} className="lp-rail-link">
              {label}
              <Chevron />
            </a>
          ))}
        </nav>
        <div className="lp-start">
          <p className="lp-start-label">
            <span className="lp-dot" aria-hidden="true" />
            Start here
          </p>
          <OpenVault className="lp-btn lp-btn-primary lp-btn-block" />
          <a href="#self-host" className="lp-btn lp-btn-ghost lp-btn-block">
            Run it yourself
          </a>
        </div>
      </aside>

      <header className="lp-top">
        <Wordmark />
        <nav aria-label="Main" className="lp-top-nav">
          <a href="#self-host" className="lp-text-link">
            Self-host
          </a>
          <OpenVault className="lp-btn lp-btn-primary lp-btn-sm" />
        </nav>
      </header>

      <main id="main" className="lp-main">
        <section className="lp-hero" aria-labelledby="landing-title">
          <h1 id="landing-title" className="lp-display">
            <span className="lp-display-line">Plain notes,</span>{" "}
            <span className="lp-display-line">
              <span className="lp-slot" aria-hidden="true">
                <VaultAtlas width={240} height={96} count={14} seed={5} labels={false} decorative className="lp-slot-svg" />
              </span>{" "}
              linked.
            </span>
          </h1>
          <div className="lp-hero-foot">
            <p className="lp-lead">
              Nexus is a markdown notebook for the browser, in the spirit of Obsidian. Type <Code>[[</Code> to link
              two notes, read the backlinks and the graph, and keep every note a plain .md file on your own server.
            </p>
            <div className="lp-actions">
              <OpenVault className="lp-btn lp-btn-primary">
                Open your vault
                <Arrow />
              </OpenVault>
              <a href="#self-host" className="lp-btn lp-btn-ghost">
                Run it yourself
              </a>
            </div>
          </div>
          <figure className="lp-atlas" data-reveal style={{ ["--d" as string]: 2 }}>
            <VaultAtlas className="lp-atlas-svg lp-atlas-wide" />
            <VaultAtlas width={560} height={480} count={44} seed={7} className="lp-atlas-svg lp-atlas-narrow" />
            <VaultBars className="lp-bars" />
            <figcaption>A sample vault as its graph: each dot a note, each line a [[link]]. Blue is the open note and what it links to.</figcaption>
          </figure>
        </section>

        <section id="write" className="lp-section" aria-labelledby="write-title">
          <SectionHead
            id="write-title"
            title="Type markdown, read a note"
            sub="Live preview hides the syntax everywhere except the line you are on."
          >
            <p>
              Try it below. Links, tags, tasks, highlights and headings turn into the note as you type; the line with
              your cursor keeps its markdown so you can still edit it. What is saved is exactly what you typed.
            </p>
          </SectionHead>
          <div data-reveal style={{ ["--d" as string]: 3 }}>
            <LiveNote />
          </div>
        </section>

        <section id="links" className="lp-section" aria-labelledby="links-title">
          <SectionHead
            id="links-title"
            title="Every link works both ways"
            sub="Link once, and the other note knows about it."
          >
            <p>
              A <Code>[[link]]</Code> shows up on the other note as a linked mention, with the line it came from.
              Mentions you have not linked yet are found too, one click from a link. Rename a note and every link to it
              is rewritten.
            </p>
          </SectionHead>
          <div className="lp-split">
            <div data-reveal>
              <BacklinksFragment />
            </div>
            <div data-reveal style={{ ["--d" as string]: 1 }}>
              <GraphFragment />
            </div>
          </div>
        </section>

        <section id="search" className="lp-section" aria-labelledby="search-title">
          <SectionHead id="search-title" title="Find it with operators" sub="The search syntax Obsidian users already know.">
            <p>Words match as prefixes; quotes keep a phrase together. Combine them with the operators below.</p>
          </SectionHead>
          <div className="lp-split lp-split-wide">
            <div data-reveal>
              <SearchFragment />
            </div>
            <dl className="lp-ops" data-reveal style={{ ["--d" as string]: 1 }}>
              <div>
                <dt>
                  <Code>tag:planning</Code>
                </dt>
                <dd>Notes with the tag, nested tags included</dd>
              </div>
              <div>
                <dt>
                  <Code>path:Projects</Code>
                </dt>
                <dd>Notes in a folder</dd>
              </div>
              <div>
                <dt>
                  <Code>file:roadmap</Code>
                </dt>
                <dd>Notes by name</dd>
              </div>
              <div>
                <dt>
                  <Code>line:(launch date)</Code>
                </dt>
                <dd>All words on the same line</dd>
              </div>
              <div>
                <dt>
                  <Code>a OR b</Code>, <Code>-draft</Code>
                </dt>
                <dd>Either one, or leave a word out</dd>
              </div>
            </dl>
          </div>
        </section>

        <section id="more" className="lp-section" aria-labelledby="more-title">
          <SectionHead id="more-title" title="Canvas, templates and files" sub="The rest of the toolkit, in the same vault.">
            <p>
              A canvas is a .canvas file in the JSON Canvas format, so it opens in Obsidian too. Everything else on this
              list is stored as markdown or as a file next to it.
            </p>
          </SectionHead>
          <div className="lp-split lp-split-canvas">
            <div data-reveal>
              <CanvasFragment />
            </div>
            <dl className="lp-facts">
              <Fact term="Templates">Insert one with variables for the date and title; daily notes can use one too.</Fact>
              <Fact term="Properties">Frontmatter as a form you can edit, written back to the file without loss.</Fact>
              <Fact term="Attachments">Paste or drop images, PDFs, audio and video into a note.</Fact>
              <Fact term="Callouts, math, diagrams">Obsidian callouts that fold, KaTeX math and Mermaid in reading view.</Fact>
              <Fact term="Share links">Publish one note as a read-only page, with an optional expiry, and revoke it any time.</Fact>
              <Fact term="Several vaults">Keep work and personal notes apart and switch between them.</Fact>
            </dl>
          </div>
        </section>

        <section id="devices" className="lp-section" aria-labelledby="devices-title">
          <SectionHead id="devices-title" title="On every device you own" sub="A phone is not a smaller desktop here.">
            <p>
              The workspace has its own phone layout and installs from the browser. Notes you open are kept on the
              device, so you can keep writing on a train; edits sync when you are back online.
            </p>
          </SectionHead>
          <div className="lp-devices">
            <div data-reveal>
              <PhoneFragment />
            </div>
            <dl className="lp-facts lp-facts-tall">
              <Fact term="Installs like an app">On iPhone, Android or desktop, from the browser’s menu.</Fact>
              <Fact term="Works offline">Changes wait in an outbox on the device and are sent on reconnect.</Fact>
              <Fact term="Live editing">
                Open a note in two places and edits arrive as they are typed, with a marker for each open session.
              </Fact>
            </dl>
          </div>
        </section>

        <section id="self-host" className="lp-section" aria-labelledby="self-host-title">
          <SectionHead
            id="self-host-title"
            title="Your server, your files"
            sub="One Docker Compose file, and a vault you can always take with you."
          >
            <p>
              Compose starts Postgres, a migration step that exits when it is done, the app and the collaboration
              service. Export the vault as a .zip of .md files that opens in Obsidian, or import an Obsidian vault.
            </p>
          </SectionHead>
          <dl className="lp-stats">
            <div data-reveal>
              <dt>Services in one Compose file</dt>
              <dd>4</dd>
            </div>
            <div data-reveal style={{ ["--d" as string]: 1 }}>
              <dt>Notes in one vault</dt>
              <dd>20,000</dd>
            </div>
            <div data-reveal style={{ ["--d" as string]: 2 }}>
              <dt>Storage per vault</dt>
              <dd>500 MiB</dd>
            </div>
            <div data-reveal style={{ ["--d" as string]: 3 }}>
              <dt>Format of every note</dt>
              <dd>.md</dd>
            </div>
          </dl>
          <div className="lp-split lp-split-code">
            <div className="lp-terminal" data-reveal>
              <div className="lp-terminal-bar">
                <span>Terminal</span>
                <CopyButton text={COMPOSE} label="Copy the commands" className="lp-copy" />
              </div>
              <pre tabIndex={0} aria-label="Commands to start Nexus with Docker Compose">
                <code>
                  <Compose />
                </code>
              </pre>
            </div>
            <div data-reveal style={{ ["--d" as string]: 1 }}>
              <FilesFragment />
            </div>
          </div>
          <dl className="lp-facts lp-facts-row">
            <Fact term="Sign-up is closed by default">
              Set <Code>NEXUS_ALLOW_SIGNUP=true</Code>, restart, create the owner account, then set it back.
            </Fact>
            <Fact term="HTTPS in front">
              The app listens on <Code>127.0.0.1:3000</Code>. Put Caddy or Nginx with HTTPS in front of it.
            </Fact>
            <Fact term="Leave any time">Export the vault from Settings, notes and attachments together.</Fact>
          </dl>
        </section>
      </main>

      <footer className="lp-footer">
        <p className="lp-footer-name" translate="no" aria-hidden="true">
          Nexus
        </p>
        <div className="lp-footer-row">
          <nav aria-label="Footer" className="lp-footer-nav">
            <OpenVault className="lp-text-link" />
            <Link href="/login" className="lp-text-link">
              Sign in
            </Link>
            <a href="#self-host" className="lp-text-link">
              Self-host
            </a>
          </nav>
          <p>Linked notes in plain markdown, on your own server.</p>
          <p>
            <a href="#main" className="lp-text-link">
              Back to top
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
