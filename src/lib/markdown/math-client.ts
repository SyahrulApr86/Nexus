/**
 * Math in the reading view. The renderer leaves formulas as `code.math-inline` and
 * `code.math-display`; KaTeX and its stylesheet load only when a note has one.
 * trust is off, so \href, \url and the \html* commands stay disabled.
 */

type Katex = (typeof import("katex"))["default"];

let loading: Promise<Katex> | null = null;

const OPTIONS = { trust: false, strict: "warn", throwOnError: false, maxSize: 20, maxExpand: 500, errorColor: "var(--negative)" } as const;

export async function renderMath(root: HTMLElement, signal: { cancelled: boolean }): Promise<void> {
  const nodes = [...root.querySelectorAll<HTMLElement>("code.math-inline, code.math-display")];
  if (!nodes.length) return;
  loading ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([m]) => m.default);
  let katex: Katex;
  try {
    katex = await loading;
  } catch {
    loading = null;
    return; // the formulas stay readable as source
  }
  if (signal.cancelled) return;
  for (const code of nodes) {
    if (!code.isConnected) continue;
    const display = code.classList.contains("math-display");
    const out = document.createElement(display ? "div" : "span");
    out.className = display ? "math math-block" : "math";
    katex.render(code.textContent ?? "", out, { ...OPTIONS, displayMode: display });
    const target = display && code.parentElement?.tagName === "PRE" ? code.parentElement : code;
    target.replaceWith(out);
  }
}
