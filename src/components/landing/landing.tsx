import { Suspense, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import "./landing.css";
import { CopyButton } from "./copy-button";
import { VaultLink, VaultLinkFallback } from "./vault-link";

/* A typed markdown token. `hang` pulls a line-start token into the gutter by its own width (n cells). */
function Tok({ children, hang, i }: { children: string; hang?: boolean; i?: number }) {
  const style = {
    ...(hang ? { "--n": children.length } : null),
    ...(i !== undefined ? { "--i": i } : null),
  } as CSSProperties;
  return (
    <span className={hang ? "lp-tok lp-hang" : "lp-tok"} style={style}>
      {children}
    </span>
  );
}

function OpenVault({ className }: { className: string }) {
  return (
    <Suspense fallback={<VaultLinkFallback className={className}>Open your vault</VaultLinkFallback>}>
      <VaultLink className={className}>Open your vault</VaultLink>
    </Suspense>
  );
}

function Wordmark() {
  return (
    <Link href="/" className="lp-wordmark" translate="no">
      <span aria-hidden="true" className="lp-tok" style={{ "--tok": "0.94em" } as CSSProperties}>
        [[
      </span>
      Nexus
      <span aria-hidden="true" className="lp-tok" style={{ "--tok": "0.94em" } as CSSProperties}>
        ]]
      </span>
    </Link>
  );
}

// From README "Deploy": the commands a self-hoster runs, with the comments in English.
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

function Row({ example, title, children }: { example: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="lp-row">
      {example}
      <div className="lp-row-text">
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
    </li>
  );
}

function Code({ children }: { children: string }) {
  return <code className="lp-inline-code">{children}</code>;
}

export function Landing() {
  return (
    <div className="lp-page">
      <header className="lp-wrap">
        <div className="lp-bar">
          <Wordmark />
          <nav aria-label="Main" className="lp-bar-nav">
            <a href="#self-host" className="lp-link">
              Self-host
            </a>
            <OpenVault className="lp-link" />
          </nav>
        </div>
      </header>

      <main>
        <section className="lp-wrap lp-hero" aria-labelledby="landing-title">
          <div className="lp-sheet">
            <figure style={{ margin: 0 }}>
              <figcaption className="lp-path">
                <span className="sr-only">An example daily note, as typed: </span>
                Daily notes/2026-11-13.md
              </figcaption>
              {/* 13 November 2026 is a Friday. */}
              <p className="lp-note">
                <span className="lp-line">Friday, 13&nbsp;November&nbsp;—</span>
                <span className="lp-line">
                  <Tok hang i={0}>
                    [[
                  </Tok>
                  <span className="lp-target">Project kickoff</span>
                  <Tok i={1}>]]</Tok> moved
                </span>
                <span className="lp-line">
                  <Tok hang i={2}>
                    [[
                  </Tok>
                  <span className="lp-target">Q4 roadmap</span>
                  <Tok i={3}>]]</Tok> up a week.
                </span>
                <span className="lp-line">
                  <Tok hang i={4}>
                    #
                  </Tok>
                  <span className="lp-tag">planning</span>
                </span>
              </p>
            </figure>

            <div className="lp-promise">
              <h1 id="landing-title">Notes that link to each other, in plain markdown.</h1>
              <p>
                Open your vault in any browser, on any device. Type <Code>[[</Code> to link one note to another, and
                every link shows up as a backlink on the other side.
              </p>
              <div className="lp-actions">
                <OpenVault className="lp-primary" />
                <a href="#self-host" className="lp-link">
                  Self-host
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-wrap lp-section" aria-labelledby="what">
          <div className="lp-section-head">
            <h2 id="what">What it does</h2>
            <p>The parts of Obsidian you reach for every day, in a browser tab, backed by your own database.</p>
          </div>
          <ul className="lp-rows">
            <Row
              title="Links and backlinks"
              example={
                <p className="lp-example">
                  <span className="lp-line">
                    <Tok hang>[[</Tok>
                    <span className="lp-target">Q4&nbsp;roadmap</span>
                    <Tok>]]</Tok>
                  </span>
                </p>
              }
            >
              Type <Code>[[</Code> and pick a note. The note you linked to lists the mention, with the line it came
              from. Rename a note and every link to it is rewritten.
            </Row>
            <Row
              title="Graph"
              example={
                <p className="lp-example">
                  <span className="lp-line">
                    <Tok hang>#</Tok>
                    <span className="lp-tag">planning</span>
                  </span>
                </p>
              }
            >
              Every note and link as a graph you can zoom, pan and filter by name or tag, with a list mode for the
              keyboard and screen readers.
            </Row>
            <Row
              title="Search with operators"
              example={
                <p className="lp-query">
                  <span className="lp-op">tag:</span>planning &quot;launch date&quot; <span className="lp-op">-</span>draft
                </p>
              }
            >
              Words, &quot;phrases&quot;, <Code>OR</Code>, exclusions and filters: <Code>file:</Code>,{" "}
              <Code>path:</Code>, <Code>tag:</Code>, and <Code>line:</Code> for words on the same line.
            </Row>
            <Row
              title="Live preview"
              example={
                <p className="lp-example">
                  <span className="lp-line">
                    <Tok hang>##</Tok>
                    Agenda
                  </span>
                </p>
              }
            >
              Markdown hides its syntax on every line except the one you are editing, which shows the source.
            </Row>
            <Row
              title="Callouts, embeds, math, diagrams"
              example={
                <p className="lp-example">
                  <span className="lp-line">
                    <Tok hang>&gt;</Tok>
                    <Tok>[!warning]</Tok> Launch moved
                  </span>
                  <span className="lp-line">
                    <Tok hang>![[</Tok>
                    <span className="lp-target">Meeting&nbsp;notes</span>
                    <Tok>#</Tok>
                    <span className="lp-target">Decisions</span>
                    <Tok>]]</Tok>
                  </span>
                </p>
              }
            >
              In reading view: Obsidian callouts that fold, embedded notes and headings, KaTeX math and Mermaid
              diagrams.
            </Row>
          </ul>
          <div className="lp-also">
            <div className="lp-row-text">
              <h3>Works on your phone</h3>
              <p>
                The workspace fits a phone screen, and installs from the browser on iPhone, Android or desktop. It
                still needs your server: there is no offline mode yet.
              </p>
            </div>
            <div className="lp-row-text">
              <h3>History</h3>
              <p>
                Before a note is overwritten, Nexus keeps the earlier text: up to 50 versions per note, for 30 days. A
                panel to browse and restore them is planned; today they are reachable through the API.
              </p>
            </div>
          </div>
        </section>

        <section className="lp-wrap lp-section" aria-labelledby="files">
          <div className="lp-section-head">
            <h2 id="files">Your files stay yours</h2>
            <p>A note is a markdown file, not a row you can’t get back out.</p>
          </div>
          <div className="lp-files">
            <ul className="lp-file-list" aria-label="An exported vault">
              <li>my-vault.zip</li>
              <li>
                <span className="lp-dir">Daily notes/</span>2026-11-13.md
              </li>
              <li>
                <span className="lp-dir">Projects/</span>Project kickoff.md
              </li>
              <li>
                <span className="lp-dir">Projects/</span>Q4 roadmap.md
              </li>
            </ul>
            <div className="lp-points">
              <div>
                <h3>Plain .md</h3>
                <p>
                  What you type is what is stored: <Code>[[links]]</Code>, <Code>#tags</Code> and frontmatter stay
                  text in the file.
                </p>
              </div>
              <div>
                <h3>Export that opens in Obsidian</h3>
                <p>Export vault, in Settings, downloads every note as a .zip of .md files.</p>
              </div>
              <div>
                <h3>Import from Obsidian</h3>
                <p>Bring a vault in as a .zip, or a few .md files. Attachments and .obsidian settings are skipped.</p>
              </div>
            </div>
          </div>
        </section>

        <section id="self-host" className="lp-wrap lp-section" aria-labelledby="self-host-title">
          <div className="lp-section-head">
            <h2 id="self-host-title">Run it on your own server</h2>
            <p>
              Docker Compose starts three services: Postgres, a migration step that exits when it is done, and the
              app.
            </p>
          </div>
          <div className="lp-code">
            <div className="lp-code-bar">
              <span>Terminal</span>
              <CopyButton text={COMPOSE} label="Copy the commands" className="lp-copy" />
            </div>
            <pre tabIndex={0} aria-label="Commands to start Nexus with Docker Compose">
              <code>
                <Compose />
              </code>
            </pre>
          </div>
          <div className="lp-notes">
            <div className="lp-row-text">
              <h3>Sign-up is closed by default</h3>
              <p>
                To create the owner account, set <Code>NEXUS_ALLOW_SIGNUP=true</Code> in .env, restart the app and sign
                up. Then set it back to <Code>false</Code> and restart again.
              </p>
            </div>
            <div className="lp-row-text">
              <h3>HTTPS in front</h3>
              <p>
                The app listens on <Code>127.0.0.1:3000</Code> only. Put Caddy or Nginx with HTTPS in front of it;
                session cookies are only secure on https.
              </p>
            </div>
          </div>
        </section>

        <section className="lp-wrap lp-section" aria-labelledby="together">
          <div className="lp-section-head">
            <h2 id="together">
              Working together <span className="lp-planned">Planned</span>
            </h2>
            <p>Today a vault belongs to one account. Shared vaults and real-time editing are planned, not built.</p>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap">
          <div className="lp-footer-inner">
            <p>Nexus keeps your notes as plain markdown.</p>
            <nav aria-label="Footer" className="lp-footer-nav">
              <OpenVault className="lp-link" />
              <a href="#self-host" className="lp-link">
                Self-host
              </a>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
