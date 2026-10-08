"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { StaffUser, StoredHistory } from "@/lib/types";
import { staffLogout } from "@/lib/staffLogout";
import PictogramStrip from "@/components/PictogramStrip";
import { Icon } from "@/components/Icon";
import { AppShell } from "@/components/AppShell";

export default function PharmacyPage() {
  const router = useRouter();
  const [user, setUser] = useState<StaffUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [encounters, setEncounters] = useState<StoredHistory[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const me = await fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ ok: false }));
      if (!me.ok || !["pharmacist", "admin"].includes(me.user?.role ?? "")) {
        router.replace("/login");
        return;
      }
      setUser(me.user);
      const enc = await fetch("/api/encounters", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ encounters: [] as StoredHistory[] }));
      setEncounters(enc.encounters ?? []);
      setChecking(false);
    })();
  }, [router]);

  const pending = useMemo(
    () =>
      encounters
        .filter((e) => e.status === "confirmed" && e.prescription?.medications?.length && !e.dispensedAt)
        .sort((a, b) => a.enteredAt.localeCompare(b.enteredAt)),
    [encounters]
  );
  const dispensed = useMemo(
    () =>
      encounters
        .filter((e) => e.prescription?.medications?.length && e.dispensedAt)
        .sort((a, b) => (b.dispensedAt ?? "").localeCompare(a.dispensedAt ?? ""))
        .slice(0, 12),
    [encounters]
  );

  const markDispensed = async (e: StoredHistory) => {
    if (!window.confirm(`Mark prescription for ${e.patient.name} as dispensed?`)) return;
    setBusyId(e.encounterId);
    const res = await fetch(`/api/encounters/${e.encounterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dispensedAt: new Date().toISOString(),
        audit: [{ action: "dispensed", at: new Date().toISOString(), detail: "Medication dispensed", actor: user?.username, origin: "client" }],
      }),
    });
    const json = await res.json();
    setBusyId(null);
    if (!json.ok) setMsg(json.error ?? "Update failed");
    else {
      setMsg("Dispensed and logged.");
      const enc = await fetch("/api/encounters", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ encounters: [] as StoredHistory[] }));
      setEncounters(enc.encounters ?? []);
    }
  };

const handleSignOut = async () => {
  await staffLogout(() => router.replace("/login"));
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
        <h1 className="text-xl font-semibold tracking-tight text-ink">Pharmacy dispensing · दवा वितरण</h1>
        <p className="text-ink-2 text-[15px]">Fulfil prescriptions written by the treating physician. Prefer Jan Aushadhi generics · जन औषधि जेनरिक दें.</p>
      </div>

      {msg && (
        <div className="banner">
          <Icon name="info" size={15} className="mt-px" />
          {msg}
        </div>
      )}

      <div className="panel p-4">
        <p className="panel-title">
          <Icon name="clock" size={15} className="text-ink-3" />
          Awaiting fulfilment ({pending.length})
        </p>
        {pending.length === 0 && (
          <p className="py-8 text-center text-sm text-ink-3">No prescriptions are waiting to be dispensed.</p>
        )}
        <div className="mt-3 flex flex-col gap-3">
          {pending.map((e) => {
            const token = e.token ?? e.encounterId.slice(0, 8).toUpperCase();
            return (
              <div key={e.encounterId} className="rounded-lg border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[15px] font-semibold text-ink">
                      {e.patient.name}{" "}
                      <span className="font-mono text-[12px] font-normal text-ink-3">{token}</span>
                      <span className="chip chip-neutral ml-2 text-[11px]">Generic · जेनरिक — Jan Aushadhi</span>
                    </p>
                    <p className="text-[13px] text-ink-2">
                      {e.patient.age} yrs · {e.patient.department} · {e.patient.abhaId}
                    </p>
                  </div>
                  <button
                    onClick={() => markDispensed(e)}
                    disabled={busyId !== null}
                    className="btn btn-primary btn-sm min-h-[48px] text-[15px]"
                  >
                    <Icon name="check" size={15} />
                    {busyId === e.encounterId ? "Saving…" : "Mark dispensed · दे दी ✓"}
                  </button>
                </div>
                {e.prescription?.diagnosis && <p className="mt-2 text-[15px] text-ink-2"><strong>Dx:</strong> {e.prescription.diagnosis} {e.prescription.icd10 ? <span className="font-mono text-xs text-ink-3">({e.prescription.icd10})</span> : null}</p>}
                <ul className="mt-2 flex flex-col gap-1">
                  {(e.prescription?.medications ?? []).map((m, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 text-[15px] text-ink">
                      <span className="font-semibold">{m.name}</span>
                      {m.dosage && <span className="text-ink-2">{m.dosage}</span>}
                      {m.frequency && <span className="rounded bg-sunken px-1.5 text-xs text-ink-2">सुबह-शाम 🌞🌙 · {m.frequency}</span>}
                      {m.duration && <span className="text-[12px] text-ink-3">{m.duration}</span>}
                      {m.instructions && <span className="text-xs italic text-ink-3">{m.instructions}</span>}
                    </li>
                  ))}
                </ul>
                {/* Low-literacy pictogram strip handed to the patient (Batch B, U3) */}
                <details className="mt-3 rounded-lg border border-success-border bg-success-subtle p-3">
                  <summary className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-success">
                    <Icon name="image" size={15} />
                    Show pictogram instructions (patient handout)
                  </summary>
                  <div className="mt-2">
                    <PictogramStrip medications={e.prescription?.medications ?? []} />
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel p-4">
        <p className="panel-title">
          <Icon name="checkCircle" size={15} className="text-success" />
          Recently dispensed
        </p>
        {dispensed.length === 0 ? (
          <p className="py-4 text-sm text-ink-3">Nothing dispensed yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1.5">
            {dispensed.map((e) => (
              <li key={e.encounterId} className="flex items-center justify-between text-sm text-ink-2">
                <span>{e.patient.name} · {e.prescription?.medications?.length} meds</span>
                <span className="text-[12px] text-ink-3">{new Date(e.dispensedAt ?? "").toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      </div>
    </AppShell>
  );
}