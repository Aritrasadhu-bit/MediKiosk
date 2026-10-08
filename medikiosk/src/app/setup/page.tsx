"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";

/**
 * First-run setup wizard (Batch C, P5).
 *
 * Runs only while the site is unconfigured (/api/setup/status returns configured:false).
 * Collects hospital name + kiosk departments, then the initial admin credentials.
 * After the one POST the wizard closes permanently.
 */
export default function SetupPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState<1 | 2>(1);
  const [hospitalName, setHospitalName] = useState("");
  const [departmentsText, setDepartmentsText] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch("/api/setup/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (!json.ok) return;
        if (json.configured) router.replace("/login");
        else setChecking(false);
      })
      .catch(() => setChecking(false));
  }, [router]);

  const departments = departmentsText
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hospitalName, departments, username, password }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Setup failed");
        return;
      }
      setDone(true);
      setTimeout(() => router.push("/login"), 1200);
    } catch {
      setError("Network error — is the server running?");
    } finally {
      setBusy(false);
    }
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
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-lg">
        <div className="panel p-6 shadow-lg">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-brand-subtle text-brand">
            <Icon name="hospital" size={26} />
          </div>
          <h1 className="mt-4 text-center text-lg font-semibold tracking-tight text-ink">
            Welcome to MediKiosk
          </h1>
          <p className="mt-1 text-center text-[13px] text-ink-2">
            First-run setup. Register your hospital and create the administrator account.
          </p>

          <div className="mt-6 flex items-center gap-2">
            <span className={step === 1 ? "chip chip-info" : "chip chip-success"}>
              <Icon name={step === 1 ? "building" : "check"} size={13} />
              Hospital
            </span>
            <span className="h-px flex-1 bg-line" />
            <span className={step === 2 ? "chip chip-info" : "chip"}>
              <Icon name={step === 2 ? "user" : "lock"} size={13} />
              Administrator
            </span>
          </div>

          {done ? (
            <div className="banner banner-success mt-6 justify-center">
              <Icon name="checkCircle" size={16} className="mt-px" />
              Setup complete. Redirecting to sign-in…
            </div>
          ) : step === 1 ? (
            <div className="mt-6 flex flex-col gap-4">
              <label className="block">
                <span className="field-label">Hospital / clinic name</span>
                <input
                  value={hospitalName}
                  onChange={(e) => setHospitalName(e.target.value)}
                  placeholder="e.g. District Hospital, Ayodhya"
                  className="field mt-1"
                />
              </label>
              <label className="block">
                <span className="field-label">Kiosk departments (comma-separated)</span>
                <textarea
                  value={departmentsText}
                  onChange={(e) => setDepartmentsText(e.target.value)}
                  rows={3}
                  placeholder="General Medicine, Cardiology, Paediatrics, Obstetrics…"
                  className="field mt-1"
                />
                <span className="mt-1 block text-[12px] text-ink-3">
                  Leave empty to keep the default 16 departments.
                </span>
              </label>
              <button
                onClick={() => setStep(2)}
                disabled={!hospitalName.trim()}
                className="btn btn-primary btn-lg"
              >
                Continue
                <Icon name="arrowRight" size={16} />
              </button>
            </div>
          ) : (
            <div className="mt-6 flex flex-col gap-4">
              <label className="block">
                <span className="field-label">Admin username</span>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  placeholder="admin"
                  className="field mt-1"
                />
              </label>
              <label className="block">
                <span className="field-label">Admin password (min 8 characters)</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  className="field mt-1"
                />
              </label>
              <label className="block">
                <span className="field-label">Confirm password</span>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  className="field mt-1"
                />
              </label>
              {error && (
                <p className="banner banner-critical">
                  <Icon name="alert" size={15} className="mt-px" />
                  {error}
                </p>
              )}
              {password.length > 0 && confirm.length > 0 && password !== confirm && (
                <p className="text-[13px] font-medium text-warning" role="status">
                  Passwords do not match yet — retype the confirmation to enable Finish setup.
                </p>
              )}
              {password.length > 0 && password.length < 8 && (
                <p className="text-[13px] font-medium text-warning" role="status">
                  Password needs at least 8 characters ({password.length}/8).
                </p>
              )}
              <div className="flex gap-3">
                <button onClick={() => setStep(1)} className="btn btn-secondary btn-lg">
                  <Icon name="arrowLeft" size={16} />
                  Back
                </button>
                <button
                  onClick={submit}
                  disabled={
                    busy ||
                    username.trim().length < 3 ||
                    password.length < 8 ||
                    password !== confirm
                  }
                  className="btn btn-primary btn-lg flex-1"
                >
                  {busy ? "Saving…" : "Finish setup"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}