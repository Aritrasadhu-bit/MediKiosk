"use client";

import { useEffect } from "react";
import { hydrateOutbox } from "@/lib/outbox";

const KIOSK_ID_KEY = "medikiosk_kiosk_id";
const BEAT_MS = 60_000;

function kioskId(): string {
  try {
    let id = window.localStorage.getItem(KIOSK_ID_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? `kiosk-${crypto.randomUUID().slice(0, 8)}`
          : `kiosk-${Date.now().toString(36)}`;
      window.localStorage.setItem(KIOSK_ID_KEY, id);
    }
    return id;
  } catch {
    return "kiosk-unknown";
  }
}

/**
 * Silent fleet heartbeat: every minute (and on visibility return) tells the
 * server this kiosk is alive plus how many writes are still queued. No PHI,
 * no UI, failures swallowed — it must never disturb a patient session.
 */
export default function KioskHeartbeat() {
  useEffect(() => {
    let cancelled = false;
    const beat = async () => {
      try {
        const pending = hydrateOutbox().filter((i) => !i.gaveUp).length;
        await fetch("/api/kiosk/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kioskId: kioskId(), pending }),
        });
      } catch {
        /* offline — next beat retries */
      }
      if (!cancelled) timer = window.setTimeout(beat, BEAT_MS);
    };
    let timer = window.setTimeout(beat, 5_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void beat();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
