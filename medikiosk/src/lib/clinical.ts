import type { StoredHistory } from "./types";

/**
 * Clinical decision-support helpers — pure, offline-safe.
 *
 * 1. `suggestedDifferentials` — possible diagnoses per chief complaint (a small
 *    curated lookup the LLM may override when OPENAI_API_KEY is configured).
 * 2. `stdSuggestedQuestions` — gaps the doctor should clarify per complaint.
 * 3. `parseDictatedRx` — turn a doctor's free-text dictation into a structured
 *    prescription (name/dose/frequency/duration) without any AI dependency.
 */

export type AiPanel = {
  hinted: boolean;
  differentials: string[];
  suggestedQuestions: string[];
};

type Hint = { keywords: string[]; differentials: string[]; questions: string[] };

const HINTS: Hint[] = [
  {
    keywords: ["cardio", "chest pain", "chest discomfort", "heart", "angina"],
    differentials: ["Acute coronary syndrome / Angina", "Pneumonia / pleurisy", "GERD or musculoskeletal chest pain"],
    questions: [
      "Is the pain exertional or present at rest?",
      "Does it radiate to the jaw, neck, back, or left arm?",
      "Is there associated diaphoresis (sweating), nausea, or breathlessness?",
      "ECG + cardiac biomarkers (Troponin) indicated today?",
    ],
  },
  {
    keywords: ["fever", "temperature", "pyrexia", "chills"],
    differentials: ["Viral illness / URTI", "Bacterial infection (UTI / pneumonia / typhoid)", "Vector-borne illness (Malaria / Dengue)"],
    questions: [
      "Was the fever measured with a thermometer?",
      "Any chills, rigors, headache, or petechial rash?",
      "Recent travel, mosquito exposure, or sick contacts?",
    ],
  },
  {
    keywords: ["headache", "neuro", "brain", "seizure", "numbness", "stroke", "migraine"],
    differentials: ["Migraine / Tension headache", "Hypertensive emergency / Sinusitis", "Intracranial event / Neuropathy"],
    questions: [
      "Any vomiting, visual disturbance, aura, or neck stiffness?",
      "Is the headache unilateral, throbbing, or sudden thunderclap?",
      "Any focal weakness, facial drooping, or speech difficulty?",
      "Has blood pressure been checked today?",
    ],
  },
  {
    keywords: ["pulmo", "breathless", "breathlessness", "difficulty breathing", "shortness", "asthma", "wheeze", "lung"],
    differentials: ["COPD / asthma exacerbation", "Pneumonia / Bronchitis", "Heart failure or pulmonary embolism"],
    questions: [
      "Sudden or gradual onset?",
      "Any productive cough, yellow phlegm, wheeze, or hemoptysis?",
      "Can they speak in full sentences without pausing for breath?",
      "Any orthopnea or paroxysmal nocturnal dyspnea?",
    ],
  },
  {
    keywords: ["gastro", "abdominal", "stomach", "belly", "digest", "liver", "acidity", "reflux"],
    differentials: ["Gastritis / Peptic ulcer / GERD", "Acute gastroenteritis / Food poisoning", "Biliary colic / Appendicitis / Pancreatitis"],
    questions: [
      "Is the pain upper, lower, or diffuse?",
      "Relation to food: worse after meals or relieved by food?",
      "Any vomiting, hematemesis, melena (black stool), or jaundice?",
    ],
  },
  {
    keywords: ["ortho", "joint", "body pain", "arthritis", "bone", "fracture", "sprain", "knee"],
    differentials: ["Osteoarthritis / Degenerative joint disease", "Traumatic sprain / ligament injury / fracture", "Inflammatory or gouty arthritis"],
    questions: [
      "Can the patient bear weight or walk without support?",
      "Is there morning joint stiffness lasting over 30-60 minutes?",
      "Was there a recent fall, twisting injury, or direct trauma?",
      "Any joint swelling, warmth, erythema, or mechanical locking?",
    ],
  },
  {
    keywords: ["derma", "skin", "rash", "itching", "pruritus", "lesion", "boil", "eczema"],
    differentials: ["Allergic contact dermatitis / Eczema", "Fungal infection (Tinea) / Urticaria", "Bacterial pyoderma / Psoriasis"],
    questions: [
      "Is the rash severely itchy or burning/painful?",
      "What is the lesion morphology (macules, vesicles, scaly plaques)?",
      "Any new soap, cosmetic, oil, sunlight, or drug exposure?",
      "Is it spreading across other body regions?",
    ],
  },
  {
    keywords: ["ent", "ear", "nose", "throat", "hearing", "sinus", "tonsil", "hoarseness"],
    differentials: ["Acute pharyngitis / tonsillitis", "Otitis media / Otitis externa", "Sinusitis / Allergic rhinitis"],
    questions: [
      "Any ear discharge (purulent, foul-smelling, or blood-stained)?",
      "Is there unilateral hearing loss, tinnitus, or vertigo?",
      "Severe pain on swallowing (odynophagia) or hoarseness?",
    ],
  },
  {
    keywords: ["ophthal", "eye", "vision", "blur", "cataract", "conjunctiv"],
    differentials: ["Conjunctivitis / corneal abrasion", "Refractive error / Cataract", "Acute angle-closure glaucoma / Uveitis"],
    questions: [
      "Is the vision loss or blurring sudden or gradual?",
      "Any severe ocular pain, photophobia, or seeing colored halos?",
      "Is there redness, gritty sensation, or purulent discharge?",
    ],
  },
  {
    keywords: ["paed", "pediatric", "child", "infant"],
    differentials: ["Acute paediatric viral infection", "Paediatric gastroenteritis / dehydration", "Paediatric lower respiratory infection"],
    questions: [
      "Is the child active and alert or unusually drowsy / lethargic?",
      "How is feeding and fluid intake (refusing feeds / vomiting)?",
      "Are wet diapers / urination frequency normal?",
      "Any fast breathing, grunting, or chest retractions?",
    ],
  },
  {
    keywords: ["gyn", "obs", "menses", "period", "pelvic", "pregnancy", "women"],
    differentials: ["Dysmenorrhea / Menorrhagia / AUB", "Pelvic inflammatory disease (PID)", "Early pregnancy / Ectopic pregnancy"],
    questions: [
      "Date of Last Menstrual Period (LMP) and is it regular?",
      "Is bleeding heavy with clots, or is there intermenstrual spotting?",
      "Any foul-smelling vaginal discharge or severe pelvic pain?",
      "Is pregnancy a possibility?",
    ],
  },
  {
    keywords: ["nephro", "uro", "kidney", "urine", "urinary", "dysuria", "renal"],
    differentials: ["Urinary tract infection (Cystitis/Pyelonephritis)", "Renal calculi (Nephrolithiasis)", "Glomerulonephritis / Chronic kidney disease"],
    questions: [
      "Is there burning sensation or pain during urination (dysuria)?",
      "Any visible red/dark urine (hematuria) or frothy urine?",
      "Any flank/loin pain radiating to the groin?",
      "Any facial morning puffiness or bilateral leg edema?",
    ],
  },
  {
    keywords: ["endo", "diabetes", "sugar", "thyroid", "goiter", "hormone"],
    differentials: ["Uncontrolled Diabetes Mellitus", "Thyroid disorder (Hyper/Hypothyroidism)", "Metabolic syndrome"],
    questions: [
      "Most recent fasting/PP blood sugar or HbA1c values?",
      "Any excessive thirst (polydipsia) or frequent urination (polyuria)?",
      "Any sudden unexplained weight loss or gain?",
      "Any heat/cold intolerance, hand tremors, or palpitations?",
    ],
  },
  {
    keywords: ["psych", "mental", "depression", "anxiety", "insomnia", "panic", "mood"],
    differentials: ["Major depressive disorder", "Generalized anxiety disorder / Panic disorder", "Insomnia / Adjustment reaction"],
    questions: [
      "How long has low mood, sadness, or anxiety been present?",
      "Any insomnia, early morning awakening, or hypersomnia?",
      "Loss of interest in previously enjoyed activities (anhedonia)?",
      "How severely is daily functioning/work affected?",
    ],
  },
  {
    keywords: ["surg", "lump", "swelling", "wound", "ulcer", "hernia", "abscess"],
    differentials: ["Subcutaneous lump / Lipoma / Lymphadenopathy", "Inguinal / Umbilical hernia", "Abscess / Infected ulcer / Surgical abdomen"],
    questions: [
      "How long has the lump/swelling been present and is it growing?",
      "Is the swelling tender to touch or does it reduce when lying flat?",
      "Any wound discharge, pus, bleeding, or non-healing ulcer?",
      "Any acute abdominal pain, distension, or inability to pass flatus/stool?",
    ],
  },
  {
    keywords: ["dent", "tooth", "teeth", "gum", "jaw", "mouth"],
    differentials: ["Dental caries / Pulpitis", "Periapical abscess / Periodontitis", "Gingivitis / TMJ dysfunction"],
    questions: [
      "Is there sharp sensitivity to cold, hot, or sweet food?",
      "Is the toothache constant, throbbing, and worse at night?",
      "Any gum swelling, bleeding, or pus discharge near the tooth?",
      "Any difficulty opening the mouth or chewing?",
    ],
  },
  {
    keywords: ["ayush", "ayurved", "panchakarma", "naturopathy", "prakriti"],
    differentials: ["Vataja / Pittaja / Kaphaja Dosha Imbalance", "Agnimandya / Ama disturbance", "Ahara-Vihara related chronic disorder"],
    questions: [
      "How is appetite and digestion after meals (Agni)?",
      "What is the bowel movement pattern (Koshtha)?",
      "Which climate and food temperature suits best (Sheet/Ushna)?",
      "What are the patient's daily routine and sleep habits (Vihara)?",
    ],
  },
  {
    keywords: ["dizziness", "giddiness", "vertigo", "syncope"],
    differentials: ["Vestibular disorder (BPPV / Labyrinthitis)", "Orthostatic hypotension / Anaemia", "Hypoglycaemia / Cardiac arrhythmia"],
    questions: [
      "Does it happen specifically on standing up or changing posture?",
      "Associated palpitation, sweating, or loss of consciousness?",
      "Any hearing loss, tinnitus, or spinning sensation?",
    ],
  },
  {
    keywords: ["weakness", "fatigue", "tired", "lethargy"],
    differentials: ["Anaemia / Nutritional deficiency", "Hypothyroidism / Chronic disease", "Depression / Chronic fatigue"],
    questions: [
      "Sudden or gradual progressive onset?",
      "Any occult bleeding, heavy menses, or unintentional weight loss?",
      "Sleep quality, nutrition, and daily stress levels?",
    ],
  },
  {
    keywords: ["vomiting", "nausea"],
    differentials: ["Acute gastroenteritis", "Gastritis / food poisoning", "Migraine / pregnancy / medication side-effect"],
    questions: [
      "Is there blood (hematemesis) or bile in the vomitus?",
      "Associated watery diarrhea, fever, or abdominal cramps?",
      "In females of reproductive age: possibility of pregnancy?",
    ],
  },
];

const GENERIC_QUESTIONS = [
  "Was the onset sudden or gradual?",
  "Any associated fever, weight change or night sweats?",
  "What makes the symptom better or worse?",
  "Has this happened before?",
];

export function suggestedDifferentials(h: StoredHistory): string[] {
  const complaint = ((h.history as Record<string, unknown>)?.chiefComplaint ?? "").toString();
  const dept = (h.patient.department ?? "").toString();
  const text = `${dept} ${complaint} ${h.summary ?? ""} ${(h.redFlags ?? []).map((f) => f.symptom).join(" ")}`.toLowerCase();
  const hit = HINTS.find((hint) => hint.keywords.some((k) => text.includes(k)));
  return hit ? [...hit.differentials] : ["Review in clinic — no high-yield differentials auto-matched."];
}

export function stdSuggestedQuestions(h: StoredHistory): string[] {
  const complaint = ((h.history as Record<string, unknown>)?.chiefComplaint ?? "").toString();
  const dept = (h.patient.department ?? "").toString();
  const text = `${dept} ${complaint} ${h.summary ?? ""}`.toLowerCase();
  const hit = HINTS.find((hint) => hint.keywords.some((k) => text.includes(k)));
  const questions = hit ? [...hit.questions] : [...GENERIC_QUESTIONS];
  if (h.patient.sex === "Female") questions.push("Female patient — is pregnancy a possibility?");
  if ((h.redFlags ?? []).some((f) => f.severity === "high")) questions.push("High-severity red flag present — urgent review signalled.");
  if (h.patient.vitals?.spo2 !== undefined && h.patient.vitals.spo2 < 94)
    questions.push("SpO2 below 94% — repeat reading after ambulation?");
  return questions.slice(0, 6);
}

export function buildFallbackAiPanel(h: StoredHistory): AiPanel {
  return {
    hinted: false,
    differentials: suggestedDifferentials(h),
    suggestedQuestions: stdSuggestedQuestions(h),
  };
}

// ---------------------------------------------------------------------------
// Dictation → structured prescription
// ---------------------------------------------------------------------------

export type RxItem = {
  name: string;
  dosage?: string;
  frequency?: string;
  duration?: string;
  instructions?: string;
};

const MED_DICTIONARY = [
  "paracetamol", "acetaminophen", "amoxicillin", "amoxiclav", "azithromycin", "ciprofloxacin",
  "doxycycline", "aspirin", "diclofenac", "ibuprofen", "naproxen", "aceclofenac", "mefenamic",
  "ramipril", "enalapril", "telmisartan", "losartan", "amlodipine", "atenolol", "metoprolol",
  "propranolol", "bisoprolol", "atorvastatin", "rosuvastatin", "pantoprazole", "omeprazole",
  "esomeprazole", "rabeprazole", "metformin", "glimepiride", "sitagliptin", "insulin",
  "empagliflozin", "dapagliflozin", "salbutamol", "formoterol", "montelukast", "levocetirizine",
  "cetirizine", "domperidone", "ondansetron", "pantop", "dolo", "calpol", "crocin", "thrombophob",
  "clopidogrel", "warfarin", "rivaroxaban", "furosemide", "spironolactone", "thyroxine",
  "clonazepam", "alprazolam", "sertraline", "fluoxetine", "cough syrup", "multivitamin",
];

const FREQ_MAP: Record<string, string> = {
  od: "once daily",
  bd: "twice daily",
  tds: "thrice daily",
  qid: "four times daily",
  hs: "at bedtime",
  sos: "as needed",
  daily: "once daily",
  morning: "in the morning",
  night: "at night",
  weekly: "once weekly",
};

function detectFrequency(line: string): { value?: string; rest: string } {
  const m = line.match(/\b(od|bd|tds|qid|hs|sos|q\d+h|twice\s+daily|thrice\s+daily|once\s+daily|daily|morning|night|weekly)\b/i);
  if (!m) return { rest: line };
  const raw = m[1].toLowerCase();
  const value = /^q(\d+)h$/.test(raw)
    ? `every ${raw.slice(1, -1)} hours`
    : FREQ_MAP[raw] ?? raw;
  return { value, rest: `${line.slice(0, m.index)} ${line.slice(m.index! + m[0].length)}`.replace(/\s+/g, " ").trim() };
}

function detectDosage(line: string): { value?: string; rest: string } {
  const m = line.match(/(\d+(?:\.\d+)?\s*(?:mg|g|mcg|microgram|ml|units?|iu))\b/i);
  if (!m) return { rest: line };
  return { value: m[1].toLowerCase(), rest: line.replace(m[0], "").replace(/\s+/g, " ").trim() };
}

function detectDuration(line: string): { value?: string; rest: string } {
  const m = line.match(/(?:for|×|x)\s*(\d+)\s*(days?|weeks?|months?)/i);
  if (!m) return { rest: line };
  return { value: `${m[1]} ${m[2].toLowerCase()}`, rest: line.replace(m[0], "").replace(/\s+/g, " ").trim() };
}

export function parseDictatedRx(text: string): RxItem[] {
  if (!text) return [];
  const segments = text
    .split(/\n|;/)
    .map((s) => s.trim())
    .filter(Boolean);

  const items: RxItem[] = [];
  for (const rawSeg of segments) {
    let seg = rawSeg;
    const hit = MED_DICTIONARY.find((drug) => seg.toLowerCase().includes(drug));
    if (!hit) continue; // skip non-medication lines (history/notes)
    // The dictionary term is interpolated into a pattern, so escape it: every
    // current entry is alphanumeric, but a future entry with regex syntax
    // (e.g. "vit-c", "co-trimoxazole") would otherwise change the match or
    // throw, silently corrupting the parsed prescription.
    seg = seg.replace(new RegExp(hit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ").replace(/\s+/g, " ").trim();
    const item: RxItem = { name: hit };
    const freq = detectFrequency(seg);
    if (freq.value) item.frequency = freq.value;
    seg = freq.rest;
    const dose = detectDosage(seg);
    if (dose.value) item.dosage = dose.value;
    seg = dose.rest;
    const dur = detectDuration(seg);
    if (dur.value) item.duration = dur.value;
    seg = dur.rest;
    if (seg) item.instructions = seg;
    items.push(item);
  }
  return items;
}

// ---------------------------------------------------------------------------
// Ayurvedic Tridosha & Prakriti Computation (Ministry of Ayush)
// ---------------------------------------------------------------------------

export type PrakritiAnalysis = {
  vata: number;
  pitta: number;
  kapha: number;
  dominant: string;
  characteristics: string[];
  dietaryRecommendations: string[];
};

export function computePrakritiScores(ayush?: StoredHistory["history"]["ayush"]): PrakritiAnalysis {
  let v = 33, p = 33, k = 34;
  if (!ayush) {
    return {
      vata: 33,
      pitta: 33,
      kapha: 34,
      dominant: "Tridoshic (Balanced)",
      characteristics: ["Balanced metabolism and constitution", "Good overall physiological resilience"],
      dietaryRecommendations: ["Seasonal wholesome diet (Ritucharya)", "Moderation in heavy or excessively spicy foods"],
    };
  }

  let vScore = 1, pScore = 1, kScore = 1;
  const prak = (ayush.prakriti || "").toLowerCase();
  if (prak.includes("vata") || prak.includes("वात")) vScore += 3;
  if (prak.includes("pitta") || prak.includes("पित्त")) pScore += 3;
  if (prak.includes("kapha") || prak.includes("कफ")) kScore += 3;

  const agni = (ayush.agni || ayush.aharaShakti || "").toLowerCase();
  if (agni.includes("vishama") || agni.includes("अनियमित") || agni.includes("कम")) vScore += 2;
  if (agni.includes("tikshna") || agni.includes("तीव्र") || agni.includes("ज्यादा")) pScore += 2;
  if (agni.includes("manda") || agni.includes("धीमी") || agni.includes("सामान्य")) kScore += 2;

  const koshtha = (ayush.koshtha || "").toLowerCase();
  if (koshtha.includes("krura") || koshtha.includes("कब्ज") || koshtha.includes("hard")) vScore += 2;
  if (koshtha.includes("mrudu") || koshtha.includes("पतला") || koshtha.includes("loose")) pScore += 2;
  if (koshtha.includes("madhyama") || koshtha.includes("नियमित") || koshtha.includes("regular")) kScore += 2;

  const sattva = (ayush.sattva || "").toLowerCase();
  if (sattva.includes("चिंता") || sattva.includes("anxious")) vScore += 1;
  if (sattva.includes("गुस्सा") || sattva.includes("irritable")) pScore += 1;
  if (sattva.includes("शांत") || sattva.includes("calm")) kScore += 1;

  const total = vScore + pScore + kScore;
  v = Math.round((vScore / total) * 100);
  p = Math.round((pScore / total) * 100);
  k = 100 - (v + p);

  let dominant = "Balanced";
  const chars: string[] = [];
  const diet: string[] = [];

  if (v >= p && v >= k) {
    dominant = v - Math.max(p, k) > 15 ? "Vata Pradhana" : p >= k ? "Vata-Pitta" : "Vata-Kapha";
    chars.push("Variable digestive fire (Vishama Agni)", "Prone to dryness, joint stiffness, and restlessness");
    diet.push("Warm, unctuous (Snigdha), nourishing cooked meals", "Avoid excessive dry, cold, or raw salads");
  } else if (p >= v && p >= k) {
    dominant = p - Math.max(v, k) > 15 ? "Pitta Pradhana" : v >= k ? "Pitta-Vata" : "Pitta-Kapha";
    chars.push("Sharp metabolism & strong appetite (Tikshna Agni)", "Prone to hyperacidity, heat intolerance, and inflammation");
    diet.push("Cooling, sweet, bitter, and astringent foods (Ghee, coconut water)", "Avoid pungent, fermented, and excessively sour foods");
  } else {
    dominant = k - Math.max(v, p) > 15 ? "Kapha Pradhana" : p >= v ? "Kapha-Pitta" : "Kapha-Vata";
    chars.push("Slow, steady digestion (Manda Agni)", "Robust immunity, prone to sluggishness and congestion");
    diet.push("Light, warm, dry, and spicy foods with Trikatu / ginger", "Reduce heavy dairy, sweets, and deep-fried foods");
  }

  return { vata: v, pitta: p, kapha: k, dominant, characteristics: chars, dietaryRecommendations: diet };
}

// ---------------------------------------------------------------------------
// Dual ICD-10 & AYUSH NAMASTE Terminology Mapping
// ---------------------------------------------------------------------------

export type DualCode = {
  icd10: string;
  icdTitle: string;
  namasteCode: string;
  namasteTerm: string;
  category: string;
};

const DUAL_CODING_CATALOG: Array<{ keywords: string[]; code: DualCode }> = [
  {
    keywords: ["chest pain", "angina", "heart", "hrudroga", "सीने में दर्द", "छाती"],
    code: { icd10: "R07.9", icdTitle: "Chest pain, unspecified", namasteCode: "AYU-HRD-01", namasteTerm: "Hrudroga (हृद्रोग)", category: "Cardiovascular" },
  },
  {
    keywords: ["cough", "kasa", "खाँसी", "কাশি"],
    code: { icd10: "R05", icdTitle: "Cough", namasteCode: "AYU-KAS-01", namasteTerm: "Kasa (कास)", category: "Respiratory" },
  },
  {
    keywords: ["breathless", "dyspnoea", "asthma", "shwasa", "साँस", "হাঁপানি"],
    code: { icd10: "R06.02", icdTitle: "Shortness of breath / Dyspnea", namasteCode: "AYU-SHW-01", namasteTerm: "Shwasa Roga (श्वास रोग)", category: "Respiratory" },
  },
  {
    keywords: ["abdominal", "stomach", "shoola", "udar", "पेट में दर्द", "পেট ব্যথা"],
    code: { icd10: "R10.9", icdTitle: "Abdominal pain, unspecified", namasteCode: "AYU-UDR-01", namasteTerm: "Shoola / Udararoga (शूल / उदररोग)", category: "Gastrointestinal" },
  },
  {
    keywords: ["acidity", "gerd", "amlapitta", "heartburn", "खट्टी डकार", "গ্যাস"],
    code: { icd10: "K21.9", icdTitle: "Gastro-esophageal reflux disease", namasteCode: "AYU-AML-01", namasteTerm: "Amlapitta (अम्लपित्त)", category: "Gastrointestinal" },
  },
  {
    keywords: ["joint", "arthritis", "sandhigata", "back pain", "जोड़ों का दर्द", "বাতের ব্যথা"],
    code: { icd10: "M25.50", icdTitle: "Pain in joint, unspecified site", namasteCode: "AYU-VAT-04", namasteTerm: "Sandhigata Vata / Amavata (संधिगत वात / आमवात)", category: "Musculoskeletal" },
  },
  {
    keywords: ["diabetes", "sugar", "prameha", "madhumeha", "मधुमेह", "ডায়াবেটিস"],
    code: { icd10: "E11.9", icdTitle: "Type 2 diabetes mellitus", namasteCode: "AYU-PRM-01", namasteTerm: "Prameha / Madhumeha (प्रमेह / मधुमेह)", category: "Endocrine & Metabolic" },
  },
  {
    keywords: ["fever", "pyrexia", "jwara", "बुखार", "জ্বর"],
    code: { icd10: "R50.9", icdTitle: "Fever, unspecified", namasteCode: "AYU-JWR-01", namasteTerm: "Jwara (ज्वर)", category: "General / Systemic" },
  },
  {
    keywords: ["headache", "shirashoola", "migraine", "सिरदर्द", "মাথাব্যথা"],
    code: { icd10: "R51", icdTitle: "Headache", namasteCode: "AYU-SHI-01", namasteTerm: "Shirashoola (शिरःशूल)", category: "Neurological" },
  },
  {
    keywords: ["skin", "rash", "eczema", "kushtha", "खुजली", "চুলकानी"],
    code: { icd10: "L30.9", icdTitle: "Dermatitis, unspecified", namasteCode: "AYU-KUS-01", namasteTerm: "Kushtha / Vicharchika (कुष्ठ / विचर्चिका)", category: "Dermatology" },
  },
];

export function lookupDualCoding(text?: string | null): DualCode | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const entry of DUAL_CODING_CATALOG) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return entry.code;
    }
  }
  return {
    icd10: "R69",
    icdTitle: "Illness, unspecified",
    namasteCode: "AYU-GEN-00",
    namasteTerm: "Samanya Vyadhi (सामान्य व्याधि)",
    category: "General",
  };
}