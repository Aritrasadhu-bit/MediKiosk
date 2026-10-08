"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { enqueueOutbox, flushOutbox, OUTBOX_EVENT } from "@/lib/outbox";
import { ct, t } from "@/lib/i18n";
import { useSession } from "@/lib/useSession";
import { Icon } from "@/components/Icon";
import { KioskShell } from "@/components/AppShell";

const QUICK_SYMPTOMS = ["Fever", "Cough", "Cold", "Diarrhoea", "Rash", "Headache", "Weakness", "Vomiting", "Joint pain"];

/** Stable client-side id for a camp capture (uuid, with a plain fallback). */
function genClientId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Screening-camp mode (Batch B, U2).
 *
 * A lightning-fast capture form for outreach camps: tap the symptoms, enter
 * name/age/village, hit "Save & next" — repeat at 20+ patients/hour. When the
 * camp has no connectivity the record is queued in the offline outbox and
 * replayed automatically (see the sync banner). Every capture becomes a real
 * pending encounter so it lands in the OPD register and surveillance feed.
 */
export default function CampPage() {
  const { session } = useSession();
  const [campId, setCampId] = useState("ashram-school-camp");
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [sex, setSex] = useState<"Male" | "Female" | "Other">("Male");
  const [village, setVillage] = useState("");
  const [mobile, setMobile] = useState("");
  const [symptoms, setSymptoms] = useState<string[]>([]);
  // Per-patient screening consent — default unticked, reset after every save
  // so one tick can never carry over to the next patient in line.
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [count, setCount] = useState(0);

  // Reflect outbox queue length (offline captures waiting to sync).
  useEffect(() => {
    const refresh = () => {
      try {
        const raw = window.localStorage.getItem("medikiosk_outbox") ?? "[]";
        const items = JSON.parse(raw);
        setPending(Array.isArray(items) ? items.filter((i: { gaveUp?: boolean }) => !i.gaveUp).length : 0);
      } catch {
        /* ignore */
      }
    };
    refresh();
    window.addEventListener(OUTBOX_EVENT, refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.removeEventListener(OUTBOX_EVENT, refresh);
      window.removeEventListener("online", refresh);
    };
  }, []);

  const toggleSymptom = (s: string) =>
    setSymptoms((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const save = async () => {
    if (!name.trim() || !age) {
      setStatus("Enter at least the name and age.");
      return;
    }
    if (!consent) {
      setStatus("Please take the patient's screening consent first — tick the consent checkbox.");
      return;
    }
    setStatus(null);
    const payload = {
      campId: campId.trim() || "outreach-camp",
      name: name.trim(),
      age: Number(age),
      sex,
      village: village.trim() || undefined,
      mobile: mobile.trim() || undefined,
      symptoms: symptoms.join(", "),
      offline: false,
      consentGranted: true,
      lang: session.language?.code ?? "en",
      voiceCode: session.language?.voiceCode ?? "en-IN",
      // Stable per-patient id so an outbox replay of THIS capture upserts the
      // same encounter instead of minting a duplicate queue entry.
      clientId: genClientId(),
    };
    // Enqueue first (survives a network drop), then try to flush now.
    enqueueOutbox("/api/camp", "POST", payload);
    void flushOutbox();
    setCount((c) => c + 1);
    setStatus(`${name.trim()} queued. Next patient.${navigator.onLine ? "" : " Offline: will sync automatically."}`);
    setName("");
    setAge("");
    setVillage("");
    setMobile("");
    setSymptoms([]);
    setConsent(false);
  };

  return (
    <KioskShell>
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5">
      <div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="chip chip-warning">Camp mode</span>
            <span className="text-[12px] text-ink-3">Offline screening · outreach</span>
          </div>
          <Link href="/" className="btn btn-ghost btn-sm min-h-[44px]">
            <Icon name="arrowLeft" size={14} />
            Kiosk · कियोस्क
          </Link>
        </div>
        <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-ink">{t("campTitle", session.language?.code)}</h1>
        <p className="text-[15px] text-ink-2">
          तेज़ स्क्रीनिंग — नाम, उम्र, लक्षण। हर व्यक्ति अस्पताल की कतार में जुड़ जाता है। Offline-first · बैटरी + count visible · Worker photo verification below.
        </p>
        {pending > 0 && (
          <p className="banner banner-warning mt-2 text-[14px]">
            <Icon name="wifiOff" size={15} className="mt-px" />
            {pending} record{pending === 1 ? "" : "s"} waiting · <span lang="hi">{pending} रिकॉर्ड लंबित — नेटवर्क आते ही अपने आप भेजा जाएगा।</span> They will sync
            automatically.
          </p>
        )}
      </div>

      <div className="panel p-4">
        <label className="field-label">Camp name / ID</label>
        <input
          value={campId}
          onChange={(e) => setCampId(e.target.value)}
          className="field mt-1"
          placeholder="e.g. ashram-school-camp"
        />
      </div>

      <div className="panel p-4 flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="field-label">Full name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="field mt-1"
              placeholder="Patient name"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Age *</label>
              <input
                value={age}
                onChange={(e) => setAge(e.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric"
                className="field mt-1"
                placeholder="Years"
              />
            </div>
            <div>
              <label className="field-label">Sex</label>
              <select
                value={sex}
                onChange={(e) => setSex(e.target.value as "Male" | "Female" | "Other")}
                className="field mt-1"
              >
                <option>Male</option>
                <option>Female</option>
                <option>Other</option>
              </select>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="field-label">Village / Panchayat</label>
            <input
              value={village}
              onChange={(e) => setVillage(e.target.value)}
              className="field mt-1"
              placeholder="Village name"
            />
          </div>
          <div>
            <label className="field-label">Mobile (optional)</label>
            <input
              value={mobile}
              onChange={(e) => setMobile(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))}
              inputMode="numeric"
              className="field mt-1"
              placeholder="10-digit"
            />
          </div>
        </div>

        <div>
          <label className="field-label">Symptoms — tap to add</label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {QUICK_SYMPTOMS.map((s) => (
              <button
                key={s}
                onClick={() => toggleSymptom(s)}
                aria-pressed={symptoms.includes(s)}
                className={`chip h-8 cursor-pointer px-3 text-[13px] transition-colors ${
                  symptoms.includes(s)
                    ? "border-success-border bg-success-subtle font-semibold text-success"
                    : "border-line text-ink-2 hover:border-line-strong"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {status && (
          <p className="banner banner-info">
            <Icon name="info" size={15} className="mt-px" />
            {status}
          </p>
        )}

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-sunken p-3">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 accent-[var(--brand)]"
          />
          <span className="text-[13px] text-ink">
            <strong>{ct("consentTitle", session.language?.code)} — </strong>
            {ct("campConsent", session.language?.code)}
          </span>
        </label>

        <button onClick={save} aria-describedby={!consent ? "camp-consent-hint" : undefined} className="btn btn-primary btn-lg w-full">
          <Icon name="save" size={17} />
          Save and next patient{count > 0 ? ` (${count} saved)` : ""}
        </button>
        {!consent && (
          <p id="camp-consent-hint" className="text-center text-[13px] font-medium text-warning">
            Tick the screening consent checkbox above to enable saving · सहमति पर निशान लगाएं
          </p>
        )}
      </div>

      <p className="text-center text-[12px] text-ink-3">
        {session.language?.native ?? session.language?.name ?? "हिन्दी / English"} · Screening-camp records appear
        in the physician queue and the daily OPD register.
      </p>
    </div>
    </KioskShell>
  );
}