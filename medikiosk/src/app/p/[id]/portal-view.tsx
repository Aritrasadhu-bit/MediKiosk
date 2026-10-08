"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PictogramStrip from "@/components/PictogramStrip";
import PrakritiRadar from "@/components/PrakritiRadar";
import { Icon } from "@/components/Icon";
import type { AyushHistory } from "@/lib/types";

type PortalRecord = {
  encounterId: string;
  name: string;
  age: number;
  sex: string;
  department: string;
  abhaId: string;
  token: string;
  status: string;
  enteredAt: string;
  summary: string;
  vitals: Record<string, number>;
  redFlags: { symptom: string; severity: string; message: string }[];
  prescription: { diagnosis?: string; medications?: { name: string; dosage?: string; frequency?: string; duration?: string }[] } | null;
  consentGranted: boolean;
  consent: { granted?: string[]; decidedAt?: string; purpose?: string; expiresAt?: string; revokedAt?: string } | null;
  visibleToClinicians: boolean;
  dispensedAt: string | null;
  queuePosition: number;
  historySections: { chiefComplaint: string; hpi: string };
  mode?: "allopathic" | "ayush";
  ayush?: AyushHistory | null;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting to be seen",
  triage: "With the nurse",
  confirmed: "Seen by the doctor",
  er: "Routed to Emergency",
};

export function PatientPortalView({ encounterId, code }: { encounterId: string; code: string }) {
  const [record, setRecord] = useState<PortalRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consentMsg, setConsentMsg] = useState<string | null>(null);
  const [abdmMsg, setAbdmMsg] = useState<string | null>(null);
  const [msgTone, setMsgTone] = useState<"info" | "error">("info");
  const [abdmBusy, setAbdmBusy] = useState(false);
  // Live queue position: the record snapshot goes stale the moment the queue
  // moves, so re-check the public position feed while still waiting.
  const [liveQueue, setLiveQueue] = useState<{ position: number; etaMin: number } | null>(null);

  useEffect(() => {
    if (!record || (record.status !== "pending" && record.status !== "triage") || !record.token) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/queue/position/${encodeURIComponent(record.token)}`, { cache: "no-store" });
        const json = await res.json();
        if (!alive) return;
        if (json?.found) setLiveQueue({ position: json.position, etaMin: json.etaMin });
      } catch {
        /* offline — keep last known position */
      }
    };
    load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [record]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/patient/portal/${encounterId}?code=${encodeURIComponent(code)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (!alive) return;
        if (!json.ok) {
          setError(json.error ?? "Could not load your record.");
          return;
        }
        setRecord(json.record);
      })
      .catch(() => alive && setError("Could not load your record."));
    return () => {
      alive = false;
    };
  }, [encounterId, code]);

  const toggleConsent = async (consent: boolean) => {
    setMsgTone("info");
    setConsentMsg(
      consent
        ? "Granting access…"
        : "Revoking access… This is effective immediately — we will confirm once the hospital can no longer see your history."
    );
    const res = await fetch(`/api/patient/portal/${encounterId}/consent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, consent }),
    });
    const json = await res.json();
    if (json.ok) {
      setRecord((r) => (r ? { ...r, consentGranted: consent, consent: json.consent ?? r.consent } : r));
      setConsentMsg(
        consent
          ? "Access granted. Your doctor can view this record."
          : "Access revoked. Your clinical history is now withheld from doctor, nurse and pharmacy screens. You stay in the queue, and nothing you previously shared is deleted."
      );
    } else {
      setMsgTone("error");
      setConsentMsg(`${json.error ?? "Could not update consent."}`);
    }
  };

  const sendToAbdm = async () => {
    setAbdmBusy(true);
    setAbdmMsg(null);
    setMsgTone("info");
    try {
      const res = await fetch(`/api/abdm/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encounterId, code }),
      });
      const json = await res.json();
      if (json.ok) {
        // `delivered` is false in this build — the payload is constructed
        // locally, not submitted to the ABDM gateway. Say so.
        setAbdmMsg(
          json.delivered
            ? `Sent to your ABDM app. Consent ${json.consentId}, FHIR bundle has ${json.fhir?.total ?? "?"} resources.`
            : `Prepared your ABHA health-information payload in the ABDM wire format (consent ${json.consentId}, ${json.fhir?.total ?? "?"} FHIR resources). This build does not connect to the ABDM gateway, so nothing was uploaded to the national server. It stays on this hospital's system.`
        );
      } else {
        setMsgTone("error");
        setAbdmMsg(`${json.error ?? "ABDM request failed."}`);
      }
    } catch {
      setMsgTone("error");
      setAbdmMsg("ABDM request failed.");
    } finally {
      setAbdmBusy(false);
    }
  };

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-sunken p-6 text-center">
        <Icon name="lock" size={40} className="text-ink-3" />
        <h1 className="text-2xl font-bold text-ink">This record is protected</h1>
        <p className="max-w-md text-ink-2">{error}</p>
        <Link href="/" className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover">
          <Icon name="arrowLeft" size={15} /> Back to kiosk
        </Link>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="spinner h-10 w-10" role="status" aria-label="Loading your record" />
      </div>
    );
  }

  const vitals = Object.entries(record.vitals).filter(([, v]) => v !== undefined && v !== null);

  return (
    <div className="min-h-screen bg-sunken px-4 py-8">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="section-label mb-0.5">MediKiosk · patient portal</p>
            <h1 className="text-xl font-semibold tracking-tight text-ink">My Health Record</h1>
          </div>
          <Link href="/" className="btn btn-secondary btn-sm">
            <Icon name="arrowLeft" size={14} /> Kiosk
          </Link>
        </div>

        {/* Status card */}
        <div className="panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-lg font-bold text-ink">{record.name}</p>
              <p className="field-label">{record.age} yrs · {record.sex} · {record.department}</p>
              <p className="mt-1 font-mono text-xs text-ink-3">ABHA: {record.abhaId}</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-black tracking-wide text-success">{record.token}</p>
              <span className="mt-1 inline-block rounded-full bg-success-subtle px-2 py-0.5 text-xs font-bold text-success">
                {STATUS_LABEL[record.status] ?? record.status}
              </span>
            </div>
          </div>

          {(() => {
            const queue =
              liveQueue ??
              (record.queuePosition > 0
                ? { position: record.queuePosition, etaMin: Math.max(5, record.queuePosition * 7) }
                : null);
            if ((record.status !== "pending" && record.status !== "triage") || !queue) return null;
            return (
              <div className="mt-4 rounded-xl bg-info-subtle p-3 text-sm text-info">
                <Icon name="ticket" size={15} className="mt-0.5" /> You are number{" "}
                <strong>{queue.position}</strong> in the queue — about{" "}
                <strong>~{queue.etaMin} min</strong>.
              </div>
            );
          })()}
          {record.status === "er" && (
            <div className="mt-4 rounded-xl bg-critical-subtle p-3 text-sm font-semibold text-critical">
              <strong>Please proceed to the Emergency department right away.</strong>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => toggleConsent(!record.consentGranted)}
              className={record.consentGranted ? "btn btn-warning" : "btn btn-primary"}
            >
              <Icon name={record.consentGranted ? "lock" : "checkCircle"} size={15} />
              {record.consentGranted ? "Revoke consent" : "Grant consent"}
            </button>
            <a
              href={`/api/patient/portal/${record.encounterId}/fhir?code=${encodeURIComponent(code)}`}
              className="btn btn-secondary"
            >
              <Icon name="download" size={15} /> Download FHIR record
            </a>
            <button onClick={sendToAbdm} disabled={abdmBusy} className="btn btn-secondary">
              <Icon name="upload" size={15} /> {abdmBusy ? "Preparing…" : "Prepare my ABHA record (ABDM format)"}
            </button>
            <button onClick={() => window.print()} className="btn btn-secondary">
              <Icon name="printer" size={15} /> Print this page
            </button>
          </div>
          {consentMsg && (
            <p className={`mt-2 text-[13px] ${msgTone === "error" ? "text-critical" : "text-ink-2"}`}>
              {consentMsg}
            </p>
          )}
          {abdmMsg && (
            <p className={`mt-2 text-[13px] ${msgTone === "error" ? "text-critical" : "text-ink-2"}`}>
              {abdmMsg}
            </p>
          )}
          <p className="mt-3 text-xs text-ink-3">
            Consent controls who at the hospital may view this record (DPDP 2023 s.6). Revoking is enforced by the
            server: the clinical history is withheld from doctor, nurse and pharmacy screens, while your place in
            the queue is kept so you are still called.
          </p>
        </div>

        {/* Summary */}
        <div className="panel mt-4 p-5">
          <h2 className="panel-title mb-3"><Icon name="note" size={15} className="text-ink-3" />Clinical summary</h2>
          {record.historySections.chiefComplaint && (
            <p className="text-[13px] text-ink-2"><strong>Chief complaint:</strong> {record.historySections.chiefComplaint}</p>
          )}
          {record.historySections.hpi && (
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink-2"><strong>History:</strong> {record.historySections.hpi.slice(0, 600)}</p>
          )}
          {record.summary ? (
            <p className="mt-3 whitespace-pre-wrap text-sm text-ink-2">{record.summary}</p>
          ) : (
            <p className="text-[13px] text-ink-3">Summary not yet generated.</p>
          )}
          {vitals.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {vitals.map(([k, v]) => (
                <span key={k} className="rounded-lg bg-sunken px-2 py-1 text-xs font-semibold text-ink-2">
                  {k}: {v}
                </span>
              ))}
            </div>
          )}
          {record.redFlags.length > 0 && (
            <div className="mt-4 rounded-xl bg-critical-subtle p-3 text-xs text-critical">
              {record.redFlags.map((f, i) => (
                <p key={i}><strong>{f.symptom}</strong> — {f.message}</p>
              ))}
            </div>
          )}
          {record.ayush && (
            <div className="mt-4">
              <PrakritiRadar ayush={record.ayush} />
            </div>
          )}
        </div>

        {/* Prescription */}
        {record.prescription && (
          <div className="panel mt-4 p-5">
            <h2 className="panel-title mb-3"><Icon name="pill" size={15} className="text-ink-3" />Prescription {record.dispensedAt ? "(dispensed)" : ""}</h2>
            {record.prescription.diagnosis && <p className="text-[13px] text-ink-2"><strong>Diagnosis:</strong> {record.prescription.diagnosis}</p>}
            <ul className="mt-2 flex flex-col gap-1.5">
              {(record.prescription.medications ?? []).map((m, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 text-sm text-ink">
                  <span className="font-semibold">{m.name}</span>
                  {m.dosage && <span className="text-ink-2">{m.dosage}</span>}
                  {m.frequency && <span className="rounded bg-sunken px-1.5 text-xs text-ink-2">{m.frequency}</span>}
                  {m.duration && <span className="text-[12px] text-ink-3">{m.duration}</span>}
                </li>
              ))}
            </ul>
            {/* Low-literacy pictogram instructions (Batch B, U3) */}
            {(record.prescription.medications ?? []).length > 0 && (
              <div className="mt-4 rounded-lg border border-line bg-sunken p-3">
                <p className="mb-2 flex items-center gap-1.5 section-label">
                  <Icon name="lightbulb" size={13} className="text-ink-3" />
                  How to take your medicine
                </p>
                <PictogramStrip medications={record.prescription.medications as never} />
              </div>
            )}
          </div>
        )}

        <p className="mt-6 text-center text-xs text-ink-3">
          MediKiosk · Your data stays in this hospital&apos;s secure store. Contact the hospital to delete your record.
        </p>
      </div>
    </div>
  );
}