"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "./sw-events";

/** Registers the service worker once the page has loaded. Renders nothing. */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    const run = () => void registerServiceWorker();
    if (document.readyState === "complete") run();
    else window.addEventListener("load", run, { once: true });
    return () => window.removeEventListener("load", run);
  }, []);
  return null;
}
