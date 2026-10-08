"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icon";

export default function PwaBootstrap() {
  const [installEvt, setInstallEvt] = useState<Event | null>(null);

  useEffect(() => {
    // Never register a service worker in development.
    //
    // Turbopack's dev chunks are not content-hashed, so a cache-first worker
    // keeps serving the previous bundle under the same URL after every edit —
    // the page gets fresh HTML but stale JS, which surfaces as a phantom
    // hydration error that no amount of hard-reloading can clear.
    if (process.env.NODE_ENV !== "development" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const onInstall = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e);
    };
    // Bound to a named reference: passing an inline arrow to removeEventListener
    // creates a different function object and silently removes nothing, so each
    // mount would leak a listener.
    const onInstalled = () => setInstallEvt(null);
    window.addEventListener("beforeinstallprompt", onInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!installEvt) return null;

  return (
    <button
      onClick={async () => {
        await (installEvt as Event & { prompt?: () => Promise<void> }).prompt?.();
        setInstallEvt(null);
      }}
      className="btn btn-dark fixed bottom-20 right-4 z-40 shadow-md"
    >
      <Icon name="download" size={15} />
      Install MediKiosk (offline-ready)
    </button>
  );
}