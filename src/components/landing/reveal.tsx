"use client";

import { useEffect } from "react";

/**
 * Entrance for the parts of each section: elements marked [data-reveal] rise into place as their
 * section enters the screen, staggered by their --d delay. Content is visible without script; this
 * only arms the move after hydration, and never when the reader prefers reduced motion.
 */
export function Reveal() {
  useEffect(() => {
    const root = document.documentElement;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const items = [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
    root.classList.add("lp-motion");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).dataset.in = "";
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    // Next frame, so elements already on screen still play their entrance once.
    const raf = requestAnimationFrame(() => items.forEach((el) => io.observe(el)));
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      root.classList.remove("lp-motion");
    };
  }, []);
  return null;
}
