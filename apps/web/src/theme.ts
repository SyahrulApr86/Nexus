export type Theme = "light" | "dark" | "system";

export function resolveTheme(pref: Theme): "light" | "dark" {
  if (pref !== "system") return pref;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function applyTheme(pref: Theme): void {
  const resolved = resolveTheme(pref);
  document.documentElement.dataset.theme = resolved;
  if (pref === "system") localStorage.removeItem("nexus-theme");
  else localStorage.setItem("nexus-theme", pref);
}

export function currentAppliedTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}
