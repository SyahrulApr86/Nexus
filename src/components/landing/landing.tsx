import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import "./tokens.css";
import "./atlas.css";
import "./fragments.css";
import "./landing.css";
import { VaultAtlas } from "./atlas";
import { CopyButton } from "./copy-button";
import { BacklinksFragment, CanvasFragment, CollabFragment, FilesFragment, GraphFragment, PhoneFragment, SearchFragment } from "./fragments";
import { Icon } from "./icons";
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

const NAV = [
  ["#links", "Links"],
  ["#search", "Search"],
  ["#toolkit", "Toolkit"],
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

/** The two-column section header: the title and its subhead on the left, the description on the right. */
function SectionHead({ id, title, sub, children }: { id: string; title: string; sub: string; children: ReactNode }) {
  return (
    <div className="lp-head">
      <div className="lp-head-title">
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

function Spec({ term, children, d = 0 }: { term: string; children: ReactNode; d?: number }) {
  return (
    <div className="lp-spec" data-reveal style={{ ["--d" as string]: d }}>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const OPERATORS: Array<[string, string]> = [
  ["tag:planning", "Notes with the tag, nested tags included"],
  ["path:Projects", "Notes in a folder and below it"],
  ["file:roadmap", "Notes by name"],
  ["line:(launch date)", "All the words on one line"],
  ["-draft", "Leave a word out; OR for either one"],
];

export function Landing() {
  return (
    <div className="lp-dark lp-page">
      <a href="#main" className="lp-skip">
        Skip to content
      </a>
      <Reveal />

      <header className="lp-top">
        <div className="lp-top-in">
          <Wordmark />
          <nav aria-label="Sections" className="lp-top-nav">
            {NAV.map(([href, label]) => (
              <a key={href} href={href} className="lp-nav-link">
                {label}
              </a>
            ))}
          </nav>
          <div className="lp-top-end">
            <Link href="/login" className="lp-nav-link lp-nav-signin">
              Sign in
            </Link>
            <OpenVault className="lp-btn lp-btn-primary lp-btn-sm" />
          </div>
        </div>
      </header>

      <main id="main" className="lp-main">
        <section className="lp-hero" aria-labelledby="landing-title">
          <div className="lp-hero-head">
            <h1 id="landing-title" className="lp-display">
              <span className="lp-display-line">Plain notes,</span>{" "}
              <span className="lp-display-line">
                <span className="lp-slot" aria-hidden="true">
                  <VaultAtlas width={240} height={96} count={14} seed={5} labels={false} decorative className="lp-slot-svg" />
                </span>{" "}
                linked.
              </span>
            </h1>
            <div className="lp-hero-aside">
              <p className="lp-lead">
                Nexus is a markdown notebook for the browser, in the spirit of Obsidian. Link notes with{" "}
                <Code>[[ ]]</Code>, follow them in the graph, and keep every note a plain .md file on your own server.
              </p>
              <div className="lp-actions">
                <OpenVault className="lp-btn lp-btn-primary">
                  Open your vault
                  <Icon name="arrow" />
                </OpenVault>
                <a href="#self-host" className="lp-btn lp-btn-ghost">
                  Run it yourself
                </a>
              </div>
            </div>
          </div>
          <div className="lp-hero-shot">
            <LiveNote />
            <p className="lp-hint">
              Edit the markdown and watch the note render. The tabs open two more examples.
            </p>
          </div>
        </section>

        <section id="links" className="lp-section" aria-labelledby="links-title">
          <SectionHead id="links-title" title="Every link works both ways" sub="Link once, and the other note knows.">
            <p>
              A <Code>[[link]]</Code> shows up on the other note as a linked mention, with the line it came from. Mentions
              you have not linked yet are found too, one click from a link. Rename a note and every link to it is
              rewritten.
            </p>
          </SectionHead>
          <div className="lp-links-stage">
            <div className="lp-links-graph" data-reveal>
              <GraphFragment />
            </div>
            <div className="lp-links-back" data-reveal style={{ ["--d" as string]: 2 }}>
              <BacklinksFragment />
            </div>
          </div>
        </section>

        <section id="search" className="lp-section" aria-labelledby="search-title">
          <SectionHead id="search-title" title="Find it with operators" sub="The search syntax Obsidian users already know.">
            <p>
              Words match as prefixes and quotes keep a phrase together. Every hit is marked in its line, and the
              result opens at the match.
            </p>
          </SectionHead>
          <div data-reveal>
            <SearchFragment />
          </div>
          <div className="lp-ops-wrap">
            <div data-reveal>
              <h3>Operators you can combine</h3>
              <p className="lp-ops-note">Put several in one query, in any order.</p>
            </div>
            <table className="lp-ops" data-reveal style={{ ["--d" as string]: 1 }}>
              <tbody>
                {OPERATORS.map(([op, what]) => (
                  <tr key={op}>
                    <th scope="row">
                      <Code>{op}</Code>
                    </th>
                    <td>{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="toolkit" className="lp-section" aria-labelledby="toolkit-title">
          <SectionHead id="toolkit-title" title="Canvas, templates and files" sub="The rest of the toolkit, in the same vault.">
            <p>
              A canvas is a .canvas file in the JSON Canvas format, so it opens in Obsidian too. Everything else here is
              stored as markdown, or as a file next to it.
            </p>
          </SectionHead>
          <div className="lp-toolkit">
            <div className="lp-toolkit-canvas" data-reveal>
              <CanvasFragment />
            </div>
            <dl className="lp-specs">
              <Spec term="Templates">Insert one with variables for the date and title; daily notes can use one too.</Spec>
              <Spec term="Properties" d={1}>
                Frontmatter as a form you can edit, written back to the file without loss.
              </Spec>
              <Spec term="Attachments" d={2}>
                Paste or drop images, PDFs, audio and video into a note.
              </Spec>
              <Spec term="Callouts, math, diagrams" d={3}>
                Obsidian callouts that fold, KaTeX math and Mermaid in reading view.
              </Spec>
              <Spec term="Share links" d={4}>
                Publish one note as a read-only page, with an optional expiry. Revoke it any time.
              </Spec>
              <Spec term="Several vaults" d={5}>
                Keep work and personal notes apart and switch between them.
              </Spec>
            </dl>
          </div>
        </section>

        <section id="devices" className="lp-section lp-band" aria-labelledby="devices-title">
          <div className="lp-devices">
            <div className="lp-devices-copy">
              <h2 id="devices-title" data-reveal>
                One note, every device
              </h2>
              <p className="lp-devices-lead" data-reveal style={{ ["--d" as string]: 1 }}>
                The workspace has its own phone layout and installs from the browser. Open a note in two places and the
                edits arrive as they are typed.
              </p>
              <dl className="lp-specs lp-specs-tight">
                <Spec term="Installs like an app" d={2}>
                  On iPhone, Android or desktop, from the browser’s menu.
                </Spec>
                <Spec term="Works offline" d={3}>
                  Notes you open stay on the device. Changes wait in an outbox and are sent on reconnect.
                </Spec>
                <Spec term="Live editing" d={4}>
                  Every open session has its own named cursor.
                </Spec>
              </dl>
            </div>
            <div className="lp-devices-phone" data-reveal style={{ ["--d" as string]: 1 }}>
              <PhoneFragment />
            </div>
            <div className="lp-devices-collab" data-reveal style={{ ["--d" as string]: 2 }}>
              <CollabFragment />
            </div>
          </div>
        </section>

        <section id="self-host" className="lp-section" aria-labelledby="self-host-title">
          <SectionHead id="self-host-title" title="Your server, your files" sub="One Compose file, and a vault you can take with you.">
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
          <div className="lp-host">
            <div className="lp-terminal" data-ui data-reveal>
              <div className="lp-terminal-bar">
                <span className="lp-terminal-t">
                  <Icon name="terminal" size={14} />
                  Terminal
                </span>
                <CopyButton text={COMPOSE} label="Copy the commands" className="lp-copy" />
              </div>
              <pre tabIndex={0} aria-label="Commands to start Nexus with Docker Compose">
                <code>
                  <Compose />
                </code>
              </pre>
            </div>
            <div className="lp-host-files" data-reveal style={{ ["--d" as string]: 1 }}>
              <FilesFragment />
            </div>
          </div>
          <dl className="lp-specs lp-specs-row">
            <Spec term="Sign-up is closed by default">
              Set <Code>NEXUS_ALLOW_SIGNUP=true</Code>, restart, create the owner account, then set it back.
            </Spec>
            <Spec term="HTTPS in front" d={1}>
              The app listens on <Code>127.0.0.1:3000</Code>. Put Caddy or Nginx with HTTPS in front of it.
            </Spec>
            <Spec term="Leave any time" d={2}>
              Export the vault from Settings, notes and attachments together.
            </Spec>
          </dl>
        </section>

        <section className="lp-close" aria-labelledby="close-title">
          <h2 id="close-title" className="lp-close-title" data-reveal>
            Start a vault tonight.
          </h2>
          <div className="lp-close-row" data-reveal style={{ ["--d" as string]: 1 }}>
            <p>Sign in on this server, or run your own with one Compose file.</p>
            <div className="lp-actions">
              <OpenVault className="lp-btn lp-btn-primary">
                Open your vault
                <Icon name="arrow" />
              </OpenVault>
              <a href="#self-host" className="lp-btn lp-btn-ghost">
                Read the setup
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-footer-row">
          <nav aria-label="Footer" className="lp-footer-nav">
            <OpenVault className="lp-nav-link" />
            <Link href="/login" className="lp-nav-link">
              Sign in
            </Link>
            <a href="#self-host" className="lp-nav-link">
              Self-host
            </a>
            <a href="#main" className="lp-nav-link">
              Back to top
            </a>
          </nav>
          <p>Linked notes in plain markdown, on your own server.</p>
        </div>
        <p className="lp-footer-name" translate="no" aria-hidden="true">
          <span className="lp-wordmark-b">[[</span>Nexus<span className="lp-wordmark-b">]]</span>
        </p>
      </footer>
    </div>
  );
}
