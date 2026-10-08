"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/useSession";
import { saveHistory, recordAudit, generateEncounterId } from "@/lib/store";
import { speak } from "@/lib/speech";
import { kioskSpeech } from "@/lib/speech";
import { checkInteractions, interactionsToSummary, drugsWithoutCoverage, INTERACTION_COVERAGE_NOTE } from "@/lib/interactions";
import { deriveQueueToken } from "@/lib/queue";
import { spokenSummaryScript, sectionLabel, glossClinicalTerm, t, type PatientSectionKey } from "@/lib/i18n";
import { localizeComplaint, localizePast, localizeSurgery, localizeCommonMed, localizeAllergy } from "@/lib/translations";
import type { AuditEvent, Medication, StoredHistory, ConsentState, ConsentScope } from "@/lib/types";
import { Icon } from "@/components/Icon";
import { KioskShell } from "@/components/AppShell";
import { ListenButton } from "@/components/GovtKioskHelp";

/**
 * Turn the kiosk's ticked purposes into the stored granular consent state.
 * Consent is granted for one year (DPDP 2023 s.6 requires purpose limitation
 * and a defined retention horizon), and clinical_care is the scope that makes
 * the record readable by the treating team.
 *
 * No scope is filtered here. `his_emr_export` was once dropped by this function,
 * which silently made the kiosk's "send to hospital system" checkbox a no-op;
 * every scope the patient actually ticked is stored, and the server decides what
 * each one permits. Unknown names still cannot reach storage — `normalizeConsent`
 * in src/lib/consent.ts filters them against CONSENT_SCOPES.
 */
function buildConsentState(granted: ConsentScope[], now: string): ConsentState {
  return {
    granted,
    decidedAt: now,
    purpose:
      "Capture of this clinical history, digitisation of uploaded documents, and use by " +
      "treating clinicians at this hospital for the purpose of your care.",
    expiresAt: new Date(Date.parse(now) + 365 * 24 * 3600 * 1000).toISOString(),
  };
}

export const SUMMARY_UI: Record<string, {
  step: string;
  badge: string;
  title: string;
  subtitle: string;
  patientTitle: string;
  patientSubtitle: string;
  confirmBtn: string;
}> = {
  hi: {
    step: "चरण 4",
    badge: "संरचित सारांश",
    title: "आपका चिकित्सा इतिहास सारांश",
    subtitle: "आपके डॉक्टर के लिए तैयार — यह आपकी अनुमति से साझा किया जाएगा",
    patientTitle: "आपकी जानकारी",
    patientSubtitle: "यह आपके डॉक्टर को दिखाई जाएगी",
    confirmBtn: "पुष्टि करें और डॉक्टर को भेजें",
  },
  bn: {
    step: "ধাপ ৪",
    badge: "কাঠামোগত সারাংশ",
    title: "আপনার চিকিৎসা ইতিহাসের সারাংশ",
    subtitle: "আপনার ডাক্তারের জন্য প্রস্তুত — আপনার অনুমতিতেই শেয়ার করা হবে",
    patientTitle: "আপনার রেকর্ডকৃত তথ্য",
    patientSubtitle: "এটি আপনার ডাক্তার দেখতে পাবেন",
    confirmBtn: "নিশ্চিত করুন এবং ডাক্তারকে পাঠান",
  },
  ta: {
    step: "படி 4",
    badge: "கட்டமைக்கப்பட்ட சுருக்கம்",
    title: "உங்கள் மருத்துவ வரலாறு சுருக்கம்",
    subtitle: "மருத்துவருக்கு தயார் — உங்கள் அனுமதியுடன் மட்டுமே பகிரப்படும்",
    patientTitle: "பதிவு செய்யப்பட்ட விவரங்கள்",
    patientSubtitle: "மருத்துவர் இதை வாசிப்பார்",
    confirmBtn: "உறுதிசெய்து மருத்துவருக்கு அனுப்பவும்",
  },
  te: {
    step: "దశ 4",
    badge: "నిర్మాణాత్మక సారాంశం",
    title: "మీ క్లినికల్ చరిత్ర సారాంశం",
    subtitle: "వైద్యుడి కోసం సిద్ధం — మీ సమ్మతితో మాత్రమే పంచుకోబడుతుంది",
    patientTitle: "నమోదు చేయబడిన సమాచారం",
    patientSubtitle: "ఇది మీ వైద్యుడికి చూపబడుతుంది",
    confirmBtn: "నిర్ధారించి వైద్యుడికి పంపండి",
  },
  mr: {
    step: "टप्पा ४",
    badge: "संरचित सारांश",
    title: "तुमचा वैद्यकीय इतिहास सारांश",
    subtitle: "डॉक्टरांसाठी सज्ज — तुमच्या परवानगीनेच शेअर केले जाईल",
    patientTitle: "तुमची नोंदवलेली माहिती",
    patientSubtitle: "हे तुमचे डॉक्टर वाचतील",
    confirmBtn: "पुष्टी करा आणि डॉक्टरांकडे पाठवा",
  },
  gu: {
    step: "તબક્કો ૪",
    badge: "માળખાગત સારાંશ",
    title: "તમારો તબીબી ઇતિહાસ સારાંશ",
    subtitle: "ડૉક્ટર માટે તૈયાર — તમારી સંમતિથી જ શેર થશે",
    patientTitle: "તમારી નોંધાયેલી વિગતો",
    patientSubtitle: "આ તમારા ડૉક્ટર જોશે",
    confirmBtn: "પુષ્ટિ કરો અને ડૉક્ટરને મોકલો",
  },
  kn: {
    step: "ಹಂತ 4",
    badge: "ರಚನಾತ್ಮಕ ಸಾರಾಂಶ",
    title: "ನಿಮ್ಮ ವೈದ್ಯಕೀಯ ಇತಿಹಾಸದ ಸಾರಾಂಶ",
    subtitle: "ವೈದ್ಯರಿಗಾಗಿ ಸಿದ್ಧ — ನಿಮ್ಮ ಅನುಮತಿಯೊಂದಿಗೆ ಮಾತ್ರ ಹಂಚಿಕೊಳ್ಳಲಾಗುತ್ತದೆ",
    patientTitle: "ದಾಖಲಿಸಲಾದ ಮಾಹಿತಿ",
    patientSubtitle: "ಇದನ್ನು ವೈದ್ಯರು ಪರಿಶೀಲಿಸುತ್ತಾರೆ",
    confirmBtn: "ದೃಢೀಕರಿಸಿ ಮತ್ತು ವೈದ್ಯರಿಗೆ ಕಳುಹಿಸಿ",
  },
  ml: {
    step: "ഘട്ടം 4",
    badge: "ഘടനാപരമായ സംഗ്രഹം",
    title: "നിങ്ങളുടെ ക്ലിനിക്കൽ ചരിത്ര സംഗ്രഹം",
    subtitle: "ഡോക്ടർക്കായി തയ്യാറാക്കിയത് — നിങ്ങളുടെ അനുമതിയോടെ മാത്രം",
    patientTitle: "രേഖപ്പെടുത്തിയ വിവരങ്ങൾ",
    patientSubtitle: "ഇത് നിങ്ങളുടെ ഡോക്ടർ പരിശോധിക്കും",
    confirmBtn: "സ്ഥിരീകരിച്ച് ഡോക്ടർക്ക് അയയ്ക്കുക",
  },
  pa: {
    step: "ਕਦਮ 4",
    badge: "ਸੰਖੇਪ ਸਾਰ",
    title: "ਤੁਹਾਡਾ ਕਲੀਨਿਕਲ ਇਤਿਹਾਸ ਸਾਰ",
    subtitle: "ਡਾਕਟਰ ਲਈ ਤਿਆਰ — ਸਿਰਫ਼ ਤੁਹਾਡੀ ਮਨਜ਼ੂਰੀ ਨਾਲ ਸਾਂਝਾ ਕੀਤਾ ਜਾਵੇਗਾ",
    patientTitle: "ਤੁਹਾਡੀ ਦਰਜ ਜਾਣਕਾਰੀ",
    patientSubtitle: "ਇਹ ਤੁਹਾਡੇ ਡਾਕਟਰ ਦੁਆਰਾ ਦੇਖੀ ਜਾਵੇਗੀ",
    confirmBtn: "ਪੁਸ਼ਟੀ ਕਰੋ ਅਤੇ ਡਾਕਟਰ ਨੂੰ ਭੇਜੋ",
  },
  en: {
    step: "Step 4",
    badge: "Structured summary",
    title: "Your clinical history summary",
    subtitle: "Ready for your doctor · shared only with your consent",
    patientTitle: "What we recorded about you",
    patientSubtitle: "This is what your doctor will read",
    confirmBtn: "Confirm and send to the doctor",
  },
};

export default function SummaryPage() {
  const { session, update } = useSession();
  const router = useRouter();
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [saved, setSaved] = useState(false);
  /** Which engine produced the summary — surfaced to the user, never assumed. */
  const [summarySource, setSummarySource] = useState<"llm" | "rules-engine" | null>(null);
  /** Whether the patient ticked the external-AI scope on /identify. */
  const aiProcessingAllowed = session.consentPurposes?.includes("ai_processing") ?? false;
  // Hard stop: a high-severity interaction needs an explicit acknowledgement
  // tick before Confirm unlocks — a warning panel alone is too easy to skim.
  const [ackRisk, setAckRisk] = useState(false);

  const docMeds: Medication[] = useMemo(
    () => (session.documents ?? []).flatMap((d) => d.entities?.medications ?? []),
    [session.documents]
  );

  const interactions = useMemo(() => {
    if (!session.history) return [];
    return checkInteractions(session.history.medications ?? [], session.history.allergies ?? [], docMeds);
  }, [session.history, docMeds]);

  const interactionsText = useMemo(() => {
    if (!interactions.length && !session.history?.medications?.length) return null;
    const lines = [interactionsToSummary(interactions)];
    // Coverage transparency travels with the handoff document: a physician
    // reading "no interactions identified" must see which drugs were never
    // checked at all.
    const unknown = drugsWithoutCoverage([
      ...(session.history?.medications ?? []),
      ...docMeds,
    ]);
    lines.push(INTERACTION_COVERAGE_NOTE);
    if (unknown.length) lines.push(`Not covered by this check — verify independently: ${unknown.join(", ")}`);
    return lines.join("\n");
  }, [interactions, docMeds, session.history]);

  useEffect(() => {
    if (!session.history) {
      router.replace("/history");
      return;
    }
    // Deps include history so a late-arriving session (storage event) does not
    // cause a false redirect to /history.
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/summarize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            history: session.history,
            mode: session.mode,
            documents: session.documents,
            redFlags: session.redFlags,
            vitals: session.patient?.vitals,
            guardian: session.patient?.guardian,
            consent: buildConsentState(session.consentPurposes ?? [], new Date().toISOString()),
          }),
        });
        if (!res.ok) throw new Error(`summarize failed (${res.status})`);
        const json = await res.json();
        setSummary(json.summary ?? "Could not generate summary.");
        setSummarySource(json.source === "llm" ? "llm" : "rules-engine");
      } catch {
        setSummary("Summary generation failed. Please retry.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: fetch once per history payload
  }, [session.history, router]);

  useEffect(() => {
    if (loading || !summary || saved) return;
    // Helper-OFF kiosks stay silent: no automatic read-back. The listen
    // button on this screen still works on demand.
    if (!session.attendantMode) return;
    // spokenSummaryScript switches on base codes ("hi"), not BCP-47 ("hi-IN").
    const rawLang = session.language?.code ?? session.language?.voiceCode ?? null;
    const lang = rawLang ? rawLang.split("-")[0] : null;
    const script = spokenSummaryScript({
      lang,
      name: session.patient?.name,
      // Spoken in the patient's language; known complaint labels localize,
      // anything else is read back verbatim.
      chiefComplaint: localizeComplaint(session.history?.chiefComplaint ?? "", lang),
      hasDocuments: (session.documents?.length ?? 0) > 0,
    });
    speak(script, session.language?.voiceCode ?? "hi-IN");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, summary, saved, session.language?.code, session.language?.voiceCode, session.attendantMode]);

  const confirmAndSave = () => {
    if (!session.patient || !session.history) return;
    const now = new Date().toISOString();
    const encounterId = session.encounterId ?? generateEncounterId();
    // Deterministic per encounter, not random: the server mints the same token
    // for a fresh write, so the slip, the display call-out and the position
    // lookup agree even if the patient resubmits from another device. (On a
    // true token collision the server re-mints something unique — the rare
    // residual is a stale slip, not two patients sharing one call identity.)
    const token = session.token ?? deriveQueueToken(encounterId);
    const audit: AuditEvent[] = [
      { action: "consent_granted", at: session.consentAt ?? now },
      ...(ackRisk && highInteractions.length > 0
        ? [{ action: "interaction_acknowledged" as const, at: now, detail: `${highInteractions.length} high-severity interaction(s) read at kiosk` }]
        : []),
      { action: "vitals_captured", at: now, detail: session.patient.vitals ? "bp/pulse/temp/height/weight/spo2 recorded" : undefined },
      { action: "documents_scanned", at: now, detail: `${session.documents.length} document(s) digitized` },
    ];
    if (session.attendantMode) {
      // Attributable assistance: the record shows a helper operated the kiosk,
      // so a later reviewer never mistakes assisted input for independent use.
      audit.unshift({ action: "attendant_assisted", at: now });
    }
    if (session.patient.respondent === "guardian") {
      audit.unshift({ action: "guardian_consented", at: now, detail: `Guardian: ${session.patient.guardian?.name} (${session.patient.guardian?.relation})` });
    }
    const finalSummary = interactionsText ? `${summary}\n\n— DRUG INTERACTION CHECK —\n${interactionsText}` : summary;
    const stored: StoredHistory = {
      encounterId,
      updatedAt: now,
      patient: session.patient,
      mode: session.mode,
      lang: session.language?.code ?? "en",
      voiceCode: session.language?.voiceCode ?? "en-IN",
      enteredAt: now,
      history: session.history,
      documents: session.documents,
      redFlags: session.redFlags,
      summary: finalSummary,
      interactions,
      audit,
      consentGranted: session.consentGranted,
      consent: buildConsentState(session.consentPurposes ?? [], now),
      status: "pending",
      token,
    };
    saveHistory(stored);
    recordAudit(encounterId, "history_submitted", "Saved from kiosk summary");
    update({ step: "done", encounterId, token });
    setSaved(true);
    router.push("/done");
  };

  const highFlags = session.redFlags.filter((r) => r.severity === "high");
  const highInteractions = interactions.filter((i) => i.severity === "high");

  const langCode = session.language?.code ?? "en";
  const ui = SUMMARY_UI[langCode] ?? SUMMARY_UI.en;

  const patientSections: Array<{ key: PatientSectionKey; value: string }> = useMemo(() => {
    const h = session.history;
    if (!h) return [];
    const join = (xs: string[]) => xs.filter(Boolean).join(", ");
    // Coded clinical values render in the patient's own language (English in
    // parentheses when it differs, so an attendant can cross-check). Free-text
    // answers (hpi, family, personal, menstrual/obstetric details, review of
    // systems, investigations) stay as recorded — mechanical translation of a
    // patient's own words would be worse than the original plus the localized
    // headings and spoken confirmation around them.
    const disp = (en: string, loc: (v: string, lang?: string | null) => string) => {
      const localized = loc(en, langCode);
      return langCode !== "en" && localized !== en ? `${localized} (${en})` : localized;
    };
    const out: Array<{ key: PatientSectionKey; value: string }> = [];
    if (h.chiefComplaint) out.push({ key: "chiefComplaint", value: disp(h.chiefComplaint, localizeComplaint) });
    if (h.hpi) out.push({ key: "hpi", value: h.hpi });
    if (h.pastMedical?.length) out.push({ key: "pastMedical", value: join(h.pastMedical.map((x) => disp(x.condition, localizePast))) });
    if (h.pastSurgical?.length) out.push({ key: "pastSurgical", value: join(h.pastSurgical.map((x) => disp(x.procedure, localizeSurgery))) });
    if (h.medications?.length) out.push({ key: "medications", value: join(h.medications.map((m) => disp(m.name, localizeCommonMed))) });
    if (h.allergies?.length) out.push({ key: "allergies", value: join(h.allergies.map((a) => disp(a.substance, localizeAllergy))) });
    if (h.familyHistory) out.push({ key: "family", value: h.familyHistory });
    if (h.personalHistory) out.push({ key: "personal", value: h.personalHistory });
    if (h.menstrualHistory) out.push({ key: "menstrual", value: h.menstrualHistory });
    if (h.obstetricHistory) out.push({ key: "obstetric", value: h.obstetricHistory });
    if (h.reviewOfSystems?.length) out.push({ key: "reviewOfSystems", value: join(h.reviewOfSystems.map((r) => r.system)) });
    if (h.priorInvestigations?.length) out.push({ key: "investigations", value: join(h.priorInvestigations.map((i) => i.test)) });
    return out;
  }, [session.history, langCode]);

  return (
    <KioskShell>
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5">
      <div>
        <div className="flex items-center gap-2">
          <span className="chip chip-info">{ui.step}</span>
          <span className="text-[12px] text-ink-3">
            {ui.badge}
          </span>
        </div>
        <h1 className="mt-1.5 flex items-center gap-2 text-xl font-semibold tracking-tight text-ink">
          {ui.title} <ListenButton text={kioskSpeech("listenSummary", langCode)} lang={session.language?.voiceCode} />
        </h1>
        <p className="text-[15px] text-ink-2">
          {ui.subtitle}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => speak(spokenSummaryScript({ lang: langCode, name: session.patient?.name, chiefComplaint: localizeComplaint(session.history?.chiefComplaint ?? "", langCode), hasDocuments: (session.documents?.length ?? 0) > 0 }), session.language?.voiceCode ?? "hi-IN")} className="btn btn-secondary min-h-[56px] text-[15px]">
            <Icon name="volume" size={16} /> {t("readBack", langCode)}
          </button>
          <span className="chip chip-success text-[13px]">{t("correctChip", langCode)}</span>
          <span className="chip chip-neutral text-[13px]">{t("changeChip", langCode)}</span>
        </div>
        <p className="mt-2 text-[13px] text-ink-2">Separate consent recorded: treatment ✓ · ABHA share ✓/✗ · voice ✓/✗ — with timestamp. Switch-style toggles below.</p>
      </div>

      {highFlags.length > 0 && (
        <div className="banner banner-critical flex-col items-start gap-1">
          <p className="flex items-center gap-2 font-semibold">
            <Icon name="siren" size={16} />
            Priority triage alert
          </p>
          <ul className="list-inside list-disc text-[13px]">
            {highFlags.map((f) => (
              <li key={f.id}>
                <strong>{f.symptom}</strong> — {f.message}
              </li>
            ))}
          </ul>
          <p className="text-[12px]">
            This patient has been signalled for immediate attention on the doctor&apos;s dashboard.
          </p>
        </div>
      )}

      {highInteractions.length > 0 && (
        <div className="banner banner-warning flex-col items-start gap-1">
          <p className="flex items-center gap-2 font-semibold">
            <Icon name="pill" size={16} />
            Medication safety alerts
          </p>
          <ul className="list-inside list-disc text-[13px]">
            {highInteractions.map((it, i) => (
              <li key={i}>
                <strong>{it.between}</strong> — {it.message}
              </li>
            ))}
          </ul>
          <p className="text-[12px]">Cross-checked against current medications and documented allergies.</p>
          <label className="mt-2 flex cursor-pointer items-start gap-2.5 rounded-lg border border-warning-border bg-canvas px-3 py-2.5">
            <input
              type="checkbox"
              checked={ackRisk}
              onChange={(e) => setAckRisk(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--brand)]"
            />
            <span className="text-[13px] font-medium text-ink">
              I have read this drug warning and will tell the doctor about all medicines I take.
            </span>
          </label>
        </div>
      )}

      {/* Patient-facing structured view — localized section headings, so the
          record can be checked without reading English clinical prose. */}
      {patientSections.length > 0 && (
        <div className="panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="panel-title">
              <Icon name="file" size={15} className="text-ink-3" />
              {ui.patientTitle}
            </h2>
            <span className="text-[12px] text-ink-3">
              {ui.patientSubtitle}
            </span>
          </div>
          <dl className="space-y-2.5">
            {patientSections.map((s) => (
              <div key={s.key} className="grid grid-cols-1 gap-0.5 sm:grid-cols-[minmax(0,13rem)_1fr] sm:gap-3">
                <dt className="text-sm font-medium text-ink-2">{sectionLabel(s.key, langCode)}</dt>
                <dd className="text-sm text-ink">
                  {langCode === "hi" ? glossClinicalTerm(s.value, langCode) : s.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <span className="font-semibold text-ink">
            Physician Readout
            {summarySource && (
              <span
                title={
                  summarySource === "llm"
                    ? "A language model drafted this summary from your answers and scanned documents. Your doctor reviews and edits it before it is used."
                    : "Built by MediKiosk's deterministic rules engine from your recorded answers and scanned documents. No external AI service received your health information."
                }
                className="ml-2 cursor-help chip"
              >
                {summarySource === "llm" ? "AI-drafted" : "Rules engine (offline)"}
              </span>
            )}
          </span>
          <button type="button" onClick={() => setEditMode((v) => !v)} className="btn btn-secondary btn-sm">
            <Icon name={editMode ? "check" : "pencil"} size={14} />
            {editMode ? "Done editing" : "Edit draft"}
          </button>
        </div>
        <div className="p-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-ink-3">
              <span className="spinner" aria-hidden />
              <p className="mt-4 text-sm">Compiling your history…</p>
            </div>
          ) : editMode ? (
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={22}
              className="prose-clin w-full rounded-lg border border-line p-3 text-sm text-ink"
            />
          ) : (
            <div className="prose-clin whitespace-pre-wrap rounded-lg border border-line bg-sunken p-4 text-[13px] leading-relaxed text-ink">
              {summary}
            </div>
          )}
        </div>
        <div className="mx-4 mb-4 flex items-start gap-2 rounded-lg border border-line bg-sunken px-3 py-2 text-[12px] text-ink-2">
          <Icon name="shield" size={14} className="mt-px shrink-0" />
          <span>
            Encrypted · consent granted (DPDP 2023) · session data cleared after confirmation · draft for
            physician review, not a diagnosis
          </span>
        </div>
        <div className="mx-4 mb-4 flex items-start gap-2 rounded-lg border border-line bg-sunken px-3 py-2 text-[12px] text-ink-2">
          <Icon name="info" size={14} className="mt-px shrink-0" />
          <span>
            {aiProcessingAllowed
              ? "You agreed to use an AI language service outside this hospital to help draft this summary. You can change this in your portal."
              : "This summary was written on this hospital's own system. Nothing was sent to an outside AI service."}{" "}
            Your doctor reviews it before it is used.
          </span>
        </div>
      </div>

      <div className="mt-1 flex items-center justify-between gap-3">
        <button type="button" onClick={() => router.push("/scan")} className="btn btn-secondary btn-lg">
          <Icon name="arrowLeft" size={16} />
          {t("back", langCode)}
        </button>
        <button
          type="button"
          onClick={confirmAndSave}
          disabled={loading || saved || (highInteractions.length > 0 && !ackRisk)}
          title={highInteractions.length > 0 && !ackRisk ? "Tick the drug-warning acknowledgement above first" : undefined}
          className="btn btn-primary btn-lg disabled:opacity-50"
        >
          <Icon name="check" size={16} />
          {ui.confirmBtn}
        </button>
      </div>
    </div>
    </KioskShell>
  );
}