"use client";

import { useEffect } from "react";
import { renderMermaid } from "@/lib/markdown/mermaid-client";

/**
 * Draws the shared note's ```mermaid blocks, as the reading view does (securityLevel "strict", no
 * raw HTML), and redraws them when the theme changes. Renders nothing itself.
 */
export function ShareDiagrams() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".sh-body");
    if (!root) return;
    let signal = { cancelled: false };
    const draw = () => {
      signal.cancelled = true;
      signal = { cancelled: false };
      void renderMermaid(root, signal);
    };
    draw();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", draw);
    const observer = new MutationObserver(draw);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      signal.cancelled = true;
      media.removeEventListener("change", draw);
      observer.disconnect();
    };
  }, []);
  return null;
}
