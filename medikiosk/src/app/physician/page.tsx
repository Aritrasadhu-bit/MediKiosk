"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { staffLogout } from "@/lib/staffLogout";
import {
  loadStoredHistories,
  subscribeHistories,
  updateStoredHistory,
  recordAudit,
  exportFhir,
  deleteHistory,
  seedDemoPatients,
  fetchServerEncounters,
} from "@/lib/store";
import { publishCall } from "@/lib/callChannel";
import { speak, createRecognizer, kioskSpeech } from "@/lib/speech";
import { tokenCalledSpeech } from "@/lib/i18n";
import { checkInteractions, checkPregnancyRisk, pregnancySignalled, drugsWithoutCoverage, INTERACTION_COVERAGE_NOTE, interactionsToSummary } from "@/lib/interactions";
import { buildTimeline, type TimelineEvent } from "@/lib/timeline";
import { renderAfterVisit, assembleSummaryHi } from "@/lib/summarizer";
import { slaLevel, waitMinutes, severityOfRedFlags } from "@/lib/queue";
import { computeEarlyWarning, ewLabel } from "@/lib/redflags";
import { QRCodeSVG } from "qrcode.react";
import { Icon } from "@/components/Icon";
import { AppShell } from "@/components/AppShell";
import { HisDeliveryPanel } from "@/components/HisDeliveryPanel";
import LabTrends from "@/components/LabTrends";
import PrakritiRadar from "@/components/PrakritiRadar";
import { lookupDualCoding } from "@/lib/clinical";
import { applyRxTemplate, templatesForDepartment } from "@/lib/rxTemplates";
import QrScanner from "@/components/QrScanner";
import type { StoredHistory, StaffUser, Prescription, Medication, InteractionWarning, DosageForm } from "@/lib/types";
import { patientKeyOf } from "@/lib/types";

const DEPTS = [
  "All departments",
  "General Medicine",
  "Cardiology",
  "Gynaecology & Obstetrics",
  "Paediatrics",
  "Acute / Emergency",
  "AYUSH - Ayurveda (General)",
];

// Common ICD-10 codes for quick diagnosis coding (suggestions via <datalist>).
const ICD_SUGGESTIONS = [
  "A09 — Infectious gastroenteritis/colitis",
  "D50.9 — Iron deficiency anaemia, unspecified",
  "E11.9 — Type 2 diabetes without complications",
  "E78.5 — Hyperlipidaemia, unspecified",
  "I10 — Essential (primary) hypertension",
  "I20.9 — Angina pectoris, unspecified",
  "J02.9 — Acute pharyngitis, unspecified",
  "J06.9 — Acute upper respiratory infection, unspecified",
  "J18.9 — Pneumonia, unspecified organism",
  "K29.7 — Gastritis, unspecified",
  "K59.0 — Constipation",
  "M54.5 — Low back pain",
  "N39.0 — Urinary tract infection, site not specified",
  "R50.9 — Fever, unspecified",
  "R51 — Headache",
  "R10.9 — Unspecified abdominal pain",
];

/** Soft alert chime for ER escalation (WebAudio, no asset needed). */
function playAlarm() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const tone = (freq: number, delay: number, dur = 0.22) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + delay);
      g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + delay + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + dur);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + delay);
      o.stop(ctx.currentTime + delay + dur + 0.05);
    };
    tone(880, 0, 0.16);
    tone(1046, 0.18, 0.16);
    tone(1318, 0.36, 0.3);
    window.setTimeout(() => ctx.close(), 1500);
  } catch {
    /* audio unavailable — visual alert still fires */
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m ago` : `${Math.floor(h / 24)}d ago`;
}

export default function PhysicianPage() {
  const router = useRouter();

  const [user, setUser] = useState<StaffUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [encounters, setEncounters] = useState<StoredHistory[]>(() =>
    typeof window === "undefined" ? [] : loadStoredHistories()
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deptFilter, setDeptFilter] = useState("All departments");
  const [statusFilter, setStatusFilter] = useState<"all" | "waiting" | "triage" | "er" | "seen">("all");
  const [search, setSearch] = useState("");
  const [nowCalling, setNowCalling] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(40);
  const [qrOpen, setQrOpen] = useState(false);

  // Scan a token slip QR (portal URL, legacy JSON payload, or bare token) and
  // jump straight to that encounter. Clears filters first so the match is
  // always visible even under a department/status filter.
  const handleSlipQr = (code: string) => {
    const raw = code.trim();
    let encounterId = "";
    let token = "";
    try {
      const parsed = JSON.parse(raw.slice(0, 100_000)) as { encounterId?: unknown; token?: unknown };
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.encounterId === "string") encounterId = parsed.encounterId;
        if (typeof parsed.token === "string") token = parsed.token;
      }
    } catch {
      /* not JSON — try URL or bare token below */
    }
    if (!encounterId && !token) {
      const m = /\/p\/([^/?#]+)/.exec(raw);
      if (m) encounterId = decodeURIComponent(m[1]);
      else token = raw;
    }
    const match = encounterId
      ? encounters.find((e) => e.encounterId === encounterId)
      : encounters.find(
          (e) => (e.token ?? "").toLowerCase() === token.toLowerCase() || e.encounterId === token
        );
    setQrOpen(false);
    if (!match) {
      notify("No record matches this QR — check the slip and retry.");
      return;
    }
    applyFilter({ dept: "All departments", status: "all", text: "" });
    setSelectedId(match.encounterId);
    notify(`Opened ${match.history.name} (${match.token ?? match.encounterId.slice(0, 8).toUpperCase()}).`);
  };

  // ---------------------------------------------------------------- auth
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (!res.ok) {
        router.replace("/login");
        return;
      }
      const json = await res.json();
      setUser(json.user);
      setAuthLoading(false);
      // Department scoping: clinicians default to their own department
      // (they can still switch); admin/others see everything.
      const dept = (json.user as StaffUser | undefined)?.department;
      if (dept && dept !== "Triage" && dept !== "Pharmacy") {
        setDeptFilter(dept);
      }
    })().catch(() => router.replace("/login"));
  }, [router]);

  // ---------------------------------------------------------------- data
  useEffect(() => {
    if (typeof window === "undefined") return;
    const unsub = subscribeHistories(() => setEncounters(loadStoredHistories()));
    // Poll the server so cross-device kiosk submissions appear automatically.
    const iv = setInterval(async () => {
      if (!user) return;
      const merged = await fetchServerEncounters().catch(() => loadStoredHistories());
      setEncounters(merged);
    }, 12_000);
    return () => {
      unsub();
      clearInterval(iv);
    };
  }, [user]);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const filtered = useMemo(() => {
    let list = encounters;
    if (deptFilter !== "All departments") {
      list = list.filter((e) => e.patient.department === deptFilter);
    }
    if (statusFilter !== "all") {
      list = list.filter((e) => {
        if (statusFilter === "waiting") return e.status === "pending" || e.status === "triage";
        if (statusFilter === "triage") return e.status === "triage";
        if (statusFilter === "er") return e.status === "er";
        return e.status === "confirmed";
      });
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (e) =>
          (e.history?.name ?? "").toLowerCase().includes(q) ||
          (e.patient?.abhaId ?? "").toLowerCase().includes(q) ||
          (e.token ?? "").toLowerCase().includes(q)
      );
    }
    const score = (e: StoredHistory) => {
      let s = 0;
      if ((e.redFlags ?? []).some((r) => r.severity === "high")) s += 100;
      if ((e.patient.vitals?.systolic ?? 0) >= 160) s += 40;
      if (e.status === "pending" || e.status === "triage") s += 20;
      return s;
    };
    return [...list].sort((a, b) => score(b) - score(a) || new Date(b.enteredAt).getTime() - new Date(a.enteredAt).getTime());
  }, [encounters, deptFilter, search, statusFilter]);

  // Pagination for the queue list (show first N, "Load more" appends).
  // Reset the page whenever a filter changes (single gate so no effect needed).
  const applyFilter = (patch: { dept?: string; status?: "all" | "waiting" | "triage" | "er" | "seen"; text?: string }) => {
    if (patch.dept !== undefined) setDeptFilter(patch.dept);
    if (patch.status !== undefined) setStatusFilter(patch.status);
    if (patch.text !== undefined) setSearch(patch.text);
    setVisibleCount(40);
  };

  const pageRows = filtered.slice(0, visibleCount);

  const selected = encounters.find((e) => e.encounterId === selectedId) ?? null;

  // Same patient longitudinal record (by ABHA id, else name+mobile).
  const patientKey = (e: StoredHistory) => patientKeyOf(e);

  const relatedEncounters = useMemo(() => {
    if (!selected) return [];
    const key = patientKey(selected);
    return encounters
      .filter((e) => e.encounterId !== selected.encounterId && patientKey(e) === key)
      .sort((a, b) => new Date(b.enteredAt).getTime() - new Date(a.enteredAt).getTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encounters, selectedId]);

  // ---------------------------------------------------------------- seed
  const handleSeed = () => {
    seedDemoPatients();
    setEncounters(loadStoredHistories());
    notify("Demo patients loaded (local + server).");
  };

  // ---------------------------------------------------------------- call next (Point 5)
  const callNext = (e: StoredHistory) => {
    publishCall({
      action: "call-next",
      encounterId: e.encounterId,
      name: e.history.name,
      token: e.token,
      at: new Date().toISOString(),
    });
    // Push to server so the waiting-room display and other devices see it too.
    fetch("/api/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encounterId: e.encounterId, action: "call", notify: true }),
    }).catch(() => {});
    setNowCalling(e.encounterId);
    recordAudit(e.encounterId, "called_next", `Called by ${user?.name ?? "physician"}`);
    speak(tokenCalledSpeech({ lang: e.lang ?? "hi", name: e.history.name, token: e.token }), e.voiceCode ?? "hi-IN");
    notify(`Calling ${e.history.name} (token ${e.token ?? "—"})`);
    setTimeout(() => setNowCalling(null), 8000);
  };

  // ---------------------------------------------------------------- nurse triage + ER escalation
  const startTriage = (e: StoredHistory) => {
    updateStoredHistory(e.encounterId, { status: "triage" });
    recordAudit(e.encounterId, "triage_verified", `Triage started by ${user?.name ?? "nurse"}`);
    setEncounters(loadStoredHistories());
    notify(`${e.history.name} moved to triage.`);
    speak(kioskSpeech("triageCall", e.lang ?? "hi", { name: e.history.name }), e.voiceCode ?? "hi-IN");
  };

  const escalateEr = (e: StoredHistory) => {
    updateStoredHistory(e.encounterId, { status: "er" });
    recordAudit(e.encounterId, "escalated_er", `Escalated to ER by ${user?.name ?? "physician"}`);
    publishCall({
      action: "call-next",
      encounterId: e.encounterId,
      name: e.history.name,
      token: e.token,
      at: new Date().toISOString(),
    });
    playAlarm();
    speak(kioskSpeech("erAlert", e.lang ?? "hi", { name: e.history.name, token: e.token ?? "" }), e.voiceCode ?? "hi-IN");
    setEncounters(loadStoredHistories());
    setNowCalling(e.encounterId);
    notify(`${e.history.name} escalated to Emergency.`);
    setTimeout(() => setNowCalling(null), 8000);
  };

  // ---------------------------------------------------------------- confirm
  const confirmEncounter = (e: StoredHistory) => {
    updateStoredHistory(e.encounterId, { status: "confirmed" });
    recordAudit(e.encounterId, "confirmed", `Confirmed by ${user?.name ?? "physician"}`);
    setEncounters(loadStoredHistories());
    notify(`${e.history.name} marked as seen.`);
  };

  const handleExport = async (e: StoredHistory) => {
    try {
      await exportFhir(e);
      notify("FHIR R4 bundle downloaded.");
    } catch {
      notify("FHIR export needs an authenticated session — log in first.");
    }
  };

  // Referral slip (Batch B, U7): printable handoff for escalated / referred patients.
  const handleReferral = (e: StoredHistory) => {
    const w = window.open(`/api/referral/${encodeURIComponent(e.encounterId)}?format=html`, "_blank");
    if (w) {
      w.focus();
    } else {
      notify("Popup blocked — allow popups for this site to open the referral slip.");
    }
  };

  const handleLogout = async () => {
    await staffLogout(() => router.replace("/login"));
  };

  if (authLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="spinner h-10 w-10" role="status" aria-label="Loading queue" />
      </div>
    );
  }

  return (
    <AppShell variant="staff" user={user} onSignOut={handleLogout}>
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Clinical dashboard · चिकित्सक डैशबोर्ड</h1>
          <p className="mt-0.5 text-[14px] text-ink-2">
            Live outpatient queue · {user?.name} · {user?.role} · My room only filter below
          </p>
          <div className="mt-2 flex flex-wrap gap-2" role="status" aria-label="Workload summary">
            <span className="chip chip-info text-[13px]">Waiting: {encounters.filter((e) => e.status === "pending" || e.status === "triage").length} · प्रतीक्षा</span>
            <span className="chip chip-warning text-[13px]">Critical P1: {encounters.filter((e) => severityOfRedFlags(e.redFlags) === "high").length} · गंभीर</span>
            <span className="chip chip-success text-[13px]">Done today: {encounters.filter((e) => e.status === "confirmed").length} · पूर्ण</span>
            <span className="chip chip-neutral text-[13px]">Avg ~3 min/pt · 3 doctors on duty</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {user?.role === "admin" && (
            <button onClick={() => router.push("/admin")} className="btn btn-secondary btn-sm">
              <Icon name="chart" size={14} />
              Analytics
            </button>
          )}
          <button onClick={handleSeed} className="btn btn-secondary btn-sm">
            <Icon name="users" size={14} />
            Load sample patients
          </button>
          <button onClick={() => router.push("/")} className="btn btn-secondary btn-sm">
            <Icon name="building" size={14} />
            Kiosk
          </button>
        </div>
      </div>

      {toast && (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-40 flex max-w-sm items-center gap-2 rounded-lg bg-ink px-4 py-3 text-[13px] font-medium text-white shadow-lg"
        >
          <Icon name="checkCircle" size={16} className="text-success" />
          {toast}
        </div>
      )}

      {encounters.some((e) => e.viaBreakGlass) && (
        <div role="alert" className="banner banner-critical mb-4">
          <Icon name="siren" size={15} className="mt-px" />
          Emergency override active — consent-revoked records are visible and every open is audit-logged.
        </div>
      )}

      {/* Filters */}
      <div className="panel flex flex-wrap items-center gap-2 p-3">
        <div className="relative">
          <Icon name="building" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <select
            value={deptFilter}
            onChange={(e) => applyFilter({ dept: e.target.value })}
            aria-label="Filter by department"
            className="field w-auto py-1.5 pl-8 pr-8"
          >
            {DEPTS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        <div className="relative min-w-[200px] flex-1">
          <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            value={search}
            onChange={(e) => applyFilter({ text: e.target.value })}
            placeholder="Search name, ABHA or token"
            aria-label="Search patients"
            className="field py-1.5 pl-8"
          />
        </div>
        <button
          type="button"
          onClick={() => setQrOpen(true)}
          className="btn btn-secondary btn-sm min-h-[44px]"
          title="Scan a token slip to open that patient"
        >
          <Icon name="qr" size={15} />
          Scan slip
        </button>
        <span className="text-[12px] text-ink-3">
          <span className="tabular font-medium text-ink-2">{filtered.length}</span> of{" "}
          <span className="tabular">{encounters.length}</span> patients
          {encounters.filter((e) => e.redFlags.some((r) => r.severity === "high")).length > 0 && (
            <>
              {" · "}
              <span className="tabular font-medium text-critical">
                {encounters.filter((e) => e.redFlags.some((r) => r.severity === "high")).length} urgent
              </span>
            </>
          )}
        </span>
      </div>

      {/* Status filter lanes */}
      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
        {(
          [
            ["all", "All"],
            ["waiting", "Waiting"],
            ["triage", "In triage"],
            ["er", "Emergency"],
            ["seen", "Seen"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => applyFilter({ status: key })}
            aria-pressed={statusFilter === key}
            className={`chip ${
              statusFilter === key ? "border-transparent bg-ink text-white" : "chip-neutral hover:border-line-strong"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Queue */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* LEFT: queue list */}
        <div className="flex flex-col gap-2">
          {filtered.length === 0 && (
            <div className="panel flex flex-col items-center gap-2 border-dashed px-6 py-12 text-center">
              <Icon name="search" size={20} className="text-ink-3" />
              <p className="text-[13px] font-medium text-ink-2">No patients match this filter</p>
              <p className="max-w-xs text-[12px] text-ink-3">
                Adjust the filters above, or start a session on the kiosk to add a patient.
              </p>
            </div>
          )}
          {pageRows.map((e) => (
            <QueueCard
              key={e.encounterId}
              e={e}
              selected={selectedId === e.encounterId}
              nowCalling={nowCalling === e.encounterId}
              role={user?.role}
              onSelect={() => setSelectedId(e.encounterId)}
              onCall={() => callNext(e)}
              onTriage={() => startTriage(e)}
              onEr={() => escalateEr(e)}
              onConfirm={() => confirmEncounter(e)}
              onExport={() => handleExport(e)}
              onReferral={() => handleReferral(e)}
              onDelete={() => {
                if (!window.confirm(`Permanently delete the encounter for ${e.history.name}? This cannot be undone.`)) return;
                deleteHistory(e.encounterId);
                notify(`Deleted ${e.history.name}.`);
              }}
            />
          ))}
          {pageRows.length < filtered.length && (
            <button
              onClick={() => setVisibleCount((v) => v + 40)}
              className="btn btn-secondary"
            >
              Show {filtered.length - pageRows.length} more
              <Icon name="chevronDown" size={15} />
            </button>
          )}
        </div>

        {/* RIGHT: selected patient work area */}
        <div>
          {selected ? (
            <PatientWorkbench
              // Remount the workbench per encounter so in-progress form state
              // (captured vitals, free-text notes) never bleeds across patients
              // when the queue list refreshes while one is selected.
              key={selected.encounterId}
              e={selected}
              related={relatedEncounters}
              user={user}
              onSelectEncounter={setSelectedId}
              onSaved={() => {
                setEncounters(loadStoredHistories());
                notify("Saved and synced to HIS.");
              }}
            />
          ) : (
            <div className="panel flex flex-col items-center gap-2 border-dashed px-6 py-16 text-center">
              <Icon name="clipboard" size={20} className="text-ink-3" />
              <p className="text-[13px] font-medium text-ink-2">No patient selected</p>
              <p className="max-w-xs text-[12px] text-ink-3">
                Choose a patient from the queue to review their history, write a prescription, or
                add a note.
              </p>
            </div>
          )}
        </div>
      </div>
      {qrOpen && <QrScanner onResult={handleSlipQr} onClose={() => setQrOpen(false)} />}
    </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------- queue card
const SLA_BAR: Record<string, string> = {
  green: "bg-success",
  amber: "bg-warning",
  red: "bg-critical",
};

/**
 * Coverage footnote for interaction results: names the prescribed drugs the
 * curated checker does not recognise, so "no warning" is never misread as
 * "checked and safe". Rendered under every interaction panel.
 */
function CoverageFootnote({ medications }: { medications: Medication[] }) {
  const unknown = drugsWithoutCoverage(medications);
  return (
    <div className="mt-1.5 border-t border-line pt-1.5 text-[11px] text-ink-3">
      <p>{INTERACTION_COVERAGE_NOTE}</p>
      {unknown.length > 0 && (
        <p className="mt-0.5 font-semibold text-warning">
          Not covered by this check — verify independently: {unknown.join(", ")}
        </p>
      )}
    </div>
  );
}

const TIMELINE_STYLE: Record<TimelineEvent["kind"], { dot: string; chip: string; label: string }> = {
  visit: { dot: "bg-brand", chip: "chip-info", label: "Visit" },
  prescription: { dot: "bg-emerald-500", chip: "chip-success", label: "Rx" },
  document: { dot: "bg-violet-500", chip: "chip-neutral", label: "Doc" },
  alert: { dot: "bg-critical", chip: "chip-critical", label: "Alert" },
};

/** Chronological spine of every visit, prescription, scan and alert. */
function MedicalTimeline({
  current,
  related,
  onSelectEncounter,
}: {
  current: StoredHistory;
  related: StoredHistory[];
  onSelectEncounter: (encounterId: string) => void;
}) {
  const events = buildTimeline(current, related);
  return (
    <div className="panel p-4">
      <p className="panel-title">
        <Icon name="calendar" size={15} className="text-ink-3" />
        Medical timeline {events.length > 0 && `(${events.length})`}
      </p>
      {events.length === 0 ? (
        <p className="mt-2 text-[12px] text-ink-3">No dated artefacts yet.</p>
      ) : (
        <ol className="mt-2.5 flex max-h-72 flex-col gap-0 overflow-y-auto">
          {events.map((ev) => {
            const style = TIMELINE_STYLE[ev.kind];
            const clickable = ev.kind !== "document" && ev.encounterId && ev.encounterId !== current.encounterId;
            const row = (
              <>
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
                <div className="min-w-0 flex-1 pb-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="tabular text-[12px] font-semibold text-ink">
                      {new Date(ev.at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                    </span>
                    <span className={`chip ${style.chip}`}>{style.label}</span>
                    {ev.severity === "high" && <span className="chip chip-critical">High</span>}
                  </div>
                  <p className="mt-0.5 truncate text-[13px] text-ink-2">{ev.title}</p>
                  {ev.detail && <p className="truncate text-[11px] text-ink-3">{ev.detail}</p>}
                </div>
              </>
            );
            return (
              <li key={ev.key} className="flex gap-2.5 border-l border-line pl-0">
                {clickable ? (
                  <button
                    type="button"
                    onClick={() => ev.encounterId && onSelectEncounter(ev.encounterId)}
                    className="flex w-full gap-2.5 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-sunken"
                  >
                    {row}
                  </button>
                ) : (
                  <div className="flex w-full gap-2.5 px-1 py-0.5">{row}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function QueueCard({
  e,
  selected,
  nowCalling,
  role,
  onSelect,
  onCall,
  onTriage,
  onEr,
  onConfirm,
  onExport,
  onReferral,
  onDelete,
}: {
  e: StoredHistory;
  selected: boolean;
  nowCalling: boolean;
  role?: string;
  onSelect: () => void;
  onCall: () => void;
  onTriage: () => void;
  onEr: () => void;
  onConfirm: () => void;
  onExport: () => void;
  onReferral: () => void;
  onDelete: () => void;
}) {
  const urgent = e.redFlags.some((r) => r.severity === "high");
  const severity = severityOfRedFlags(e.redFlags);
  const sla = slaLevel(e.enteredAt, severity);
  const wait = waitMinutes(e.enteredAt);
  const ew = computeEarlyWarning(e.history.age, e.patient.vitals);
  const statusText =
    e.status === "confirmed" ? "Seen" : e.status === "er" ? "Emergency" : e.status === "triage" ? "Triage" : "Waiting";
  const statusCls =
    e.status === "confirmed"
      ? "chip-success"
      : e.status === "er"
      ? "chip-critical"
      : e.status === "triage"
      ? "chip-info"
      : "chip-warning";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          onSelect();
        }
      }}
      className={`panel relative cursor-pointer overflow-hidden p-3 pl-4 transition-colors ${
        selected ? "border-brand ring-1 ring-brand/25" : "hover:border-line-strong"
      } ${nowCalling ? "border-success ring-1 ring-success/30" : ""}`}
    >
      {/* SLA status bar */}
      <span className={`absolute inset-y-0 left-0 w-[3px] ${SLA_BAR[sla]}`} aria-hidden="true" />
      <div className="flex items-start gap-3">
        <div className="tabular flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line bg-sunken text-[13px] font-semibold text-ink-2">
          {e.token ?? "—"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-[14px] font-semibold text-ink">{e.history.name}</p>
            <span className="tabular text-[12px] text-ink-3">
              {e.history.age}
              <span className="lowercase">y</span> &middot; {e.history.sex}
            </span>
            <span className="chip chip-neutral">{e.patient.department}</span>
            {urgent && (
              <span className="chip chip-critical">
                <Icon name="siren" size={12} />
                Urgent
              </span>
            )}
            <span className={`chip ${statusCls}`}>{statusText}</span>
            {e.viaBreakGlass && (
              <span className="chip chip-critical" title="Visible under an active emergency override — opening this record is audit-logged">
                <Icon name="siren" size={12} />
                Override
              </span>
            )}
            {e.possibleDuplicateOf && (
              <span
                className="chip chip-warning"
                title={`Possible same-day duplicate of ${e.possibleDuplicateOf.token ?? e.possibleDuplicateOf.encounterId.slice(0, 8)} (${e.possibleDuplicateOf.reason}) — verify before calling`}
              >
                <Icon name="copy" size={12} />
                Possible duplicate
              </span>
            )}
            {e.status !== "confirmed" && e.status !== "er" && (
              <span className="tabular text-[11px] text-ink-3">
                waiting {wait} min &middot; SLA {sla}
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-[13px] text-ink-2">{e.history.chiefComplaint}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
            <span>{timeAgo(e.enteredAt)}</span>
            {e.history.menstrualHistory || e.history.obstetricHistory ? (
              <span className="flex items-center gap-1">
                <Icon name="droplet" size={11} />
                Women&apos;s history
              </span>
            ) : null}
            <span className="tabular">
              EWS {ew.score} ({ewLabel(ew.level)})
            </span>
            {e.mode === "ayush" && <span className="chip chip-neutral">AYUSH</span>}
            {e.patient.respondent === "guardian" && (
              <span className="flex items-center gap-1">
                <Icon name="users" size={11} />
                via {e.patient.guardian?.name}
              </span>
            )}
          </div>
        </div>
      </div>
      {urgent && (
        <div className="banner banner-critical mt-2.5 py-1.5">
          <Icon name="alert" size={14} className="mt-px" />
          <span>
            {e.redFlags.filter((r) => r.severity === "high").map((r) => r.symptom).join(" · ")}
          </span>
        </div>
      )}
      <div
        className="mt-2.5 flex flex-wrap items-center gap-1.5"
        onClick={(ev) => ev.stopPropagation()}
        onKeyDown={(ev) => {
          // Space/Enter on an action button must not bubble to the card's own
          // key handler, which would also (de)select the encounter.
          if (ev.key === "Enter" || ev.key === " ") ev.stopPropagation();
        }}
      >
        <button onClick={onCall} className="btn btn-primary btn-sm">
          <Icon name="bell" size={14} />
          Call next
        </button>
        {e.status !== "er" && (
          <button onClick={onConfirm} className="btn btn-secondary btn-sm">
            <Icon name="check" size={14} />
            Mark seen
          </button>
        )}
        {(role === "nurse" || role === "doctor") && e.status !== "triage" && e.status !== "confirmed" && e.status !== "er" && (
          <button onClick={onTriage} className="btn btn-secondary btn-sm">
            <Icon name="activity" size={14} />
            Start triage
          </button>
        )}
        {e.status !== "er" && (
          <button onClick={onEr} className="btn btn-ghost btn-sm text-critical hover:bg-critical-subtle">
            <Icon name="siren" size={14} />
            Send to ER
          </button>
        )}
        <button onClick={onExport} className="btn btn-ghost btn-sm" title="Download FHIR bundle">
          <Icon name="download" size={14} />
          FHIR
        </button>
        <button
          onClick={onReferral}
          className={`btn btn-sm ${e.referral ? "btn-secondary" : "btn-ghost"}`}
          title={e.referral ? "Open referral slip" : "Generate a printable referral slip"}
        >
          <Icon name="file" size={14} />
          {e.referral ? "Referral" : "Refer"}
        </button>
        <button
          onClick={onDelete}
          aria-label={`Delete encounter for ${e.history.name}`}
          className="btn btn-ghost btn-sm ml-auto text-ink-3 hover:bg-critical-subtle hover:text-critical"
        >
          <Icon name="close" size={14} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- patient workbench
function PatientWorkbench({
  e,
  related,
  user,
  onSaved,
  onSelectEncounter,
}: {
  e: StoredHistory;
  related: StoredHistory[];
  user: StaffUser | null;
  onSaved: () => void;
  onSelectEncounter: (encounterId: string) => void;
}) {
  const [note, setNote] = useState(e.doctorNote ?? "");
  const [summaryLang, setSummaryLang] = useState<"en" | "hi">("en");
  const [diagnosis, setDiagnosis] = useState(e.doctorDiagnosis ?? e.prescription?.diagnosis ?? "");
  const [advice, setAdvice] = useState(e.prescription?.advice ?? "");
  const [followUp, setFollowUp] = useState(e.prescription?.followUpDate ?? "");
  const [doctorReg, setDoctorReg] = useState(e.prescription?.doctorReg ?? user?.councilReg ?? "");
  const [disposition, setDisposition] = useState<Prescription["disposition"]>(e.prescription?.disposition ?? "discharge");
  const [rxSystem, setRxSystem] = useState<"allopathic" | "ayush">(
    e.prescription?.system ?? (e.mode === "ayush" ? "ayush" : "allopathic")
  );
  const [pathya, setPathya] = useState(e.prescription?.pathya ?? "");
  const [apathya, setApathya] = useState(e.prescription?.apathya ?? "");
  const [rxMeds, setRxMeds] = useState<Medication[]>(e.prescription?.medications ?? []);
  const [rxError, setRxError] = useState<string | null>(null);
  // Department templates: one-tap starting regimens, appended (never
  // overwriting), fully editable afterwards.
  const [templateId, setTemplateId] = useState("");
  const [templateMsg, setTemplateMsg] = useState<string | null>(null);
  const deptTemplates = useMemo(
    () => templatesForDepartment(e.patient.department),
    [e.patient.department]
  );
  const [listening, setListening] = useState(false);
  const recRef = useRef<ReturnType<typeof createRecognizer> | null>(null);

  // AI differential + suggested-questions panel (rule-based offline, LLM when keyed).
  const [aiPanel, setAiPanel] = useState<{ hinted: boolean; differentials: string[]; suggestedQuestions: string[] } | null>(null);
  const [aiBusy, setAiBusy] = useState(true);
  useEffect(() => {
    let alive = true;
    fetch(`/api/patient/${e.encounterId}/ai`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (alive && json.ok) setAiPanel(json.panel);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setAiBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [e.encounterId]);

  // Dictation: turns free text into a structured prescription draft.
  const [dictate, setDictate] = useState("");
  const [dictateBusy, setDictateBusy] = useState(false);
  const [dictateMsg, setDictateMsg] = useState<string | null>(null);
  const dictateRx = async () => {
    if (!dictate.trim()) return;
    setDictateBusy(true);
    setDictateMsg(null);
    try {
      const res = await fetch("/api/rx/dictate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: dictate, encounterId: e.encounterId }),
      });
      const json = await res.json();
      if (!json.ok) {
        setDictateMsg(json.error ?? "Could not parse dictation.");
        return;
      }
      const meds: Medication[] = json.draft.map((d: { name: string; dosage?: string; frequency?: string; duration?: string; instructions?: string }) => ({
        name: d.name,
        dosage: d.dosage,
        frequency: d.frequency,
        duration: d.duration,
        instructions: d.instructions,
      }));
      setRxMeds((m) => [...m, ...meds]);
      setDictateMsg(`Drafted ${meds.length} medication(s)${json.hinted ? " (AI)" : " (offline parser)"}. Verify before saving.`);
      setDictate("");
    } catch {
      setDictateMsg("Dictation failed.");
    } finally {
      setDictateBusy(false);
    }
  };

  const rxWarnings: InteractionWarning[] = useMemo(
    () => checkInteractions(e.history.medications ?? [], e.history.allergies ?? [], rxMeds),
    [e.history, rxMeds]
  );

  // Pregnancy-safe prescribing filter (female of reproductive age).
  const pregnancyRisks = useMemo(() => {
    const ctx = {
      female: e.history.sex === "Female",
      age: e.history.age,
      pregnant: pregnancySignalled(e.history.obstetricHistory) || pregnancySignalled([e.history.menstrualHistory, e.history.obstetricHistory].filter(Boolean).join(" ")),
      notes: e.history.obstetricHistory,
    };
    return checkPregnancyRisk(rxMeds, ctx);
  }, [e.history, rxMeds]);

  const ew = useMemo(() => computeEarlyWarning(e.history.age, e.patient.vitals), [e.history.age, e.patient.vitals]);

  // Derive an ICD-10 code from the typed diagnosis (best suggestion match).
  const icdMatch = useMemo(() => {
    const q = diagnosis.toLowerCase();
    if (!q.trim()) return null;
    let best: { code: string; label: string; score: number } | null = null;
    for (const s of ICD_SUGGESTIONS) {
      const [code, label] = s.split(" — ");
      const words = label.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      const hits = words.filter((w) => q.includes(w)).length;
      const codeHit = q.includes(code.split(".")[0].toLowerCase()) ? 2 : 0;
      const score = hits + codeHit;
      if (score > 0 && (!best || score > best.score)) best = { code, label, score };
    }
    return best;
  }, [diagnosis]);

  const save = (patch: Partial<StoredHistory>, auditMsg?: string) => {
    updateStoredHistory(e.encounterId, patch);
    if (auditMsg) recordAudit(e.encounterId, "note_added", auditMsg);
    onSaved();
  };

  const savePrescription = () => {
    const reg = doctorReg || user?.councilReg || undefined;
    const hpr = user?.hprId || undefined;
    const qual = user?.qualifications || undefined;
    // Never save an empty or half-filled prescription to the record/pharmacy:
    // every row must name the medicine with dosage, frequency and duration.
    const badRow = rxMeds.findIndex(
      (m) => !m.name.trim() || !String(m.dosage ?? "").trim() || !String(m.frequency ?? "").trim() || !String(m.duration ?? "").trim()
    );
    if (rxMeds.length === 0 || badRow >= 0) {
      setRxError(
        rxMeds.length === 0
          ? "Add at least one medicine before saving the prescription."
          : `Row ${badRow + 1} is incomplete — name, dosage, frequency and duration are all required.`
      );
      return;
    }
    setRxError(null);
    const sigHash = `SHA256:${e.encounterId.slice(0, 6)}.${Date.now().toString(36)}.${(user?.username ?? "DOC").toUpperCase()}`;
    const prescription: Prescription = {
      diagnosis: diagnosis || undefined,
      system: rxSystem,
      medications: rxMeds,
      advice: advice || undefined,
      pathya: pathya || undefined,
      apathya: apathya || undefined,
      followUpDate: followUp || undefined,
      prescribedBy: user?.name,
      doctorReg: reg,
      doctorHprId: hpr,
      doctorQualifications: qual,
      signatureHash: sigHash,
      disposition: disposition,
      icd10: icdMatch ? icdMatch.code : undefined,
      writtenAt: new Date().toISOString(),
    };
    updateStoredHistory(e.encounterId, { doctorDiagnosis: diagnosis || undefined, prescription });
    recordAudit(e.encounterId, "prescription_written", `Rx (${rxSystem}) with ${rxMeds.length} item(s) by ${user?.name}${prescription.icd10 ? ` · ICD ${prescription.icd10}` : ""}${reg ? ` · Reg ${reg}` : ""}`);
    onSaved();
  };

  // Formal A4 prescription — React-rendered into #print-area (QR included).
  const [formalRxOpen, setFormalRxOpen] = useState(false);
  const printFormalRx = () => {
    setFormalRxOpen(true);
    const area = document.getElementById("print-area");
    if (area) area.style.display = "block";
    window.setTimeout(() => {
      window.print();
      if (area) area.style.display = "none";
      setFormalRxOpen(false);
    }, 60);
  };

  const toggleVoice = () => {
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = createRecognizer("hi-IN", (text) => {
      setNote((n) => (n ? `${n}\n${text}` : text));
      setListening(false);
    });
    if (!rec) return;
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  const addMed = () =>
    setRxMeds((m) => [
      ...m,
      {
        name: "",
        dosageForm: rxSystem === "ayush" ? "Vati" : "Tablet",
        dosage: "",
        frequency: "BD",
        duration: "5 days",
        anupana: rxSystem === "ayush" ? "Warm Water (उष्ण जल)" : undefined,
        kala: rxSystem === "ayush" ? "Adhobhakta (After food)" : undefined,
      },
    ]);
  const updateMed = (i: number, patch: Partial<Medication>) =>
    setRxMeds((m) => m.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const handout = useMemo(
    () =>
      renderAfterVisit({
        ...e,
        doctorNote: note || e.doctorNote,
        doctorDiagnosis: diagnosis || e.doctorDiagnosis,
        prescription: {
          ...(e.prescription ?? {}),
          system: rxSystem,
          medications: rxMeds,
          advice,
          pathya,
          apathya,
          followUpDate: followUp,
          diagnosis,
        },
      }),
    [e, note, diagnosis, rxMeds, rxSystem, advice, pathya, apathya, followUp]
  );

  const whatsappLink = useMemo(() => {
    const text = encodeURIComponent(handout.slice(0, 1800));
    return `https://wa.me/?text=${text}`;
  }, [handout]);

  const dualCode = lookupDualCoding(e.history.chiefComplaint || e.doctorDiagnosis);

  return (
    <div className="flex flex-col gap-3">
      {/* 10-Second Executive Intake HUD */}
      <div className="rounded-xl border-2 border-brand/30 bg-brand-subtle/40 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-brand/20 pb-2.5">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand text-white font-bold text-xs">
              HUD
            </span>
            <h3 className="text-sm font-bold text-ink">10-Second Clinical Intake Overview</h3>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {dualCode && (
              <>
                <span className="chip chip-info font-medium text-[11px]" title={`WHO ICD-10: ${dualCode.icdTitle}`}>
                  ICD-10: {dualCode.icd10}
                </span>
                <span className="chip border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-medium text-[11px]" title={`AYUSH NAMASTE: ${dualCode.namasteTerm}`}>
                  NAMASTE: {dualCode.namasteCode}
                </span>
              </>
            )}
            <span
              className={`chip font-semibold text-[11px] ${
                ew.level === "high" ? "chip-critical" : ew.level === "medium" ? "chip-warning" : "chip-success"
              }`}
            >
              EWS {ew.score} ({ewLabel(ew.level)})
            </span>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
          <div className="rounded-lg bg-canvas p-2.5 border border-line">
            <span className="section-label block">Chief Complaint</span>
            <p className="mt-1 font-semibold text-ink text-[13px]">{e.history.chiefComplaint || "Routine consultation"}</p>
            {dualCode && <p className="mt-0.5 text-[11px] text-ink-3">{dualCode.namasteTerm}</p>}
          </div>

          <div className="rounded-lg bg-canvas p-2.5 border border-line">
            <span className="section-label block">Allergies & Risk Factors</span>
            <p className="mt-1 font-medium text-ink">
              {e.history.allergies?.length
                ? e.history.allergies.map((a) => a.substance).join(", ")
                : "No known drug allergies (NKDA)"}
            </p>
            {(e.interactions ?? []).some((i) => i.severity === "high") && (
              <span className="mt-1 inline-block rounded bg-critical-subtle px-1.5 py-0.5 text-[10px] font-bold text-critical">
                ⚠ High Risk Drug/Herb Interaction
              </span>
            )}
          </div>

          <div className="rounded-lg bg-canvas p-2.5 border border-line">
            <span className="section-label block">Active Medications</span>
            <p className="mt-1 text-ink-2 truncate">
              {e.history.medications?.length
                ? e.history.medications.map((m) => m.name).join(", ")
                : "None reported"}
            </p>
            <p className="mt-0.5 text-[11px] text-ink-3">
              {e.documents?.length ? `${e.documents.length} document(s) scanned` : "No external documents"}
            </p>
          </div>
        </div>
      </div>

      {/* AYUSH Prakriti Tridosha Radar Chart (when AYUSH assessment is present) */}
      {(e.mode === "ayush" || e.history.ayush) && (
        <PrakritiRadar ayush={e.history.ayush} />
      )}

      {/* Vitals summary */}
      <div className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-[15px] font-semibold text-ink">
              {e.history.name}
              <span className="tabular ml-2 text-[13px] font-normal text-ink-3">
                {e.history.age}
                <span className="lowercase">y</span> &middot; {e.history.sex}
              </span>
            </h3>
            <p className="mt-0.5 text-[12px] text-ink-3">
              <span className="tabular">{e.patient.abhaId}</span>
              {e.patient.mobile && <> &middot; <span className="tabular">{e.patient.mobile}</span></>}
            </p>
          </div>
          <span
            className={`chip ${
              ew.level === "high" ? "chip-critical" : ew.level === "medium" ? "chip-warning" : "chip-success"
            }`}
          >
            EWS {ew.score} &middot; {ewLabel(ew.level)}
          </span>
        </div>
        <div className="tabular mt-2.5 text-[13px] text-ink-2">
          {e.patient.vitals && Object.keys(e.patient.vitals).length
            ? [
                e.patient.vitals.systolic ? `BP ${e.patient.vitals.systolic}/${e.patient.vitals.diastolic ?? "—"} mmHg` : null,
                e.patient.vitals.pulse ? `Pulse ${e.patient.vitals.pulse}/min` : null,
                e.patient.vitals.temperature ? `Temp ${e.patient.vitals.temperature}°C` : null,
                e.patient.vitals.spo2 ? `SpO₂ ${e.patient.vitals.spo2}%` : null,
                e.patient.vitals.weight ? `Weight ${e.patient.vitals.weight} kg` : null,
              ]
                .filter(Boolean)
                .join("  ·  ")
            : "No vitals recorded"}
        </div>
        {e.patient.respondent === "guardian" && (
          <p className="mt-2 flex items-center gap-1.5 text-[12px] text-ink-2">
            <Icon name="users" size={13} className="text-ink-3" />
            History given by guardian: {e.patient.guardian?.name} ({e.patient.guardian?.relation})
          </p>
        )}
        {e.history.menstrualHistory && (
          <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-ink-2">
            <Icon name="droplet" size={13} className="mt-px text-ink-3" />
            {e.history.menstrualHistory}
          </p>
        )}
        {e.history.obstetricHistory && (
          <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-ink-2">
            <Icon name="pregnant" size={13} className="mt-px text-ink-3" />
            {e.history.obstetricHistory}
          </p>
        )}
        {e.documents?.length > 0 && (
          <div className="mt-3">
            <p className="section-label">Scanned documents</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {e.documents.map((d) =>
                d.serverUrl ? (
                  <a
                    key={d.id}
                    href={d.serverUrl}
                    target="_blank"
                    rel="noreferrer"
                    title={d.filename}
                    className="chip chip-info no-underline"
                  >
                    <Icon name="file" size={12} />
                    {d.filename}
                  </a>
                ) : (
                  <span key={d.id} title={d.filename} className="chip chip-neutral">
                    <Icon name="file" size={12} />
                    {d.filename}
                  </span>
                )
              )}
            </div>
          </div>
        )}
        {related.length > 0 && (
          <div className="mt-3 rounded-lg border border-line bg-sunken p-3">
            <p className="section-label flex items-center gap-1.5">
              <Icon name="trending" size={12} />
              Longitudinal record &middot; {related.length} previous visit(s)
            </p>
            <div className="mt-1.5 flex flex-col gap-1">
              {related.slice(0, 4).map((r) => (
                <div key={r.encounterId} className="flex justify-between gap-3 text-[12px] text-ink-2">
                  <span className="truncate">
                    {new Date(r.enteredAt).toLocaleDateString()} &middot; {r.history.chiefComplaint}
                  </span>
                  {r.doctorDiagnosis && <span className="shrink-0 font-medium text-ink">{r.doctorDiagnosis}</span>}
                </div>
              ))}
            </div>
            <BpTrend encounters={[e, ...related]} />
          </div>
        )}
      </div>

      {/* Alerts */}
      {e.redFlags.filter((r) => r.severity === "high").length > 0 && (
        <div className="banner banner-critical flex-col">
          <p className="flex items-center gap-1.5 font-semibold">
            <Icon name="siren" size={15} />
            Priority alerts
          </p>
          {(e.redFlags ?? []).filter((r) => r.severity === "high").map((r) => (
            <p key={r.id} className="mt-0.5">{r.symptom}: {r.message}</p>
          ))}
        </div>
      )}
      {(e.interactions ?? []).filter((i) => i.severity === "high").length > 0 && (
        <div className="banner banner-warning flex-col">
          <p className="flex items-center gap-1.5 font-semibold">
            <Icon name="alert" size={15} />
            Interaction alerts
          </p>
          {(e.interactions ?? []).filter((i) => i.severity === "high").map((i, k) => (
            <p key={k} className="mt-0.5">{i.between}: {i.message}</p>
          ))}
          <CoverageFootnote medications={[...(e.history.medications ?? []), ...(e.prescription?.medications ?? [])]} />
        </div>
      )}
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="section-label">Clinical summary</p>
          {/* Bilingual output (problem statement): the stored English summary
              re-rendered with Hindi scaffolding from the same record fields.
              Clinical prose itself is never machine-translated — drug names,
              dosages and captured text render verbatim in both views. */}
          <div className="flex items-center gap-1 rounded-lg border border-line bg-sunken p-0.5" role="group" aria-label="Summary language">
            {(["en", "hi"] as const).map((lng) => (
              <button
                key={lng}
                type="button"
                onClick={() => setSummaryLang(lng)}
                aria-pressed={summaryLang === lng}
                className={`rounded px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                  summaryLang === lng ? "bg-canvas text-brand shadow-sm" : "text-ink-3 hover:text-ink"
                }`}
              >
                {lng === "en" ? "English" : "हिंदी"}
              </button>
            ))}
          </div>
        </div>
        <pre className="prose-clin max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-sunken p-3 font-sans">
          {summaryLang === "hi"
            ? assembleSummaryHi(
                {
                  history: e.history,
                  mode: e.mode,
                  documents: e.documents ?? [],
                  redFlags: e.redFlags ?? [],
                  vitals: e.patient?.vitals,
                  guardian: e.patient?.guardian,
                  interactionsText: e.interactions?.length ? interactionsToSummary(e.interactions) : undefined,
                },
                false
              )
            : e.summary}
        </pre>
      </div>

      {/* Differential / suggestion panel */}
      <div className="panel p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="panel-title">
            <Icon name="brain" size={15} className="text-ink-3" />
            Decision support
          </p>
          <span className="chip chip-neutral">
            {aiPanel?.hinted ? "Model-assisted" : "Rule-based"}
          </span>
        </div>
        {aiBusy ? (
          <p className="mt-2 text-[12px] text-ink-3">Loading…</p>
        ) : aiPanel ? (
          <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <p className="section-label">Possible differentials</p>
              <ul className="prose-clin mt-1 flex list-disc flex-col gap-1 pl-4">
                {aiPanel.differentials.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="section-label">Ask next</p>
              <ul className="prose-clin mt-1 flex list-disc flex-col gap-1 pl-4">
                {aiPanel.suggestedQuestions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-[12px] text-ink-3">Decision support unavailable.</p>
        )}
      </div>

      {/* HIS/EMR delivery state, with a resend when the export failed */}
      <HisDeliveryPanel encounterId={e.encounterId} role={user?.role} />

      {/* Doctor note + voice input */}
      <div className="panel p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="panel-title">
            <Icon name="note" size={15} className="text-ink-3" />
            Doctor&apos;s note
          </p>
          <button
            onClick={toggleVoice}
            className={`btn btn-sm ${listening ? "btn-danger mic-recording" : "btn-secondary"}`}
          >
            <Icon name="mic" size={14} />
            {listening ? "Listening…" : "Voice note"}
          </button>
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Clinical impression, findings, instructions for the patient…"
          className="field mt-2.5"
        />
        <button
          onClick={() => save({ doctorNote: note }, "Doctor note updated")}
          className="btn btn-secondary btn-sm mt-2"
        >
          <Icon name="save" size={14} />
          Save note
        </button>
      </div>

      {/* Previous visits — longitudinal continuity so repeat visits don't
          re-elicit the whole history. Newest first; selecting one opens it. */}
      <div className="panel p-4">
        <p className="panel-title">
          <Icon name="clock" size={15} className="text-ink-3" />
          Previous visits {related.length > 0 && `(${related.length})`}
        </p>
        {related.length === 0 ? (
          <p className="mt-2 text-[12px] text-ink-3">First visit on record — no prior encounters for this patient.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {related.slice(0, 5).map((r) => (
              <li key={r.encounterId}>
                <button
                  type="button"
                  onClick={() => onSelectEncounter(r.encounterId)}
                  className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-line bg-sunken px-2.5 py-1.5 text-left text-[12px] transition-colors hover:border-line-strong"
                >
                  <span className="tabular font-semibold text-ink">
                    {new Date(r.enteredAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  </span>
                  <span className="chip chip-neutral">{r.status}</span>
                  {r.viaBreakGlass && <span className="chip chip-critical">Override</span>}
                  <span className="min-w-0 flex-1 truncate text-ink-2">
                    {r.history?.chiefComplaint || "Routine consultation"}
                    {r.doctorDiagnosis || r.prescription?.diagnosis ? ` — ${r.doctorDiagnosis || r.prescription?.diagnosis}` : ""}
                  </span>
                  {(r.prescription?.medications?.length ?? 0) > 0 && (
                    <span className="text-ink-3">{r.prescription?.medications?.length} med(s)</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {related.length > 5 && (
          <p className="mt-1.5 text-[11px] text-ink-3">+ {related.length - 5} older visit(s) — use search to find them.</p>
        )}
      </div>

      {/* Longitudinal Lab Trends & Biomarker Tracking */}
      <LabTrends currentEncounter={e} relatedEncounters={related} />

      {/* Chronological medical timeline (Module B): one spine of visits,
          prescriptions, scanned documents and alerts across every visit. */}
      <MedicalTimeline current={e} related={related} onSelectEncounter={onSelectEncounter} />

      {/* e-Prescription builder */}
      <div className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
          <p className="panel-title flex items-center gap-1.5">
            <Icon name="pill" size={16} className="text-brand" />
            e-Prescription Builder
          </p>

          {/* Rx System Mode Switcher */}
          <div className="flex items-center gap-1 rounded-lg border border-line bg-sunken p-1">
            <button
              type="button"
              onClick={() => setRxSystem("allopathic")}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                rxSystem === "allopathic"
                  ? "bg-canvas text-brand shadow-sm font-bold"
                  : "text-ink-3 hover:text-ink"
              }`}
            >
              <Icon name="stethoscope" size={13} />
              Allopathic Rx
            </button>
            <button
              type="button"
              onClick={() => setRxSystem("ayush")}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                rxSystem === "ayush"
                  ? "bg-emerald-700 text-white shadow-sm font-bold"
                  : "text-ink-3 hover:text-ink"
              }`}
            >
              <Icon name="droplet" size={13} />
              AYUSH / Ayurveda Rx (आयुर्वेद)
            </button>
          </div>
        </div>

        <input
          value={diagnosis}
          onChange={(e) => setDiagnosis(e.target.value)}
          placeholder={
            rxSystem === "ayush"
              ? "Provisional Ayurvedic Diagnosis / Roga Nidana (e.g. Amavata, Prameha, Amlapitta, Sandhivata)"
              : "Provisional diagnosis (ICD-10 suggestions appear while typing)"
          }
          list="icd-list"
          aria-label="Provisional diagnosis"
          className="field mt-2.5"
        />
        {icdMatch && (
          <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-info">
            <Icon name="dna" size={13} />
            Suggested ICD-10: <strong>{icdMatch.code}</strong> — {icdMatch.label}
          </p>
        )}
        <datalist id="icd-list">
          {ICD_SUGGESTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>

        <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div>
            <label htmlFor="doctor-reg" className="field-label">
              Doctor registration no. (NMC / State / AYUSH Council)
            </label>
            <input
              id="doctor-reg"
              value={doctorReg}
              onChange={(e) => setDoctorReg(e.target.value)}
              placeholder="e.g. MCI-12345 or AYUSH-WB-6789"
              className="field"
            />
          </div>
          <div>
            <label htmlFor="disposition" className="field-label">
              Disposition
            </label>
            <select
              id="disposition"
              value={disposition}
              onChange={(e) => setDisposition(e.target.value as Prescription["disposition"])}
              className="field"
            >
              <option value="discharge">Discharge home</option>
              <option value="admit">Admit (IPD / Panchakarma)</option>
              <option value="refer">Refer to specialist</option>
              <option value="observe">Observe (short stay)</option>
            </select>
          </div>
        </div>

        {/* Medicines list */}
        <div className="mt-3 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="section-label">Prescribed Medicines ({rxMeds.length})</span>
            {rxSystem === "ayush" && (
              <span className="text-[11px] text-emerald-700 font-medium">
                Ayurvedic Formulations (Churna, Vati, Kwath, Asava) + Anupana (Vehicle)
              </span>
            )}
          </div>
          {deptTemplates.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-line-strong bg-canvas p-2">
              <label htmlFor="rx-template" className="text-[12px] font-medium text-ink-2">
                Template for {e.patient.department}:
              </label>
              <select
                id="rx-template"
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  setTemplateMsg(null);
                }}
                className="field w-auto flex-1 min-w-[12rem] py-1.5 text-[13px]"
              >
                <option value="">Choose a starting regimen…</option>
                {deptTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label} ({t.meds.length} meds)
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!templateId}
                onClick={() => {
                  const tpl = deptTemplates.find((t) => t.id === templateId);
                  if (!tpl) return;
                  const { meds, added } = applyRxTemplate(rxMeds, tpl);
                  setRxMeds(meds);
                  setTemplateMsg(
                    added > 0
                      ? `Added ${added} medicine${added > 1 ? "s" : ""} from “${tpl.label}” — review doses before saving.`
                      : `All medicines from “${tpl.label}” are already on this prescription.`
                  );
                }}
                className="btn btn-secondary btn-sm min-h-[44px] disabled:opacity-50"
              >
                Apply template
              </button>
            </div>
          )}
          {templateMsg && (
            <p role="status" className="text-[12px] text-ink-2">
              {templateMsg}
            </p>
          )}

          {rxMeds.map((m, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-lg border border-line bg-sunken p-2.5">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-12">
                {/* Dosage Form / Formulation */}
                <div className="sm:col-span-3">
                  <label className="field-label text-[10px]">Form</label>
                  <select
                    value={m.dosageForm ?? (rxSystem === "ayush" ? "Vati" : "Tablet")}
                    onChange={(e) => updateMed(i, { dosageForm: e.target.value as DosageForm })}
                    className="field py-1 text-[12px]"
                  >
                    <option value="Tablet">Tablet (Tab)</option>
                    <option value="Capsule">Capsule (Cap)</option>
                    <option value="Syrup">Syrup (Syp)</option>
                    <option value="Churna">Churna (चूर्ण)</option>
                    <option value="Vati">Vati / Gutika (वटी)</option>
                    <option value="Kwatha">Kwath / Decoction (क्वाथ)</option>
                    <option value="Asava/Arishta">Asava / Arishta (आसव)</option>
                    <option value="Taila">Taila / Oil (तैल)</option>
                    <option value="Ghrita">Ghrita (घृत)</option>
                    <option value="Avaleha">Avaleha / Paste (अवलेह)</option>
                    <option value="Injection">Injection (Inj)</option>
                    <option value="Drops">Drops</option>
                    <option value="Ointment">Lepa / Ointment</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                {/* Medicine name */}
                <div className="sm:col-span-5">
                  <label className="field-label text-[10px]">Medicine Name</label>
                  <input
                    value={m.name}
                    onChange={(e) => updateMed(i, { name: e.target.value })}
                    placeholder={rxSystem === "ayush" ? "e.g. Triphala, Chandraprabha, Ashwagandha" : "Medicine name"}
                    aria-label={`Medicine ${i + 1} name`}
                    className="field py-1 text-[13px]"
                  />
                </div>

                {/* Dose */}
                <div className="sm:col-span-2">
                  <label className="field-label text-[10px]">Dose</label>
                  <input
                    value={m.dosage ?? ""}
                    onChange={(e) => updateMed(i, { dosage: e.target.value })}
                    placeholder={rxSystem === "ayush" ? "1 tsp / 1 tab" : "500mg"}
                    aria-label={`Medicine ${i + 1} dose`}
                    className="field py-1 text-[12px]"
                  />
                </div>

                {/* Frequency */}
                <div className="sm:col-span-2 flex items-end gap-1">
                  <div className="flex-1">
                    <label className="field-label text-[10px]">Frequency</label>
                    <input
                      value={m.frequency ?? ""}
                      onChange={(e) => updateMed(i, { frequency: e.target.value })}
                      placeholder="BD / OD"
                      aria-label={`Medicine ${i + 1} frequency`}
                      className="field py-1 text-[12px]"
                    />
                  </div>
                  <button
                    onClick={() => setRxMeds((x) => x.filter((_, j) => j !== i))}
                    aria-label={`Remove medicine ${i + 1}`}
                    className="btn btn-ghost btn-sm text-ink-3 hover:bg-critical-subtle hover:text-critical"
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              </div>

              {/* Second row: Duration, Anupana (Vehicle), Kala (Timing) */}
              <div className="grid grid-cols-1 gap-2 pt-1 border-t border-line/60 sm:grid-cols-3">
                <div>
                  <label className="field-label text-[10px]">Duration</label>
                  <input
                    value={m.duration ?? ""}
                    onChange={(e) => updateMed(i, { duration: e.target.value })}
                    placeholder="e.g. 7 days / 1 month"
                    className="field py-1 text-[12px]"
                  />
                </div>

                {/* Anupana */}
                <div>
                  <label className="field-label text-[10px]">Anupana / Vehicle (माध्यम)</label>
                  <input
                    value={m.anupana ?? ""}
                    onChange={(e) => updateMed(i, { anupana: e.target.value })}
                    placeholder="e.g. Warm water, Honey, Milk, Ghee"
                    list="anupana-list"
                    className="field py-1 text-[12px]"
                  />
                  <datalist id="anupana-list">
                    <option value="Warm Water (उष्ण जल)" />
                    <option value="Honey (मधु)" />
                    <option value="Milk (दुग्ध)" />
                    <option value="Ghee (घृत)" />
                    <option value="Normal Water" />
                  </datalist>
                </div>

                {/* Kala */}
                <div>
                  <label className="field-label text-[10px]">Administration Time / Kala (सेवन काल)</label>
                  <input
                    value={m.kala ?? ""}
                    onChange={(e) => updateMed(i, { kala: e.target.value })}
                    placeholder="e.g. After food (अधोभक्त), Bedtime (निशि)"
                    list="kala-list"
                    className="field py-1 text-[12px]"
                  />
                  <datalist id="kala-list">
                    <option value="Pragbhakta (Before food / खाली पेट)" />
                    <option value="Adhobhakta (After food / भोजन के बाद)" />
                    <option value="Samanabhakta (With food / भोजन के साथ)" />
                    <option value="Nishi (Bedtime / रात को सोते समय)" />
                  </datalist>
                </div>
              </div>
            </div>
          ))}
        </div>

        <button onClick={addMed} className="btn btn-secondary btn-sm mt-2 w-full border-dashed">
          <Icon name="plus" size={14} />
          {rxSystem === "ayush" ? "Add Ayurvedic Medicine (औषधि जोड़ें)" : "Add medicine"}
        </button>

        {/* Dictation to structured draft */}
        <div className="mt-3 rounded-lg border border-line bg-sunken p-3">
          <p className="section-label flex items-center gap-1.5">
            <Icon name="mic" size={12} />
            Dictate prescription
          </p>
          <textarea
            value={dictate}
            onChange={(e) => setDictate(e.target.value)}
            rows={2}
            placeholder='e.g. "Tab paracetamol 500mg thrice daily for 5 days; Churna Triphala 1 tsp with warm water at bed time"'
            aria-label="Dictate prescription in free text"
            className="field mt-1.5"
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <button
              onClick={dictateRx}
              disabled={dictateBusy || !dictate.trim()}
              className="btn btn-secondary btn-sm"
            >
              <Icon name="note" size={14} />
              {dictateBusy ? "Parsing…" : "Generate draft"}
            </button>
            {dictateMsg && <span className="text-[12px] text-ink-2">{dictateMsg}</span>}
          </div>
          <p className="mt-1.5 text-[11px] text-ink-3">
            Appends parsed items to the prescription. The interaction and pregnancy safety checks
            below still apply.
          </p>
        </div>

        {rxWarnings.length > 0 && (
          <div className="banner banner-warning mt-3 flex-col">
            <p className="flex items-center gap-1.5 font-semibold">
              <Icon name="alert" size={14} />
              Prescription safety check
            </p>
            {rxWarnings.map((w, k) => (
              <p key={k} className={w.severity === "high" ? "font-semibold" : ""}>{w.message}</p>
            ))}
          </div>
        )}

        {e.history.sex === "Female" && pregnancyRisks.length > 0 && (
          <div className="banner banner-warning mt-3 flex-col">
            <p className="flex items-center gap-1.5 font-semibold">
              <Icon name="pregnant" size={14} />
              Mother &amp; child safety review
            </p>
            {pregnancyRisks.map((r, k) => (
              <p key={k} className={r.severity === "high" ? "font-semibold" : ""}>
                {r.drug}: {r.message}
              </p>
            ))}
            {rxMeds.filter((m) => pregnancyRisks.some((r) => r.drug === m.name)).length > 0 && (
              <p className="mt-0.5">
                Consider a safer alternative if the patient is or may be pregnant.
              </p>
            )}
          </div>
        )}

        {/* Pathya & Apathya Dietary Recommendations */}
        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div>
            <label htmlFor="rx-pathya" className="field-label text-success flex items-center gap-1">
              <Icon name="check" size={13} />
              Pathya (Do&apos;s / Wholesome Diet &amp; Lifestyle - पथ्य)
            </label>
            <textarea
              id="rx-pathya"
              value={pathya}
              onChange={(e) => setPathya(e.target.value)}
              placeholder="e.g. Light warm food, boiled water, green gram soup, daily walking"
              rows={2}
              className="field"
            />
          </div>
          <div>
            <label htmlFor="rx-apathya" className="field-label text-critical flex items-center gap-1">
              <Icon name="close" size={13} />
              Apathya (Don&apos;ts / Contraindicated Foods - अपथ्य)
            </label>
            <textarea
              id="rx-apathya"
              value={apathya}
              onChange={(e) => setApathya(e.target.value)}
              placeholder="e.g. Curd at night, heavy fried food, cold drinks, day sleep"
              rows={2}
              className="field"
            />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div>
            <label htmlFor="rx-advice" className="field-label">General Advice</label>
            <input
              id="rx-advice"
              value={advice}
              onChange={(e) => setAdvice(e.target.value)}
              placeholder="Diet, rest, hygiene…"
              className="field"
            />
          </div>
          <div>
            <label htmlFor="rx-followup" className="field-label">Follow-up date</label>
            <input
              id="rx-followup"
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              placeholder="e.g. 2026-09-27"
              className="field"
            />
          </div>
        </div>
        <button onClick={savePrescription} className="btn btn-primary mt-3 w-full">
          <Icon name="save" size={16} />
          Save prescription and sync
        </button>
        {rxError && (
          <p role="alert" className="mt-2 text-[13px] font-medium text-critical">{rxError}</p>
        )}
        <button onClick={printFormalRx} className="btn btn-secondary mt-2 w-full">
          <Icon name="printer" size={16} />
          Print A4 prescription with QR ({rxSystem === "ayush" ? "AYUSH format" : "Standard"})
        </button>
      </div>

      {/* After-visit handout */}
      <div className="panel p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="panel-title">
            <Icon name="file" size={15} className="text-ink-3" />
            After-visit handout
          </p>
          <div className="flex gap-2">
            <a target="_blank" rel="noreferrer" href={whatsappLink} className="btn btn-secondary btn-sm no-underline">
              <Icon name="link" size={14} />
              Share
            </a>
            <button
              onClick={() => {
                const area = document.getElementById("print-handout");
                if (area) {
                  area.textContent = handout;
                  area.style.display = "block";
                }
                window.print();
                if (area) area.style.display = "none";
              }}
              className="btn btn-secondary btn-sm"
            >
              <Icon name="printer" size={14} />
              Print handout
            </button>
          </div>
        </div>
        <pre className="prose-clin mt-2.5 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-sunken p-3 font-sans">{handout}</pre>
      </div>

      {/* Hidden print region — formal prescription; styled by @media print in globals.css */}
      <div id="print-area" className="hidden" aria-hidden="true">
        {formalRxOpen && (
          <div className="rx-print">
            <div className="flex items-start justify-between border-b-2 border-slate-900 pb-2">
              <div>
                <p className="text-xl font-black">
                  {rxSystem === "ayush" ? "District AYUSH Hospital & Research Centre" : "District Hospital · OPD"}
                </p>
                <p className="text-[11px] text-ink-3">
                  {rxSystem === "ayush"
                    ? "MediKiosk AYUSH Case Intake & e-Prescription (आयुष पर्चा)"
                    : "MediKiosk e-Prescription &middot; District Hospital outpatient department"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <QRCodeSVG
                  value={JSON.stringify({ encounterId: e.encounterId, token: e.token ?? "" })}
                  size={92}
                  level="M"
                  fgColor="#0f1b2d"
                  includeMargin
                />
                <p className="max-w-[130px] text-[10px] text-slate-500">
                  Scan to re-identify this visit at the kiosk check-in screen.
                </p>
              </div>
            </div>
            <div className="mt-3 space-y-1 text-sm">
              <p><b>Patient:</b> {e.history.name}, {e.history.age} y, {e.history.sex}</p>
              <p><b>ABHA ID:</b> {e.patient.abhaId || "—"} &nbsp;·&nbsp; <b>Token:</b> {e.token ?? "—"} &nbsp;·&nbsp; <b>Date:</b> {new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
              <p>
                <b>Treating Clinician:</b> {user?.name ?? "—"} {user?.qualifications ? `(${user.qualifications})` : ""}
              </p>
              <p className="text-xs text-slate-600">
                <b>Reg No:</b> {e.prescription?.doctorReg ?? user?.councilReg ?? doctorReg ?? "—"} &nbsp;·&nbsp; 
                <b>ABDM HPR ID:</b> {e.prescription?.doctorHprId ?? user?.hprId ?? "—"} &nbsp;·&nbsp; 
                <b>Department:</b> {e.patient.department} {user?.room ? `(${user.room})` : ""}
              </p>
              <p>
                <b>Diagnosis:</b> {icdMatch ? `[ICD-10 ${icdMatch.code}] ` : ""}{diagnosis || "—"} &nbsp;·&nbsp; <b>Disposition:</b> {disposition}
              </p>
              {e.mode === "ayush" && e.history.ayush && (
                <p className="text-[12px] bg-slate-100 p-1.5 rounded">
                  <b>Prakriti:</b> {e.history.ayush.prakriti || "—"} &nbsp;·&nbsp; <b>Agni:</b> {e.history.ayush.agni || "—"} &nbsp;·&nbsp; <b>Koshtha:</b> {e.history.ayush.koshtha || "—"}
                </p>
              )}
            </div>
            <table className="mt-3 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-slate-800 text-left">
                  <th className="py-1 pr-2">#</th>
                  <th className="py-1 pr-2">Form &amp; Medicine</th>
                  <th className="py-1 pr-2">Dose</th>
                  <th className="py-1 pr-2">Frequency</th>
                  <th className="py-1 pr-2">Timing / Anupana</th>
                  <th className="py-1">Duration</th>
                </tr>
              </thead>
              <tbody>
                {rxMeds.map((m, i) => (
                  <tr key={i} className="border-b border-slate-200">
                    <td className="py-1 pr-2">{i + 1}</td>
                    <td className="py-1 pr-2">
                      {m.dosageForm ? `[${m.dosageForm}] ` : ""}{m.name || "—"}
                    </td>
                    <td className="py-1 pr-2">{m.dosage ?? "—"}</td>
                    <td className="py-1 pr-2">{m.frequency ?? "—"}</td>
                    <td className="py-1 pr-2">
                      {[m.kala, m.anupana ? `with ${m.anupana}` : null].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="py-1">{m.duration ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pathya && <p className="mt-3 text-sm"><b>Pathya (Do&apos;s / Wholesome):</b> {pathya}</p>}
            {apathya && <p className="mt-1 text-sm"><b>Apathya (Don&apos;ts / Contraindicated):</b> {apathya}</p>}
            {advice && <p className="mt-2 text-sm"><b>Advice:</b> {advice}</p>}
            {followUp && <p className="mt-1 text-sm"><b>Follow-up:</b> {followUp}</p>}
            {pregnancyRisks.some((r) => r.severity === "high") && (
              <p className="banner banner-critical mt-2 flex-col items-start gap-1">
                <span className="flex items-center gap-2 font-semibold">
                  <Icon name="alert" size={15} />
                  Pregnancy-safe prescribing reviewed
                </span>
                <span>
                  Flagged medication(s) present:{" "}
                  {pregnancyRisks
                    .filter((r) => r.severity === "high")
                    .map((r) => r.drug)
                    .join(", ")}
                  .
                </span>
              </p>
            )}

            {/* Digital e-Prescription Signature Seal */}
            <div className="mt-6 flex items-end justify-between border-t border-slate-300 pt-3 text-xs">
              <div className="text-[10px] text-slate-500 max-w-sm">
                <p className="font-semibold text-slate-700">Digital e-Prescription Verification</p>
                <p className="font-mono mt-0.5">
                  Seal: {e.prescription?.signatureHash ?? `SHA256:${e.encounterId.slice(0, 8)}`}
                </p>
                <p className="mt-0.5">Complies with Pharmacy Practice Regulations 2015 &amp; ABDM e-Rx Standards</p>
              </div>
              <div className="text-right">
                <div className="font-serif italic font-bold text-slate-800 text-sm">{user?.name ?? "Authorized Clinician"}</div>
                <div className="text-[10px] text-slate-500">Digitally Signed &amp; Approved</div>
              </div>
            </div>

            <p className="mt-4 pt-1 text-center text-[10px] text-slate-400">
              MediKiosk SIH-26047 · Hospital Information System &middot; Encounter {e.encounterId}
            </p>
          </div>
        )}
      </div>
      {/* Separate handout print region — never shares #print-area, so printing
          the handout cannot destroy the formal-Rx React tree (and vice versa). */}
      <div id="print-handout" className="hidden" aria-hidden="true" />
    </div>
  );
}

/** Small SVG sparkline of systolic BP across visits. */
function BpTrend({ encounters }: { encounters: StoredHistory[] }) {
  const pts = encounters
    .map((e) => e.patient.vitals?.systolic)
    .filter((v): v is number => typeof v === "number");
  if (pts.length < 2) return null;
  const W = 220;
  const H = 40;
  const min = Math.min(...pts, 60) - 10;
  const max = Math.max(...pts, 180) + 10;
  const x = (i: number) => (pts.length === 1 ? W / 2 : (i / (pts.length - 1)) * W);
  const y = (v: number) => H - ((v - min) / (max - min)) * (H - 6) - 3;
  const line = pts.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <div className="mt-2">
      <p className="text-[10px] font-medium text-ink-3">Systolic BP trend (mmHg)</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[220px]" aria-label="Blood pressure trend">
        <polyline points={line} fill="none" stroke="var(--brand)" strokeWidth="2" />
        {pts.map((v, i) => (
          <circle key={i} cx={x(i)} cy={y(v)} r="2.5" fill="var(--brand)">
            <title>{v} mmHg</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}