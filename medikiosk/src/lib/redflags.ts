import type { Question, RedFlag, Vitals } from "./types";

export type VitalsRule = {
  id: string;
  severity: "high" | "medium";
  symptom: string;
  message: string;
  test: (v: Vitals) => boolean;
};

export const VITAL_RULES: VitalsRule[] = [
  {
    id: "vit-bp-crisis",
    severity: "high",
    symptom: "Hypertensive crisis",
    message: "BP ≥ 180/120 mmHg — hypertensive emergency suspected; immediate BP control and review.",
    test: (v) => (v.systolic ?? 0) >= 180 || (v.diastolic ?? 0) >= 120,
  },
  {
    id: "vit-bp-severe",
    severity: "medium",
    symptom: "Severe hypertension",
    message: "BP ≥ 160/100 mmHg — reassess and treat promptly.",
    test: (v) => (v.systolic ?? 0) >= 160 || (v.diastolic ?? 0) >= 100,
  },
  {
    id: "vit-bp-low",
    severity: "medium",
    symptom: "Hypotension",
    message: "Systolic BP < 90 mmHg — possible shock/hypovolaemia; review urgently.",
    test: (v) => (v.systolic ?? 0) > 0 && (v.systolic ?? 0) < 90,
  },
  {
    id: "vit-fever-high",
    severity: "high",
    symptom: "High-grade fever",
    message: "Temperature ≥ 40°C — high-grade fever; urgent evaluation.",
    test: (v) => (v.temperature ?? 0) >= 40,
  },
  {
    id: "vit-fever-med",
    severity: "medium",
    symptom: "Moderate fever",
    message: "Temperature ≥ 39°C — significant fever; prioritize evaluation.",
    test: (v) => (v.temperature ?? 0) >= 39,
  },
  {
    id: "vit-pulse-fast",
    severity: "high",
    symptom: "Tachycardia",
    message: "Pulse > 130 bpm — significant tachycardia; urgent cardiac review.",
    test: (v) => (v.pulse ?? 0) > 130,
  },
  {
    id: "vit-pulse-slow",
    severity: "medium",
    symptom: "Bradycardia",
    message: "Pulse < 45 bpm — significant bradycardia; requires assessment.",
    test: (v) => (v.pulse ?? 0) > 0 && (v.pulse ?? 0) < 45,
  },
  {
    id: "vit-spo2-low",
    severity: "high",
    symptom: "Low oxygen saturation",
    message: "SpO2 < 92% — hypoxia; immediate oxygen and respiratory assessment.",
    test: (v) => (v.spo2 ?? 100) > 0 && (v.spo2 ?? 100) < 92,
  },
  {
    id: "vit-spo2-med",
    severity: "medium",
    symptom: "Reduced oxygen saturation",
    message: "SpO2 < 95% — monitor closely; needs respiratory review.",
    test: (v) => (v.spo2 ?? 100) > 0 && (v.spo2 ?? 100) < 95,
  },
];

/** A sane human body temperature in °C. Values outside this band are almost
 * certainly unit-mismatched (°F typed as °C, e.g. "98.4") or garbled, and must
 * NOT drive red flags, MEWS or auto-escalation. */
export function plausibleTemp(t?: number): boolean {
  return t !== undefined && t > 30 && t < 45;
}

/** Returns red flags derived purely from recorded vitals (numeric pre-triage). */
export function evaluateVitalsRedFlags(vitals?: Vitals, age?: number): RedFlag[] {
  if (!vitals || Object.keys(vitals).length === 0) return [];
  const flags: RedFlag[] = [];
  const group = ageGroupOf(age);
  // Generic adult thresholds are inappropriate for children/infants — e.g. an
  // infant pulse of 135 or a child BP of 85/60 are NORMAL — so the generic
  // pulse/BP rules are skipped for those groups and the age-adjusted rules
  // (applyAgeAwareVitalsFlags) take over. Hypertensive crisis, fever and
  // hypoxia still apply at every age.
  const childAdjusted = group === "child" || group === "infant";
  for (const rule of VITAL_RULES) {
    if (childAdjusted && ["vit-pulse-fast", "vit-pulse-slow", "vit-bp-low", "vit-bp-severe"].includes(rule.id)) {
      continue;
    }
    if ((rule.id === "vit-fever-high" || rule.id === "vit-fever-med") && !plausibleTemp(vitals.temperature)) {
      continue;
    }
    if (rule.test(vitals)) {
      flags.push({
        id: rule.id,
        severity: rule.severity,
        symptom: rule.symptom,
        message: rule.message,
        source: "vitals",
      });
    }
  }
  // Age-aware thresholds for children/infants — adult rules are inappropriate
  // (e.g. a 6-year-old with BP 90/60 is entirely normal).
  applyAgeAwareVitalsFlags(flags, vitals, age);
  return flags;
}

function applyAgeAwareVitalsFlags(flags: RedFlag[], vitals: Vitals, age?: number): void {
  const group = ageGroupOf(age);
  if (group !== "child" && group !== "infant") return;
  const ref = vitalsReference(age);
  const { systolic: s, diastolic: d, pulse: p } = vitals;

  if (s && s > 0 && s < ref.bpSystolic[0] - 10) {
    flags.push({
      id: "vit-bp-low",
      severity: "medium",
      symptom: "Hypotension (age-adjusted)",
      message: `Systolic BP ${s} mmHg is low for this age group; reassess.`,
      source: "vitals",
    });
  }
  if (s && s >= (group === "child" ? 150 : 135)) {
    flags.push({
      id: "vit-bp-severe",
      severity: group === "child" ? "high" : "medium",
      symptom: "Hypertension (age-adjusted)",
      message: `BP ${s}/${d ?? "?"} mmHg is elevated for age; review.`,
      source: "vitals",
    });
  }
  if (p && p > ref.pulse[1] + 25) {
    flags.push({
      id: "vit-pulse-fast",
      severity: "medium",
      symptom: "Tachycardia (age-adjusted)",
      message: `Pulse ${p} bpm is fast for this age.`,
      source: "vitals",
    });
  }
  if (p && p > 0 && p < ref.pulse[0] - 15) {
    flags.push({
      id: "vit-pulse-slow",
      severity: "medium",
      symptom: "Bradycardia (age-adjusted)",
      message: `Pulse ${p} bpm is slow for this age.`,
      source: "vitals",
    });
  }
}

/** Returns human-readable validation hints for abnormal-but-not-red-flag vitals. */
export function vitalsSuggestions(vitals?: Vitals, age?: number): string[] {
  const out: string[] = [];
  if (!vitals) return out;
  const ref = vitalsReference(age);
  if ((vitals.systolic ?? 0) >= ref.bpSystolic[1] && (vitals.systolic ?? 0) < ref.bpSystolic[1] + 20)
    out.push("Blood pressure is elevated — discuss with your doctor.");
  if ((vitals.systolic ?? 0) >= ref.bpSystolic[1] - 10 && (vitals.systolic ?? 0) < ref.bpSystolic[1])
    out.push("Blood pressure is at the upper-normal range.");
  if (plausibleTemp(vitals.temperature) && (vitals.temperature ?? 0) >= 38 && (vitals.temperature ?? 0) < 39)
    out.push("Mild fever detected — stay hydrated.");
  return out;
}

// ---------------------------------------------------------------- age groups + early warning score

export type AgeGroup = "infant" | "child" | "adult" | "elderly";

export function ageGroupOf(age?: number): AgeGroup {
  if (age === undefined) return "adult";
  if (age < 1) return "infant";
  if (age < 13) return "child";
  if (age >= 65) return "elderly";
  return "adult";
}

export type VitalsReference = {
  bpSystolic: readonly [number, number];
  bpDiastolic: readonly [number, number];
  pulse: readonly [number, number];
  temp: readonly [number, number];
  spo2Min: number;
};

/** Age-group reference ranges for the vitals we capture (display + triage). */
export function vitalsReference(age?: number): VitalsReference {
  const g = ageGroupOf(age);
  const ranges: Record<AgeGroup, VitalsReference> = {
    infant: { bpSystolic: [70, 100], bpDiastolic: [40, 65], pulse: [100, 160], temp: [36.1, 37.8], spo2Min: 95 },
    child: { bpSystolic: [80, 110], bpDiastolic: [50, 75], pulse: [80, 140], temp: [36.1, 37.8], spo2Min: 95 },
    adult: { bpSystolic: [90, 140], bpDiastolic: [60, 90], pulse: [60, 100], temp: [36.1, 37.8], spo2Min: 95 },
    elderly: { bpSystolic: [100, 150], bpDiastolic: [60, 90], pulse: [55, 95], temp: [36.0, 37.6], spo2Min: 94 },
  };
  return ranges[g];
}

export type EarlyWarningPart = { key: string; label: string; value?: number; points: number };
export type EarlyWarning = {
  score: number;
  level: "low" | "medium" | "high";
  ageGroup: AgeGroup;
  parts: EarlyWarningPart[];
};

function bpPoints(group: AgeGroup, s: number): number {
  switch (group) {
    case "adult":
    case "elderly":
      if (s < 70) return 3;
      if (s < 80) return 2;
      if (s < 100) return 1;
      if (s >= 200) return 2;
      return 0;
    case "child":
      if (s < 65) return 3;
      if (s < 75) return 2;
      if (s < 85) return 1;
      if (s >= 140) return 2;
      return 0;
    case "infant":
      if (s < 60) return 3;
      if (s < 70) return 2;
      if (s < 80) return 1;
      if (s >= 120) return 2;
      return 0;
  }
}

function pulsePoints(group: AgeGroup, p: number): number {
  switch (group) {
    case "adult":
      if (p < 40) return 3;
      if (p < 51) return 1;
      if (p <= 100) return 0;
      if (p <= 110) return 1;
      if (p <= 129) return 2;
      return 3;
    case "elderly":
      if (p < 45) return 3;
      if (p < 56) return 1;
      if (p <= 95) return 0;
      if (p <= 105) return 1;
      if (p <= 119) return 2;
      return 3;
    case "child":
      if (p < 70) return 3;
      if (p < 85) return 1;
      if (p <= 139) return 0;
      if (p <= 159) return 2;
      return 3;
    case "infant":
      if (p < 90) return 3;
      if (p < 100) return 1;
      if (p <= 159) return 0;
      if (p <= 179) return 2;
      return 3;
  }
}

/**
 * MEWS-style early warning score from the vitals we capture (systolic BP, pulse,
 * SpO2, temperature). 0 = low, 1–2 = medium, ≥3 = high (needs urgent review).
 * Thresholds scale by age group.
 */
export function computeEarlyWarning(age: number | undefined, vitals?: Vitals): EarlyWarning {
  const group = ageGroupOf(age);
  const parts: EarlyWarningPart[] = [];
  const add = (key: string, label: string, value: number | undefined, points: number) =>
    parts.push({ key, label, value, points });

  const s = vitals?.systolic;
  if (s) add("bp", "Blood pressure", s, bpPoints(group, s));

  const p = vitals?.pulse;
  if (p) add("pulse", "Pulse", p, pulsePoints(group, p));

  const o2 = vitals?.spo2;
  if (o2) add("spo2", "SpO2", o2, o2 < 85 ? 3 : o2 < 90 ? 2 : o2 < 95 ? 1 : 0);

  const t = vitals?.temperature;
  if (t && plausibleTemp(t)) add("temp", "Temperature", t, t < 35 ? 2 : t < 38 ? 0 : t < 39 ? 1 : t < 40 ? 2 : 3);

  const score = parts.reduce((sum, part) => sum + part.points, 0);
  const level: EarlyWarning["level"] = score >= 3 ? "high" : score >= 1 ? "medium" : "low";
  return { score, level, ageGroup: group, parts };
}

/** Short human label for an early-warning level (queue badges, physician cards). */
export function ewLabel(level: EarlyWarning["level"]): string {
  return level === "high" ? "Urgent" : level === "medium" ? "Monitor" : "Stable";
}

export const REVIEW_OF_SYSTEMS: { system: string; questions: Question[] }[] = [
  {
    system: "Cardiovascular",
    questions: [
      {
        id: "cv_palpitation",
        category: "Review of Systems",
        text: "Have you had palpitations (racing or pounding heart) or chest discomfort on exertion?",
        type: "options",
        options: ["No", "Yes - palpitations", "Yes - chest discomfort on exertion", "Yes - both"],
      },
      {
        id: "cv_swelling",
        category: "Review of Systems",
        text: "Do you have swelling of feet or ankles?",
        type: "options",
        options: ["No", "Yes"],
      },
    ],
  },
  {
    system: "Respiratory",
    questions: [
      {
        id: "resp_breath",
        category: "Review of Systems",
        text: "Do you feel breathless on climbing stairs or normal work?",
        type: "options",
        options: ["No", "Yes - mild", "Yes - severe", "At rest"],
      },
      {
        id: "resp_sputum",
        category: "Review of Systems",
        text: "Have you coughed up blood or had wheezing?",
        type: "options",
        options: ["No", "Yes - wheezing", "Yes - blood in sputum", "Yes - both"],
      },
    ],
  },
  {
    system: "Gastrointestinal",
    questions: [
      {
        id: "gi_abdomen",
        category: "Review of Systems",
        text: "Do you have abdominal pain, difficulty swallowing, or change in bowel habit?",
        type: "options",
        options: ["No", "Yes - abdominal pain", "Yes - difficulty swallowing", "Yes - change in bowel habit"],
      },
      {
        id: "gi_blood",
        category: "Review of Systems",
        text: "Have you noticed blood in stool or black stools?",
        type: "options",
        options: ["No", "Yes - blood in stool", "Yes - black stools"],
      },
    ],
  },
  {
    system: "Neurological",
    questions: [
      {
        id: "neuro_weakness",
        category: "Review of Systems",
        text: "Have you had any weakness of a limb, loss of consciousness, or fits?",
        type: "options",
        options: ["No", "Yes - limb weakness", "Yes - loss of consciousness", "Yes - fits"],
      },
      {
        id: "neuro_speech",
        category: "Review of Systems",
        text: "Have you had difficulty speaking or sudden confusion?",
        type: "options",
        options: ["No", "Yes"],
      },
    ],
  },
  {
    system: "Urinary & Endocrine",
    questions: [
      {
        id: "ur_diabetes",
        category: "Review of Systems",
        text: "Do you have diabetes, increased thirst, or frequent urination?",
        type: "options",
        options: ["No", "Yes - diabetes", "Yes - increased thirst", "Yes - frequent urination"],
      },
      {
        id: "ur_burning",
        category: "Review of Systems",
        text: "Is there burning or difficulty while passing urine?",
        type: "options",
        options: ["No", "Yes"],
      },
    ],
  },
  {
    system: "Skin & Musculoskeletal",
    questions: [
      {
        id: "skin_joints",
        category: "Review of Systems",
        text: "Do you have joint swelling, skin rashes, or excessive bleeding / easy bruising?",
        type: "options",
        options: ["No", "Yes - joint swelling", "Yes - skin rash", "Yes - easy bruising"],
      },
    ],
  },
];

const RED_FLAG_RULES: { keywords: string[]; severity: "high" | "medium"; symptom: string; message: string }[] = [
  {
    keywords: ["chest pain", "chest tightness", "crushing chest", "pressure in chest", "सीने में दर्द", "सीने की तकलीफ़"],
    severity: "high",
    symptom: "Chest Pain",
    message: "Possible cardiac event - immediate ECG and cardiac review required.",
  },
  {
    keywords: ["breathless", "difficulty breathing", "can't breathe", "shortness of breath", "short of breath", "breath at rest", "सांस फूलना", "सांस"],
    severity: "high",
    symptom: "Breathlessness",
    message: "Breathlessness may indicate urgent lung or cardiac pathology.",
  },
  {
    keywords: ["weakness of arm", "weakness of leg", "one side", "face droop", "slurred speech", "difficulty speaking", "drooping", "अंग में कमज़ोरी", "बोलने में कठिनाई"],
    severity: "high",
    symptom: "Stroke symptoms",
    message: "Possible stroke - urgent neurological assessment required.",
  },
  {
    keywords: ["blood in cough", "coughing blood", "coughing up blood", "haemoptysis", "खाँसी में खून"],
    severity: "high",
    symptom: "Haemoptysis",
    message: "Coughing blood requires urgent evaluation.",
  },
  {
    keywords: ["blood in stool", "black stools", "vomiting blood", "blood in vomit", "मल में खून", "काले मल"],
    severity: "high",
    symptom: "GI Bleed",
    message: "Possible gastrointestinal bleeding - urgent review.",
  },
  {
    keywords: ["lost consciousness", "fainted", "blacked out", "unconscious", "fits", "seizure", "बेहोशी", "दौरे"],
    severity: "high",
    symptom: "Loss of consciousness",
    message: "History of syncope/seizure requires urgent neurological assessment.",
  },
  {
    keywords: ["high fever with rash", "stiff neck", "severe headache with fever"],
    severity: "high",
    symptom: "Meningitis signs",
    message: "Fever with neck stiffness/rash needs urgent assessment.",
  },
  {
    keywords: ["9-10", "worst possible", "10 out of 10", "सबसे ज़्यादा"],
    severity: "high",
    symptom: "Severe pain",
    message: "Severity 9-10 suggests urgent pathology.",
  },
  {
    keywords: ["suicide", "want to die", "kill myself", "harming myself", "hurt myself", "आत्महत्या"],
    severity: "high",
    symptom: "Self-harm ideation",
    message: "Immediate psychological / crisis intervention required.",
  },
  {
    keywords: ["diabetes", "high sugar", "blood sugar", "मधुमेह"],
    severity: "medium",
    symptom: "Diabetes",
    message: "Diabetes noted - include in history and review control.",
  },
];

export function evaluateRedFlags(text: string, overallText: string): RedFlag[] {
  const flags: RedFlag[] = [];
  const full = (text + " " + overallText).toLowerCase();
  RED_FLAG_RULES.forEach((rule, idx) => {
    const hit = rule.keywords.some((k) => full.includes(k));
    if (hit) {
      flags.push({
        id: `rf-${idx}`,
        severity: rule.severity,
        symptom: rule.symptom,
        message: rule.message,
        source: "text",
      });
    }
  });
  return flags;
}
