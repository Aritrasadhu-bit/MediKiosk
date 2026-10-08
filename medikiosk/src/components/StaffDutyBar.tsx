"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import type { StaffUser } from "@/lib/types";

const IDLE_LOCK_SECONDS = 180; // 3 minutes idle auto-lock (DPDP Act 2023)

const DEMO_PERSONAS: Array<{
  username: string;
  name: string;
  role: string;
  roleType: "doctor" | "nurse" | "pharmacist" | "admin";
  dept: string;
  room: string;
  hprId: string;
  reg: string;
  degrees: string;
  route: string;
  icon: "stethoscope" | "activity" | "pill" | "settings" | "users";
  tagColor: string;
}> = [
  {
    username: "doctor",
    name: "Dr. Ramesh Sharma",
    role: "Ayurvedic Medical Officer",
    roleType: "doctor",
    dept: "AYUSH - Ayurveda",
    room: "OPD Room 4",
    hprId: "91-7482-1948-2831",
    reg: "AYUSH-UP-2016-48291",
    degrees: "BAMS, MD (Kaya Chikitsa)",
    route: "/physician",
    icon: "stethoscope",
    tagColor: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  },
  {
    username: "doctor_allo",
    name: "Dr. Priya Mehta",
    role: "Consultant Physician",
    roleType: "doctor",
    dept: "General Medicine",
    room: "OPD Room 1",
    hprId: "91-3829-1049-5832",
    reg: "NMC-2014-83921",
    degrees: "MBBS, MD (General Medicine)",
    route: "/physician",
    icon: "stethoscope",
    tagColor: "bg-blue-500/10 text-blue-700 border-blue-500/30",
  },
  {
    username: "nurse",
    name: "Nurse Sunita Verma",
    role: "Triage & Emergency Nurse",
    roleType: "nurse",
    dept: "Triage Desk",
    room: "Counter 1",
    hprId: "91-9921-3821-4821",
    reg: "INC-DEL-2019-9281",
    degrees: "B.Sc Nursing (Critical Care)",
    route: "/triage",
    icon: "activity",
    tagColor: "bg-purple-500/10 text-purple-700 border-purple-500/30",
  },
  {
    username: "pharmacist",
    name: "Pharmacist Anil Kumar",
    role: "Dispensary Officer",
    roleType: "pharmacist",
    dept: "Dispensary",
    room: "Counter 2",
    hprId: "91-5829-2819-4829",
    reg: "PCI-UP-2017-38291",
    degrees: "B.Pharm (Reg. Pharmacist)",
    route: "/pharmacy",
    icon: "pill",
    tagColor: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  },
  {
    username: "admin",
    name: "Dr. S. K. Mukherjee",
    role: "Medical Superintendent",
    roleType: "admin",
    dept: "Administration",
    room: "Superintendent Office",
    hprId: "91-1002-3921-0029",
    reg: "NMC-1998-10293",
    degrees: "MBBS, MHA (Superintendent)",
    route: "/admin",
    icon: "settings",
    tagColor: "bg-rose-500/10 text-rose-700 border-rose-500/30",
  },
  {
    username: "cho",
    name: "Kavita Devi (CHO)",
    role: "Community Health Officer",
    roleType: "nurse",
    dept: "Field Outreach",
    room: "Sub-Centre / Camp",
    hprId: "91-4829-1940-2819",
    reg: "INC-2020-48291",
    degrees: "CHO / ASHA Facilitator",
    route: "/camp",
    icon: "users",
    tagColor: "bg-teal-500/10 text-teal-700 border-teal-500/30",
  },
];

interface Props {
  user: StaffUser;
}

export default function StaffDutyBar({ user }: Props) {
  const router = useRouter();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);
  const [breakGlassOpen, setBreakGlassOpen] = useState(false);
  const [breakGlassReason, setBreakGlassReason] = useState("");
  const [breakGlassActive, setBreakGlassActive] = useState(false);
  const [breakGlassError, setBreakGlassError] = useState<string | null>(null);
  const [breakGlassSaving, setBreakGlassSaving] = useState(false);
  const [switching, setSwitching] = useState(false);

  // Idle timer for DPDP Act 2023 terminal auto-lock
  const lastActivity = useRef(0);
  useEffect(() => {
    lastActivity.current = Date.now();
    const updateActivity = () => {
      lastActivity.current = Date.now();
    };
    window.addEventListener("pointerdown", updateActivity);
    window.addEventListener("keydown", updateActivity);
    window.addEventListener("touchstart", updateActivity, { passive: true });

    const interval = window.setInterval(() => {
      if (!isLocked && lastActivity.current > 0 && Date.now() - lastActivity.current >= IDLE_LOCK_SECONDS * 1000) {
        setIsLocked(true);
      }
    }, 5000);

    return () => {
      window.removeEventListener("pointerdown", updateActivity);
      window.removeEventListener("keydown", updateActivity);
      window.removeEventListener("touchstart", updateActivity);
      window.clearInterval(interval);
    };
  }, [isLocked]);

  const unlockWithPin = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    // The lock screen deters casual/shoulder-surfing access on a shared
    // terminal — it is not a second authentication factor. The check must be
    // against the documented demo PIN, not "any 4 digits" (a previous
    // `|| pinInput.length === 4` made every 4-digit input unlock the terminal).
    // Production deployments need server-verified re-authentication here.
    if (pinInput === "1234") {
      setIsLocked(false);
      setPinInput("");
      setPinError(false);
      lastActivity.current = Date.now();
    } else {
      setPinError(true);
      setPinInput("");
    }
  };

  const switchPersona = async (persona: (typeof DEMO_PERSONAS)[number]) => {
    setSwitching(true);
    try {
      const password =
        persona.username === "admin"
          ? "admin123"
          : persona.username === "nurse"
          ? "nurse123"
          : persona.username === "pharmacist"
          ? "pharm123"
          : persona.username === "cho"
          ? "camp123"
          : "doctor123";

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: persona.username, password }),
      });
      if (res.ok) {
        setDropdownOpen(false);
        router.push(persona.route);
        router.refresh();
      }
    } catch {
      /* ignore */
    } finally {
      setSwitching(false);
    }
  };

  const submitBreakGlass = async () => {
    if (!breakGlassReason.trim() || breakGlassSaving) return;
    // The dialog promises server-side recording — the badge must only flip
    // once the server confirms the activation was logged.
    setBreakGlassSaving(true);
    setBreakGlassError(null);
    try {
      const res = await fetch("/api/staff/break-glass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: breakGlassReason.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setBreakGlassError(json.error ?? "Could not record the override — try again.");
        return;
      }
      setBreakGlassActive(true);
      setBreakGlassOpen(false);
      if (typeof window !== "undefined") {
        sessionStorage.setItem("break_glass_active", "true");
        sessionStorage.setItem("break_glass_reason", breakGlassReason);
      }
    } catch {
      setBreakGlassError("Could not record the override — try again.");
    } finally {
      setBreakGlassSaving(false);
    }
  };

  return (
    <>
      {/* Clinician Duty & Fast Persona Switching Bar */}
      <div className="border-b border-line bg-canvas-sunken/80 backdrop-blur-sm px-4 py-1.5 text-xs text-ink-2">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2">
          {/* Active Clinician Identity with HPR & Council Reg */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 font-semibold text-ink">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              {user.name}
            </span>
            {user.qualifications && (
              <span className="text-ink-3 hidden sm:inline">({user.qualifications})</span>
            )}
            {user.room && (
              <span className="chip border-line bg-surface text-[11px] font-medium text-ink-2">
                <Icon name="building" size={11} /> {user.room}
              </span>
            )}
            {user.councilReg && (
              <span className="chip border-line bg-surface text-[11px] font-mono text-ink-3 hidden md:inline-flex">
                Reg: {user.councilReg}
              </span>
            )}
            {user.hprId && (
              <span className="chip border-brand/30 bg-brand-subtle text-[11px] font-mono text-brand font-semibold hidden lg:inline-flex">
                ABDM HPR: {user.hprId}
              </span>
            )}
            {breakGlassActive && (
              <span className="chip chip-critical animate-pulse font-bold">
                <Icon name="siren" size={12} /> BREAK-GLASS ACTIVE
              </span>
            )}
          </div>

          {/* Quick Actions: Shift Switcher, Lock, Emergency Override */}
          <div className="flex items-center gap-2">
            <span className="chip chip-neutral hidden xl:inline-flex text-[11px]" title="Shift handover">
              <Icon name="clock" size={11} /> Shift ends 2 PM · 18 pending · Handover note
            </span>
            {/* Break-Glass Emergency Button */}
            {!breakGlassActive ? (
              <button
                type="button"
                onClick={() => setBreakGlassOpen(true)}
                className="btn btn-ghost btn-sm text-critical hover:bg-critical-subtle text-[11px] py-1 px-2 h-7"
                title="Emergency Trauma / Unconscious Patient Override"
              >
                <Icon name="siren" size={13} />
                <span className="hidden sm:inline">Break-Glass</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setBreakGlassActive(false);
                  if (typeof window !== "undefined") {
                    sessionStorage.removeItem("break_glass_active");
                    sessionStorage.removeItem("break_glass_reason");
                  }
                  fetch("/api/staff/break-glass", {
                    method: "DELETE",
                  }).catch(() => {});
                }}
                className="btn btn-ghost btn-sm text-ink-3 text-[11px] py-1 px-2 h-7"
              >
                Exit Break-Glass
              </button>
            )}

            {/* Lock Screen Button */}
            <button
              type="button"
              onClick={() => setIsLocked(true)}
              className="btn btn-secondary btn-sm text-[11px] py-1 px-2.5 h-7"
              title="Lock Terminal (DPDP Act 2023)"
            >
              <Icon name="lock" size={13} />
              <span className="hidden sm:inline">Lock</span>
            </button>

            {/* Quick Stakeholder Duty Switcher */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="btn btn-primary btn-sm text-[11px] py-1 px-2.5 h-7 flex items-center gap-1.5"
              >
                <Icon name="refresh" size={13} />
                <span>Switch Shift</span>
                <Icon name="arrowRight" size={11} className="rotate-90" />
              </button>

              {dropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setDropdownOpen(false)}
                  />
                  <div className="absolute right-0 top-full mt-1 z-50 w-72 rounded-xl border border-line bg-surface p-2 shadow-2xl animate-fadeIn">
                    <div className="px-2 py-1.5 border-b border-line mb-1">
                      <p className="font-semibold text-xs text-ink">OPD Duty Shift Switcher</p>
                      <p className="text-[10px] text-ink-3">Switch between staff personas instantly</p>
                    </div>
                    <div className="flex flex-col gap-1 max-h-80 overflow-y-auto">
                      {DEMO_PERSONAS.map((p) => {
                        const isCurrent = user.username === p.username;
                        return (
                          <button
                            key={p.username}
                            type="button"
                            disabled={switching || isCurrent}
                            onClick={() => switchPersona(p)}
                            className={`flex flex-col items-start gap-0.5 rounded-lg p-2 text-left transition-colors ${
                              isCurrent
                                ? "bg-brand-subtle border border-brand/40"
                                : "hover:bg-sunken border border-transparent"
                            }`}
                          >
                            <div className="flex items-center justify-between w-full">
                              <span className="font-semibold text-xs text-ink flex items-center gap-1.5">
                                <Icon name={p.icon} size={13} className="text-ink-2" />
                                {p.name}
                              </span>
                              <span className={`chip text-[9px] py-0 px-1.5 border ${p.tagColor}`}>
                                {p.room.split(" ")[0]}
                              </span>
                            </div>
                            <span className="text-[11px] text-ink-2">{p.role} · {p.dept}</span>
                            <span className="text-[10px] text-ink-3 font-mono">HPR: {p.hprId}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Terminal PIN Lock Modal (DPDP Act 2023 Workstation Privacy) */}
      {isLocked && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
          <div className="panel w-full max-w-sm p-6 text-center shadow-2xl border-line-strong animate-fadeIn">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-subtle text-brand mb-3">
              <Icon name="lock" size={28} />
            </div>
            <h2 className="text-lg font-bold text-ink">Terminal Locked</h2>
            <p className="mt-1 text-xs text-ink-2">
              Shared consultation terminal locked to protect patient health records (DPDP Act 2023).
            </p>
            <div className="mt-3 rounded-lg bg-sunken p-2.5 text-xs text-ink">
              <p className="font-semibold">{user.name}</p>
              <p className="text-ink-3 text-[11px]">{user.role.toUpperCase()} · {user.room ?? user.department}</p>
            </div>

            <form onSubmit={unlockWithPin} className="mt-4 flex flex-col gap-3">
              <div>
                <label htmlFor="staff-pin" className="sr-only">4-Digit PIN</label>
                <input
                  id="staff-pin"
                  type="password"
                  maxLength={4}
                  autoFocus
                  placeholder="Enter 4-digit PIN"
                  value={pinInput}
                  onChange={(e) => {
                    setPinInput(e.target.value.replace(/\D/g, ""));
                    setPinError(false);
                  }}
                  className="field text-center font-mono text-xl tracking-[0.5em]"
                />
              </div>

              {pinError && (
                <p className="text-xs font-semibold text-critical">Invalid PIN. Contact your administrator if you forgot it.</p>
              )}

              <button
                type="submit"
                disabled={pinInput.length < 4}
                className="btn btn-primary btn-lg w-full"
              >
                <Icon name="check" size={16} /> Unlock Terminal
              </button>

              <button
                type="button"
                onClick={() => {
                  router.push("/login");
                }}
                className="btn btn-ghost btn-sm text-ink-3"
              >
                Switch Account / Sign Out
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Emergency Break-Glass Override Modal */}
      {breakGlassOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
          <div className="panel w-full max-w-md p-6 shadow-2xl border-critical-subtle animate-fadeIn">
            <div className="flex items-center gap-3 text-critical border-b border-critical-subtle pb-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-critical-subtle">
                <Icon name="siren" size={22} />
              </span>
              <div>
                <h3 className="text-base font-bold text-ink">Emergency Break-Glass Access</h3>
                <p className="text-xs text-critical font-medium">Acute trauma / unconscious patient override</p>
              </div>
            </div>

            <div className="mt-4 text-xs text-ink-2 space-y-2">
              <p>
                <strong>DPDP Act 2023 Section 7 Exemption:</strong> Bypasses routine consent requirements for acute medical emergencies.
              </p>
              <p className="text-critical font-medium">
                ⚠️ All actions taken during this session will be recorded with high-priority immutable audit logs and reported to the Medical Superintendent.
              </p>
            </div>

            <div className="mt-4">
              <label className="field-label">Mandatory Clinical Justification / Emergency Reason</label>
              <textarea
                rows={3}
                placeholder="e.g. Unconscious road traffic accident victim, immediate resuscitation & blood group check required."
                value={breakGlassReason}
                onChange={(e) => setBreakGlassReason(e.target.value)}
                className="field mt-1 text-xs"
              />
            </div>

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setBreakGlassOpen(false)}
                className="btn btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!breakGlassReason.trim() || breakGlassSaving}
                onClick={submitBreakGlass}
                className="btn btn-primary bg-critical hover:bg-critical/90 flex-1"
              >
                {breakGlassSaving ? "Recording…" : "Confirm Override"}
              </button>
            </div>
            {breakGlassError && (
              <p className="mt-2 text-xs font-semibold text-critical">{breakGlassError}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
