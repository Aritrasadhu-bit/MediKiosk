"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { DEPARTMENTS } from "@/lib/data";
import { useSession } from "@/lib/useSession";
import { formatAbhaId, isAcceptedIdentifier, identifierKind, isValidMobile } from "@/lib/abha";
import { speak, speakGuidance, consentAudioScript, kioskSpeech } from "@/lib/speech";
import { ct, t, CONSENT_TEXT } from "@/lib/i18n";
import { evaluateVitalsRedFlags, vitalsSuggestions } from "@/lib/redflags";
import type { Patient, Vitals, ConsentScope } from "@/lib/types";
import { CONSENT_SCOPES } from "@/lib/types";
import QrScanner from "@/components/QrScanner";
import VoiceNav from "@/components/VoiceNav";
import { Icon } from "@/components/Icon";
import { KioskShell } from "@/components/AppShell";
import { PhotoReassurance, AbhaSkipNote, DraftSavedNote, HelpVideo, ListenButton } from "@/components/GovtKioskHelp";
import {
  saveIdentifyDraft,
  clearIdentifyDraft,
  subscribeIdentifyDraft,
  getIdentifyDraftSnapshot,
  getServerIdentifyDraftSnapshot,
  type IdentifyDraft,
} from "@/lib/identifyDraft";

/**
 * Consent purposes offered on screen, in server-enforced scope order. Labels
 * live in the i18n consent block (`purpose_<scope>` in every language) so the
 * disclosure reads in the patient's language; see CONSENT_TEXT in lib/i18n.ts.
 */
const CONSENT_PURPOSES: Array<{ scope: ConsentScope }> = CONSENT_SCOPES.map((scope) => ({ scope }));

/**
 * Every scope the server enforces must be offered on screen. If a scope is
 * added to CONSENT_SCOPES without a matching consent label, the patient can
 * never consent to it, so surface that as a hard failure rather than a
 * silently unusable checkbox. (Per-language coverage is pinned by tests.)
 */
const unlabelledScopes = CONSENT_SCOPES.filter((s) => !CONSENT_TEXT.en[`purpose_${s}`]);
if (unlabelledScopes.length) {
  throw new Error(`Consent UI is missing labels for: ${unlabelledScopes.join(", ")}`);
}

/** Format a date string safely — `new Date("")` throws, so default harmlessly. */
function fmtDay(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** Format a time string safely. */
function fmtTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export default function IdentifyPage() {
  const { session, update } = useSession();
  const router = useRouter();
  const lang = session.language ?? null;
  const langCode = lang?.voiceCode ?? "hi-IN";
  // Spoken consent follows the kiosk UI language, not hardcoded Hindi — a
  // low-literacy patient cannot read the panel, so this script IS the consent
  // disclosure for them.
  const consentScript = consentAudioScript(lang?.code ?? "hi");
  // Written consent follows the same language (ct = consent text) — the
  // disclosure must be readable by the patient giving it. Unknown codes fall
  // back to English inside ct().
  const uiLang = session.language?.code ?? "en";

  const [abhaId, setAbhaId] = useState("");
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [sex, setSex] = useState<"Male" | "Female" | "Other">("Male");
  const [mobile, setMobile] = useState("");
  const [department, setDepartment] = useState("");
  // Departments follow the clinic section picked on the front page: an
  // allopathy patient sees only modern departments, an AYUSH patient sees
  // only AYUSH departments. A value already in the field (QR scan, returning
  // patient, draft restore) is always kept so it can never blank out.
  const visibleDepartments = (() => {
    const base =
      session.mode === "ayush"
        ? DEPARTMENTS.filter((d) => d.startsWith("AYUSH"))
        : DEPARTMENTS.filter((d) => !d.startsWith("AYUSH"));
    return department && !base.includes(department) ? [department, ...base] : base;
  })();
  const [consent, setConsent] = useState(false);
  // Granular per-purpose consent (DPDP 2023 s.6 purpose limitation). clinical_care
  // is required for the encounter to be usable by a clinician.
  const [consentPurposes, setConsentPurposes] = useState<ConsentScope[]>([]);
  const [showWarning, setShowWarning] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // One-shot session refill (see below): once decided — refill, defer to a
  // real draft, or honor "start fresh" — it never runs again.
  const [sessionPrefilled, setSessionPrefilled] = useState(false);
  // Draft-resume (Batch A, R2): restore an interrupted identify form and
  // autosave every change so a power-flip / refresh never loses the entry.
  //
  // Read through useSyncExternalStore rather than a useState initializer: the
  // initializer read localStorage, so the server rendered without the
  // "Resume your entry" banner while the client rendered it with one — a
  // hydration mismatch that made React discard the server tree on every visit.
  // getServerIdentifyDraftSnapshot() gives both sides the same starting value.
  const resumeDraft = useSyncExternalStore(
    subscribeIdentifyDraft,
    getIdentifyDraftSnapshot,
    getServerIdentifyDraftSnapshot
  );

  const applyDraft = (draft: IdentifyDraft) => {
    setName(draft.name);
    setAge(draft.age);
    setSex(draft.sex);
    setMobile(draft.mobile);
    setAbhaId(draft.abhaId);
    setDepartment(draft.department);
    setConsent(draft.consent);
    setRespondent(draft.respondent ?? "self");
    setGuardianName(draft.guardianName);
    setGuardianRelation(draft.guardianRelation);
    setVitals(
      Object.fromEntries(Object.entries(draft.vitals ?? {}).filter(([, v]) => v !== undefined)) as Vitals
    );
    // Clearing the stored draft drives the banner away via the store
    // subscription; autosave then re-persists the now-live field values.
    clearIdentifyDraft();
    // Restored work is final — the session refill below must not top it up.
    setSessionPrefilled(true);
    // Helper-OFF kiosks stay silent (tap feedback included).
    if (session.attendantMode) speak(kioskSpeech("returningGreeting", uiLang), langCode);
  };
  const discardDraft = () => {
    clearIdentifyDraft();
    // "Start fresh" means a blank form — lock the session refill as well.
    setSessionPrefilled(true);
  };

  // Guardian / proxy mode (point 11)
  const [respondent, setRespondent] = useState<"self" | "guardian">("self");
  const [guardianName, setGuardianName] = useState("");
  const [guardianRelation, setGuardianRelation] = useState("");

  const [vitals, setVitals] = useState<Vitals>({});
  // Returning from history (e.g. the vitals gate sends the patient back to
  // add BP/pulse/SpO2) must NOT wipe the form: the identify draft was cleared
  // on submit, so refill empty fields once from the saved session. A draft
  // with real content wins when one exists (banner restore) — but a phantom
  // empty draft (autosaved blank form) never blocks the refill and is
  // cleared. "NEW-REGISTER" is a placeholder, not an ABHA number, so it is
  // never written into the field (it would fail validation and block Next).
  if (!sessionPrefilled) {
    const draft = getIdentifyDraftSnapshot();
    const draftHasContent =
      !!draft &&
      (!!draft.name?.trim() ||
        !!draft.abhaId?.trim() ||
        !!draft.mobile?.trim() ||
        !!draft.age?.trim() ||
        !!draft.department?.trim());
    if (draftHasContent) {
      setSessionPrefilled(true);
    } else if (session.patient) {
      if (draft) clearIdentifyDraft();
      setSessionPrefilled(true);
      const p = session.patient;
      if (!name.trim() && p.name) setName(p.name);
      if (!age && p.age) setAge(String(p.age));
      if (p.sex === "Male" || p.sex === "Female" || p.sex === "Other") setSex(p.sex);
      if (!mobile.trim() && p.mobile) setMobile(p.mobile);
      if (!abhaId.trim() && p.abhaId && p.abhaId !== "NEW-REGISTER") setAbhaId(p.abhaId);
      if (!department && p.department) setDepartment(p.department);
      if (!consent && session.consentGranted) {
        setConsent(true);
        setConsentPurposes(session.consentPurposes ?? []);
      }
      if (p.respondent === "guardian" && p.guardian) {
        setRespondent("guardian");
        if (!guardianName.trim()) setGuardianName(p.guardian.name);
        if (!guardianRelation.trim()) setGuardianRelation(p.guardian.relation);
      }
      if (Object.keys(vitals).length === 0 && p.vitals && Object.keys(p.vitals).length > 0) {
        setVitals({ ...p.vitals });
      }
    }
  }
  const ageNum = Number(age) || undefined;
  const vitalsFlags = evaluateVitalsRedFlags(vitals, ageNum);
  const vitalsHints = vitalsSuggestions(vitals, ageNum);

  // Autosave the whole identify form every time anything changes (debounced
  // by React's batching) so a power-flip never loses a half-filled entry.
  useEffect(() => {
    saveIdentifyDraft({
      name,
      age,
      sex,
      mobile,
      abhaId,
      department,
      consent,
      respondent,
      guardianName,
      guardianRelation,
      vitals,
    });
  }, [name, age, sex, mobile, abhaId, department, consent, respondent, guardianName, guardianRelation, vitals]);

  // Returning-patient lookup + duplicate-waiting detection (server, public route).
  type LookupResult = {
    returning: boolean;
    patient?: { name: string; age: number; sex: string; department: string; lastVisit: string };
    pendingEncounter?: { encounterId: string; token?: string; department: string; enteredAt: string };
  };
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);

  const abhaTrimmed = abhaId.trim();
  // Either accepted identifier form triggers lookup, not just ABHA — the field
  // promises Aadhaar works, and "will be used for record lookup" was shown
  // beside it. Aadhaar is a valid key server-side (`normalizedAbha` compares
  // digits), so gating on ABHA alone silently skipped returning patients who
  // identified by Aadhaar.
  const hasAbha = isAcceptedIdentifier(abhaTrimmed);
  const hasMobile = isValidMobile(mobile.trim());
  const canLookup = hasAbha || hasMobile;

  useEffect(() => {
    if (!canLookup) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLookupBusy(true);
      try {
        const res = await fetch("/api/patient/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Mobile-only lookup is two-factor: the typed name must match the
          // stored patient name or the route refuses (see lookupRequestSchema).
          body: JSON.stringify({
            abha: hasAbha ? abhaTrimmed : undefined,
            mobile: hasMobile ? mobile.trim() : undefined,
            name: name.trim() || undefined,
          }),
        });
        const json = (await res.json()) as LookupResult & { ok?: boolean; error?: string };
        if (!cancelled && json.ok !== false) setLookup(json);
      } catch {
        // Server unreachable — continue silently (kiosk still works offline).
      } finally {
        if (!cancelled) setLookupBusy(false);
      }
    }, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [abhaId, mobile, name, canLookup, hasAbha, hasMobile, abhaTrimmed]);

  // Attendant-assisted mode: play the stage guidance on arrival so a patient
  // who cannot operate the kiosk still hears what to do. Other stages already
  // speak on entry; identify was silent until the first interaction.
  useEffect(() => {
    if (session.attendantMode) {
      speakGuidance("identify", lang?.code ?? "en", langCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Appointment check-in: a mobile number with a booked slot for today can
  // check in right here and jump the priority queue.
  type AppointmentLite = { id: string; name: string; department: string; slot: string; status: string };
  const localToday = new Date();
  const todayStr = `${localToday.getFullYear()}-${String(localToday.getMonth() + 1).padStart(2, "0")}-${String(localToday.getDate()).padStart(2, "0")}`;
  const [appointment, setAppointment] = useState<AppointmentLite | null>(null);
  const [checkMsg, setCheckMsg] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      // Two-factor lookup (mobile + typed name, enforced by the route). While
      // the name is empty there is nothing to look up — and any appointment
      // found for a previous name must be cleared so it can't be checked in
      // after the field changes.
      if (!hasMobile || !name.trim()) {
        if (!cancelled) setAppointment(null);
        return;
      }
      try {
        const res = await fetch(
          `/api/appointments?mobile=${encodeURIComponent(mobile.trim())}&date=${todayStr}&name=${encodeURIComponent(name.trim())}`,
          { cache: "no-store" }
        );
        const json = await res.json();
        if (!cancelled && json.ok) {
          const apt = (json.appointments ?? []).find((a: AppointmentLite) => a.status === "booked");
          setAppointment(apt ?? null);
        }
      } catch {
        /* offline — skip */ 
      }
    }, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hasMobile, mobile, name, todayStr]);

  const checkInAppt = async () => {
    if (!appointment) return;
    const res = await fetch("/api/appointments/checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: appointment.id, name: appointment.name }),
    });
    const json = await res.json();
    if (json.ok) {
      setCheckMsg(`Checked in. Slot ${appointment.slot} confirmed. Continue below with your details.`);
      setAppointment(null);
    } else {
      setCheckMsg(json.error ?? "Check-in failed.");
    }
  };

  // One-tap re-registration: prefill from the most recent visit.
  const applyReturning = () => {
    if (!canLookup || !lookup?.patient) return;
    setName((n) => n || lookup.patient!.name);
    setAge((a) => a || String(lookup.patient!.age));
    const prevSex = lookup.patient!.sex;
    setSex((prevSex === "Male" || prevSex === "Female" || prevSex === "Other" ? prevSex : "Other") as "Male" | "Female" | "Other");
    setDepartment((d) => d || lookup.patient!.department);
    if (session.attendantMode) speak(kioskSpeech("returningDetails", uiLang, { name: lookup.patient!.name }), langCode);
    setLookup(null);
  };

  const handleAbhaChange = (v: string) => {
    setAbhaId(v);
    if (v) setErrors((e) => ({ ...e, abha: "" }));
    // Drop the banner as soon as they start fixing it, rather than leaving
    // "Please correct the highlighted fields" sitting under a field that is
    // now green.
    if (showWarning) setShowWarning(false);
  };

  const handleQrResult = (code: string) => {
    // A QR sticker is untrusted input — anyone can print one and hold it to
    // the camera. The typed flow constrains name length and department to a
    // fixed dropdown, so the scanned values get the same treatment here rather
    // than flowing raw into the record (off-list departments would corrupt
    // queue stats/surveillance, and a megabyte name would break storage).
    // The ABHA itself is re-validated at submit time regardless.
    let rawAbha = code.slice(0, 64);
    try {
      const parsed = JSON.parse(code.slice(0, 100_000));
      if (typeof parsed === "object" && parsed !== null) {
        if (parsed.abha) rawAbha = String(parsed.abha).slice(0, 64);
        if (parsed.name && !name) setName(String(parsed.name).trim().slice(0, 120));
        if (parsed.department && !department) {
          const match = DEPARTMENTS.find((d) => d.toLowerCase() === String(parsed.department).trim().toLowerCase());
          if (match) setDepartment(match);
        }
      }
    } catch {
      // not JSON, treat as raw string
    }
    setAbhaId(formatAbhaId(rawAbha));
    setQrOpen(false);
    setErrors((e) => ({ ...e, abha: "" }));
  };

  const next = () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = t("errName", uiLang);
    if (!age) errs.age = t("errAge", uiLang);
    if (!department) errs.department = t("errDept", uiLang);
    // Longitudinal continuity: require ABHA or mobile so records can be linked.
    if (!abhaId.trim() && !isValidMobile(mobile.trim())) {
      errs.idRequired = t("errIdRequired", uiLang);
    }
    if (abhaId && !isAcceptedIdentifier(abhaId)) {
      errs.abha = t("errAbhaBad", uiLang);
    }
    if (mobile && !isValidMobile(mobile)) errs.mobile = t("errMobileBad", uiLang);
    if (respondent === "guardian") {
      if (!guardianName.trim()) errs.guardianName = t("errGuardianName", uiLang);
      if (!guardianRelation.trim()) errs.guardianRelation = t("errGuardianRel", uiLang);
    }
    if (!consent) errs.consent = ct("consentRequired", uiLang);
    // Clinical-care consent is what makes the record usable: without it no
    // clinician may read it, so accepting the encounter would be pointless.
    if (consent && !consentPurposes.includes("clinical_care")) {
      errs.consent = ct("consentClinicalCare", uiLang);
    }
    // Duplicate-visit blocker: an unresolved waiting token for this patient
    // means a second encounter would create a double queue entry. Next stays
    // blocked until the patient uses the token they have — the "Register this
    // as a new visit" button above remains the conscious override (it clears
    // the lookup), so genuine revisits are never stranded.
    if (canLookup && lookup?.pendingEncounter) {
      errs.duplicate =
        `This patient is already waiting with token ${lookup.pendingEncounter.token} ` +
        `(${lookup.pendingEncounter.department}). Use that token, or press "Register this as a new visit" above to continue anyway.`;
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      setShowWarning(true);
      return;
    }
    const numAge = Number(age);
    const patient: Patient = {
      abhaId: abhaId || "NEW-REGISTER",
      name: name.trim(),
      age: isNaN(numAge) ? 0 : numAge,
      sex,
      mobile: mobile || undefined,
      department,
      vitals: Object.keys(vitals).length ? vitals : undefined,
      respondent,
      guardian:
        respondent === "guardian"
          ? { name: guardianName.trim(), relation: guardianRelation.trim(), mobile: mobile || undefined }
          : undefined,
    };
    update({
      patient,
      step: "history",
      consentGranted: consent,
      consentPurposes,
      consentAt: consent ? new Date().toISOString() : undefined,
      redFlags: [...(session.redFlags ?? []), ...vitalsFlags],
    });
    if (session.attendantMode) {
      speak(
        respondent === "guardian"
          ? kioskSpeech("thanksGuardian", uiLang, { name: guardianName.trim() })
          : kioskSpeech("thanksSelf", uiLang, { name: name.trim() }),
        langCode
      );
    }
    clearIdentifyDraft(); // draft fulfilled — entry is now in the live session
    router.push("/history");
  };

  // Kiosk touch targets: 16px base text and generous height so the form is
  // usable by an elderly patient standing at a screen.
  const inputCls = (hasErr: boolean) =>
    `mt-1 w-full rounded-lg border px-3.5 py-3 text-base text-ink outline-none transition-colors ${
      hasErr ? "border-critical bg-critical-subtle" : "border-line-strong bg-surface"
    }`;

  const vitalsField = (
    label: string,
    key: keyof Vitals,
    placeholder: string,
    step = "1"
  ) => {
    const fieldId = `vital-${key}`;
    return (
      <div>
        <label htmlFor={fieldId} className="field-label">{label}</label>
        <input
          id={fieldId}
          value={vitals[key] ?? ""}
          onChange={(e) => setVitals((v) => ({ ...v, [key]: +e.target.value.replace(/[^0-9.]/g, "") || undefined }))}
          placeholder={placeholder}
          inputMode="decimal"
          step={step}
          className={inputCls(false)}
        />
      </div>
    );
  };

  return (
    <KioskShell>
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6">
        <p className="section-label">Step 1 of 5 · Identity and consent</p>
        <h1 className="mt-1.5 flex items-center gap-2 text-xl font-semibold tracking-tight text-ink">{t("patientId", uiLang)} <ListenButton text={kioskSpeech("listenIdentify", uiLang)} lang={langCode} /></h1>
        <p className="mt-1 text-[15px] text-ink-2">
          {t("confirmIdentity", uiLang)}
        </p>
        <div className="mt-2 flex flex-wrap gap-2"><HelpVideo /><AbhaSkipNote /></div>
        <PhotoReassurance />
        <DraftSavedNote />
      </div>

      {/* Draft-resume banner — a power-flip or refresh mid-form is
          not fatal: the snapshot is restored and the patient continues. */}
      {resumeDraft && (
        <div className="banner banner-warning mb-4 flex-wrap items-center fade-up">
          <Icon name="refresh" size={16} className="mt-px" />
          <div className="min-w-[12rem] flex-1">
            <p className="font-semibold">Resume your entry</p>
            <p className="mt-0.5 text-[12px] opacity-90">
              We found an interrupted form{resumeDraft.name ? ` for ${resumeDraft.name}` : ""}, saved at{" "}
              {new Date(resumeDraft.savedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}.
              Your details were not lost.
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => applyDraft(resumeDraft)} className="btn btn-primary btn-sm">
              Restore my details
            </button>
            <button type="button" onClick={discardDraft} className="btn btn-secondary btn-sm">
              Start fresh
            </button>
          </div>
        </div>
      )}

      {/* Respondent / guardian mode */}
      <section className="panel p-4">
        <h2 className="panel-title mb-3">
          <Icon name="user" size={15} className="text-ink-3" />
          {t("whoGivesHistory", uiLang)}
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {(["self", "guardian"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRespondent(r)}
              aria-pressed={respondent === r}
              className={`rounded-lg border px-3 py-3 text-sm font-semibold transition-colors ${
                respondent === r
                  ? "border-brand bg-brand font-semibold text-white shadow-sm"
                  : "border-line bg-surface text-ink-2 hover:border-line-strong hover:bg-sunken"
              }`}
            >
              {r === "self" ? t("selfResp", uiLang) : t("guardianResp", uiLang)}
            </button>
          ))}
        </div>
        {respondent === "guardian" && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 fade-up">
            <div>
              <label htmlFor="guardian-name" className="field-label">
                {t("guardianNameLbl", uiLang)} *
              </label>
              <input
                id="guardian-name"
                value={guardianName}
                onChange={(e) => setGuardianName(e.target.value)}
                placeholder="e.g. Suresh Kumar"
                className={inputCls(Boolean(errors.guardianName))}
              />
              {errors.guardianName && <p className="mt-1 text-[12px] text-critical">{errors.guardianName}</p>}
            </div>
            <div>
              <label htmlFor="guardian-relation" className="field-label">
                {t("guardianRelLbl", uiLang)} *
              </label>
              <input
                id="guardian-relation"
                value={guardianRelation}
                onChange={(e) => setGuardianRelation(e.target.value)}
                placeholder="e.g. Mother, Son, Caregiver"
                className={inputCls(Boolean(errors.guardianRelation))}
              />
              {errors.guardianRelation && <p className="mt-1 text-[12px] text-critical">{errors.guardianRelation}</p>}
            </div>
            <p className="col-span-full text-[12px] leading-relaxed text-ink-3">
              {t("guardianNote", uiLang)}
            </p>
          </div>
        )}
      </section>

      {/* ABHA / Aadhaar */}
      <section className="panel mt-3 p-4">
        <h2 className="panel-title mb-3">
          <Icon name="shield" size={15} className="text-ink-3" />
          ABHA ID or Aadhaar <span className="font-normal text-ink-3">({t("optionalTag", uiLang)})</span>
        </h2>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => setQrOpen(true)}
            className="rounded-lg border border-dashed border-line-strong bg-sunken p-3 text-left transition-colors hover:border-brand hover:bg-brand-subtle"
          >
            <Icon name="qr" size={20} className="text-ink-2" />
            <div className="mt-1 text-sm font-medium text-ink">{t("scanAbhaQr", uiLang)}</div>
            <div className="text-[12px] text-ink-3">Uses this kiosk&apos;s camera</div>
          </button>
          <div className="flex-1">
            <label htmlFor="abha-id" className="field-label">
              {t("orEnterAbha", uiLang)}
            </label>
            <input
              id="abha-id"
              value={abhaId}
              onChange={(e) => handleAbhaChange(e.target.value)}
              placeholder="0000 0000 0000"
              inputMode="numeric"
              className={inputCls(Boolean(errors.abha) || Boolean(errors.idRequired))}
            />
            {errors.abha && <p className="mt-1 text-[12px] text-critical">{errors.abha}</p>}
            {errors.idRequired && <p className="mt-1 text-[12px] text-critical">{errors.idRequired}</p>}
            {identifierKind(abhaId) === "abha" && (
              <p className="mt-1 flex items-center gap-1 text-[12px] text-success">
                <Icon name="check" size={12} />
                Valid ABHA ID (check digit verified)
              </p>
            )}
            {identifierKind(abhaId) === "aadhaar" && (
              <p className="mt-1 flex items-center gap-1 text-[12px] text-success">
                <Icon name="check" size={12} />
                Valid Aadhaar number &mdash; will be used for record lookup
              </p>
            )}
          </div>
        </div>

        {/* Returning-patient one-tap re-registration */}
        {lookupBusy && <p className="mt-2 text-[12px] text-ink-3">Checking for previous visits…</p>}
        {canLookup && lookup?.returning && !lookup.pendingEncounter && (
          <div className="banner banner-success mt-3 flex-wrap items-center fade-up">
            <Icon name="hand" size={16} className="mt-px" />
            <p className="min-w-[12rem] flex-1 font-medium">
              Welcome back, {lookup.patient?.name} (last visit {fmtDay(lookup.patient?.lastVisit)})
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={applyReturning} className="btn btn-primary btn-sm">
                Re-register for a new visit
              </button>
              <button type="button" onClick={() => setLookup(null)} className="btn btn-secondary btn-sm">
                New visitor
              </button>
            </div>
          </div>
        )}
        {canLookup && lookup?.pendingEncounter && (
          <div className="banner banner-warning mt-3 flex-col fade-up">
            <p className="font-semibold">
              This patient already has a waiting token:{" "}
              <span className="tabular">{lookup.pendingEncounter.token}</span> (
              {lookup.pendingEncounter.department})
            </p>
            <p className="mt-0.5 text-[12px]">
              Registered {fmtTime(lookup.pendingEncounter.enteredAt)}. Please check this is not a
              duplicate submission before continuing.
            </p>
            <button type="button" onClick={() => setLookup(null)} className="btn btn-secondary btn-sm mt-1 self-start">
              Register this as a new visit
            </button>
          </div>
        )}
        {hasMobile && appointment && (
          <div className="banner banner-info mt-3 flex-wrap items-center fade-up">
            <Icon name="calendar" size={16} className="mt-px" />
            <p className="min-w-[12rem] flex-1 font-medium">
              Appointment found: {appointment.name} &middot; {appointment.department} &middot; slot{" "}
              <strong>{appointment.slot}</strong>
            </p>
            <button type="button" onClick={checkInAppt} className="btn btn-primary btn-sm">
              Check in now
            </button>
          </div>
        )}
        {checkMsg && <p className="mt-2 text-[12px] text-ink-2">{checkMsg}</p>}
      </section>

      {/* Patient details */}
      <section className="panel mt-3 p-4">
        <h2 className="panel-title mb-3">
          <Icon name="user" size={15} className="text-ink-3" />
          {t("patientDetails", uiLang)}
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="full-name" className="field-label">
              {t("fullName", uiLang)} *
            </label>
            <input
              id="full-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter full name"
              className={inputCls(Boolean(errors.name))}
            />
            {errors.name && <p className="mt-1 text-[12px] text-critical">{errors.name}</p>}
          </div>
          <div>
            <label htmlFor="age" className="field-label">
              {t("ageDob", uiLang)} *
            </label>
            <input
              id="age"
              value={age}
              onChange={(e) => setAge(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="Age in years"
              inputMode="numeric"
              className={inputCls(Boolean(errors.age))}
            />
            {errors.age && <p className="mt-1 text-[12px] text-critical">{errors.age}</p>}
          </div>
          <div>
            <label className="field-label">{t("genderLabel", uiLang)}</label>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {(["Male", "Female", "Other"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSex(s)}
                  aria-pressed={sex === s}
                  className={`rounded-lg border px-3 py-3 text-sm font-semibold transition-colors ${
                    sex === s
                      ? "border-brand bg-brand font-semibold text-white shadow-sm"
                      : "border-line bg-surface text-ink-2 hover:border-line-strong hover:bg-sunken"
                  }`}
                >
                  {s === "Male" ? t("maleOpt", uiLang) : s === "Female" ? t("femaleOpt", uiLang) : t("otherOpt", uiLang)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="mobile" className="field-label">
              {t("mobileLabel", uiLang)} ({t("optionalTag", uiLang)})
            </label>
            <input
              id="mobile"
              value={mobile}
              onChange={(e) => setMobile(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="10-digit mobile"
              inputMode="tel"
              className={inputCls(Boolean(errors.mobile))}
            />
            {errors.mobile && <p className="mt-1 text-[12px] text-critical">{errors.mobile}</p>}
          </div>
          <div>
            <label htmlFor="department" className="field-label">
              {t("deptLabel", uiLang)}
            </label>
            <select
              id="department"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className={inputCls(Boolean(errors.department))}
            >
              <option value="">{t("selectDept", uiLang)}</option>
              {visibleDepartments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            {errors.department && <p className="mt-1 text-[12px] text-critical">{errors.department}</p>}
          </div>
        </div>
      </section>

      {/* Vitals */}
      <section className="panel mt-3 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="panel-title">
            <Icon name="activity" size={15} className="text-ink-3" />
            {t("vitalsTitle", uiLang)}
          </h2>
          <span className="chip chip-neutral">{t("optionalSkip", uiLang)}</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {vitalsField("BP (systolic)", "systolic", "120")}
          {vitalsField("BP (diastolic)", "diastolic", "80")}
          {vitalsField("Pulse / min", "pulse", "72")}
          {vitalsField("Weight (kg)", "weight", "60")}
          {vitalsField("Height (cm)", "height", "165")}
          {vitalsField("Temperature (°C)", "temperature", "37.0", "0.1")}
          {vitalsField("SpO2 (%)", "spo2", "98")}
        </div>
        {/* Live numeric pre-triage */}
        {(vitalsFlags.length > 0 || vitalsHints.length > 0) && (
          <div className="mt-3 fade-up">
            {vitalsFlags.some((f) => f.severity === "high") && (
              <div className="banner banner-critical flex-col">
                <p className="flex items-center gap-1.5 font-semibold">
                  <Icon name="siren" size={15} />
                  Automatic triage alert
                </p>
                {vitalsFlags.map((f) => (
                  <p key={f.id} className="mt-0.5">{f.symptom}: {f.message}</p>
                ))}
                <p className="mt-1 text-[12px] opacity-80">
                  This patient will be flagged urgent on the doctor&apos;s dashboard.
                </p>
              </div>
            )}
            {vitalsFlags.filter((f) => f.severity === "medium").map((f) => (
              <p key={f.id} className="mt-1.5 flex items-start gap-1.5 text-[13px] text-warning">
                <Icon name="alert" size={14} className="mt-px" />
                {f.message}
              </p>
            ))}
            {vitalsHints.map((hint, i) => (
              <p key={i} className="mt-1.5 flex items-start gap-1.5 text-[13px] text-info">
                <Icon name="info" size={14} className="mt-px" />
                {hint}
              </p>
            ))}
          </div>
        )}
      </section>

      {/* Consent */}
      <section className="panel mt-3 p-4">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id="consent-main"
            checked={consent}
            onChange={(e) => {
              const checked = e.target.checked;
              setConsent(checked);
              // The main box is "select all": ticking it ticks all 6 purpose
              // boxes below, unticking it clears them. Individual purposes
              // can still be adjusted afterwards (clinical_care stays
              // mandatory — unchecking it unticks the main box below).
              setConsentPurposes(checked ? [...CONSENT_SCOPES] : []);
              if (checked && session.attendantMode) speak(consentScript.thanks, langCode);
            }}
            className="mt-1 h-5 w-5 shrink-0 accent-[var(--brand)]"
          />
          <div className="min-w-0 flex-1">
            <h2 className="panel-title">
              <Icon name="lock" size={15} className="text-ink-3" />
              {ct("consentTitle", uiLang)}
            </h2>
            <p className="prose-clin mt-1.5">
              {respondent === "guardian" ? ct("consentGuardian", uiLang) : ct("consentMain", uiLang)}
            </p>
            <p className="mt-2.5 text-[13px] text-ink-2">
              {ct("consentWithdraw", uiLang)}
            </p>
            <ul className="mt-2 flex flex-col gap-2">
              {CONSENT_PURPOSES.map((p) => (
                <li key={p.scope} className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    id={`consent-${p.scope}`}
                    checked={consentPurposes.includes(p.scope)}
                    disabled={!consent}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...new Set([...consentPurposes, p.scope])]
                        : consentPurposes.filter((s) => s !== p.scope);
                      setConsentPurposes(next);
                      // Clinical-care use is mandatory: without it no clinician
                      // may read the record, so the kiosk must not accept it.
                      if (p.scope === "clinical_care") setConsent(e.target.checked);
                    }}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand)]"
                  />
                  <label htmlFor={`consent-${p.scope}`} className="cursor-pointer text-[13px] leading-snug">
                    <span className="font-medium text-ink">{ct(`purpose_${p.scope}`, uiLang)}</span>
                  </label>
                </li>
              ))}
            </ul>
            {errors.consent && <p className="mt-2 text-[12px] text-critical">{errors.consent}</p>}
            <button type="button"
              onClick={() =>
                speak(
                  respondent === "guardian" ? consentScript.guardian : consentScript.patient,
                  langCode
                )
              }
              className="btn btn-ghost btn-sm mt-2 -ml-1"
            >
              <Icon name="volume" size={14} />
              {ct("consentPlayAudio", uiLang)}
            </button>
          </div>
        </div>
      </section>

      {showWarning && (
        <div className="banner banner-critical mt-3">
          <Icon name="alert" size={15} className="mt-px" />
          {t("errFixFields", uiLang)}
        </div>
      )}
      {errors.duplicate && (
        <div role="alert" className="banner banner-warning mt-3">
          <Icon name="alert" size={15} className="mt-px" />
          {errors.duplicate}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <button type="button" onClick={() => router.push("/")} className="btn btn-secondary btn-lg">
          <Icon name="arrowLeft" size={16} />
          {t("back", uiLang)}
        </button>
        <button type="button" onClick={next} className="btn btn-primary btn-lg">
          {t("next", uiLang)}: {t("describeProblem", uiLang)}
          <Icon name="arrowRight" size={16} />
        </button>
      </div>

      {qrOpen && <QrScanner onResult={handleQrResult} onClose={() => setQrOpen(false)} />}

      <VoiceNav
        lang={langCode}
        onCommand={(intent) => {
          if (intent === "next") next();
          else if (intent === "back") router.push("/");
          else if (intent === "help")
            speak(
              kioskSpeech("identifyHelp", uiLang),
              langCode
            );
        }}
      />
    </div>
    </KioskShell>
  );
}