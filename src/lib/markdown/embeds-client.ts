import { extractSection } from "./embeds";

/** Loads a note by wikilink target; null when it does not exist. */
export type EmbedLoader = (target: string) => Promise<{ id: string; content: string } | null>;

type Options = {
  load: EmbedLoader;
  /** Renders markdown to sanitised HTML (the same pipeline as the reading view). */
  render: (md: string) => string;
  signal: { cancelled: boolean };
  /** Called with each filled embed body, e.g. to draw diagrams inside it. */
  onRendered?: (body: HTMLElement) => void;
  depth?: number;
  chain?: string[];
};

/** How many embed levels are drawn: an embed inside an embed, and no deeper. */
export const MAX_EMBED_DEPTH = 2;

function say(body: HTMLElement, message: string) {
  body.textContent = message;
  body.classList.add("embed-note");
}

/**
 * Fill the embed placeholders that belong directly to `root` (not those inside a
 * nested embed body), then recurse into what was filled. Every write checks the
 * signal, so a re-render cancels work that is still in flight.
 */
export async function hydrateEmbeds(root: HTMLElement, opts: Options): Promise<void> {
  const depth = opts.depth ?? 0;
  const chain = opts.chain ?? [];
  const rootBody = root.classList.contains("embed-body") ? root : null;
  const embeds = [...root.querySelectorAll<HTMLElement>(".embed[data-embed]")].filter(
    (el) => (el.parentElement?.closest(".embed-body") ?? null) === rootBody,
  );

  await Promise.all(
    embeds.map(async (el) => {
      const body = el.querySelector<HTMLElement>(":scope > .embed-body");
      // "loading" left behind by a cancelled run is picked up again; finished states are kept.
      if (!body || (el.dataset.embedState && el.dataset.embedState !== "loading")) return;
      el.dataset.embedState = "loading";
      if (el.hasAttribute("data-embed-missing")) {
        el.dataset.embedState = "missing";
        return;
      }
      if (depth >= MAX_EMBED_DEPTH) {
        say(body, "Embedded too deeply to show here. Open the note to read it.");
        el.dataset.embedState = "deep";
        return;
      }
      const target = el.dataset.embed ?? "";
      const hash = target.indexOf("#");
      const name = (hash === -1 ? target : target.slice(0, hash)).trim();
      const heading = hash === -1 ? "" : target.slice(hash + 1).trim();

      let note: { id: string; content: string } | null = null;
      try {
        note = await opts.load(name);
      } catch {
        if (!opts.signal.cancelled) say(body, "Couldn’t load this note. Reopen the note to try again.");
        el.dataset.embedState = "error";
        return;
      }
      if (opts.signal.cancelled) return;
      if (!note) {
        say(body, "Not created yet. Select the title to create it.");
        el.dataset.embedState = "missing";
        return;
      }
      if (chain.includes(note.id)) {
        say(body, "This note embeds itself, so it isn’t repeated here.");
        el.dataset.embedState = "cycle";
        return;
      }
      const md = heading ? extractSection(note.content, heading) : note.content;
      if (md === null) {
        say(body, `There is no heading “${heading}” in this note.`);
        el.dataset.embedState = "missing";
        return;
      }
      if (!md.trim()) {
        say(body, "This note is empty.");
        el.dataset.embedState = "empty";
        return;
      }
      body.classList.remove("embed-note");
      body.innerHTML = opts.render(md);
      el.dataset.embedState = "ready";
      opts.onRendered?.(body);
      await hydrateEmbeds(body, { ...opts, depth: depth + 1, chain: [...chain, note.id] });
    }),
  );
}
