"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { StoredHistory, StaffUser } from "@/lib/types";
import { staffLogout } from "@/lib/staffLogout";
import { Icon } from "@/components/Icon";
import { AppShell } from "@/components/AppShell";

type BackupFile = { filename: string; bytes: number; sha256: string; at: string };
type DrillResult = { at: string; by: string; target: string; restored: number; ok: boolean; error?: string };

type SurveillanceSummary = {
  buckets: { key: string; label: string; count: number; byDepartment: Record<string, number> }[];
  alerts: { key: string; label: string; department: string; count: number; windowStart: string; level: string }[];
  since: string;
};

type KioskHeartbeatRow = {
  kioskId: string;
  lastSeen: string;
  pending: number;
  userAgent: string;
};

function StatCard({ label, value, color = "text-ink" }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="panel p-4">
      <p className="section-label">{label}</p>
      <p className={`mt-2 text-4xl font-black ${color}`}>{value}</p>
    </div>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const [user, setUser] = useState<StaffUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [encounters, setEncounters] = useState<StoredHistory[]>([]);
  const [about, setAbout] = useState<{ version: string; build?: { id: string; time: string | null }; persistence?: string; phiEncrypted?: boolean; hostCookie?: boolean } | null>(null);
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [lastDrill, setLastDrill] = useState<DrillResult | null>(null);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [surv, setSurv] = useState<SurveillanceSummary | null>(null);
  // Kiosk fleet health: which kiosks are alive, silent, or holding unsynced writes.
  const [fleet, setFleet] = useState<KioskHeartbeatRow[] | null>(null);
  const [fleetAt, setFleetAt] = useState(0);
  // Slack/Teams-style alert webhook for silent kiosks and stuck queues.
  // Appointment reminders (day-before SMS for booked visits).
  const [reminderDate, setReminderDate] = useState(() =>
    new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 10)
  );
  const [reminderMsg, setReminderMsg] = useState<string | null>(null);
  const [reminderBusy, setReminderBusy] = useState(false);

  const sendReminders = async () => {
    setReminderBusy(true);
    setReminderMsg(null);
    try {
      const res = await fetch("/api/admin/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: reminderDate }),
      });
      const json = await res.json();
      if (!json.ok) {
        setReminderMsg(json.error ?? "Could not send reminders.");
        return;
      }
      setReminderMsg(
        `${json.sent} sent · ${json.skipped} already reminded · ${json.failed} failed (of ${json.total} booked for ${json.date}). ${json.provider}`
      );
    } catch {
      setReminderMsg("Network error.");
    } finally {
      setReminderBusy(false);
    }
  };

  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSaved, setWebhookSaved] = useState<string | null>(null);
  const [webhookMsg, setWebhookMsg] = useState<string | null>(null);
  const [webhookBusy, setWebhookBusy] = useState(false);

  const loadWebhook = async () => {
    const res = await fetch("/api/admin/alert-webhook", { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => ({ ok: false }));
    if (res?.ok) setWebhookSaved(res.webhook.configured ? res.webhook.maskedUrl : "");
  };

  const saveWebhook = async () => {
    setWebhookBusy(true);
    setWebhookMsg(null);
    try {
      const res = await fetch("/api/admin/alert-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl }),
      });
      const json = await res.json();
      if (!json.ok) {
        setWebhookMsg(json.error ?? "Could not save.");
        return;
      }
      setWebhookSaved(json.webhook.configured ? json.webhook.maskedUrl : "");
      setWebhookUrl("");
      setWebhookMsg("Saved. Alerts fire whenever this fleet view loads.");
    } catch {
      setWebhookMsg("Network error.");
    } finally {
      setWebhookBusy(false);
    }
  };

  const testWebhook = async () => {
    setWebhookBusy(true);
    setWebhookMsg(null);
    try {
      const res = await fetch("/api/admin/alert-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: true }),
      });
      const json = await res.json();
      setWebhookMsg(
        json.ok
          ? (json.sent as string[]).length
            ? `Test ping delivered (${(json.sent as string[]).join(", ")}).`
            : "Webhook reachable — nothing unhealthy to report right now."
          : (json.error ?? "Ping failed."),
      );
    } catch {
      setWebhookMsg("Network error.");
    } finally {
      setWebhookBusy(false);
    }
  };

  const loadFleet = async () => {
    const res = await fetch("/api/kiosk/heartbeat", { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => ({ ok: false }));
    if (res?.ok) {
      setFleet(res.kiosks as KioskHeartbeatRow[]);
      setFleetAt(Date.now());
    }
  };

  // Living-hospital demo (Batch C, P2)
  const [demo, setDemo] = useState<{
    running: boolean;
    intervalSeconds: number;
    startedAt: string | null;
    spawned: number;
    progressed: number;
    demoEncounters: number;
  } | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoMsg, setDemoMsg] = useState<string | null>(null);
  const [demoInterval, setDemoInterval] = useState(8);

  const loadDemo = async () => {
    const res = await fetch("/api/demo/live", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ ok: false }));
    if (res?.ok) setDemo(res.status);
  };

  const startDemo = async () => {
    setDemoBusy(true);
    setDemoMsg(null);
    try {
      const res = await fetch("/api/demo/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intervalSeconds: demoInterval }),
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setDemoMsg(`${json.error ?? "Failed to start demo"}`);
        return;
      }
      setDemo(json.status);
      setDemoMsg("Living-hospital demo running — patients arriving every few seconds.");
    } catch {
      setDemoMsg("Network error.");
    } finally {
      setDemoBusy(false);
    }
  };

  const stopDemo = async () => {
    setDemoBusy(true);
    setDemoMsg(null);
    try {
      const res = await fetch("/api/demo/live", { method: "DELETE", cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setDemoMsg(`${json.error ?? "Failed to stop demo"}`);
        return;
      }
      setDemo(json.status);
      setDemoMsg("⏹ Demo stopped. Existing demo patients remain in the queue.");
    } catch {
      setDemoMsg("Network error.");
    } finally {
      setDemoBusy(false);
    }
  };

  // ---------------------------------------------------------------- maintenance mode (Batch D, R5)
  const [maint, setMaint] = useState<{ active: boolean; reason?: string } | null>(null);
  const [maintMsg, setMaintMsg] = useState<string | null>(null);
  const [maintBusy, setMaintBusy] = useState(false);
  const [maintReason, setMaintReason] = useState("");

  // Emergency overrides review queue (break-glass activations, newest first).
  const [overrides, setOverrides] = useState<
    Array<{ encounterId: string | null; by: string; role: string; reason: string; at: string }>
  >([]);

  const loadMaintenance = async () => {
    const res = await fetch("/api/admin/maintenance", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ ok: false }));
    if (res?.ok) setMaint(res.maintenance);
  };

  const toggleMaintenance = async () => {
    setMaintBusy(true);
    setMaintMsg(null);
    try {
      const next = !maint?.active;
      const res = await fetch("/api/admin/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next, reason: next ? maintReason || "scheduled maintenance" : undefined }),
        cache: "no-store",
      });
      const json = await res.json();
      if (!json.ok) {
        setMaintMsg(`${json.error ?? "Failed"}`);
        return;
      }
      setMaint(json.maintenance);
      setMaintMsg(next ? "Maintenance mode on. Kiosk writes are paused." : "Maintenance mode off. Kiosk writes accepted.");
    } catch {
      setMaintMsg("Network error.");
    } finally {
      setMaintBusy(false);
    }
  };

  // Backup restore drill (Batch D, R4) — prove backups are restorable.
  const [drillMsg, setDrillMsg] = useState<string | null>(null);
  const [drillBusy, setDrillBusy] = useState(false);

  const runDrill = async () => {
    setDrillBusy(true);
    setDrillMsg("Running restore drill…");
    try {
      const res = await fetch("/api/admin/backup-drill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        cache: "no-store",
      });
      const json = await res.json();
      setDrillMsg(json.ok ? `${json.message}` : `${json.error ?? "Drill failed"}`);
      const enc = await fetch("/api/encounters", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ encounters: [] }));
      setEncounters(enc.encounters ?? []);
      // Refresh the persisted drill outcome so the panel below shows this run.
      const bg = await fetch("/api/admin/backups", { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
      setBackups(bg.backups ?? []);
      setLastDrill(bg.lastDrill ?? null);
    } catch {
      setDrillMsg("Drill failed — network error.");
    } finally {
      setDrillBusy(false);
    }
  };

  const loadSurveillance = async () => {
    const res = await fetch("/api/surveillance?hours=72", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ ok: false }));
    if (res?.ok) setSurv(res.report);
  };

const handleSignOut = async () => {
  await staffLogout(() => router.replace("/login"));
};

  useEffect(() => {
    (async () => {
      const me = await fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ ok: false }));
      if (!me.ok || me.user?.role !== "admin") {
        router.replace("/login");
        return;
      }
      setUser(me.user);
      const [enc, cfg] = await Promise.all([
        fetch("/api/encounters", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ encounters: [] as StoredHistory[] })),
        fetch("/api/config")
          .then((r) => r.json())
          .catch(() => ({ version: "?", capabilities: {} as Record<string, unknown> })),
      ]);
      setEncounters(enc.encounters ?? []);
      // /api/config nests the deployment diagnostics under `capabilities`, and
      // names the version `version`. Reading them off the top level silently
      // yielded undefined, which made this panel report "plaintext (dev)" even
      // when PHI encryption was switched on — a false all-clear on the one
      // screen an operator would trust it on. Undefined now renders as "—"
      // (unknown) rather than as a definite negative.
      setAbout({
        version: cfg.version ?? "?",
        build: cfg.build,
        persistence: cfg.capabilities?.persistence,
        phiEncrypted: cfg.capabilities?.phiEncrypted,
        hostCookie: cfg.capabilities?.hostCookie,
      });
      const backupsRes = await fetch("/api/admin/backups", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ backups: [] as BackupFile[] }));
      setBackups(backupsRes.backups ?? []);
      setLastDrill(backupsRes.lastDrill ?? null);
      const bgRes = await fetch("/api/staff/break-glass", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ ok: false }));
      if (bgRes?.ok) setOverrides(bgRes.activations ?? []);
      loadSurveillance();
      loadDemo();
      loadFleet();
      loadWebhook();
      loadMaintenance();
      setAuthLoading(false);
    })();
  }, [router]);

  const stats = useMemo(() => {
    const total = encounters.length;
    const pending = encounters.filter((e) => e.status === "pending").length;
    const triage = encounters.filter((e) => e.status === "triage").length;
    const er = encounters.filter((e) => e.status === "er").length;
    const confirmed = encounters.filter((e) => e.status === "confirmed").length;
    const urgent = encounters.filter((e) => (e.redFlags ?? []).some((r) => r.severity === "high")).length;
    const guardian = encounters.filter((e) => e.patient?.respondent === "guardian").length;
    const ayush = encounters.filter((e) => e.mode === "ayush").length;
    const withVitals = encounters.filter((e) => e.patient.vitals && Object.keys(e.patient.vitals).length).length;
    const prescriptions = encounters.filter((e) => e.prescription?.medications?.length).length;
    return { total, pending, triage, er, confirmed, urgent, guardian, ayush, withVitals, prescriptions };
  }, [encounters]);

  // Export (server) — JSON or CSV+BOM; restore re-imports a JSON backup.
  const [exportBusy, setExportBusy] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportData = async (format: "json" | "csv") => {
    setExportBusy(true);
    try {
      const res = await fetch(`/api/admin/export?format=${format}`, { cache: "no-store" });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `medikiosk-export-${new Date().toISOString().slice(0, 10)}.${format === "json" ? "json" : "csv"}`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExportBusy(false);
    }
  };

  const restoreData = async (file: File) => {
    setRestoreMsg("Restoring…");
    try {
      const text = await file.text();
      const res = await fetch("/api/admin/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      const json = await res.json();
      setRestoreMsg(json.ok ? `Restored ${json.restored ?? "?"} encounters.` : `${json.error ?? "Restore failed"}`);
      const enc = await fetch("/api/encounters", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ encounters: [] }));
      setEncounters(enc.encounters ?? []);
    } catch {
      setRestoreMsg("Restore failed — invalid file.");
    }
  };

  const resetDemo = async () => {
    if (!window.confirm("Reset the demo? This clears all encounters, queue state and appointments, then re-seeds the 3 demo patients.")) return;
    setResetMsg("Resetting…");
    try {
      const res = await fetch("/api/admin/reset", { method: "POST", cache: "no-store" });
      const json = await res.json();
      setResetMsg(json.ok ? `${json.message}` : `${json.error ?? "Reset failed"}`);
      const enc = await fetch("/api/encounters", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ encounters: [] }));
      setEncounters(enc.encounters ?? []);
    } catch {
      setResetMsg("Reset failed.");
    }
  };

  // OPD register export (Batch A, P3) — daily DHIS/RCH-style register.
  const [registerDate, setRegisterDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [registerMsg, setRegisterMsg] = useState<string | null>(null);
  const downloadRegister = async (format: "csv" | "html") => {
    setRegisterMsg(format === "csv" ? "Generating CSV…" : "Opening printable register…");
    try {
      const res = await fetch(`/api/admin/opd-register?date=${registerDate}&format=${format}`, { cache: "no-store" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setRegisterMsg(`${j.error ?? "Export failed"}`);
        return;
      }
      if (format === "html") {
        const html = await res.text();
        const w = window.open("", "_blank");
        if (w) {
          w.document.write(html);
          w.document.close();
          w.focus();
        }
        setRegisterMsg("Register opened — use the browser Print dialog.");
      } else {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `opd-register-${registerDate}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        setRegisterMsg(`Downloaded register for ${registerDate}.`);
      }
    } catch {
      setRegisterMsg("Export failed — is the server up?");
    }
  };

  // Syndromic surveillance (Batch B, U1) — anonymized cluster/outbreak feed.

  const byDept = useMemo(() => {
    const m = new Map<string, number>();
    encounters.forEach((e) => m.set(e.patient.department, (m.get(e.patient.department) ?? 0) + 1));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [encounters]);

  const last7 = useMemo(() => {
    const days: { label: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString(undefined, { weekday: "short" });
      const count = encounters.filter((e) => e.enteredAt.startsWith(key)).length;
      days.push({ label, count });
    }
    return days;
  }, [encounters]);

  const redFlagCounts = useMemo(() => {
    const m = new Map<string, number>();
    encounters.forEach((e) => e.redFlags.forEach((r) => m.set(r.symptom, (m.get(r.symptom) ?? 0) + 1)));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [encounters]);

  const maxDaily = Math.max(1, ...last7.map((d) => d.count));

  if (authLoading) {
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Hospital analytics</h1>
          <p className="text-ink-2">
            Kiosk performance and operational status · version {about?.version}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total encounters" value={stats.total} />
        <StatCard label="Waiting" value={stats.pending} color="text-warning" />
        <StatCard label="In triage" value={stats.triage} color="text-info" />
        <StatCard label="Seen" value={stats.confirmed} color="text-success" />
        <StatCard label="Urgent" value={stats.urgent} color="text-critical" />
        <StatCard label="ER escalated" value={stats.er} color="text-critical" />
        <StatCard label="Prescriptions written" value={stats.prescriptions} color="text-info" />
        <StatCard label="Guardian-mode" value={stats.guardian} />
        <StatCard label="AYUSH mode" value={stats.ayush} color="text-warning" />
        <StatCard label="With vitals" value={stats.withVitals} />
        <div className="panel p-4">
          <p className="section-label">Data tools · OPD Register (state format) · ओपीडी रजिस्टर</p>
          <p className="mt-1 text-[13px] text-ink-2">One-click daily register for MO: Excel/PDF as per state format · <span lang="hi">रोज़ का रजिस्टर एक क्लिक में।</span> Hourly footfall, language split, mode split below.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => exportData("json")}
              disabled={exportBusy || stats.total === 0}
              className="btn btn-dark btn-sm"
            >
              <Icon name="download" size={14} />
              Export JSON
            </button>
            <button
              onClick={() => exportData("csv")}
              disabled={exportBusy || stats.total === 0}
              className="btn btn-secondary btn-sm"
            >
              <Icon name="download" size={14} />
              Export CSV
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="btn btn-secondary btn-sm"
            >
              <Icon name="upload" size={14} />
              Restore JSON
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(ev) => {
                const f = ev.target.files?.[0];
                if (f) restoreData(f);
                ev.target.value = "";
              }}
            />
          </div>
          {restoreMsg && <p className="mt-2 text-[13px] text-ink-2">{restoreMsg}</p>}
          <div className="mt-3 border-t border-line pt-3">
            <button onClick={resetDemo} className="btn btn-danger btn-sm">
              <Icon name="alert" size={14} />
              Reset demo state
            </button>
            {resetMsg && <p className="mt-2 text-[13px] text-ink-2">{resetMsg}</p>}
          </div>
        </div>
      </div>

      {/* Kiosk fleet health — which kiosks are alive, silent, or holding unsynced writes */}
      <div className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="panel-title"><Icon name="activity" size={15} className="text-ink-3" />Kiosk fleet health</p>
            <p className="text-[12px] text-ink-3">
              Silent over 5 min = check power/network. Pending &gt; 0 = writes stuck on that kiosk.
            </p>
          </div>
          <button type="button" onClick={loadFleet} className="btn btn-secondary btn-sm min-h-[44px]">
            <Icon name="refresh" size={14} />
            Refresh
          </button>
        </div>
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-line bg-sunken p-3">
          <p className="text-[13px] font-medium text-ink-2">
            Alert webhook {webhookSaved ? <span className="tabular text-ink-3">({webhookSaved})</span> : <span className="text-ink-3">(not set)</span>} — silent kiosks and stuck queues post here. Paste a Slack/Teams incoming-webhook URL:
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://hooks.slack.com/…"
              inputMode="url"
              className="field min-h-[44px] flex-1 py-1.5 text-[13px]"
            />
            <div className="flex gap-2">
              <button type="button" onClick={saveWebhook} disabled={webhookBusy} className="btn btn-primary btn-sm min-h-[44px] disabled:opacity-50">
                Save
              </button>
              <button type="button" onClick={testWebhook} disabled={webhookBusy} className="btn btn-secondary btn-sm min-h-[44px] disabled:opacity-50">
                Test ping
              </button>
            </div>
          </div>
          {webhookMsg && <p role="status" className="text-[13px] text-ink-2">{webhookMsg}</p>}
        </div>
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-line bg-sunken p-3">
          <p className="text-[13px] font-medium text-ink-2">
            Appointment reminders — day-before SMS for booked visits (already-reminded bookings are skipped):
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="date"
              value={reminderDate}
              onChange={(e) => setReminderDate(e.target.value)}
              aria-label="Reminder date"
              className="field min-h-[44px] w-auto py-1.5 text-[13px]"
            />
            <button type="button" onClick={sendReminders} disabled={reminderBusy || !reminderDate} className="btn btn-primary btn-sm min-h-[44px] disabled:opacity-50">
              <Icon name="phone" size={14} />
              {reminderBusy ? "Sending…" : "Send reminders"}
            </button>
          </div>
          {reminderMsg && <p role="status" className="text-[13px] text-ink-2">{reminderMsg}</p>}
        </div>
        {fleet === null ? (
          <p className="mt-3 text-sm text-ink-3">Loading kiosk heartbeats…</p>
        ) : fleet.length === 0 ? (
          <p className="mt-3 text-sm text-ink-3">No kiosk has checked in yet — heartbeats arrive within a minute of any kiosk page load.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {fleet.map((k) => {
              const silentMs = Math.max(0, fleetAt - new Date(k.lastSeen).getTime());
              const silent = silentMs > 5 * 60_000;
              return (
                <div key={k.kioskId} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-sunken px-3 py-2">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${silent ? "bg-critical" : k.pending > 0 ? "bg-warning" : "bg-success"}`} aria-hidden="true" />
                  <span className="tabular text-sm font-semibold text-ink">{k.kioskId}</span>
                  <span className={`chip ${silent ? "chip-critical" : k.pending > 0 ? "chip-warning" : "chip-success"}`}>
                    {silent ? "silent" : k.pending > 0 ? `${k.pending} unsynced` : "healthy"}
                  </span>
                  <span className="tabular ml-auto text-[12px] text-ink-3">
                    seen {Math.max(0, Math.round(silentMs / 1000))}s ago
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Daily intake */}
        <div className="panel p-4">
          <p className="panel-title"><Icon name="chart" size={15} className="text-ink-3" />Intake — last 7 days</p>
          <div className="mt-4 flex h-40 items-end gap-2">
            {last7.map((d) => (
              <div key={d.label} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-xs font-semibold text-ink-2">{d.count}</span>
                <div
                  className="w-full rounded-t-md bg-brand transition-colors hover:bg-brand-hover"
                  style={{ height: `${Math.max(4, (d.count / maxDaily) * 100)}px` }}
                />
                <span className="text-[10px] text-ink-3">{d.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* By department */}
        <div className="panel p-4">
          <p className="panel-title"><Icon name="building" size={15} className="text-ink-3" />By department</p>
          <div className="mt-3 flex flex-col gap-1.5">
            {byDept.map(([dept, count]) => (
              <div key={dept} className="flex items-center gap-2 text-sm">
                <span className="w-40 truncate text-ink-2">{dept}</span>
                <div className="h-3 flex-1 rounded bg-sunken">
                  <div className="h-3 rounded bg-success" style={{ width: `${(count / Math.max(1, byDept[0][1])) * 100}%` }} />
                </div>
                <span className="w-8 text-right font-semibold text-ink">{count}</span>
              </div>
            ))}
            {byDept.length === 0 && <p className="text-[13px] text-ink-3">No encounters yet.</p>}
          </div>
        </div>

        {/* Red flags */}
        <div className="panel p-4">
          <p className="panel-title"><Icon name="siren" size={15} className="text-critical" />Red-flag triggers</p>
          <div className="mt-3 flex flex-col gap-1.5">
            {redFlagCounts.map(([symptom, count]) => (
              <div key={symptom} className="flex items-center justify-between text-sm">
                <span className="text-ink-2">{symptom}</span>
                <span className="rounded-full bg-critical-subtle px-2 py-0.5 text-xs font-bold text-critical">{count}</span>
              </div>
            ))}
            {redFlagCounts.length === 0 && <p className="text-[13px] text-ink-3">No red flags recorded.</p>}
          </div>
        </div>

        {/* Ops */}
        <div className="panel p-4">
          <p className="panel-title"><Icon name="activity" size={15} className="text-ink-3" />Operational status</p>
          <ul className="mt-3 flex flex-col gap-2 text-sm text-ink-2">
            <li className="flex items-center justify-between">
              <span>Serving build</span>
              <span className="font-mono text-[12px] font-medium text-ink" title={about?.build?.time ?? undefined}>
                {about?.build ? `${about.build.id}${about.build.time ? ` · ${new Date(about.build.time).toLocaleDateString("en-IN")}` : ""}` : "—"}
              </span>
            </li>
            <li className="flex items-center justify-between"><span>Server persistence</span><span className="font-medium text-ink">{about?.persistence ?? "—"}</span></li>
            {/* Three states, not two: "unknown" must never render as "plaintext".
                A missing value here would tell an operator their PHI is exposed
                when it may well be encrypted — or worse, claim encryption is on
                when the report never loaded. */}
            <li className="flex items-center justify-between">
              <span>PHI at rest (AES-256-GCM)</span>
              {about?.phiEncrypted === undefined ? (
                <span className="rounded-full bg-sunken px-2 py-0.5 text-xs font-bold text-ink-3">unknown</span>
              ) : (
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${about.phiEncrypted ? "bg-success-subtle text-success" : "bg-warning-subtle text-warning"}`}>
                  {about.phiEncrypted ? "encrypted" : "plaintext (dev)"}
                </span>
              )}
            </li>
            <li className="flex items-center justify-between">
              <span>Session cookie hardening</span>
              <span className="font-medium text-ink">
                {about?.hostCookie === undefined ? "—" : about.hostCookie ? "__Host- prefix" : "plain (http dev)"}
              </span>
            </li>
            <li className="flex items-center justify-between"><span>Encounter store (server)</span><span className="font-medium text-ink">{encounters.length}</span></li>
            <li className="flex items-center justify-between"><span>Multi-language OCR</span><span className="rounded-full bg-success-subtle px-2 py-0.5 text-xs font-bold text-success">en + 9 regional</span></li>
            <li className="flex items-center justify-between"><span>FHIR R4 export</span><span className="rounded-full bg-success-subtle px-2 py-0.5 text-xs font-bold text-success">available</span></li>
            <li className="flex items-center justify-between"><span>Queue announcements</span><span className="rounded-full bg-success-subtle px-2 py-0.5 text-xs font-bold text-success">live</span></li>
          </ul>
          <p className="mt-3 text-xs text-ink-3">
            Data shown is this device&apos;s encounter store (demo). In production, point the data layer at the hospital HIS/EMR.
          </p>
        </div>
      </div>

      {/* Syndromic surveillance (Batch B, U1) — anonymized outbreak feed */}
      <div className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="panel-title"><Icon name="trending" size={15} className="text-ink-3" />Syndromic surveillance — last 72h</p>
            <p className="text-[12px] text-ink-3">
              Anonymous syndrome counts (fever, respiratory, GI, rash, …) with rolling-window cluster alerts — IDSP-style outbreak early warning.
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={loadSurveillance} className="btn btn-secondary btn-sm">
              <Icon name="refresh" size={14} />
              Refresh
            </button>
            <a href="/api/surveillance?format=csv" className="btn btn-secondary btn-sm">
              <Icon name="download" size={14} />
              CSV
            </a>
          </div>
        </div>

        {surv && (surv.alerts.length > 0 || surv.buckets.length > 0) ? (
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Alerts first — these are the actionable part */}
            {surv.alerts.length > 0 && (
              <div className="rounded-xl border border-critical-border bg-critical-subtle p-4">
                <p className="section-label text-critical">Cluster alerts</p>
                <ul className="mt-2 flex flex-col gap-2">
                  {surv.alerts.map((a, i) => (
                    <li key={i} className="flex items-start justify-between gap-3 text-sm">
                      <div>
                        <span className={`font-bold ${a.level === "warning" ? "text-critical" : "text-warning"}`}>
                          {a.label}
                        </span>
                        <span className="text-ink-2"> · {a.department}</span>
                        <p className="text-[12px] text-ink-2">
                          {a.count} cases in 3h window · from {new Date(a.windowStart).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                          a.level === "warning" ? "bg-critical text-white" : "bg-warning-subtle text-warning"
                        }`}
                      >
                        {a.level}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* Bucket counts */}
            <div className="rounded-lg border border-line p-4">
              <p className="section-label">Syndrome buckets</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {surv.buckets.map((b) => (
                  <div key={b.key} className="flex items-center justify-between rounded-lg bg-sunken px-3 py-2 text-sm">
                    <span className="truncate text-ink-2">{b.label}</span>
                    <span className="ml-2 rounded-full bg-success-subtle px-2 py-0.5 text-[11px] font-semibold text-success">
                      {b.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-3">
            {surv ? "No syndrome clusters in the last 72h — all clear." : "Loading surveillance…"}
          </p>
        )}
      </div>

      {/* Living-hospital demo (Batch C, P2) — scripted arrivals + auto-advance */}
      <div className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="panel-title"><Icon name="users" size={15} className="text-ink-3" />Living-hospital demo</p>
            <p className="text-[12px] text-ink-3">
              Creates a test patient every few seconds and auto-advances the queue from waiting through triage to seen, so the floor is never empty while demonstrating.
            </p>
          </div>
          <span
            className={`chip ${demo?.running ? "border-success-border bg-success-subtle text-success" : "border-line bg-sunken text-ink-2"}`}
          >
            <Icon name={demo?.running ? "play" : "minus"} size={12} />
            {demo?.running ? "Running" : "Stopped"}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="field-label">Arrival interval (seconds)</span>
            <input
              type="number"
              min={1}
              max={120}
              value={demoInterval}
              disabled={demo?.running}
              onChange={(e) => setDemoInterval(Number(e.target.value))}
              className="field mt-1 w-32 py-1.5 text-[13px] disabled:opacity-40"
            />
          </label>
          {demo?.running ? (
            <button onClick={stopDemo} disabled={demoBusy} className="btn btn-danger">
              <Icon name="minus" size={14} />
              Stop demo
            </button>
          ) : (
            <button onClick={startDemo} disabled={demoBusy} className="btn btn-primary">
              <Icon name="play" size={14} />
              Start demo
            </button>
          )}
          <div className="ml-auto flex flex-wrap gap-4 text-[12px] text-ink-2">
            <span>
              Arrived: <strong className="tabular text-ink">{demo?.spawned ?? 0}</strong>
            </span>
            <span>
              Auto-advanced: <strong className="tabular text-ink">{demo?.progressed ?? 0}</strong>
            </span>
            <span>
              Demo records: <strong className="tabular text-ink">{demo?.demoEncounters ?? 0}</strong>
            </span>
          </div>
        </div>
        {demoMsg && <p className="mt-2 text-[13px] text-ink-2">{demoMsg}</p>}
      </div>

      {/* OPD register (Batch A, P3) — daily DHIS/RCH-style register */}
      <div className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="panel-title"><Icon name="clipboard" size={15} className="text-ink-3" />Daily OPD register</p>
            <p className="text-[12px] text-ink-3">
              Serial · time · token · patient · OPD no. · village · department · complaint · diagnosis · medicines · doctor — the register the MO signs.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={registerDate}
              onChange={(e) => setRegisterDate(e.target.value)}
              className="field w-auto py-1.5 text-[13px]"
            />
            <button onClick={() => downloadRegister("csv")} className="btn btn-dark btn-sm">
              <Icon name="download" size={14} />
              CSV
            </button>
            <button onClick={() => downloadRegister("html")} className="btn btn-secondary btn-sm">
              <Icon name="printer" size={14} />
              Printable register
            </button>
          </div>
        </div>
        {registerMsg && <p className="mt-2 text-[13px] text-ink-2">{registerMsg}</p>}
      </div>

      {/* Automated backups (SHA-256 manifest, retention 7) */}
      <div className="panel p-4">
        <div className="flex items-center justify-between">
          <p className="panel-title"><Icon name="save" size={15} className="text-ink-3" />Automated backups</p>
          <span className="rounded-full bg-sunken px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-2">
            retention · last 7 · sha-256 manifest · every 6h
          </span>
        </div>
        {backups.length === 0 ? (
          <p className="mt-3 text-sm text-ink-3">No backups yet — exporting JSON or running a drill creates one automatically.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-3">
                  <th className="py-2 pr-4">Snapshot</th>
                  <th className="py-2 pr-4">Size</th>
                  <th className="py-2">SHA-256</th>
                </tr>
              </thead>
              <tbody>
                {backups.slice(0, 7).map((b) => (
                  <tr key={b.filename} className="border-b border-line last:border-0">
                    <td className="py-2 pr-4 font-mono text-xs text-ink">{b.filename}</td>
                    <td className="py-2 pr-4 text-xs text-ink-2">{(b.bytes / 1024).toFixed(1)} KB</td>
                    <td className="py-2 font-mono text-[11px] text-ink-3">{b.sha256.slice(0, 20)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button onClick={runDrill} disabled={drillBusy} className="btn btn-secondary btn-sm">
            <Icon name="shield" size={14} />
            Run restore drill
          </button>
          <p className="text-[12px] text-ink-3">
            Backs up, verifies a SHA-256 checksum, then re-imports every record using a merge base so newer data is never overwritten.
          </p>
        </div>
        {drillMsg && <p className="mt-2 text-[13px] text-ink-2">{drillMsg}</p>}
        {lastDrill && (
          <p className={`mt-2 rounded-lg px-2.5 py-1.5 text-[12px] font-medium ${lastDrill.ok ? "bg-success-subtle text-success" : "bg-critical-subtle text-critical"}`}>
            Last drill — {new Date(lastDrill.at).toLocaleString("en-IN")} by {lastDrill.by}:{" "}
            {lastDrill.ok
              ? `passed, ${lastDrill.restored} record(s) re-imported from ${lastDrill.target}`
              : `FAILED: ${lastDrill.error ?? "verification failed"}`}
          </p>
        )}
      </div>

      {/* Maintenance mode (Batch D, R5) */}
      <div className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="panel-title"><Icon name="settings" size={15} className="text-ink-3" />Maintenance mode</p>
            <p className="text-[12px] text-ink-3">
              Pauses kiosk writes (encounters, camp sync, appointments) with a 503 while a backup/migration window runs — no silent data loss.
            </p>
          </div>
          <span
            className={`chip ${
              maint?.active ? "border-warning-border bg-warning-subtle text-warning" : "border-line bg-sunken text-ink-2"
            }`}
          >
            <Icon name={maint?.active ? "lock" : "play"} size={12} />
            {maint?.active ? "Active" : "Off"}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block min-w-[220px] flex-1">
            <span className="field-label">Reason (shown on the kiosk)</span>
            <input
              value={maintReason}
              disabled={maint?.active}
              onChange={(e) => setMaintReason(e.target.value)}
              placeholder="e.g. nightly backup window"
              className="field mt-1 disabled:opacity-40"
            />
          </label>
          <button
            onClick={toggleMaintenance}
            disabled={maintBusy}
            className={`btn btn-sm ${maint?.active ? "btn-secondary" : "btn-warning"}`}
          >
            <Icon name={maint?.active ? "play" : "lock"} size={15} />
            {maint?.active ? "Resume kiosk writes" : "Start maintenance"}
          </button>
        </div>
        {maintMsg && <p className="mt-2 text-[13px] text-ink-2">{maintMsg}</p>}
      </div>

      <div className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="panel-title"><Icon name="siren" size={15} className="text-critical" />Emergency overrides</p>
            <p className="text-[12px] text-ink-3">
              Break-glass activations for the Medical Superintendent&apos;s review — who overrode consent, for which record, and why. Each activation opens a 15-minute emergency read window.
            </p>
          </div>
          <span className={`chip ${overrides.length ? "border-critical-subtle bg-critical-subtle text-critical" : "border-line bg-sunken text-ink-2"}`}>
            {overrides.length} activation{overrides.length === 1 ? "" : "s"}
          </span>
        </div>
        {overrides.length === 0 ? (
          <p className="mt-3 text-[13px] text-ink-3">No emergency overrides recorded.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {overrides.slice(0, 10).map((o, i) => (
              <li key={`${o.at}-${i}`} className="rounded-lg border border-line bg-sunken p-2.5 text-[12px]">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold text-ink">{o.by}</span>
                  <span className="text-ink-3">({o.role})</span>
                  <span className="tabular text-ink-3">{new Date(o.at).toLocaleString("en-IN")}</span>
                  {o.encounterId && <span className="font-mono text-ink-2">{o.encounterId.slice(0, 8)}</span>}
                </div>
                <p className="mt-1 text-ink-2">{o.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
    </AppShell>
  );
}