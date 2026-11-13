import type { MetadataRoute } from "next";

// Served at /manifest.webmanifest. Installs Nexus as a standalone app that opens on the vault.
// No service worker yet: the installed app still needs the server, there is no offline mode.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Nexus",
    short_name: "Nexus",
    description:
      "A knowledge base that runs in the browser: markdown notes connected by [[wikilinks]], with backlinks, tags, search, a graph view and daily notes.",
    start_url: "/vault",
    scope: "/",
    display: "standalone",
    background_color: "#02070a",
    theme_color: "#02070a",
    categories: ["productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // The mark sits inside the central 80% circle, so any launcher mask keeps it whole.
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
