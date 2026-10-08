"use client";

import { useEffect, useState } from "react";
import { useSyncStatus } from "@/lib/outbox";
import { STORAGE_FULL_EVENT } from "@/lib/storage";
import { Icon } from "@/components/Icon";

/**
 * Offline / sync-status banner: shown when the kiosk has writes queued because
 * the server could not be reached. Auto-retries with backoff and exposes a
 * manual "Retry now" action.
 */
export default function SyncBanner() {
  const { pending, syncing, failed, detail, retryNow } = useSyncStatus();
  // Sticky for the session: quota almost never recovers without staff help.
  const [storageFull, setStorageFull] = useState(false);
  useEffect(() => {
    const onFull = () => setStorageFull(true);
    window.addEventListener(STORAGE_FULL_EVENT, onFull);
    return () => window.removeEventListener(STORAGE_FULL_EVENT, onFull);
  }, []);

  if (storageFull) {
    return (
      <div className="w-full rounded-lg border border-critical-border bg-critical-subtle px-3.5 py-2.5 text-[13px] text-critical" role="alert">
        <div className="flex items-start gap-2">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          <span>
            <span className="font-semibold">Kiosk storage full · स्टोरेज भर गया</span>
            <span>
              {" "}
              — new records are being kept in memory only. Tell staff and do not close or refresh this page.
            </span>
          </span>
        </div>
      </div>
    );
  }

  if (pending === 0 && failed === 0) return null;

  const reachedLimit = failed > 0;

  return (
    <div
      className={`w-full rounded-lg border px-3.5 py-2.5 text-[13px] ${
        reachedLimit ? "border-critical-border bg-critical-subtle text-critical" : "border-warning-border bg-warning-subtle text-warning"
      }`}
      role="status"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-start gap-2">
          <Icon name={syncing ? "refresh" : "wifiOff"} size={16} className="mt-0.5" />
          <span>
            {reachedLimit ? (
              <>
                <span className="font-semibold">Delivery failed · भेजना असफल</span>
                <span>
                  {" "}
                  — {failed} item{failed > 1 ? "s" : ""} could not be delivered. <span lang="hi">कृपया स्टाफ से कहें।</span> Staff action needed.
                  {detail && <span className="block text-[12px] opacity-90">Reason · कारण: {detail}</span>}
                </span>
              </>
            ) : (
              <>
            <span className="font-semibold">{syncing ? "Syncing… · भेजा जा रहा है…" : "Offline · ऑफ़लाइन"}</span>
            {pending > 0 && (
              <span>
                {" "}
                &mdash; {pending} pending write{pending > 1 ? "s" : ""} queued · <span lang="hi">{pending} पर्ची कतार में — कुछ भी नहीं खोएगा, अपने आप भेजा जाएगा।</span> Nothing is lost; they resend
                automatically.
              </span>
            )}
              </>
            )}
          </span>
        </p>
        <button onClick={retryNow} disabled={syncing} className="btn btn-secondary btn-sm min-h-[44px]">
          <Icon name="refresh" size={14} />
          {syncing ? "Syncing… · भेज रहे…" : "Retry now · पुनः भेजें"}
        </button>
      </div>
    </div>
  );
}
