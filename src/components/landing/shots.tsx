import { Icon } from "./icons";

/*
 * Real captures of the workspace in its dark theme, taken at 2x from a seeded copy of the sample
 * vault the page uses throughout (Q4 roadmap, Weekly sync, Mira Chen…). Used where the product
 * itself reads better than a drawing: the live graph and the phone layout. AVIF first, WebP as the
 * fallback; width and height are the CSS size, so the layout never shifts while they load.
 */

export function GraphShot() {
  return (
    <figure data-ui className="fx fx-shot">
      <div className="fx-bar">
        <Icon name="graph" size={14} />
        <span className="fx-bar-t">Graph view</span>
        <span className="fx-bar-m">Sample vault</span>
      </div>
      <picture>
        <source media="(max-width: 899px)" type="image/avif" srcSet="/landing/graph-view-narrow.avif" width={588} height={530} />
        <source media="(max-width: 899px)" type="image/webp" srcSet="/landing/graph-view-narrow.webp" width={588} height={530} />
        <source type="image/avif" srcSet="/landing/graph-view.avif" />
        <img
          src="/landing/graph-view.webp"
          width={1088}
          height={530}
          loading="lazy"
          decoding="async"
          className="fx-shot-img"
          alt="The Nexus graph view of a sample vault. The open note, Q4 roadmap, is ringed in blue and hovered, so its links to Weekly sync, Mira Chen, Project kickoff, Budget review, Interview synthesis and the daily notes light up blue while the rest of the vault dims."
        />
      </picture>
    </figure>
  );
}

export function PhoneShot() {
  return (
    <figure data-ui className="fx fx-phone-shot">
      <picture>
        <source type="image/avif" srcSet="/landing/phone-note.avif" />
        <img
          src="/landing/phone-note.webp"
          width={390}
          height={844}
          loading="lazy"
          decoding="async"
          alt="Weekly sync open in the Nexus phone layout: a link to the Q4 plan, four tasks with the first one done, a Decisions section with links to Pricing model and Bima Pratama, a quote, and the tags #planning and #team. Back, Forward, Find, New and Commands sit along the bottom."
        />
      </picture>
    </figure>
  );
}
