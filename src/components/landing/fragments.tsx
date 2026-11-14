import { VaultAtlas } from "./atlas";
import { Icon } from "./icons";

/*
 * Cropped fragments of the Nexus workspace in its dark theme, drawn at true size from the app's own
 * panes with the sample vault the page uses throughout (Q4 roadmap, Weekly sync, Mira Chen…). Each
 * root carries data-ui: inside it the product's own conventions (1px pane edges, small labels) apply.
 */

function Hit({ children }: { children: string }) {
  return <mark className="fx-hit">{children}</mark>;
}

function Bar({ icon, title, meta }: { icon: Parameters<typeof Icon>[0]["name"]; title: string; meta?: string }) {
  return (
    <div className="fx-bar">
      <Icon name={icon} size={14} />
      <span className="fx-bar-t">{title}</span>
      {meta && <span className="fx-bar-m">{meta}</span>}
    </div>
  );
}

export function BacklinksFragment() {
  const rows = [
    { note: "Weekly sync", path: "Meetings", before: "Launch moves to ", link: "the Q4 plan", after: "." },
    { note: "Project kickoff", path: "Projects", before: "Scope is fixed in ", link: "Q4 roadmap", after: ", the rest goes to Q1." },
    { note: "2026-11-13", path: "Daily notes", before: "Moved ", link: "Q4 roadmap", after: " up a week. #planning" },
  ];
  return (
    <figure data-ui className="fx fx-backlinks" aria-label="The backlinks pane for the note Q4 roadmap">
      <Bar icon="link" title="Backlinks" meta="Q4 roadmap" />
      <p className="fx-sec">
        Linked mentions <b>3</b>
      </p>
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
      <p className="fx-sec">
        Unlinked mentions <b>1</b>
      </p>
      <div className="fx-row fx-row-quiet">
        <p className="fx-row-title">
          Budget review<span className="fx-path">Projects</span>
        </p>
        <p className="fx-context">
          “The <Hit>Q4 roadmap</Hit> still lists two hires.” <span className="fx-action">Link it</span>
        </p>
      </div>
    </figure>
  );
}

export function GraphFragment() {
  return (
    <figure data-ui className="fx fx-graph" aria-label="The graph view of a sample vault">
      <Bar icon="graph" title="Graph view" meta="64 notes · 97 links" />
      <div className="fx-graph-stage">
        <VaultAtlas width={1200} height={520} count={72} seed={7} className="fx-graph-svg fx-graph-wide" />
        <VaultAtlas width={560} height={560} count={44} seed={7} className="fx-graph-svg fx-graph-narrow" />
        <div className="fx-graph-filter">
          <span className="fx-graph-k">Filter</span>
          <span className="fx-graph-q">
            <span className="fx-op">tag:</span>#planning
          </span>
        </div>
        <ul className="fx-legend">
          <li>
            <span className="fx-sw fx-sw-open" /> Open note
          </li>
          <li>
            <span className="fx-sw fx-sw-near" /> Links from it
          </li>
          <li>
            <span className="fx-sw fx-sw-tag" /> Tagged #planning
          </li>
        </ul>
      </div>
    </figure>
  );
}

export function SearchFragment() {
  const results = [
    {
      name: "Q4 roadmap",
      path: "Projects",
      snip: (
        <>
          …the <Hit>launch date</Hit> moves to 4 December once the beta closes…
        </>
      ),
    },
    {
      name: "Weekly sync",
      path: "Meetings",
      snip: (
        <>
          Agreed a new <Hit>launch date</Hit>; Mira sends the release notes.
        </>
      ),
    },
    {
      name: "2026-11-13",
      path: "Daily notes",
      snip: (
        <>
          Call with design about the <Hit>launch date</Hit> banner.
        </>
      ),
    },
  ];
  return (
    <figure data-ui className="fx fx-search" aria-label="Search with operators, and the notes it finds">
      <div className="fx-query">
        <Icon name="search" size={28} className="fx-query-icon" />
        <p className="fx-query-text">
          <span className="fx-op">tag:</span>planning <span className="fx-str">&quot;launch date&quot;</span>{" "}
          <span className="fx-op">-</span>draft
          <span className="fx-caret" aria-hidden="true" />
        </p>
      </div>
      <div className="fx-search-body">
        <p className="fx-sec">
          3 notes match <span className="fx-sec-m">sorted by last edit</span>
        </p>
        <ul className="fx-list">
          {results.map((r, i) => (
            <li key={r.name} className={i === 0 ? "fx-row fx-row-on" : "fx-row"}>
              <p className="fx-row-title">
                <Icon name="file" size={14} />
                {r.name}
                <span className="fx-path">{r.path}</span>
              </p>
              <p className="fx-context">{r.snip}</p>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}

export function CanvasFragment() {
  // x, y, w on a 600 x 300 board; nx, ny, nw on the 320 x 400 board a phone shows.
  const cards = [
    { x: 28, y: 36, w: 190, nx: 10, ny: 14, nw: 170, t: "Q4 roadmap", b: "Launch on 4 December", kind: "on" },
    { x: 300, y: 24, w: 180, nx: 140, ny: 116, nw: 170, t: "Beta feedback", b: "12 notes · #research", kind: "tag" },
    { x: 140, y: 190, w: 200, nx: 10, ny: 226, nw: 170, t: "Release notes", b: "Draft, owner Mira", kind: "" },
    { x: 410, y: 176, w: 160, nx: 150, ny: 316, nw: 160, t: "Launch day", b: "Checklist, 6 tasks", kind: "" },
  ];
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const grid = (id: string, w: number, h: number) => (
    <>
      <defs>
        <pattern id={id} width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="12" cy="12" r="1" className="fx-grid-dot" />
        </pattern>
      </defs>
      <rect width={w} height={h} fill={`url(#${id})`} />
    </>
  );
  return (
    <figure data-ui className="fx fx-canvas" aria-label="A canvas with four cards joined by arrows">
      <Bar icon="canvas" title="Launch.canvas" meta="4 cards · 3 arrows" />
      <div className="fx-canvas-stage">
        <svg viewBox="0 0 600 300" className="fx-canvas-lines fx-canvas-wide" aria-hidden="true" preserveAspectRatio="none">
          {grid("fx-grid-wide", 600, 300)}
          <path d="M218 70 C 258 70, 262 58, 300 58" />
          <path d="M122 104 C 122 150, 210 160, 236 190" />
          <path d="M340 226 C 375 226, 382 212, 410 212" />
        </svg>
        <svg viewBox="0 0 320 400" className="fx-canvas-lines fx-canvas-narrow" aria-hidden="true" preserveAspectRatio="none">
          {grid("fx-grid-narrow", 320, 400)}
          <path d="M120 74 C 120 100, 200 100, 220 116" />
          <path d="M60 74 C 40 140, 50 190, 70 226" />
          <path d="M150 270 C 180 285, 210 300, 230 316" />
        </svg>
        {cards.map((c) => (
          <div
            key={c.t}
            className={`fx-card${c.kind ? ` fx-card-${c.kind}` : ""}`}
            style={
              {
                left: pct(c.x, 600),
                top: pct(c.y, 300),
                width: pct(c.w, 600),
                "--nx": pct(c.nx, 320),
                "--ny": pct(c.ny, 400),
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

/** Two sessions in one note: each cursor carries the name of who is typing. */
export function CollabFragment() {
  return (
    <figure data-ui className="fx fx-collab" aria-label="Two people editing the same note at once">
      <Bar icon="file" title="Release notes" meta="2 editing" />
      <div className="fx-collab-body">
        <p className="fx-collab-h">Release notes, 4 December</p>
        <p className="fx-collab-p">
          Notes you open now stay on the device, so you can keep writing offline.
          <span className="fx-cursor fx-cursor-you">
            <span className="fx-cursor-name">You</span>
          </span>
        </p>
        <p className="fx-collab-p">
          Search understands nested tags
          <span className="fx-cursor fx-cursor-mira">
            <span className="fx-cursor-name">Mira, on her phone</span>
          </span>
        </p>
        <p className="fx-collab-p fx-collab-faint">Known issues: none so far.</p>
      </div>
    </figure>
  );
}

export function FilesFragment() {
  return (
    <figure data-ui className="fx fx-files" aria-label="An exported vault, as plain files">
      <Bar icon="folder" title="my-vault.zip" meta="plain .md files" />
      <ul className="fx-tree">
        <li className="fx-dir">
          <Icon name="folder" size={14} /> Daily notes
        </li>
        <li className="fx-file">2026-11-13.md</li>
        <li className="fx-dir">
          <Icon name="folder" size={14} /> Meetings
        </li>
        <li className="fx-file">Weekly sync.md</li>
        <li className="fx-dir">
          <Icon name="folder" size={14} /> Projects
        </li>
        <li className="fx-file">Project kickoff.md</li>
        <li className="fx-file fx-file-on">Q4 roadmap.md</li>
        <li className="fx-file">Launch.canvas</li>
        <li className="fx-dir">
          <Icon name="folder" size={14} /> attachments
        </li>
        <li className="fx-file">beta-chart.png</li>
      </ul>
    </figure>
  );
}
