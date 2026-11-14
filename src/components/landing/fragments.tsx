import { VaultAtlas } from "./atlas";

/*
 * Cropped fragments of the Nexus interface, drawn at true size from the app's own panes with the
 * sample vault the page uses throughout (Q4 roadmap, Weekly sync, Mira Chen…). Each root carries
 * data-ui: inside it the product's own conventions (1px panel edges, small labels) apply.
 */

function Hit({ children }: { children: string }) {
  return <mark className="fx-hit">{children}</mark>;
}

export function BacklinksFragment() {
  const rows = [
    { note: "Weekly sync", path: "Meetings", before: "Launch moves to ", link: "the Q4 plan", after: "." },
    { note: "Project kickoff", path: "Projects", before: "Scope is fixed in ", link: "Q4 roadmap", after: ", rest goes to Q1." },
    { note: "2026-11-13", path: "Daily notes", before: "Moved ", link: "Q4 roadmap", after: " up a week. #planning" },
  ];
  return (
    <figure data-ui className="fx fx-backlinks" aria-label="The backlinks pane for the note Q4 roadmap">
      <div className="fx-head">
        <span className="fx-title">Linked mentions</span>
        <span className="fx-count">3</span>
      </div>
      <ul className="fx-list">
        {rows.map((r) => (
          <li key={r.note} className="fx-row">
            <p className="fx-row-title">
              {r.note}
              <span className="fx-path">{r.path}</span>
            </p>
            <p className="fx-context">
              {r.before}
              <span className="fx-link">{r.link}</span>
              {r.after}
            </p>
          </li>
        ))}
      </ul>
      <div className="fx-head fx-head-quiet">
        <span className="fx-title">Unlinked mentions</span>
        <span className="fx-count">1</span>
      </div>
      <p className="fx-context fx-pad">
        Budget review: “the <Hit>Q4 roadmap</Hit> still lists two hires” <span className="fx-action">Link</span>
      </p>
    </figure>
  );
}

export function GraphFragment() {
  return (
    <figure data-ui className="fx fx-graph" aria-label="The graph view, filtered to one tag">
      <div className="fx-head">
        <span className="fx-title">Graph</span>
        <span className="fx-field">
          <span className="fx-field-k">Filter</span> tag:#planning
        </span>
      </div>
      <VaultAtlas width={560} height={300} count={38} seed={3} decorative className="fx-graph-svg" />
      <p className="fx-foot">38 notes · 61 links · list view for keyboard and screen readers</p>
    </figure>
  );
}

export function SearchFragment() {
  const results = [
    {
      name: "Q4 roadmap",
      path: "Projects/Q4 roadmap.md",
      snip: (
        <>
          …the <Hit>launch date</Hit> moves to 4 December once the beta closes…
        </>
      ),
    },
    {
      name: "Weekly sync",
      path: "Meetings/Weekly sync.md",
      snip: (
        <>
          Agreed a new <Hit>launch date</Hit>; Mira sends the release notes.
        </>
      ),
    },
    {
      name: "2026-11-13",
      path: "Daily notes/2026-11-13.md",
      snip: (
        <>
          Call with design about the <Hit>launch date</Hit> banner.
        </>
      ),
    },
  ];
  return (
    <figure data-ui className="fx fx-search" aria-label="Search results for a query with operators">
      <code className="fx-query">
        <span className="fx-op">tag:</span>planning &quot;launch date&quot; <span className="fx-op">-</span>draft
      </code>
      <p className="fx-foot fx-foot-top">3 notes match</p>
      <ul className="fx-list">
        {results.map((r, i) => (
          <li key={r.name} className={i === 0 ? "fx-row fx-row-on" : "fx-row"}>
            <p className="fx-row-title">
              {r.name}
              <span className="fx-path">{r.path}</span>
            </p>
            <p className="fx-context">{r.snip}</p>
          </li>
        ))}
      </ul>
    </figure>
  );
}

export function CanvasFragment() {
  // x, y, w on a 600 x 260 board; nx, ny, nw on the 320 x 380 board a phone shows.
  const cards = [
    { x: 24, y: 28, w: 196, nx: 8, ny: 12, nw: 170, t: "Q4 roadmap", b: "Launch on 4 December" },
    { x: 290, y: 18, w: 188, nx: 150, ny: 112, nw: 162, t: "Beta feedback", b: "12 notes, #research" },
    { x: 150, y: 168, w: 210, nx: 8, ny: 214, nw: 170, t: "Release notes", b: "Draft, owner: Mira" },
    { x: 420, y: 150, w: 150, nx: 168, ny: 300, nw: 144, t: "Launch day", b: "Checklist" },
  ];
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const grid = (id: string, w: number, h: number) => (
    <>
      <defs>
        <pattern id={id} width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="10" cy="10" r="1" className="fx-grid-dot" />
        </pattern>
      </defs>
      <rect width={w} height={h} fill={`url(#${id})`} />
    </>
  );
  return (
    <figure data-ui className="fx fx-canvas" aria-label="A canvas with four cards joined by arrows">
      <div className="fx-head">
        <span className="fx-title">Launch.canvas</span>
        <span className="fx-path">4 cards · 3 edges</span>
      </div>
      <div className="fx-canvas-stage">
        <svg viewBox="0 0 600 260" className="fx-canvas-lines fx-canvas-wide" aria-hidden="true" preserveAspectRatio="none">
          {grid("fx-grid-wide", 600, 260)}
          <path d="M220 60 C 255 60, 260 50, 290 50" />
          <path d="M122 92 C 122 130, 200 140, 230 168" />
          <path d="M360 200 C 390 200, 395 190, 420 190" />
        </svg>
        <svg viewBox="0 0 320 380" className="fx-canvas-lines fx-canvas-narrow" aria-hidden="true" preserveAspectRatio="none">
          {grid("fx-grid-narrow", 320, 380)}
          <path d="M120 72 C 120 100, 200 96, 220 112" />
          <path d="M60 72 C 40 140, 50 180, 70 214" />
          <path d="M150 258 C 180 270, 210 280, 230 300" />
        </svg>
        {cards.map((c, i) => (
          <div
            key={c.t}
            className={i === 0 ? "fx-card fx-card-on" : "fx-card"}
            style={
              {
                left: pct(c.x, 600),
                top: pct(c.y, 260),
                width: pct(c.w, 600),
                "--nx": pct(c.nx, 320),
                "--ny": pct(c.ny, 380),
                "--nw": pct(c.nw, 320),
              } as React.CSSProperties
            }
          >
            <p className="fx-card-t">{c.t}</p>
            <p className="fx-card-b">{c.b}</p>
          </div>
        ))}
      </div>
    </figure>
  );
}

export function PhoneFragment() {
  return (
    <figure data-ui className="fx fx-phone" aria-label="A note open on a phone">
      <div className="fx-phone-bar">
        <span>Weekly sync</span>
        <span className="fx-phone-dot" aria-hidden="true" />
      </div>
      <div className="fx-phone-body">
        <p className="fx-phone-h">Weekly sync</p>
        <p className="fx-phone-p">
          Launch moves to <span className="fx-link">the Q4 plan</span>.
        </p>
        <p className="fx-phone-task fx-phone-done">
          <span className="fx-box" aria-hidden="true" /> Draft the release notes
        </p>
        <p className="fx-phone-task">
          <span className="fx-box" aria-hidden="true" /> Ask <span className="fx-link">Mira Chen</span> about the beta
        </p>
        <p className="fx-phone-p">
          <span className="fx-tag">#planning</span> <span className="fx-tag">#team</span>
        </p>
        <p className="fx-phone-status">Saved on this phone · syncs when online</p>
      </div>
      <div className="fx-phone-nav" aria-hidden="true">
        <span>Files</span>
        <span>Search</span>
        <span className="fx-phone-nav-on">Note</span>
        <span>Graph</span>
      </div>
    </figure>
  );
}

export function FilesFragment() {
  return (
    <figure data-ui className="fx fx-files" aria-label="An exported vault, as files">
      <div className="fx-head">
        <span className="fx-title">my-vault.zip</span>
        <span className="fx-path">plain .md files</span>
      </div>
      <ul className="fx-tree">
        <li className="fx-dir">Daily notes</li>
        <li className="fx-file fx-in">2026-11-13.md</li>
        <li className="fx-dir">Meetings</li>
        <li className="fx-file fx-in">Weekly sync.md</li>
        <li className="fx-dir">Projects</li>
        <li className="fx-file fx-in">Project kickoff.md</li>
        <li className="fx-file fx-in fx-row-on">Q4 roadmap.md</li>
        <li className="fx-file fx-in">Launch.canvas</li>
        <li className="fx-dir">attachments</li>
        <li className="fx-file fx-in">beta-chart.png</li>
      </ul>
    </figure>
  );
}
