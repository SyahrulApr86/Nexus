import { useEffect, useMemo, useRef, useState } from "react";
import { MarkdownPreview } from "./MarkdownPreview.js";

const SCRIPT = `# Systems thinking

A stock is what you can count at a moment.
A flow is what changes it over time.

See also [[Feedback Loops]] and [[Antifragile]]

#reading #q3`;

const LINKS = [
  { targetTitle: "Feedback Loops", targetNoteId: "demo-1" },
  { targetTitle: "Antifragile", targetNoteId: null },
];

/**
 * The landing hero's signature: Nexus typing into itself. Same editor styling
 * and the same preview component the product ships, so the demo cannot drift
 * from reality. Static for anyone who prefers reduced motion.
 */
export function HeroDemo() {
  const reduced = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const [typed, setTyped] = useState(reduced ? SCRIPT : "");
  const frame = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (reduced) return;
    let i = 0;
    let last = performance.now();
    const step = (now: number) => {
      // Human-ish cadence: fast within words, a beat at newlines
      const gap = SCRIPT[i] === "\n" ? 90 : 22;
      if (now - last >= gap) {
        i++;
        setTyped(SCRIPT.slice(0, i));
        last = now;
      }
      if (i < SCRIPT.length) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [reduced]);

  const done = typed.length === SCRIPT.length;

  return (
    <div className="overflow-hidden rounded-card border border-border bg-card shadow-[0_1px_2px_rgba(12,43,100,0.08),0_12px_32px_rgba(12,43,100,0.12)]">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-[14px] font-medium text-ink">
          Systems thinking
        </span>
        <span
          className="text-[12px] text-muted"
          aria-live="polite"
          aria-atomic="true"
        >
          {done ? "Saved" : "Saving…"}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2">
        <div className="min-h-[248px] border-border px-4 py-3 font-mono text-[13px] leading-relaxed text-ink sm:border-r">
          <pre className="whitespace-pre-wrap break-words font-mono">
            {typed}
            {!done && (
              <span
                aria-hidden="true"
                className="ml-px inline-block h-[1.05em] w-[2px] translate-y-[2px] bg-accent align-middle motion-safe:animate-pulse"
              />
            )}
          </pre>
        </div>
        <div className="min-h-[248px] bg-surface/50">
          <MarkdownPreview content={typed} links={LINKS} />
        </div>
      </div>
    </div>
  );
}
