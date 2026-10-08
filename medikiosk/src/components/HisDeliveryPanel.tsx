"use client";

import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/Icon";

/**
 * Staff-facing HIS/EMR delivery status with a retry control.
 *
 * The patient screen on /done reports delivery truthfully but cannot act on a
 * failure. This panel is the other half: it shows what actually happened to the
 * record and lets a clinician resend it when the transport was down.
 *
 * It deliberately renders only the redacted receipt. The configured FHIR base
 * URL and HL7 host:port are internal infrastructure and are never sent to the
 * browser, so this component has nothing to hide — and cannot accidentally
 * display them either.
 */

type DeliveryState = "delivered" | "failed" | "not_configured" | "no_consent" | "skipped";

type Delivery = {
  state: DeliveryState;
  detail: string;
  at: string;
  attempts?: number;
  status?: number;
};

type HisStatus = {
  ok: boolean;
  configured: boolean;
  mode: "fhir" | "hl7v2" | "off";
  delivery: Delivery;
};

const STATE_STYLE: Record<DeliveryState, { chip: string; icon: IconName; label: string }> = {
  delivered: { chip: "chip-success", icon: "checkCircle", label: "Delivered" },
  failed: { chip: "chip-critical", icon: "alert", label: "Failed" },
  not_configured: { chip: "chip-neutral", icon: "info", label: "Not connected" },
  no_consent: { chip: "chip-warning", icon: "info", label: "No consent" },
  skipped: { chip: "chip-neutral", icon: "info", label: "Not sent yet" },
};

/** Roles the API permits to trigger a (re)send. Mirrors the route's check. */
const CAN_RETRY = ["doctor", "admin", "nurse"];

export function HisDeliveryPanel({ encounterId, role }: { encounterId: string; role?: string }) {
  const [status, setStatus] = useState<HisStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/his/${encodeURIComponent(encounterId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (alive && json) setStatus(json as HisStatus);
      })
      // Offline or aborted — keep whatever was last shown rather than
      // blanking the panel and implying the record status changed.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [encounterId]);

  const retry = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/his/${encodeURIComponent(encounterId)}`, { method: "POST" });
      const json = (await res.json()) as HisStatus & { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Could not send the record.");
      } else if (json.delivery) {
        setStatus((prev) => (prev ? { ...prev, delivery: json.delivery } : prev));
      }
    } catch {
      setError("Network error — the record is safe on this device. Try again when connected.");
    } finally {
      setBusy(false);
    }
  };

  if (!status)
    return (
      <section className="panel p-4" aria-label="Hospital system delivery" aria-busy="true">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
          <Icon name="link" size={15} className="text-ink-3" />
          Hospital system
        </div>
        {error ? (
          <p className="mt-2 text-[12px] font-medium text-critical" role="alert">{error}</p>
        ) : (
          <p className="mt-2 flex items-center gap-2 text-[12px] text-ink-3">
            <span className="spinner h-4 w-4" aria-hidden="true" /> Checking delivery status…
          </p>
        )}
      </section>
    );

  const delivery = status.delivery;
  const style = STATE_STYLE[delivery?.state ?? "skipped"] ?? STATE_STYLE.skipped;
  const mayRetry = role === undefined || CAN_RETRY.includes(role);
  const retryable =
    mayRetry && (delivery?.state === "failed" || delivery?.state === "no_consent" || delivery?.state === "skipped");

  return (
    <section className="panel p-4" aria-label="Hospital system delivery">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
          <Icon name="link" size={15} className="text-ink-3" />
          Hospital system
        </span>
        <span className={`chip ${style.chip}`}>
          <Icon name={style.icon} size={12} />
          {style.label}
        </span>
      </div>

      <p className="mt-2 text-[12px] leading-relaxed text-ink-2">{delivery?.detail}</p>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
        <span>
          Transport:{" "}
          {status.mode === "fhir" ? "FHIR R4" : status.mode === "hl7v2" ? "HL7 v2" : "Not configured"}
        </span>
        {delivery?.at && <span>Last attempt {new Date(delivery.at).toLocaleString("en-IN")}</span>}
        {typeof delivery?.attempts === "number" && <span>{delivery.attempts} attempt(s)</span>}
        {typeof delivery?.status === "number" && <span>HTTP {delivery.status}</span>}
      </div>

      {!status.configured && (
        <p className="mt-2 rounded-md border border-line bg-sunken px-2.5 py-2 text-[11px] text-ink-2">
          No hospital system is connected to this kiosk. Records are stored here and can be exported later.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-2 rounded-md border border-critical/30 bg-critical/5 px-2.5 py-2 text-[11px] text-critical">
          {error}
        </p>
      )}

      {retryable && (
        <button onClick={retry} disabled={busy} className="btn btn-secondary btn-sm mt-3">
          <Icon name="refresh" size={13} />
          {busy ? "Sending…" : delivery?.state === "failed" ? "Retry send" : "Send to hospital system"}
        </button>
      )}
    </section>
  );
}
