"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { StaffUser, StoredHistory } from "@/lib/types";
import { staffLogout } from "@/lib/staffLogout";
import { escalationPolicy } from "@/lib/escalation";
import { waitMinutes } from "@/lib/queue";
import { Icon } from "@/components/Icon";
import { AppShell } from "@/components/AppShell";

const VITAL_KEYS: { key: string; label: string; hint: string }[] = [
  { key: "systolic", label: "BP sys (mmHg) · रक्तचाप ऊपर", hint: "Normal 90–120" },
  { key: "diastolic", label: "BP dia (mmHg) · रक्तचाप नीचे", hint: "Normal 60–80" },
  { key: "pulse", label: "Pulse (bpm) · नाड़ी", hint: "Normal 60–100" },
  { key: "spo2", label: "SpO2 (%) · ऑक्सीजन", hint: "Normal ≥95" },
  { key: "temperature", label: "Temp (°C) · बुखार", hint: "Normal 36.1–37.2" },
  { key: "weight", label: "Weight (kg) · वज़न", hint: "kg" },
];

export default function TriagePage() {
  const router = useRouter();
  const [user, setUser] = useState<StaffUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [encounters, setEncounters] = useState<StoredHistory[]>([]);
  const [selected, setSelected] = useState<StoredHistory | null>(null);
  const [vitals, setVitals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const me = await fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ ok: false }));
      if (!me.ok || !["nurse", "doctor", "admin"].includes(me.user?.role ?? "")) {
        router.replace("/login");
        return;
      }
      setUser(me.user);
      const enc = await fetch("/api/encounters", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ encounters: [] as StoredHistory[] }));
      setEncounters(enc.encounters ?? []);
      setChecking(false);
    })();
  }, [router]);

  const refresh = useCallback(async () => {
    const enc = await fetch("/api/encounters", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ encounters: [] as StoredHistory[] }));
    setEncounters(enc.encounters ?? []);
  }, []);

  const waiting = useMemo(
    () =>
      encounters
        .filter((e) => e.status === "pending" || e.status === "triage")
        .sort((a, b) => {
          const eRule = escalationPolicy(a);
          const bRule = escalationPolicy(b);
          return bRule.score - eRule.score || Number(b.status === "triage") - Number(a.status === "triage") || a.enteredAt.localeCompare(b.enteredAt);
        }),
    [encounters]
  );

  const patch = async (id: string, body: unknown) => {
    setBusy(true);
    const res = await fetch(`/api/encounters/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    setBusy(false);
    if (!json.ok) setMsg(json.error ?? "Update failed");
    else {
      setMsg("Updated.");
      await refresh();
    }
    return json.ok;
  };

const handleSignOut = async () => {
  await staffLogout(() => router.replace("/login"));
};

  const applyVitals = async (e: StoredHistory) => {
    const VITAL_RANGES: Record<string, [number, number]> = {
      systolic: [50, 300],
      diastolic: [30, 200],
      pulse: [20, 250],
      spo2: [50, 100],
      temperature: [30, 45],
      weight: [1, 300],
    };
    const v: Record<string, number> = {};
    for (const { key } of VITAL_KEYS) {
      const raw = vitals[key];
      if (raw !== undefined && raw !== "" && !Number.isNaN(Number(raw))) {
        const num = Number(raw);
        const [lo, hi] = VITAL_RANGES[key] ?? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
        if (num < lo || num > hi) {
          setMsg(`Refused: ${key} = ${raw} is outside the plausible range (${lo}–${hi}). Re-check the measurement.`);
          return;
        }
        v[key] = num;
      }
    }
    await patch(e.encounterId, {
      patient: { vitals: v },
      audit: [{ action: "vitals_captured", at: new Date().toISOString(), detail: "Nurse re-capture at triage", actor: user?.username, origin: "client" }],
    });
    setVitals({});
    setSelected(null);
  };

  if (checking) {
    return (
      <div className="flex min-h-64 flex-1 items-center justify-center">
        <span className="spinner" aria-hidden />
        <span className="sr-only">Loading</span>
      </div>
    );
  }

  return (
    <AppShell variant="staff" user={user} onSignOut={handleSignOut}>
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Nurse triage · नर्स जांच</h1>
        <p className="text-ink-2 text-[15px]">Today: {encounters.length} total · {waiting.length} waiting · Priority: Sr. Citizen / Divyang / Pregnant first. Escalation flags from vitals + red flags.</p>
        <div className="mt-2 flex flex-wrap gap-2 text-[12px] font-semibold">
          <span className="chip triage-p1">P1 Red · तुरंत — ER</span>
          <span className="chip triage-p2">P2 Yellow · जल्दी — Monitor</span>
          <span className="chip triage-p3">P3 Green · सामान्य — Routine</span>
        </div>
      </div>

      {msg && (
        <div className="banner">
          <Icon name="info" size={15} className="mt-px" />
          {msg}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Waiting list */}
        <div className="panel p-4">
          <div className="flex items-center justify-between">
            <p className="panel-title">
              <Icon name="ticket" size={15} className="text-ink-3" />
              Waiting ({waiting.length})
            </p>
            <button onClick={refresh} className="btn btn-secondary btn-sm">
              <Icon name="refresh" size={14} />
              Refresh
            </button>
          </div>
          <div className="mt-3 flex max-h-[70vh] flex-col gap-2 overflow-y-auto pr-1">
            {waiting.length === 0 && (
              <p className="py-8 text-center text-sm text-ink-3">No patients are waiting.</p>
            )}
            {waiting.map((e) => {
              const rule = escalationPolicy(e);
                const badge =
                  rule.level === "er"
                    ? "chip triage-p1"
                    : rule.level === "triage"
                      ? "chip triage-p2"
                      : "chip triage-p3";
              const token = e.token ?? e.encounterId.slice(0, 8).toUpperCase();
              const priority = (e.patient as { priorityFlag?: string }).priorityFlag ?? (e.redFlags?.some((r) => r.severity === "high") ? "Sr.Citizen/Divyang check" : "");
              return (
                <button
                  key={e.encounterId}
                  onClick={() => {
                    setSelected(e);
                    setVitals({});
                    setMsg(null);
                  }}
                  className={`min-h-[64px] rounded-lg border-2 p-3 text-left transition-colors ${
                    selected?.encounterId === e.encounterId
                      ? "border-[var(--border-focus)] bg-info-subtle"
                      : "border-line bg-canvas hover:border-line-strong"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[15px] font-semibold text-ink">{e.patient.name}</span>
                    <span className={badge}>
                      {rule.level === "er" ? "P1 · तुरंत" : rule.level === "triage" ? "P2 · जल्दी" : "P3 · सामान्य"} · MEWS{" "}
                      {rule.score}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[13px] text-ink-2">
                    {token} · {e.patient.department} · {waitMinutes(e.enteredAt)} min · {e.status}{priority ? ` · ${priority}` : ""}
                  </p>
                  {rule.reasons.length > 0 && (
                    <p className="mt-1 text-[11px] text-critical">{rule.reasons.join("; ")}</p>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected patient actions */}
        <div className="panel p-4">
          {!selected ? (
            <p className="py-16 text-center text-sm text-ink-3">Select a waiting patient to triage.</p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="panel-title">Patient triage</p>
                <button onClick={() => setSelected(null)} className="btn btn-secondary btn-sm">
                  <Icon name="close" size={14} />
                  Close
                </button>
              </div>
              <h2 className="mt-3 text-lg font-semibold text-ink">{selected.patient.name}</h2>
              <p className="text-[12px] text-ink-2">
                {selected.patient.age} yrs · {selected.patient.sex} · {selected.patient.department} · ABHA {selected.patient.abhaId}
              </p>
              <p className="mt-2 text-sm text-ink-2">
                <strong>Chief complaint:</strong> {(selected.history as { chiefComplaint?: string })?.chiefComplaint ?? "—"}
              </p>
              <p className="mt-1 line-clamp-3 text-xs text-ink-2">
                {(selected.history as { hpi?: string })?.hpi?.slice(0, 260) ?? ""}
              </p>

              {/* Re-capture vitals */}
              <div className="mt-4 rounded-lg border border-line bg-sunken p-3">
                <p className="section-label">Re-capture vitals</p>
                <div key={selected.encounterId} className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {VITAL_KEYS.map(({ key, label, hint }) => (
                    <label key={key} className="flex flex-col gap-0.5 text-[11px] text-ink-2">
                      {label}
                      <input
                        type="number"
                        defaultValue={selected.patient.vitals?.[key as keyof typeof selected.patient.vitals] ?? ""}
                        onChange={(ev) => setVitals((v) => ({ ...v, [key]: ev.target.value }))}
                        placeholder={hint}
                        className="field"
                      />
                    </label>
                  ))}
                </div>
                <button
                  onClick={() => applyVitals(selected)}
                  disabled={busy}
                  className="btn btn-primary btn-sm mt-3 w-full"
                >
                  <Icon name="activity" size={15} />
                  Save vitals
                </button>
              </div>

              {/* Status actions */}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => patch(selected.encounterId, {
                    status: "triage",
                    audit: [{ action: "triage_verified", at: new Date().toISOString(), detail: "Nurse triage complete", actor: user?.username, origin: "client" }],
                  })}
                  disabled={busy}
                  className="btn btn-primary btn-sm"
                >
                  <Icon name="check" size={15} />
                  Mark triage complete
                </button>
                <button
                  onClick={() => patch(selected.encounterId, {
                    status: "er",
                    audit: [{ action: "escalated_er", at: new Date().toISOString(), detail: "Escalated to ER by nurse", actor: user?.username, origin: "client" }],
                  })}
                  disabled={busy}
                  className="btn btn-danger btn-sm"
                >
                  <Icon name="siren" size={15} />
                  Escalate to ER
                </button>
              </div>
              {selected.redFlags.some((f) => f.severity === "high") && (
                <div className="banner banner-critical mt-3 flex-col items-start gap-1">
                  {selected.redFlags.map((f, i) => (
                    <p key={i} className="text-[13px]">
                      <strong>{f.symptom}</strong> — {f.message}
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      </div>
    </AppShell>
  );
}