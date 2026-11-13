import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, JetBrains_Mono, Literata } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegistrar } from "@/components/workspace/offline/sw-registrar";

// Self-hosted at build time by next/font: no request reaches a font CDN at runtime.
const hanken = Hanken_Grotesk({ variable: "--font-hanken", subsets: ["latin"], display: "swap" });
const literata = Literata({
  variable: "--font-literata",
  subsets: ["latin"],
  axes: ["opsz"],
  style: ["normal", "italic"],
  display: "swap",
});
// Italic is loaded too: code inside emphasis and comment tokens is set in the real italic, not a synthesized slant.
const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Nexus", template: "%s · Nexus" },
  description: "Linked markdown notes that open in any browser. Your vault stays plain .md files.",
  // Home-screen name on iOS. "default" status bar: black-translucent would put white status text over the light theme.
  appleWebApp: { title: "Nexus", capable: true, statusBarStyle: "default" },
};

// Frame colours from globals.css (--frame), for the browser bar.
const FRAME = { light: "#f1f4f7", dark: "#02070a" };

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: FRAME.light },
    { media: "(prefers-color-scheme: dark)", color: FRAME.dark },
  ],
};

// Applies a saved theme choice before first paint, so there is no light/dark flash. A manual choice
// also gets its own theme-color tag, kept first in <head> so it wins over the two media-query tags
// above, even after React reorders the head; "Match system" removes it. The observer keeps it in
// step whenever data-theme changes later.
const themeScript = `(function(){var d=document.documentElement,C=${JSON.stringify(FRAME)};try{var t=localStorage.getItem('nexus-theme');if(t==='light'||t==='dark')d.dataset.theme=t}catch(e){}function sync(){var t=d.dataset.theme,m=document.getElementById('nexus-theme-color');if(t!=='light'&&t!=='dark'){if(m)m.remove();return}if(!m){m=document.createElement('meta');m.name='theme-color';m.id='nexus-theme-color'}if(m.content!==C[t])m.content=C[t];if(document.querySelector('meta[name="theme-color"]')!==m)document.head.prepend(m)}sync();var o=new MutationObserver(sync);o.observe(d,{attributes:true,attributeFilter:['data-theme']});o.observe(document.head,{childList:true})})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${hanken.variable} ${literata.variable} ${jetbrains.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="h-full">
        {children}
        {/* Offline support: caches the app shell so the installed app opens without a connection. */}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
