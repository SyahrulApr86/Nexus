/**
 * Mermaid diagrams in the reading view. The library is imported only when a note
 * contains a ```mermaid block, rendered with securityLevel "strict" (its output is
 * sanitised by Mermaid itself), and themed from the app's CSS tokens.
 */

type Mermaid = (typeof import("mermaid"))["default"];

let loading: Promise<Mermaid> | null = null;
let seq = 0;
// Rendered SVG by theme and source, so re-renders (task toggles, tree refreshes) are free.
const cache = new Map<string, string>();

const KINDS: [RegExp, string][] = [
  [/^(graph|flowchart)\b/, "Flowchart"],
  [/^sequenceDiagram\b/, "Sequence diagram"],
  [/^classDiagram/, "Class diagram"],
  [/^stateDiagram/, "State diagram"],
  [/^erDiagram\b/, "Entity relationship diagram"],
  [/^gantt\b/, "Gantt chart"],
  [/^pie\b/, "Pie chart"],
  [/^journey\b/, "User journey"],
  [/^mindmap\b/, "Mind map"],
  [/^timeline\b/, "Timeline"],
  [/^gitGraph\b/, "Git graph"],
];

function describe(source: string) {
  const first = source
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("%%"));
  return KINDS.find(([re]) => re.test(first ?? ""))?.[1] ?? "Diagram";
}

function token(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function themeVariables() {
  const sheet = token("--sheet", "#ffffff");
  const fg = token("--fg", "#02070a");
  return {
    darkMode: getComputedStyle(document.documentElement).colorScheme === "dark",
    background: sheet,
    fontFamily: "var(--font-ui), ui-sans-serif, sans-serif",
    fontSize: "14px",
    primaryColor: token("--accent-soft", "#e1f3fb"),
    primaryBorderColor: token("--accent", "#0297de"),
    primaryTextColor: fg,
    secondaryColor: token("--code-bg", "#eef2f5"),
    secondaryBorderColor: token("--control", "#7d8c99"),
    secondaryTextColor: fg,
    tertiaryColor: token("--hover", "#e9eef2"),
    tertiaryBorderColor: token("--control", "#7d8c99"),
    tertiaryTextColor: fg,
    lineColor: token("--muted", "#45525d"),
    textColor: fg,
    mainBkg: token("--accent-soft", "#e1f3fb"),
    nodeBorder: token("--accent", "#0297de"),
    clusterBkg: token("--code-bg", "#eef2f5"),
    clusterBorder: token("--border", "#dce3e9"),
    titleColor: fg,
    edgeLabelBackground: sheet,
    noteBkgColor: token("--mark-soft", "#ffe8e0"),
    noteTextColor: fg,
    noteBorderColor: token("--mark", "#fc734d"),
    actorBkg: token("--accent-soft", "#e1f3fb"),
    actorBorder: token("--accent", "#0297de"),
    actorTextColor: fg,
    actorLineColor: token("--muted", "#45525d"),
    signalColor: fg,
    signalTextColor: fg,
    labelBoxBkgColor: token("--code-bg", "#eef2f5"),
    labelBoxBorderColor: token("--control", "#7d8c99"),
    labelTextColor: fg,
    loopTextColor: fg,
    activationBkgColor: token("--hover", "#e9eef2"),
    activationBorderColor: token("--control", "#7d8c99"),
    sequenceNumberColor: sheet,
    // Flat like the rest of the app: no shadows on things at rest.
    dropShadow: "none",
  };
}

function showError(pre: HTMLElement, message: string) {
  let note = pre.previousElementSibling as HTMLElement | null;
  if (!note?.classList.contains("mermaid-error")) {
    note = document.createElement("p");
    note.className = "mermaid-error";
    pre.before(note);
  }
  const lines = message.split("\n").map((l) => l.trim()).filter(Boolean);
  const first = lines[0] ?? "unknown error";
  // Parser errors end with "Expecting …, got 'X'": name the unexpected token, not the whole grammar.
  const got = lines.find((l) => /^Expecting\b/.test(l))?.match(/got '([^']+)'/)?.[1];
  const text = got
    ? `${first.replace(/:$/, "")}: ${got === "EOF" ? "the diagram ends too early" : `unexpected “${got}”`}`
    : first;
  note.textContent = `Couldn’t draw this diagram: ${text.length > 180 ? `${text.slice(0, 177)}…` : text}`;
  pre.hidden = false;
}

/** Draw (or redraw, after a theme change) every ```mermaid block under `root`. */
export async function renderMermaid(root: HTMLElement, signal: { cancelled: boolean }): Promise<void> {
  const blocks = [...root.querySelectorAll<HTMLElement>("pre > code.language-mermaid")];
  if (!blocks.length) return;
  loading ??= import("mermaid").then((m) => m.default);
  let mermaid: Mermaid;
  try {
    mermaid = await loading;
  } catch {
    loading = null;
    if (!signal.cancelled) blocks.forEach((code) => showError(code.parentElement!, "the diagram library failed to load"));
    return;
  }
  if (signal.cancelled) return;
  const vars = themeVariables();
  const themeKey = JSON.stringify(vars);
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: "base",
    themeVariables: vars,
    fontFamily: "var(--font-ui), ui-sans-serif, sans-serif",
  });

  for (const code of blocks) {
    const pre = code.parentElement as HTMLElement;
    const source = code.textContent ?? "";
    let host = pre.previousElementSibling as HTMLElement | null;
    if (host?.classList.contains("mermaid-error")) host = host.previousElementSibling as HTMLElement | null;
    if (!host?.classList.contains("mermaid-diagram")) {
      host = document.createElement("div");
      host.className = "mermaid-diagram";
      pre.before(host);
    }
    try {
      const key = `${themeKey}\u0000${source}`;
      let svg = cache.get(key);
      if (!svg) {
        svg = (await mermaid.render(`nexus-mermaid-${++seq}`, source)).svg;
        if (cache.size > 100) cache.clear();
        cache.set(key, svg);
      }
      if (signal.cancelled) return;
      host.innerHTML = svg;
      host.setAttribute("role", "img");
      host.setAttribute("aria-label", describe(source));
      // The source stays available to assistive tech as the diagram's description.
      if (!pre.id) pre.id = `nexus-mermaid-source-${++seq}`;
      host.setAttribute("aria-describedby", pre.id);
      const err = pre.previousElementSibling;
      if (err?.classList.contains("mermaid-error")) err.remove();
      pre.hidden = true;
    } catch (e) {
      if (signal.cancelled) return;
      host.remove();
      showError(pre, e instanceof Error ? e.message : String(e));
    }
  }
}
