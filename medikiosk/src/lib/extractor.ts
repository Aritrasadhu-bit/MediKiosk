// Pure extraction heuristics — no framework imports so it can be unit-tested.

export type Medication = {
  name: string;
  dosage?: string;
  frequency?: string;
  duration?: string;
  dosageForm?: string;
  anupana?: string;
  kala?: string;
  isAyurvedic?: boolean;
};

export type Investigation = {
  test: string;
  value: string;
  unit?: string;
  referenceRange?: string;
  flag?: "high" | "low" | "normal" | "critical";
  date?: string;
};

export type DocType =
  | "Prescription"
  | "Lab Report"
  | "Discharge Summary"
  | "Imaging Report"
  | "Other";

export type ExtractedEntities = {
  type: DocType;
  date?: string;
  entities: {
    diagnoses: string[];
    medications: Medication[];
    investigations: Investigation[];
    procedures: string[];
  };
  abnormalValues: Investigation[];
};

/** Curated dictionary of common Indian allopathic drugs. */
export const INDIAN_ALLOPATHIC_DRUGS = [
  "Paracetamol",
  "Dolo",
  "Crocin",
  "Amlodipine",
  "Metformin",
  "Telmisartan",
  "Pantoprazole",
  "Azithromycin",
  "Amoxicillin",
  "Augmentin",
  "Ciprofloxacin",
  "Atorvastatin",
  "Losartan",
  "Ibuprofen",
  "Cetirizine",
  "Levocetirizine",
  "Omeprazole",
  "Ranitidine",
  "Montelukast",
  "Glimepiride",
  "Rabeprazole",
  "Clopidogrel",
  "Diclofenac",
  "Tramadol",
  "Ondansetron",
  "Domperidone",
  "Levothyroxine",
  "Metoprolol",
  "Ceftriaxone",
  "Ofloxacin",
  "Norfloxacin",
  "Albendazole",
  "Vildagliptin",
  "Rosuvastatin",
  "Hydrochlorothiazide",
  "Enalapril",
  "Salbutamol",
  "Budecort",
  "Thyronorm",
];

/** Curated dictionary of popular Ayurvedic formulations from API (Ayurvedic Pharmacopoeia of India). */
export const AYURVEDIC_FORMULATIONS = [
  "Triphala Churna",
  "Ashwagandha Churna",
  "Sitopaladi Churna",
  "Avipattikar Churna",
  "Chandraprabha Vati",
  "Yograj Guggulu",
  "Kaishore Guggulu",
  "Gokshuradi Guggulu",
  "Kanchnar Guggulu",
  "Arogyavardhini Vati",
  "Mahasudarshan Kwath",
  "Dashamularishta",
  "Draksharishta",
  "Ashokarishta",
  "Arjunarishta",
  "Shankhapushpi",
  "Brahmi Vati",
  "Trikatu Churna",
  "Haridra Khanda",
  "Liv 52",
  "Shatavari Churna",
  "Bilvadi Churna",
  "Hingwashtak Churna",
  "Maharasnadi Kwath",
  "Punarnavadi Mandur",
  "Sutashekhar Ras",
  "Kamadudha Ras",
  "Laxmi Vilas Ras",
  "Chyawanprash",
  "Khadiradi Vati",
  "Talishadi Churna",
];

export function levenshteinDistance(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;

  const matrix: number[][] = [];
  for (let i = 0; i <= bl; i++) matrix[i] = [i];
  for (let j = 0; j <= al; j++) matrix[0][j] = j;

  for (let i = 1; i <= bl; i++) {
    for (let j = 1; j <= al; j++) {
      if (b.charAt(i - 1).toLowerCase() === a.charAt(j - 1).toLowerCase()) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  return matrix[bl][al];
}

/**
 * Fuzzy matches raw OCR extracted word against the medical dictionary to correct
 * handwriting typos and OCR misreadings.
 */
export function correctDrugName(rawName: string): { name: string; corrected: boolean; isAyurvedic: boolean } {
  const clean = rawName.trim().replace(/^[^\w]+|[^\w]+$/g, "");
  if (!clean || clean.length < 3) return { name: clean, corrected: false, isAyurvedic: false };

  // 1. Direct exact match check
  for (const drug of INDIAN_ALLOPATHIC_DRUGS) {
    if (drug.toLowerCase() === clean.toLowerCase()) {
      return { name: drug, corrected: false, isAyurvedic: false };
    }
  }
  for (const ayur of AYURVEDIC_FORMULATIONS) {
    if (ayur.toLowerCase() === clean.toLowerCase()) {
      return { name: ayur, corrected: false, isAyurvedic: true };
    }
  }

  // 2. Fuzzy match against Allopathic
  let bestMatch = clean;
  let minDistance = 999;
  let isAyur = false;

  const maxAllowedDist = clean.length <= 5 ? 1 : clean.length <= 8 ? 2 : 3;

  for (const drug of INDIAN_ALLOPATHIC_DRUGS) {
    const dist = levenshteinDistance(clean, drug);
    if (dist < minDistance && dist <= maxAllowedDist) {
      minDistance = dist;
      bestMatch = drug;
      isAyur = false;
    }
  }

  // 3. Fuzzy match against Ayurvedic
  for (const ayur of AYURVEDIC_FORMULATIONS) {
    // Check full name or first word
    const firstWord = ayur.split(" ")[0];
    const distFull = levenshteinDistance(clean, ayur);
    const distFirst = levenshteinDistance(clean, firstWord);
    const dist = Math.min(distFull, distFirst);

    if (dist < minDistance && dist <= maxAllowedDist) {
      minDistance = dist;
      bestMatch = ayur;
      isAyur = true;
    }
  }

  if (minDistance <= maxAllowedDist) {
    return { name: bestMatch, corrected: bestMatch.toLowerCase() !== clean.toLowerCase(), isAyurvedic: isAyur };
  }

  // Return original capitalized
  const capitalized = clean.charAt(0).toUpperCase() + clean.slice(1);
  return { name: capitalized, corrected: false, isAyurvedic: false };
}

export function inferDocType(filename: string, text: string): DocType {
  const lower = (filename + " " + text).toLowerCase();
  if (/discharge|आंतरिक|रुग्ण|summary/i.test(lower)) return "Discharge Summary";
  // Lab heuristics use specific markers only. The old bare words "report" and
  // "count" promoted any prescription saying "review with reports" to a Lab
  // Report (which then extracted phantom investigations from printed ranges),
  // and unanchored "lab" fired inside "label" and "count" inside "discount".
  if (/\blabs?\b|\bblood counts?\b|hba1c|creatinine|haemoglobin|hemoglobin|blood tests?|जांच/i.test(lower)) return "Lab Report";
  // Word-bounded prescription markers ("rx" must not fire inside "matrix",
  // "tab." must not fire inside "stable."). The mg unit must not match inside
  // a word ("img.png" contains "mg") but must still match "500mg" and "500 mg".
  if (/\brx\b|prescri|\btab\.|\bcapsule\b|\bdose\b|(?:^|[^a-zA-Z])mg(?![a-zA-Z])|औषधि|दवा|टैब|churna|vati|kwath|asava/i.test(lower)) return "Prescription";
  if (/x-ray|xray|ct scan|mri|ultrasound|sonography|imaging|एक्स-रे/i.test(lower)) return "Imaging Report";
  return "Other";
}

export function parseDate(text: string): string | undefined {
  const iso = text.match(/\b(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const dm = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (dm) {
    const [, a, b, c] = dm;
    return `${c.length === 2 ? "20" + c : c}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
  }
  return undefined;
}

export const KNOWN_TESTS: { name: string; range?: string; unit?: string }[] = [
  { name: "Hemoglobin", range: "13-17 g/dL", unit: "g/dL" },
  { name: "HbA1c", range: "<5.7%", unit: "%" },
  { name: "Fasting Blood Sugar", range: "70-100 mg/dL", unit: "mg/dL" },
  { name: "Post Prandial Sugar", range: "<140 mg/dL", unit: "mg/dL" },
  { name: "TSH", range: "0.4-4.0 mIU/L", unit: "mIU/L" },
  { name: "T3", range: "0.8-2.0 ng/mL", unit: "ng/mL" },
  { name: "T4", range: "4.5-12 µg/dL", unit: "µg/dL" },
  { name: "Creatinine", range: "0.6-1.2 mg/dL", unit: "mg/dL" },
  { name: "Urea", range: "15-45 mg/dL", unit: "mg/dL" },
  { name: "SGPT/ALT", range: "7-56 U/L", unit: "U/L" },
  { name: "SGOT/AST", range: "10-40 U/L", unit: "U/L" },
  { name: "Bilirubin", range: "0.1-1.2 mg/dL", unit: "mg/dL" },
  { name: "Platelets", range: "150-450 (x10³/µL)", unit: "x10³/µL" },
  { name: "RBC", range: "4.5-5.5 M/µL", unit: "M/µL" },
  { name: "WBC", range: "4000-11000 /µL", unit: "/µL" },
  { name: "Cholesterol", range: "<200 mg/dL", unit: "mg/dL" },
  { name: "HDL", range: ">40 mg/dL", unit: "mg/dL" },
  { name: "LDL", range: "<100 mg/dL", unit: "mg/dL" },
  { name: "Triglycerides", range: "<150 mg/dL", unit: "mg/dL" },
  { name: "Uric Acid", range: "3.4-7.0 mg/dL", unit: "mg/dL" },
  { name: "Sodium", range: "135-145 mmol/L", unit: "mmol/L" },
  { name: "Potassium", range: "3.5-5.0 mmol/L", unit: "mmol/L" },
];

export function heuristicExtract(text: string, filename = ""): ExtractedEntities {
  const diagnoses: string[] = [];
  const medications: Medication[] = [];
  const investigations: Investigation[] = [];
  const procedures: string[] = [];

  const docType = inferDocType(filename, text);

  // One shared sink. Rx-prefixed lines carry their own evidence (the prefix),
  // so they keep the historical permissive behaviour — a prescription drug
  // outside the dictionary is still captured for physician review. Prose
  // triggers only accept dictionary hits, otherwise ordinary words
  // ("continue review") would become phantom medications.
  const addMedication = (rawName: string, afterText: string, strict: boolean) => {
    const clean = rawName.trim().split(/[\s,;]+/)[0];
    if (!clean || clean.length < 3) return;
    const match = correctDrugName(clean);
    if (strict) {
      // correctDrugName always returns *something* (capitalized passthrough),
      // so require a real dictionary hit here: exact, or a bounded correction.
      const hit = [...INDIAN_ALLOPATHIC_DRUGS, ...AYURVEDIC_FORMULATIONS].some(
        (d) => d.toLowerCase() === match.name.toLowerCase()
      );
      if (!hit) return;
    }
    if (medications.some((x) => x.name.toLowerCase() === match.name.toLowerCase())) return;
    const dose =
      afterText.match(/(\d+(?:\.\d+)?)\s?(?:mg|mcg|g|ml|IU|units?|mEq|tablets?|tabs?|tsp|spoon)/i)?.[0] ?? undefined;
    medications.push({ name: match.name, dosage: dose, isAyurvedic: match.isAyurvedic });
  };

  // Medication extraction (Rx patterns like Tab. Name mg, Cap. Name, Churna, Vati, Kwath)
  const medRegex = /\b(?:Tab|Caps?|Syp|Inj|Oint|Drops|Churna|Vati|Kwath|Kwatha|Asava|Arishta|Taila|Ghrita)\.?\s+([A-Za-z][A-Za-z\-'\s]{2,25})/gi;
  const medMatches = text.matchAll(medRegex);
  for (const m of medMatches) {
    addMedication(m[1], text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 60), false);
  }

  // Discharge-summary prose: drugs appear without Rx prefixes —
  // "treated with Azithromycin", "discharged on Metformin", "Adv: Aspirin",
  // numbered lists ("1. Paracetamol 500mg"). Same dictionary gate applies.
  const proseRegex = /(?:treated with|discharged on|discharge on|continued? on|started on|put on|adv(?:ice)?\.?:?)\s+([A-Za-z][A-Za-z\-']{2,24})/gi;
  for (const m of text.matchAll(proseRegex)) {
    addMedication(m[1], text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 40), true);
  }
  const numberedRegex = /^\s*\d+[.)]\s+([A-Za-z][A-Za-z\-']{2,24})/gim;
  for (const m of text.matchAll(numberedRegex)) {
    addMedication(m[1], text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 40), true);
  }

  // Known investigations — ONLY for genuine lab reports.
  if (docType === "Lab Report") {
    for (const t of KNOWN_TESTS) {
      const key = t.name.toLowerCase().split("/")[0].toLowerCase();
      const idx = text.toLowerCase().indexOf(key);
      if (idx >= 0) {
        const window = text.slice(idx + key.length, idx + key.length + 80);
        const value = window.match(/[:=]?\s*(\d+(?:\.\d+)?)\s*([a-zA-Zµ%/]+)?/);
        // A bare "Test low-high unit" with no patient value is the printed
        // reference range, not a result — "Hemoglobin 13-17 g/dL" must not
        // become a phantom "Hemoglobin = 13" investigation. A number followed
        // by a dash and another digit is the low end of a range, so skip it.
        // (A dash BEFORE the number, e.g. "Hb - 13.5", is just a separator
        // and is still accepted, because the match itself starts at the digit.)
        if (value && value[1] && Number(value[1]) > 0) {
          const after = window.slice((value.index ?? 0) + value[0].length);
          if (/^\s*[–—-]\s*\d/.test(after)) continue;
          let flag: "normal" | "high" | "low" = "normal";
          const num = Number(value[1]);
          if (t.range) {
            const r = t.range.match(/(\d+(?:\.\d+)?)\s*[–\-]\s*(\d+(?:\.\d+)?)/);
            if (r) {
              if (num > Number(r[2])) flag = "high";
              else if (num < Number(r[1])) flag = "low";
            } else {
              const upperBound = t.range.match(/<(\d+(?:\.\d+)?)/);
              const lowerBound = t.range.match(/>(\d+(?:\.\d+)?)/);
              if (upperBound && num > Number(upperBound[1])) flag = "high";
              if (lowerBound && num < Number(lowerBound[1])) flag = "low";
            }
          }
          investigations.push({
            test: t.name,
            value: value[1],
            unit: value[2] ?? "",
            referenceRange: t.range ?? "",
            flag,
          });
        }
      }
    }
  }

  // Simple diagnosis keywords
  const diagKeywords = [
    "hypertension", "diabetes", "type 2", "hypothyroidism", "hyperthyroidism", "anemia", "asthma",
    "copd", "typhoid", "malaria", "dengue", "urinary tract infection", "uti", "pneumonia", "tuberculosis",
    "amavata", "sandhivata", "prameha", "amlapitta", "grahani", "kamala",
  ];
  for (const k of diagKeywords) {
    if (text.toLowerCase().includes(k)) diagnoses.push(k.toUpperCase());
  }

  const procKeywords = ["appendectomy", "cholecystectomy", "hernia repair", "c-section", "angioplasty", "bypass surgery", "panchakarma", "vamana", "virechana", "basti"];
  for (const k of procKeywords) {
    if (text.toLowerCase().includes(k)) procedures.push(k);
  }

  const abnormalValues = investigations.filter((i) => i.flag !== "normal");
  const date = parseDate(text);

  return {
    type: docType,
    date,
    entities: { diagnoses, medications, investigations, procedures },
    abnormalValues,
  };
}