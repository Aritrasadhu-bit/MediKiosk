"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";

// Development-only convenience. In production this is never populated, so
// the sign-in screen never advertises working credentials.
const DEMO_ACCOUNTS =
  process.env.NODE_ENV === "development"
    ? [
        {
          username: "doctor",
          password: "doctor123",
          name: "Dr. Ramesh Sharma",
          role: "Ayurvedic Medical Officer",
          dept: "AYUSH (Room 4)",
          hprId: "91-7482-1948-2831",
          reg: "AYUSH-UP-2016-48291",
          icon: "stethoscope" as const,
        },
        {
          username: "doctor_allo",
          password: "doctor123",
          name: "Dr. Priya Mehta",
          role: "Consultant Physician",
          dept: "Internal Med (Room 1)",
          hprId: "91-3829-1049-5832",
          reg: "NMC-2014-83921",
          icon: "stethoscope" as const,
        },
        {
          username: "nurse",
          password: "nurse123",
          name: "Nurse Sunita Verma",
          role: "Triage & Emergency Nurse",
          dept: "Triage Desk 1",
          hprId: "91-9921-3821-4821",
          reg: "INC-DEL-2019-9281",
          icon: "activity" as const,
        },
        {
          username: "pharmacist",
          password: "pharm123",
          name: "Pharmacist Anil Kumar",
          role: "Dispensary Pharmacist",
          dept: "Dispensary (Counter 2)",
          hprId: "91-5829-2819-4829",
          reg: "PCI-UP-2017-38291",
          icon: "pill" as const,
        },
        {
          username: "admin",
          password: "admin123",
          name: "Dr. S. K. Mukherjee",
          role: "Medical Superintendent",
          dept: "Admin Office",
          hprId: "91-1002-3921-0029",
          reg: "NMC-1998-10293",
          icon: "settings" as const,
        },
        {
          username: "cho",
          password: "camp123",
          name: "Kavita Devi (CHO)",
          role: "Community Health Officer",
          dept: "Outreach Camp",
          hprId: "91-4829-1940-2819",
          reg: "INC-2020-48291",
          icon: "users" as const,
        },
      ]
    : [];

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [setupPending, setSetupPending] = useState(false);

  // First-run wizard: surface a setup link while unconfigured.
  useEffect(() => {
    fetch("/api/setup/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (json?.ok && json.configured === false) setSetupPending(true);
      })
      .catch(() => {});
  }, []);

  const submit = async (u = username, p = password) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u.trim(), password: p }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Sign-in failed. Check your username and password.");
        return;
      }
      const destination =
        u.trim().toLowerCase() === "cho"
          ? "/camp"
          : json.user?.role === "admin"
          ? "/admin"
          : json.user?.role === "nurse"
          ? "/triage"
          : json.user?.role === "pharmacist"
          ? "/pharmacy"
          : "/physician";
      router.push(destination);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full flex-1 items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-3xl">
        <div className="govt-tricolor mb-4 rounded" aria-hidden="true" />
        <div className="grid gap-4 md:grid-cols-2">
        <div className="panel hidden p-6 md:block">
          <p className="text-[12px] font-bold uppercase tracking-wide text-ink-3">District Hospital · जिला अस्पताल</p>
          <h2 className="mt-1 text-xl font-bold">Free OPD for all · सभी के लिए निःशुल्क</h2>
          <ul className="prose-clin mt-3 list-disc pl-5">
            <li>ABDM + ABHA ready · DPDP Act 2023 compliant</li>
            <li>OPD 9 AM – 1 PM · Helpline 104 / 108</li>
            <li>Grievance: Medical Superintendent Office</li>
          </ul>
          <p className="mt-3 flex gap-2"><span className="chip chip-success">ABDM</span><span className="chip chip-info">DPDP</span><span className="chip chip-neutral">GIGW 3.0</span></p>
        </div>
        <div className="panel p-6">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand text-white">
            <Icon name="hospital" size={24} />
          </span>
          <h1 className="text-lg font-semibold tracking-tight text-ink">Staff sign in · स्टाफ लॉगिन</h1>
          <p className="mt-1 text-[14px] text-ink-2">
            Physician, triage, pharmacy and admin portals · <span lang="hi">चिकित्सक / नर्स / फार्मेसी</span>
          </p>
        </div>

        {setupPending && (
          <div className="banner banner-warning mb-4">
            <Icon name="hammer" size={16} className="mt-px" />
            <div className="flex-1">
              <p className="font-semibold">First-run setup pending</p>
              <p className="mt-0.5 text-[12px] opacity-90">
                Set the hospital name and create the first administrator account.
              </p>
              <Link href="/setup" className="btn btn-secondary btn-sm mt-2">
                Open setup
                <Icon name="arrowRight" size={14} />
              </Link>
            </div>
          </div>
        )}

        <form
          className="panel flex flex-col gap-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div>
            <label htmlFor="username" className="field-label">
              Username
            </label>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              className="field"
            />
          </div>
          <div>
            <label htmlFor="password" className="field-label">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="field"
            />
          </div>

          {error && (
            <p role="alert" className="banner banner-critical">
              <Icon name="alert" size={15} className="mt-px" />
              {error}
            </p>
          )}

          <button type="submit" disabled={busy || !username || !password} className="btn btn-primary w-full">
            {busy ? "Signing in…" : "Sign in"}
            {!busy && <Icon name="arrowRight" size={16} />}
          </button>

          {DEMO_ACCOUNTS.length > 0 && (
            <div className="mt-1 border-t border-line pt-4">
              <p className="section-label mb-2">Hospital Duty Personas (1-Click Login)</p>
              <div className="flex flex-col gap-1.5">
                {DEMO_ACCOUNTS.map((a) => (
                  <button
                    key={a.username}
                    type="button"
                    disabled={busy}
                    onClick={() => submit(a.username, a.password)}
                    className="flex items-center justify-between gap-2 rounded-lg border border-line bg-canvas p-2 text-left hover:border-brand/40 hover:bg-sunken transition-all disabled:opacity-60"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-subtle text-brand">
                        <Icon name={a.icon} size={14} />
                      </span>
                      <div className="min-w-0">
                        <p className="font-semibold text-xs text-ink truncate">{a.name}</p>
                        <p className="text-[11px] text-ink-3 truncate">{a.role} · {a.dept}</p>
                      </div>
                    </div>
                    <span className="chip border-line text-[10px] font-mono shrink-0">
                      Sign in &rarr;
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </form>

        <Link
          href="/"
          className="mt-5 flex items-center justify-center gap-1.5 text-[13px] text-ink-3 no-underline hover:text-ink"
        >
          <Icon name="arrowLeft" size={14} />
          Back to kiosk · कियोस्क
        </Link>
        </div>
        </div>
      </div>
    </div>
  );
}
