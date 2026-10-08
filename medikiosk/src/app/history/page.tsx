"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { t as tUI } from "@/lib/i18n";
import { CHIEF_COMPLAINTS, AYUSH_FOLLOWUPS, DASHAVIDHA_PARIKsha_BASE, getDepartmentQuestions } from "@/lib/data";
import { useSession } from "@/lib/useSession";
import { REVIEW_OF_SYSTEMS, evaluateRedFlags } from "@/lib/redflags";
import {
  localizeOptions,
  localizeQuestion,
  localizeComplaint,
  localizePast,
  localizeStageLabel,
  localizeSurgery,
  localizeCommonMed,
  localizeAllergy,
  localizePersonalHabit,
  getHistoryStageUI,
} from "@/lib/translations";
import { appendVoiceText, recordAndTranscribe, speak, speakGuidance } from "@/lib/speech";
import { buildKioskConsent } from "@/lib/consent";
import type { ClinicalHistory, Question, RedFlag } from "@/lib/types";
import { Icon } from "@/components/Icon";
import { KioskShell } from "@/components/AppShell";
import { HelpVideo } from "@/components/GovtKioskHelp";
import BodyMap, { type BodyMapSelection } from "@/components/BodyMap";

type Stage =
  | "complaint"
  | "socrates"
  | "hpi-open"
  | "past"
  | "surgical"
  | "medications"
  | "allergies"
  | "family"
  | "personal"
  | "female"
  | "ros"
  | "ayush"
  | "complete";

const STAGE_LABELS: Record<Stage, string> = {
  complaint: "Chief Complaint",
  socrates: "History of Present Illness",
  "hpi-open": "Tell me more",
  past: "Past Medical History",
  surgical: "Past Surgical History",
  medications: "Current Medications",
  allergies: "Allergies",
  family: "Family History",
  personal: "Personal History",
  female: "Menstrual & Obstetric History",
  ros: "Review of Systems",
  ayush: "AYUSH Assessment",
  complete: "Complete",
};

const PAST_CONDITIONS = [
  "Diabetes",
  "Hypertension",
  "Asthma",
  "TB (Tuberculosis)",
  "Heart disease",
  "Thyroid disorder",
  "Epilepsy / seizures",
  "Cancer",
  "Anaemia",
  "Kidney disease",
  "Liver disease",
  "Joint disease",
  "None",
];

const SURGERIES = [
  "None",
  "Appendectomy",
  "Gallbladder removal",
  "Hernia repair",
  "Caesarean section",
  "Hysterectomy",
  "Knee / hip replacement",
  "Cataract surgery",
  "Heart surgery",
  "Other",
];

const COMMON_MEDS = [
  "Paracetamol",
  "Ibuprofen",
  "Diclofenac",
  "Aspirin",
  "Cetirizine",
  "Azithromycin",
  "Amoxicillin",
  "Pantoprazole",
  "Metformin",
  "Glimepiride",
  "Amlodipine",
  "Telmisartan",
  "Metoprolol",
  "Atorvastatin",
  "Levothyroxine",
  "Insulin",
  "Furosemide",
  "Multivitamin",
  "None",
];

const ALLERGY_OPTIONS = [
  "Penicillin",
  "Amoxicillin",
  "Sulpha drugs",
  "Aspirin",
  "Ibuprofen",
  "Paracetamol",
  "Ciprofloxacin",
  "Tetanus injection",
  "Latex",
  "Dust allergy",
  "Food allergy",
  "Peanut allergy",
  "Bee sting",
  "Iodine dye",
  "None known",
  "Other",
];

export default function HistoryPage() {
  const { session, update } = useSession();
  const router = useRouter();

  const [stage, setStage] = useState<Stage>("complaint");
  const [complaint, setComplaint] = useState("");
  const [socratesIdx, setSocratesIdx] = useState(0);
  const [socratesAnswers, setSocratesAnswers] = useState<Record<string, string>>({});
  const [hpiText, setHpiText] = useState("");
  const [pastSel, setPastSel] = useState<string[]>([]);
  const [surgicalSel, setSurgicalSel] = useState<string[]>([]);
  const [medsSel, setMedsSel] = useState<string[]>([]);
  const [allergySel, setAllergySel] = useState<string[]>([]);
  const [familyText, setFamilyText] = useState("");
  const [smoking, setSmoking] = useState("");
  const [alcohol, setAlcohol] = useState("");
  // Menstrual / obstetric history (female patients)
  const [menstrualReg, setMenstrualReg] = useState("");
  const [menstrualText, setMenstrualText] = useState("");
  const [everPregnant, setEverPregnant] = useState("");
  const [obstetricText, setObstetricText] = useState("");
  const [rosIdx, setRosIdx] = useState(0);
  const [rosAnswers, setRosAnswers] = useState<Record<string, string>>({});
  const [ayushIdx, setAyushIdx] = useState(0);
  const [ayushAnswers, setAyushAnswers] = useState<Record<string, string>>({});
  const [freeText, setFreeText] = useState("");
  const [redFlags, setRedFlags] = useState<RedFlag[]>([]);
  const [convoLog, setConvoLog] = useState<{ question: string; answer: string }[]>([]);
  const [aiProbe, setAiProbe] = useState<string | null>(null);
  const [aiProbeAnswer, setAiProbeAnswer] = useState("");
  const [probing, setProbing] = useState(false);
  const [complaintView, setComplaintView] = useState<"bodymap" | "grid">("bodymap");
  const [bodySelection, setBodySelection] = useState<BodyMapSelection | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);

  const DRAFT_KEY = "medikiosk_history_draft";

  const langCode = session.language?.voiceCode ?? "hi-IN";
  const lang = session.language?.code ?? "en";

  const t = (q: Question) => localizeQuestion(q.id, lang) ?? q.text;
  const opts = (q: Question) => localizeOptions(q.id, lang, q.options ?? []);

  const hpiQuestions = useMemo(
    () => getDepartmentQuestions(session.patient?.department, session.mode),
    [session.patient?.department, session.mode]
  );
  const rosQuestions = useMemo(() => REVIEW_OF_SYSTEMS.flatMap((r) => r.questions), []);
  const currentRosQuestion = rosQuestions[rosIdx];
  const ayushQuestions = useMemo(() => AYUSH_FOLLOWUPS, []);

  const isFemale = session.patient?.sex === "Female";
  const stageList = useMemo(() => {
    const s: Stage[] = ["complaint", "socrates", "hpi-open", "past", "surgical", "medications", "allergies", "family", "personal"];
    if (isFemale) s.push("female");
    s.push("ros");
    if (session.mode === "ayush") s.push("ayush");
    s.push("complete");
    return s;
  }, [session.mode, isFemale]);

  const stageIndex = stageList.indexOf(stage);
  // Progress accounts for intra-stage questions so the bar moves through
  // HPI/ROS/AYUSH instead of stalling then jumping.
  const subProgress = (() => {
    if (stage === "socrates") return socratesIdx / Math.max(hpiQuestions.length, 1);
    if (stage === "ros") return rosIdx / Math.max(rosQuestions.length, 1);
    if (stage === "ayush") return ayushIdx / Math.max(ayushQuestions.length, 1);
    return 0;
  })();
  const progress =
    ((Math.max(stageIndex, 0) + Math.min(Math.max(subProgress, 0), 0.999)) /
      Math.max(stageList.length - 1, 1)) *
    100;

  // ---- Draft persistence: browser back / refresh must not lose in-progress answers ----
  // Saved on every change; restored once on mount. Cleared on successful complete().
  // This is local-only, never triggers an API request.
  /* eslint-disable react-hooks/set-state-in-effect -- one-time hydration from localStorage draft */
  useEffect(() => {
    if (draftRestored) return;
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) {
        setDraftRestored(true);
        return;
      }
      const d = JSON.parse(raw) as Partial<{
        stage: Stage;
        complaint: string;
        socratesIdx: number;
        socratesAnswers: Record<string, string>;
        hpiText: string;
        pastSel: string[];
        surgicalSel: string[];
        medsSel: string[];
        allergySel: string[];
        familyText: string;
        smoking: string;
        alcohol: string;
        menstrualReg: string;
        menstrualText: string;
        everPregnant: string;
        obstetricText: string;
        rosIdx: number;
        rosAnswers: Record<string, string>;
        ayushIdx: number;
        ayushAnswers: Record<string, string>;
        convoLog: { question: string; answer: string }[];
      }>;
      if (d.stage) setStage(d.stage);
      if (typeof d.complaint === "string") setComplaint(d.complaint);
      if (typeof d.socratesIdx === "number") setSocratesIdx(d.socratesIdx);
      if (d.socratesAnswers) setSocratesAnswers(d.socratesAnswers);
      if (typeof d.hpiText === "string") setHpiText(d.hpiText);
      if (Array.isArray(d.pastSel)) setPastSel(d.pastSel);
      if (Array.isArray(d.surgicalSel)) setSurgicalSel(d.surgicalSel);
      if (Array.isArray(d.medsSel)) setMedsSel(d.medsSel);
      if (Array.isArray(d.allergySel)) setAllergySel(d.allergySel);
      if (typeof d.familyText === "string") setFamilyText(d.familyText);
      if (typeof d.smoking === "string") setSmoking(d.smoking);
      if (typeof d.alcohol === "string") setAlcohol(d.alcohol);
      if (typeof d.menstrualReg === "string") setMenstrualReg(d.menstrualReg);
      if (typeof d.menstrualText === "string") setMenstrualText(d.menstrualText);
      if (typeof d.everPregnant === "string") setEverPregnant(d.everPregnant);
      if (typeof d.obstetricText === "string") setObstetricText(d.obstetricText);
      if (typeof d.rosIdx === "number") setRosIdx(d.rosIdx);
      if (d.rosAnswers) setRosAnswers(d.rosAnswers);
      if (typeof d.ayushIdx === "number") setAyushIdx(d.ayushIdx);
      if (d.ayushAnswers) setAyushAnswers(d.ayushAnswers);
      if (Array.isArray(d.convoLog)) setConvoLog(d.convoLog);
    } catch {
      /* corrupted draft — start fresh */
    } finally {
      setDraftRestored(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!draftRestored) return;
    try {
      window.localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          stage,
          complaint,
          socratesIdx,
          socratesAnswers,
          hpiText,
          pastSel,
          surgicalSel,
          medsSel,
          allergySel,
          familyText,
          smoking,
          alcohol,
          menstrualReg,
          menstrualText,
          everPregnant,
          obstetricText,
          rosIdx,
          rosAnswers,
          ayushIdx,
          ayushAnswers,
          convoLog,
        })
      );
    } catch {
      /* storage full — in-memory state still works */
    }
  }, [
    draftRestored,
    stage,
    complaint,
    socratesIdx,
    socratesAnswers,
    hpiText,
    pastSel,
    surgicalSel,
    medsSel,
    allergySel,
    familyText,
    smoking,
    alcohol,
    menstrualReg,
    menstrualText,
    everPregnant,
    obstetricText,
    rosIdx,
    rosAnswers,
    ayushIdx,
    ayushAnswers,
    convoLog,
    DRAFT_KEY,
  ]);

  const scrollTop = useCallback(() => {
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, []);

  // ---- Back navigation: one step back, preserving all inputs ----
  // Pure client-side state change: no form submit, no fetch, no store reset.
  // convoLog is trimmed by one entry so going back + re-answering does not
  // duplicate the conversation history.
  const goBack = useCallback(() => {
    // Inside the hpi-open overflow (socrates idx past the end) -> last HPI q
    if (stage === "socrates" && socratesIdx >= hpiQuestions.length) {
      setSocratesIdx(hpiQuestions.length - 1);
      setConvoLog((prev) => prev.slice(0, -1));
      scrollTop();
      return;
    }
    if (stage === "socrates" && socratesIdx > 0) {
      setSocratesIdx((i) => i - 1);
      setConvoLog((prev) => prev.slice(0, -1));
      scrollTop();
      return;
    }
    if (stage === "socrates" && socratesIdx === 0) {
      setStage("complaint");
      scrollTop();
      return;
    }
    if (stage === "hpi-open") {
      setStage("socrates");
      setSocratesIdx(hpiQuestions.length - 1);
      setConvoLog((prev) => prev.slice(0, -1));
      scrollTop();
      return;
    }
    if (stage === "ros" && rosIdx > 0) {
      setRosIdx((i) => i - 1);
      setConvoLog((prev) => prev.slice(0, -1));
      scrollTop();
      return;
    }
    if (stage === "ros" && rosIdx === 0) {
      const prev = stageList[stageIndex - 1] ?? "personal";
      setStage(prev);
      // Leaving the "Captured" log behind duplicates the conversation.
      setConvoLog((prevLog) => prevLog.slice(0, -1));
      scrollTop();
      return;
    }
    if (stage === "ayush" && ayushIdx > 0) {
      setAyushIdx((i) => i - 1);
      setConvoLog((prev) => prev.slice(0, -1));
      scrollTop();
      return;
    }
    if (stage === "ayush" && ayushIdx === 0) {
      setStage("ros");
      setRosIdx(rosQuestions.length - 1);
      setConvoLog((prev) => prev.slice(0, -1));
      scrollTop();
      return;
    }
    if (stage === "complaint") {
      // First step: back goes to the previous main section (identity)
      router.push("/identify");
      return;
    }
    // Linear stages: past -> hpi-open, surgical -> past, ... , family -> allergies, etc.
    const prev = stageList[stageIndex - 1];
    if (prev) {
      // Discard uncommitted type-box text: it is only saved by Next, so
      // carrying it backward would wrongly satisfy the answer gate there.
      if (["past", "surgical", "medications", "allergies"].includes(stage)) setFreeText("");
      setStage(prev);
      // personal logs smoking+alcohol; female logs regularity + pregnancy (before
      // the "Captured" entry). Trim only what was actually logged so back +
      // re-answer does not duplicate the conversation sent to /scan and /summary.
      if (stage === "personal") {
        const n = (smoking ? 1 : 0) + (alcohol ? 1 : 0);
        if (n > 0) setConvoLog((prevLog) => prevLog.slice(0, -n));
      } else if (stage === "female") {
        const n = (menstrualReg ? 1 : 0) + (everPregnant ? 1 : 0);
        if (n > 0) setConvoLog((prevLog) => prevLog.slice(0, -n));
      }
      scrollTop();
      return;
    }
    router.push("/identify");
  }, [stage, socratesIdx, rosIdx, ayushIdx, stageList, stageIndex, hpiQuestions.length, rosQuestions.length, router, scrollTop, smoking, alcohol, menstrualReg, everPregnant]);

  const isFirstStage = stage === "complaint" && socratesIdx === 0 && rosIdx === 0 && ayushIdx === 0;
  const backLabel = isFirstStage ? `${tUI("back", lang)} · Identity` : tUI("back", lang);

  const logged = useRef<{ [k: string]: boolean }>({});

  useEffect(() => {
    if (!session.patient) {
      router.replace("/identify");
      return;
    }
    // Silent kiosk: with the helper OFF there is no proactive voice — the
    // patient reads the screen. Mic dictation, listen buttons and tap
    // feedback still work on demand.
    if (!session.attendantMode) return;
    // Key by stage + sub-index: sharing one key per stage silenced Q2..N.
    const speechKey = `${stage}-${socratesIdx}-${rosIdx}-${ayushIdx}-${lang}`;
    if (logged.current[speechKey]) return;
    logged.current[speechKey] = true;
    // Spoken prompts must follow the kiosk's chosen language — the same
    // localized strings shown on screen — never hardcoded English.
    const ui = getHistoryStageUI(lang);
    let msg = "";
    switch (stage) {
      case "complaint":
        speakGuidance("history", lang, langCode);
        break;
      case "hpi-open":
        msg = `${ui.hpiTitle}. ${ui.hpiSubtitle}`;
        break;
      case "past":
        msg = ui.pastSubtitle;
        break;
      case "surgical":
        msg = ui.surgicalSubtitle;
        break;
      case "medications":
        msg = ui.medsSubtitle;
        break;
      case "allergies":
        msg = ui.allergiesSubtitle;
        break;
      case "family":
        msg = ui.familySubtitle;
        break;
      case "personal":
        msg = `${ui.personalTitle}. ${ui.smokingTitle}. ${ui.alcoholTitle}`;
        break;
      case "socrates":
        if (socratesIdx < hpiQuestions.length) {
          const q = hpiQuestions[socratesIdx];
          // Read the question plus EVERY option — truncating the list hides
          // valid answers from patients who listen instead of reading.
          msg = `${t(q)} ${opts(q).join(", ")}`;
        } else {
          msg = localizeQuestion("hpi", lang) ?? "अपनी परेशानी के बारे में विस्तार से बताएं। Tell us more in your own words.";
        }
        break;
      case "ros":
        if (rosIdx < rosQuestions.length) {
          const q = rosQuestions[rosIdx];
          msg = `${t(q)}`;
        }
        break;
      case "female":
        msg = localizeQuestion("female_period", lang) ?? "क्या आपके मासिक धर्म नियमित हैं? Have your periods been regular?";
        break;
      case "ayush":
        if (ayushIdx < ayushQuestions.length) {
          const q = ayushQuestions[ayushIdx];
          msg = `${t(q)}`;
        }
        break;
      default:
        msg = STAGE_LABELS[stage];
    }
    if (msg) speak(msg, langCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, socratesIdx, rosIdx, ayushIdx, lang, langCode, hpiQuestions, session.attendantMode]);

  const logAnswer = (q: string, a: string) => {
    setConvoLog((prev) => [...prev, { question: q, answer: a }]);
  };

  const handleComplaint = (c: string) => {
    setComplaint(c);
    logAnswer("Chief complaint", c);
    setStage("socrates");
    scrollTop();
  };

  const handleSocratesAnswer = (q: Question, a: string) => {
    setSocratesAnswers((prev) => ({ ...prev, [q.id]: a }));
    logAnswer(q.text, a);
    const nextIdx = socratesIdx + 1;
    setSocratesIdx(nextIdx);
    if (nextIdx >= hpiQuestions.length) {
      setStage("hpi-open");
    }
    scrollTop();
  };

  const handleRosAnswer = (a: string) => {
    const q = currentRosQuestion;
    if (q) {
      setRosAnswers((prev) => ({ ...prev, [q.id]: a }));
      logAnswer(q.text, a);
      const full = a.toLowerCase();
      if (q.id === "resp_breath" && (full.includes("at rest") || full.includes("severe") || full.includes("आराम के समय") || full.includes("गंभीर"))) {
        setRedFlags((f) => [...f, {
          id: "rf-breath",
          severity: "high",
          symptom: "Breathlessness",
          message: "Breathlessness at rest - urgent respiratory assessment required.",
        }]);
      }
    }
    const nextIdx = rosIdx + 1;
    setRosIdx(nextIdx);
    if (nextIdx >= rosQuestions.length && session.mode === "ayush") {
      setStage("ayush");
    }
    scrollTop();
  };

  const handleAyushAnswer = (q: Question, a: string) => {
    setAyushAnswers((prev) => ({ ...prev, [q.id]: a }));
    logAnswer(q.text, a);
    setAyushIdx((i) => i + 1);
    scrollTop();
  };

  const onTranscript = (text: string) => {
    if (stage === "complaint") {
      const match = CHIEF_COMPLAINTS.find((c) => c.label.toLowerCase().includes(text.toLowerCase()));
      if (match) {
        handleComplaint(match.label);
      } else {
        setComplaint(text);
        logAnswer("Chief complaint", text);
        setStage("socrates");
      }
    } else if (stage === "socrates") {
      const q = hpiQuestions[socratesIdx];
      if (q) handleSocratesAnswer(q, text);
    } else if (stage === "hpi-open") {
      // Append: a second dictation extends the description instead of wiping it.
      setHpiText((prev) => appendVoiceText(prev, text));
    } else if (stage === "ros") {
      handleRosAnswer(text);
    } else if (stage === "ayush") {
      const q = ayushQuestions[ayushIdx];
      if (q) {
        // Free-text AYUSH questions (e.g. daily routine) fill the box like
        // hpi-open instead of auto-advancing past it.
        if (q.type === "text") {
          setAyushAnswers((prev) => ({ ...prev, [q.id]: appendVoiceText(prev[q.id] ?? "", text) }));
        } else handleAyushAnswer(q, text);
      }
    } else {
      setFreeText((prev) => appendVoiceText(prev, text));
    }
  };

  const probeWithAi = async () => {
    setProbing(true);
    try {
      const socratesHistory = hpiQuestions
        .filter((q) => socratesAnswers[q.id])
        .map((q) => `${q.text}: ${socratesAnswers[q.id]}`);

      const combinedHpi = [
        complaint ? `Chief Complaint: ${complaint}` : "",
        ...socratesHistory,
        hpiText ? `Patient's description: ${hpiText}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const questionHistory = convoLog.map((c) => `${c.question} -> ${c.answer}`).join("\n");

      const res = await fetch("/api/converse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chiefComplaint: complaint,
          department: session.patient?.department ?? "",
          hpi: combinedHpi || complaint,
          priorQuestions: questionHistory || convoLog.map((c) => c.question).join(" | "),
          language: lang,
          // Pre-save ai_processing tick. A 403 means the patient did not
          // consent to external processing — handled below by staying on the
          // guided flow, exactly like a backend outage.
          consent: buildKioskConsent(session.consentPurposes ?? []),
        }),
      });
      if (!res.ok) {
        setAiProbe(null);
        return;
      }
      const json = await res.json();
      if (json.complete) setAiProbe(null);
      else {
        setAiProbe(json.question ?? null);
        if (json.question) speak(json.question, langCode);
      }
    } catch {
      setAiProbe(null);
    } finally {
      setProbing(false);
    }
  };

  // Red-flag complaints must not reach the doctor without triage vitals
  // (BP sys/dia, pulse, SpO2). Vitals are optional at /identify because the
  // complaint is unknown there — so the gate lives here, at the end of the
  // disease description, with a way back to add them (progress is preserved
  // in the history draft).
  const [needVitals, setNeedVitals] = useState(false);
  const vitalsMissingForComplaint = () => {
    if (!/chest pain|breathlessness/i.test(complaint)) return false;
    const v = session.patient?.vitals;
    return !(v && v.systolic != null && v.diastolic != null && v.pulse != null && v.spo2 != null);
  };

  const complete = () => {
    if (vitalsMissingForComplaint()) {
      setNeedVitals(true);
      scrollTop();
      return;
    }
    setNeedVitals(false);
    const isNegative = (v: string) => {
      const trimmed = v.trim().toLowerCase();
      return trimmed === "no" || trimmed.startsWith("no ") || trimmed.startsWith("no,") || trimmed === "नहीं" || trimmed.startsWith("नहीं ");
    };
    const positiveRos = Object.entries(rosAnswers).filter(([, v]) => !isNegative(v));
    const reviewOfSystems = positiveRos.map(([id, v]) => {
      const q = rosQuestions.find((r) => r.id === id);
      return { system: q?.category ?? "Review of Systems", positive: v };
    });

    const hpi = [
      complaint,
      ...hpiQuestions.filter((q) => socratesAnswers[q.id]).map((q) => `${q.text} ${socratesAnswers[q.id]}`),
      ...(hpiText ? [`Patient's own words: ${hpiText}`] : []),
      ...(aiProbe && aiProbeAnswer.trim() ? [`AI follow-up (“${aiProbe}”): ${aiProbeAnswer.trim()}`] : []),
    ].join(". ");

    const ayush: ClinicalHistory["ayush"] = session.mode === "ayush" ? {
      prakriti: ayushAnswers["prakriti"] ?? "",
      vikriti: "",
      sara: "",
      samhanana: "",
      pramana: `${session.patient?.age} years`,
      satmya: "",
      sattva: ayushAnswers["sattva"] ?? "",
      aharaShakti: ayushAnswers["agni"] ?? "",
      vyayamaShakti: "",
      vaya: ayushAnswers["vaya"] ?? "",
      agni: ayushAnswers["agni"] ?? "",
      koshtha: ayushAnswers["koshtha"] ?? "",
      nidana: "",
      samprapti: "",
      aharaVihara: ayushAnswers["vihara"] ?? "",
    } : undefined;

    const history: ClinicalHistory = {
      name: session.patient?.name ?? "",
      age: session.patient?.age ?? 0,
      sex: session.patient?.sex ?? "",
      chiefComplaint: complaint,
      hpi,
      pastMedical: pastSel.filter((c) => c !== "None").map((c) => ({ condition: c })),
      pastSurgical: surgicalSel.filter((s) => s !== "None" && s !== "Other").map((s) => ({ procedure: s })),
      medications: medsSel.filter((m) => m !== "None").map((m) => ({ name: m })),
      allergies: allergySel.filter((a) => a !== "None known").map((a) => ({ substance: a })),
      familyHistory: familyText || "Not elicited",
      personalHistory: [
        smoking ? `Smoking: ${smoking}` : "",
        alcohol ? `Alcohol: ${alcohol}` : "",
      ].filter(Boolean).join("; ") || "Not elicited",
      menstrualHistory:
        isFemale && (menstrualReg || menstrualText)
          ? [menstrualReg ? `Periods: ${menstrualReg}` : "", menstrualText ? `Details: ${menstrualText}` : ""]
              .filter(Boolean)
              .join("; ")
          : undefined,
      obstetricHistory:
        isFemale && (everPregnant || obstetricText)
          ? [everPregnant ? `Pregnancy: ${everPregnant}` : "", obstetricText ? `Obstetric details: ${obstetricText}` : ""]
              .filter(Boolean)
              .join("; ")
          : undefined,
      reviewOfSystems: reviewOfSystems.length ? reviewOfSystems : [{ system: "General", positive: "All systems negative" }],
      priorInvestigations: [],
      ayush,
    };

    const overallText = [
      history.hpi,
      ...history.pastMedical.map((p) => p.condition),
      ...Object.values(rosAnswers),
    ].join(" ");
    const flags = evaluateRedFlags(overallText, overallText);

    // Preserve vitals triage flags captured at /identify: evaluateRedFlags
    // only sees history text, so merge instead of overwriting.
    const mergedFlags = [...(session.redFlags ?? []), ...flags];
    setRedFlags(mergedFlags);
    update({
      step: "scan",
      conversation: convoLog,
      history,
      redFlags: mergedFlags,
    });
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    router.push("/scan");
  };

  const renderOptionGrid = (options: string[], onPick: (v: string) => void, cols = 2, selected?: string) => (
    <div className={`grid grid-cols-1 gap-2.5 ${cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
      {options.map((o) => {
        const isSelected = selected === o;
        return (
          <button
            key={o}
            type="button"
            onClick={() => onPick(o)}
            aria-pressed={isSelected}
            className={`rounded-lg border px-4 py-3.5 text-left text-base transition-colors ${
              isSelected
                ? "border-[var(--border-focus)] bg-brand font-semibold text-white shadow-sm"
                : "border-line bg-canvas text-ink hover:border-line-strong hover:bg-sunken"
            }`}
          >
            {o}
          </button>
        );
      })}
    </div>
  );

  const renderMultiSelect = (
    options: string[],
    selected: string[],
    toggle: (v: string) => void,
    onDone: () => void,
    singleColumn = true,
    display?: (v: string) => string
  ) => (
    <div>
      <div className={`grid grid-cols-1 gap-2 ${singleColumn ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
        {options.map((o) => {
          const on = selected.includes(o);
          return (
            <button type="button"
              key={o}
              onClick={() => toggle(o)}
              aria-pressed={on}
              className={`rounded-lg border px-4 py-3 text-left text-[15px] transition-colors ${
                on
                  ? "border-[var(--border-focus)] bg-brand font-semibold text-white"
                  : "border-line bg-canvas text-ink hover:border-line-strong"
              }`}
            >
              {display ? display(o) : o}
            </button>
          );
        })}
      </div>
      {!singleColumn && (
        <input
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          placeholder="Or type or speak additional items…"
          className="field mt-3"
        />
      )}
      {selected.length === 0 && !freeText.trim() && (
        <p role="status" className="mt-3 flex items-center justify-center gap-1.5 text-center text-[13px] font-medium text-critical">
          <Icon name="alert" size={14} className="shrink-0" />
          {tUI("answerRequired", lang)}
        </p>
      )}
      <button
        type="button"
        disabled={selected.length === 0 && !freeText.trim()}
        onClick={() => {
          onDone();
          scrollTop();
        }}
        className="btn btn-primary btn-lg mt-4 w-full disabled:opacity-50"
      >
        Next
        <Icon name="arrowRight" size={16} />
      </button>
    </div>
  );

  const toggleIn = (arr: string[], v: string, set: (v: string[]) => void) => {
    if (v === "None" || v === "None known") {
      set(arr.includes(v) ? [] : [v]);
      return;
    }
    set(arr.includes(v) ? arr.filter((x) => x !== v) : v === "Other" ? [...arr.filter((x) => x !== "None" && x !== "None known" && x !== "Other"), "Other"] : [...arr.filter((x) => x !== "None" && x !== "None known"), v]);
  };

  // Merge the "type your own" box into the selection when leaving the stage.
  // Without this, typed (or dictated) custom entries were silently dropped on
  // Next — the box before this fix accepted text but never saved it anywhere.
  const commitFreeText = (arr: string[], set: (v: string[]) => void) => {
    const extras = freeText
      .split(",")
      .map((s) => s.trim().replace(/\s+/g, " "))
      .filter(Boolean)
      .filter((s) => !arr.some((x) => x.toLowerCase() === s.toLowerCase()));
    if (extras.length) {
      set([...arr.filter((x) => x !== "None" && x !== "None known"), ...extras]);
    }
    if (freeText.trim()) setFreeText("");
  };

  const stageUI = getHistoryStageUI(lang);

  // ------------------ RENDER ------------------
  return (
    <KioskShell>
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
      <div className="mb-5">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="section-label">{localizeStageLabel(stage, lang)}</span>
          <span className="text-[12px] tabular-nums text-ink-3">{Math.round(progress)}%</span>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="History progress"
        >
          <div className="h-full rounded-full bg-brand" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Back navigation — every Disease Description step. type="button" so it never
          submits a form; pure state change, no fetch, preserves all inputs via state.
          First step routes to the previous main section (/identify). */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={goBack}
          aria-label={isFirstStage ? "Back to identity details" : "Go back to previous question"}
          className="btn btn-secondary btn-sm min-h-[44px]"
        >
          <Icon name="arrowLeft" size={15} />
          {backLabel}
        </button>
        <span className="text-[12px] tabular-nums text-ink-3" aria-live="polite">
          Step {Math.max(stageIndex + 1, 1)} / {stageList.length}
          {stage === "socrates" && socratesIdx < hpiQuestions.length
            ? ` · Q ${socratesIdx + 1}/${hpiQuestions.length}`
            : null}
          {stage === "ros" && rosIdx < rosQuestions.length
            ? ` · Q ${rosIdx + 1}/${rosQuestions.length}`
            : null}
          {stage === "ayush" && ayushIdx < ayushQuestions.length
            ? ` · Q ${ayushIdx + 1}/${ayushQuestions.length}`
            : null}
        </span>
      </div>

      {stage === "complaint" && (
        <div className="fade-up flex flex-col gap-4">
          <div className="banner banner-success text-[15px]">
            <Icon name="mic" size={18} className="mt-0.5 shrink-0" />
            <span>{stageUI.voiceHint}</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-ink">{stageUI.complaintTitle}</h1>
              <p className="text-ink-2 text-[15px]">{stageUI.complaintSubtitle}</p>
              <HelpVideo />
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-line bg-sunken p-1">
              <button
                type="button"
                onClick={() => setComplaintView("bodymap")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  complaintView === "bodymap"
                    ? "bg-brand text-white shadow-sm"
                    : "text-ink-2 hover:text-ink hover:bg-canvas"
                }`}
              >
                <Icon name="activity" size={14} />
                {stageUI.bodymapBtn}
              </button>
              <button
                type="button"
                onClick={() => setComplaintView("grid")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  complaintView === "grid"
                    ? "bg-brand text-white shadow-sm"
                    : "text-ink-2 hover:text-ink hover:bg-canvas"
                }`}
              >
                <Icon name="grid" size={14} />
                {stageUI.gridBtn}
              </button>
            </div>
          </div>

          {complaintView === "bodymap" ? (
            <div className="flex flex-col gap-4">
              <BodyMap
                lang={lang}
                onSelect={(sel) => {
                  setBodySelection(sel);
                }}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!bodySelection}
                  onClick={() => {
                    if (bodySelection) {
                      const c = `${bodySelection.complaintSuggestion} (${bodySelection.label})`;
                      setSocratesAnswers((prev) => ({
                        ...prev,
                        severity: bodySelection.severity ? `${bodySelection.severity}/10` : "Moderate",
                      }));
                      handleComplaint(c);
                    }
                  }}
                  className="btn btn-primary btn-lg flex-1 disabled:opacity-50"
                  aria-describedby={!bodySelection ? "bodymap-hint" : undefined}
                >
                  <Icon name="check" size={18} />
                  {stageUI.continueBtn}
                </button>
              </div>
              {!bodySelection && (
                <p id="bodymap-hint" className="text-[13px] text-ink-2">
                  {stageUI.complaintSubtitle}
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {CHIEF_COMPLAINTS.map((c) => {
                const isSelected = complaint.startsWith(c.label);
                return (
                  <button type="button"
                    key={c.label}
                    onClick={() => handleComplaint(c.label)}
                    aria-pressed={isSelected}
                    className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border px-3 py-4 transition-colors ${
                      isSelected
                        ? "border-[var(--border-focus)] bg-brand font-semibold text-white shadow-sm"
                        : "border-line bg-canvas hover:border-line-strong hover:bg-sunken"
                    }`}
                  >
                    <Icon name={c.icon} size={22} className={isSelected ? "text-white" : "text-ink-2"} />
                    <span className={`text-[13px] font-medium ${isSelected ? "text-white" : "text-ink"}`}>{c.label}</span>
                    <span className={`text-[11px] ${isSelected ? "text-white/80" : "text-ink-3"}`}>{localizeComplaint(c.label, lang)}</span>
                  </button>
                );
              })}
            </div>
          )}

          <button type="button"
            onClick={() => handleComplaint("Not sure / no specific complaint")}
            className="w-full rounded-lg border border-dashed border-line-strong px-4 py-3 text-[13px] font-medium text-ink-2 transition-colors hover:border-line-strong hover:bg-sunken hover:text-ink"
          >
            {stageUI.doctorBtn}
          </button>
        </div>
      )}

      {stage === "socrates" && socratesIdx < hpiQuestions.length && (
        <div className="fade-up">
          <p className="text-xs font-semibold uppercase tracking-wide text-success mb-1">
            {session.patient?.department ? `${session.patient.department} · ` : ""}{stageUI.socratesHeader}
          </p>
          <h1 className="text-2xl font-bold text-ink mb-4">{t(hpiQuestions[socratesIdx])}</h1>
          {renderOptionGrid(
            opts(hpiQuestions[socratesIdx]),
            (a) => handleSocratesAnswer(hpiQuestions[socratesIdx], a),
            2,
            socratesAnswers[hpiQuestions[socratesIdx].id]
          )}
        </div>
      )}

      {(stage === "hpi-open" || (stage === "socrates" && socratesIdx >= hpiQuestions.length)) && (
        <div className="fade-up">
          <h1 className="text-xl font-semibold tracking-tight text-ink">{stageUI.hpiTitle}</h1>
          <p className="text-ink-2 mb-3">{stageUI.hpiSubtitle}</p>
          <textarea
            value={hpiText}
            onChange={(e) => setHpiText(e.target.value)}
            placeholder={stageUI.hpiPlaceholder}
            rows={4}
            className="field"
          />
          <VoiceField lang={langCode} onTranscript={(t) => setHpiText((p) => appendVoiceText(p, t))} />

          <div className="mt-2 rounded-lg border border-info-border bg-info-subtle p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                <Icon name="lightbulb" size={14} className="text-info" />
                {stageUI.clarifyBadge}
              </p>
              <button type="button" onClick={probeWithAi} disabled={probing} className="btn btn-secondary btn-sm">
                {probing ? "..." : aiProbe ? stageUI.askAgainBtn : stageUI.askBtn}
              </button>
            </div>
            {aiProbe && (
              <div className="mt-2">
                <p className="text-[13px] text-ink">{aiProbe}</p>
                <input
                  value={aiProbeAnswer}
                  onChange={(e) => setAiProbeAnswer(e.target.value)}
                  placeholder="Your answer…"
                  className="field mt-2"
                />
                <VoiceField lang={langCode} onTranscript={(t) => setAiProbeAnswer((p) => appendVoiceText(p, t))} />
              </div>
            )}
          </div>

          {!hpiText.trim() && (
            <p role="status" className="mt-3 flex items-center justify-center gap-1.5 text-center text-[13px] font-medium text-critical">
              <Icon name="alert" size={14} className="shrink-0" />
              {tUI("answerRequired", lang)}
            </p>
          )}
          <button
            type="button"
            disabled={!hpiText.trim()}
            onClick={() => {
              setStage("past");
              scrollTop();
            }}
            className="btn btn-primary btn-lg mt-4 w-full disabled:opacity-50"
          >
            {stageUI.nextBtn}
            <Icon name="arrowRight" size={16} />
          </button>
        </div>
      )}

      {stage === "past" && (
        <div>
          <p className="section-label mb-1">{localizeStageLabel("past", lang)}</p>
          <h1 className="mb-4 text-xl font-semibold tracking-tight text-ink">
            {stageUI.pastSubtitle}
          </h1>
          {renderMultiSelect(
            PAST_CONDITIONS,
            pastSel,
            (v) => toggleIn(pastSel, v, setPastSel),
            () => setStage("surgical"),
            true,
            (v) => (v === "None" ? localizePast(v, lang) : `${localizePast(v, lang)}${lang !== "en" && localizePast(v, lang) !== v ? ` (${v})` : ""}`)
          )}
        </div>
      )}

      {stage === "surgical" && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-success mb-1">{localizeStageLabel("surgical", lang)}</p>
          <h1 className="text-2xl font-bold text-ink mb-4">{stageUI.surgicalSubtitle}</h1>
          {renderMultiSelect(
            SURGERIES,
            surgicalSel,
            (v) => toggleIn(surgicalSel, v, setSurgicalSel),
            () => {
              commitFreeText(surgicalSel, setSurgicalSel);
              setStage("medications");
            },
            false,
            (v) => (v === "None" ? localizeSurgery(v, lang) : `${localizeSurgery(v, lang)}${lang !== "en" && localizeSurgery(v, lang) !== v ? ` (${v})` : ""}`)
          )}
        </div>
      )}

      {stage === "medications" && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-success mb-1">{localizeStageLabel("medications", lang)}</p>
          <h1 className="text-2xl font-bold text-ink mb-4">{stageUI.medsSubtitle}</h1>
          <div className="mb-3">
            <VoiceField lang={langCode} onTranscript={(t) => setFreeText((p) => appendVoiceText(p, t))} />
          </div>
          {renderMultiSelect(
            COMMON_MEDS,
            medsSel,
            (v) => toggleIn(medsSel, v, setMedsSel),
            () => {
              commitFreeText(medsSel, setMedsSel);
              setStage("allergies");
            },
            false,
            (v) => (v === "None" ? localizeCommonMed(v, lang) : `${localizeCommonMed(v, lang)}${lang !== "en" && localizeCommonMed(v, lang) !== v ? ` (${v})` : ""}`)
          )}
        </div>
      )}

      {stage === "allergies" && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-success mb-1">{localizeStageLabel("allergies", lang)}</p>
          <h1 className="text-2xl font-bold text-ink mb-4">{stageUI.allergiesSubtitle}</h1>
          <div className="mb-3">
            <VoiceField lang={langCode} onTranscript={(t) => setFreeText((p) => appendVoiceText(p, t))} />
          </div>
          {renderMultiSelect(
            ALLERGY_OPTIONS,
            allergySel,
            (v) => toggleIn(allergySel, v, setAllergySel),
            () => {
              commitFreeText(allergySel, setAllergySel);
              setStage("family");
            },
            false,
            (v) => (v === "None known" ? localizeAllergy(v, lang) : `${localizeAllergy(v, lang)}${lang !== "en" && localizeAllergy(v, lang) !== v ? ` (${v})` : ""}`)
          )}
        </div>
      )}

      {stage === "family" && (
        <div className="fade-up">
          <p className="text-xs font-semibold uppercase tracking-wide text-success mb-1">{localizeStageLabel("family", lang)}</p>
          <h1 className="text-2xl font-bold text-ink mb-1">{stageUI.familySubtitle}</h1>
          <p className="text-ink-2 mb-3">{stageUI.voiceHint}</p>
          <textarea
            value={familyText}
            onChange={(e) => setFamilyText(e.target.value)}
            rows={3}
            placeholder={stageUI.familyPlaceholder}
            className="field"
          />
          <VoiceField lang={langCode} onTranscript={(t) => setFamilyText((p) => appendVoiceText(p, t))} />
          {!familyText.trim() && (
            <p role="status" className="mt-3 flex items-center justify-center gap-1.5 text-center text-[13px] font-medium text-critical">
              <Icon name="alert" size={14} className="shrink-0" />
              {tUI("answerRequired", lang)}
            </p>
          )}
          <button
            type="button"
            disabled={!familyText.trim()}
            onClick={() => {
              setStage("personal");
              scrollTop();
            }}
            className="btn btn-primary btn-lg mt-4 w-full disabled:opacity-50"
          >
            {stageUI.nextBtn}
            <Icon name="arrowRight" size={16} />
          </button>
        </div>
      )}

      {stage === "personal" && (
        <div className="fade-up">
          <p className="text-xs font-semibold uppercase tracking-wide text-success mb-1">{localizeStageLabel("personal", lang)}</p>
          <h1 className="text-2xl font-bold text-ink mb-4">{stageUI.personalTitle}</h1>
          <div className="flex flex-col gap-4">
            <div>
              <p className="font-medium text-ink-2 mb-2">{stageUI.smokingTitle}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {(["No", "Yes - current", "Yes - past", "Chewing tobacco"] as const).map((v) => {
                  const isSelected = smoking === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => {
                        setSmoking(v);
                        logAnswer("Smoking", v);
                      }}
                      aria-pressed={isSelected}
                      className={`rounded-lg border px-4 py-3.5 text-left text-base transition-colors ${
                        isSelected
                          ? "border-[var(--border-focus)] bg-brand font-semibold text-white shadow-sm"
                          : "border-line bg-canvas text-ink hover:border-line-strong hover:bg-sunken"
                      }`}
                    >
                      {localizePersonalHabit(v, lang)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <p className="font-medium text-ink-2 mb-2">{stageUI.alcoholTitle}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {(["No", "Occasional", "Daily", "Quit"] as const).map((v) => {
                  const isSelected = alcohol === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => {
                        setAlcohol(v);
                        logAnswer("Alcohol", v);
                      }}
                      aria-pressed={isSelected}
                      className={`rounded-lg border px-4 py-3.5 text-left text-base transition-colors ${
                        isSelected
                          ? "border-[var(--border-focus)] bg-brand font-semibold text-white shadow-sm"
                          : "border-line bg-canvas text-ink hover:border-line-strong hover:bg-sunken"
                      }`}
                    >
                      {localizePersonalHabit(v, lang)}
                    </button>
                  );
                })}
              </div>
            </div>
            {(!smoking || !alcohol) && (
              <p className="text-[13px] text-ink-2" role="status">
                {!smoking ? stageUI.smokingTitle : stageUI.alcoholTitle}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                setStage(isFemale ? "female" : "ros");
                scrollTop();
              }}
              disabled={!smoking || !alcohol}
              className="btn btn-primary btn-lg mt-2 disabled:opacity-50"
            >
              {stageUI.nextBtn}
              <Icon name="arrowRight" size={16} />
            </button>
          </div>
        </div>
      )}

      {stage === "female" && (
        <div className="fade-up">
          <p className="section-label mb-1">{localizeStageLabel("female", lang)}</p>
          <h1 className="text-xl font-semibold tracking-tight text-ink">{stageUI.femaleTitle}</h1>
          <p className="text-ink-2 mb-4">{stageUI.femaleSubtitle}</p>

          <div className="panel p-4">
            <p className="mb-2 font-medium text-ink">{stageUI.periodsQuestion}</p>
            {renderOptionGrid(
              opts({
                id: "female_period",
                category: "Women's health",
                text: stageUI.periodsQuestion,
                type: "options",
                options: ["Regular", "Irregular", "Menopause (stopped)", "Not applicable"],
              }),
              (v) => {
                setMenstrualReg(v);
                logAnswer("Menstrual regularity", v);
              },
              2,
              menstrualReg
            )}
          </div>

          {menstrualReg && (
            <div className="mt-4 flex flex-col gap-4 fade-up">
              <div>
                <p className="font-medium text-ink mb-1">{stageUI.lmpLabel}</p>
                <textarea
                  value={menstrualText}
                  onChange={(e) => setMenstrualText(e.target.value)}
                  rows={2}
                  placeholder={stageUI.lmpPlaceholder}
                  className="field"
                />
                <VoiceField lang={langCode} onTranscript={(t) => setMenstrualText((p) => appendVoiceText(p, t))} />
              </div>
              <div>
                <p className="font-medium text-ink mb-1">{stageUI.pregnantQuestion}</p>
                {renderOptionGrid(
                  opts({
                    id: "female_pregnant",
                    category: "Women's health",
                    text: stageUI.pregnantQuestion,
                    type: "options",
                    options: ["No", "Yes"],
                  }),
                  (v) => {
                    setEverPregnant(v);
                    logAnswer("Ever pregnant", v);
                  },
                  2,
                  everPregnant
                )}
              </div>
              {everPregnant === (opts({ id: "female_pregnant", category: "History", text: "", type: "options", options: ["No", "Yes"] })[1] ?? "Yes") && (
                <div>
                  <p className="font-medium text-ink mb-1">{stageUI.obstLabel}</p>
                  <textarea
                    value={obstetricText}
                    onChange={(e) => setObstetricText(e.target.value)}
                    rows={2}
                    placeholder={stageUI.obstPlaceholder}
                    className="field"
                  />
                  <VoiceField lang={langCode} onTranscript={(t) => setObstetricText((p) => appendVoiceText(p, t))} />
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              logAnswer("Menstrual/Obstetric history", "Captured");
              setStage("ros");
              scrollTop();
            }}
            disabled={!menstrualReg}
            className="btn btn-primary btn-lg mt-4 w-full"
          >
            {stageUI.nextBtn}
            <Icon name="arrowRight" size={16} />
          </button>
        </div>
      )}

      {stage === "ros" && rosIdx >= rosQuestions.length && session.mode !== "ayush" && (
        <div>
          <div className="fade-up">
            <h1 className="text-xl font-semibold tracking-tight text-ink">{stageUI.almostDoneTitle}</h1>
            <p className="text-ink-2 mb-4">{stageUI.almostDoneSubtitle}</p>
            {needVitals && (
              <div role="alert" className="banner banner-critical mb-3 flex-col items-start gap-2">
                <p className="flex items-start gap-1.5 font-semibold">
                  <Icon name="alert" size={15} className="mt-px" />
                  Chest pain / breathlessness needs BP, pulse and SpO2 recorded first.
                </p>
                <button
                  type="button"
                  onClick={() => router.push("/identify")}
                  className="btn btn-secondary btn-sm min-h-[44px]"
                >
                  <Icon name="arrowLeft" size={14} />
                  Back to Identity to add vitals (answers are saved)
                </button>
              </div>
            )}
            <button type="button" onClick={() => complete()} className="btn btn-primary btn-lg w-full">
              {stageUI.scanContinueBtn}
              <Icon name="arrowRight" size={16} />
            </button>
          </div>
        </div>
      )}

      {stage === "ros" && rosIdx < rosQuestions.length && currentRosQuestion && (
        <div className="fade-up">
          <p className="section-label mb-1">
            {stageUI.rosTitle} · {rosIdx + 1} / {rosQuestions.length}
          </p>
          <h1 className="mb-4 text-xl font-semibold tracking-tight text-ink">{t(currentRosQuestion)}</h1>
          {renderOptionGrid(
            opts(currentRosQuestion),
            (a) => handleRosAnswer(a),
            2,
            rosAnswers[currentRosQuestion.id]
          )}
        </div>
      )}

      {(stage === "ayush") && (
        ayushIdx < ayushQuestions.length ? (
          <div className="fade-up">
            <p className="section-label mb-1">
              {stageUI.ayushTitle} · {ayushIdx + 1} / {ayushQuestions.length}
            </p>
            <h1 className="mb-1 text-xl font-semibold tracking-tight text-ink">
              {t(ayushQuestions[ayushIdx])}
            </h1>
            <p className="text-ink-2 mb-4">{DASHAVIDHA_PARIKsha_BASE.find((d) => d.param.toLowerCase() === ayushQuestions[ayushIdx].id)?.note ?? ""}</p>
            {ayushQuestions[ayushIdx].type === "text" ? (
              <div>
                <textarea
                  value={ayushAnswers[ayushQuestions[ayushIdx].id] ?? ""}
                  onChange={(e) =>
                    setAyushAnswers((prev) => ({ ...prev, [ayushQuestions[ayushIdx].id]: e.target.value }))
                  }
                  rows={3}
                  className="field"
                />
                <VoiceField
                  lang={langCode}
                  onTranscript={(txt) =>
                    setAyushAnswers((prev) => ({
                      ...prev,
                      [ayushQuestions[ayushIdx].id]: appendVoiceText(prev[ayushQuestions[ayushIdx].id] ?? "", txt),
                    }))
                  }
                />
                {!(ayushAnswers[ayushQuestions[ayushIdx].id] ?? "").trim() && (
                  <p role="status" className="mt-3 flex items-center justify-center gap-1.5 text-center text-[13px] font-medium text-critical">
                    <Icon name="alert" size={14} className="shrink-0" />
                    {tUI("answerRequired", lang)}
                  </p>
                )}
                <button
                  type="button"
                  disabled={!(ayushAnswers[ayushQuestions[ayushIdx].id] ?? "").trim()}
                  onClick={() => {
                    const q = ayushQuestions[ayushIdx];
                    const v = (ayushAnswers[q.id] ?? "").trim();
                    logAnswer(q.text, v);
                    setAyushIdx((i) => i + 1);
                    scrollTop();
                  }}
                  className="btn btn-primary btn-lg mt-4 w-full disabled:opacity-50"
                >
                  {stageUI.nextBtn}
                  <Icon name="arrowRight" size={16} />
                </button>
              </div>
            ) : (
              renderOptionGrid(
                opts(ayushQuestions[ayushIdx]),
                (a) => handleAyushAnswer(ayushQuestions[ayushIdx], a),
                2,
                ayushAnswers[ayushQuestions[ayushIdx].id]
              )
            )}
          </div>
        ) : (
          <div className="fade-up">
            <h1 className="text-xl font-semibold tracking-tight text-ink">{stageUI.ayushDoneTitle}</h1>
            <p className="text-ink-2 mb-4">{stageUI.ayushDoneSubtitle}</p>
            {needVitals && (
              <div role="alert" className="banner banner-critical mb-3 flex-col items-start gap-2">
                <p className="flex items-start gap-1.5 font-semibold">
                  <Icon name="alert" size={15} className="mt-px" />
                  Chest pain / breathlessness needs BP, pulse and SpO2 recorded first.
                </p>
                <button
                  type="button"
                  onClick={() => router.push("/identify")}
                  className="btn btn-secondary btn-sm min-h-[44px]"
                >
                  <Icon name="arrowLeft" size={14} />
                  Back to Identity to add vitals (answers are saved)
                </button>
              </div>
            )}
            <button type="button" onClick={() => complete()} className="btn btn-primary btn-lg w-full">
              {stageUI.scanContinueBtn}
              <Icon name="arrowRight" size={16} />
            </button>
          </div>
        )
      )}

      {/* Single floating voice button only for stages without an inline one.
          hpi-open/family/female already render their own VoiceField — a second
          mic here double-captures into conflicting destinations. */}
      {["complaint", "socrates", "ros", "ayush"].includes(stage) && (
        <div className="mt-4 flex items-center gap-4">
          <VoiceField lang={langCode} onTranscript={onTranscript} />
          <p className="text-[13px] text-ink-3">{stageUI.voiceHint}</p>
        </div>
      )}

      {/* Red flag banner */}
      {redFlags.some((r) => r.severity === "high") && (
        <div className="banner banner-critical mt-4">
          <Icon name="siren" size={16} className="mt-px" />
          <div>
            <p className="font-semibold">Priority alert generated</p>
            <p className="text-[13px]">
              A red-flag symptom was detected. Triage staff have been notified for immediate attention.
            </p>
          </div>
        </div>
      )}
      </div>
    </KioskShell>
  );
}

// Small voice field used by several stages — tries Indian ASR backend first, Web Speech as fallback.
// Every session APPENDS to the field (callers wrap with appendVoiceText): starting,
// stopping, or re-tapping the mic never clears what is already there.
function VoiceField({ lang, onTranscript }: { lang: string; onTranscript: (t: string) => void }) {
  const [mode, setMode] = useState<"idle" | "recording" | "processing">("idle");
  const [level, setLevel] = useState(0);
  const [interim, setInterim] = useState("");
  const [unheard, setUnheard] = useState(false);
  const { session } = useSession();

  const toggle = async () => {
    if (mode === "recording") {
      window.dispatchEvent(new Event("speechrecord:stop"));
      return;
    }
    setMode("processing");
    setUnheard(false);
    setInterim("");
    try {
      const text = await recordAndTranscribe(
        lang,
        () => setMode("recording"),
        // Long budget: a full case description in one tap must not be cut off.
        60,
        // Pre-save ai_processing tick: without it the server refuses backend
        // transcription and the helper falls back to on-device speech.
        buildKioskConsent(session.consentPurposes ?? []),
        (lv) => setLevel(lv),
        // Live interim preview only — delivered finals arrive via onTranscript.
        (t) => setInterim(t)
      );
      setInterim("");
      if (text) {
        onTranscript(text);
      } else {
        // Empty transcript after a full recording almost always means the mic
        // heard nothing usable (OPD noise, too far, muted) — say so plainly
        // instead of failing silently, so the patient retries or types.
        // Existing field text is left untouched so a retry appends to it.
        setUnheard(true);
      }
      setMode("idle");
      setLevel(0);
    } catch {
      setInterim("");
      setMode("idle");
      setLevel(0);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          disabled={mode === "processing"}
          aria-label={mode === "recording" ? "Stop recording" : "Start voice input"}
          className={`flex h-16 w-16 items-center justify-center rounded-full shadow-md transition-colors disabled:opacity-50 ${
            mode === "recording"
              ? "mic-recording bg-brand text-white"
              : "border border-line-strong bg-canvas text-ink-2 hover:border-[var(--border-focus)] hover:text-ink"
          }`}
        >
          <Icon name="mic" size={24} />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="field-label">
            {mode === "recording"
              ? tUI("voiceListening", lang.split("-")[0])
              : mode === "processing"
                ? tUI("voiceTranscribing", lang.split("-")[0])
                : tUI("voiceInputHint", lang.split("-")[0])}
          </span>
          {mode === "recording" && interim && (
            <span className="block max-w-[18rem] break-words text-[12px] italic text-ink-2" aria-live="polite">
              Hearing: “{interim}”
            </span>
          )}
          {/* Live mic level: a flat bar tells the patient (or attendant) the
              mic hears nothing — move closer — before the recording ends. */}
          {mode === "recording" && (
            <div
              className="h-1.5 w-28 overflow-hidden rounded-full bg-sunken"
              role="meter"
              aria-label="Microphone level"
              aria-valuenow={Math.round(level * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={`h-full rounded-full transition-[width] duration-100 ${level < 0.08 ? "bg-warning" : "bg-success"}`}
                style={{ width: `${Math.round(level * 100)}%` }}
              />
            </div>
          )}
        </div>
      </div>
      {unheard && mode === "idle" && (
        <p className="text-[12px] text-warning">
          Couldn&apos;t hear anything — move closer to the mic and try again, or type instead.
        </p>
      )}
    </div>
  );
}