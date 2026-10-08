import type { Medication } from "./types";

/**
 * Department prescription templates — common starting regimens a doctor can
 * apply with one tap and then edit. Templates APPEND medicines that are not
 * already on the prescription (matched by name, case-insensitive); they never
 * delete or overwrite what the doctor already wrote. Doses are adult
 * defaults — the doctor adjusts per patient.
 */

export type RxTemplate = {
  id: string;
  label: string;
  /** Lowercase department keywords this template applies to. Empty = all. */
  departments: string[];
  meds: Medication[];
};

const T = (
  name: string,
  dosage: string,
  frequency: string,
  duration: string,
  extra?: Partial<Medication>
): Medication => ({ name, dosage, frequency, duration, dosageForm: "Tablet", ...extra });

export const RX_TEMPLATES: RxTemplate[] = [
  {
    id: "urti",
    label: "URTI / viral fever",
    departments: [],
    meds: [
      T("Paracetamol", "500mg", "TDS", "3 days"),
      T("Cetirizine", "10mg", "OD", "3 days"),
      T("Azithromycin", "500mg", "OD", "3 days"),
    ],
  },
  {
    id: "hypertension",
    label: "Hypertension follow-up",
    departments: ["cardio", "heart", "general"],
    meds: [
      T("Amlodipine", "5mg", "OD", "30 days"),
      T("Telmisartan", "40mg", "OD", "30 days"),
      T("Atorvastatin", "10mg", "OD", "30 days"),
    ],
  },
  {
    id: "diabetes",
    label: "Diabetes follow-up",
    departments: ["endo", "diabet", "general"],
    meds: [
      T("Metformin", "500mg", "BD", "30 days"),
      T("Glimepiride", "1mg", "OD", "30 days"),
    ],
  },
  {
    id: "gastritis",
    label: "Gastritis / acidity",
    departments: [],
    meds: [
      T("Pantoprazole", "40mg", "OD", "14 days"),
      T("Domperidone", "10mg", "TDS", "5 days"),
    ],
  },
  {
    id: "msk-pain",
    label: "Musculoskeletal pain",
    departments: ["ortho", "bone", "joint", "neuro", "surg"],
    meds: [
      T("Diclofenac", "50mg", "BD", "5 days"),
      T("Paracetamol", "500mg", "TDS", "5 days"),
    ],
  },
  {
    id: "dermatitis",
    label: "Allergic dermatitis",
    departments: ["derma", "skin", "general"],
    meds: [
      T("Cetirizine", "10mg", "OD", "7 days"),
      { name: "Betamethasone cream", dosage: "apply thin layer", frequency: "BD", duration: "7 days", dosageForm: "Ointment" },
    ],
  },
  {
    id: "uti",
    label: "UTI (uncomplicated)",
    departments: ["nephro", "uro", "kidney", "urinary", "gyn", "obs"],
    meds: [
      T("Ciprofloxacin", "500mg", "BD", "5 days"),
      T("Paracetamol", "500mg", "TDS", "3 days"),
    ],
  },
  {
    id: "paed-fever",
    label: "Paediatric fever",
    departments: ["paed", "ped", "child"],
    meds: [
      { name: "Paracetamol", dosage: "125mg/5ml", frequency: "TDS", duration: "3 days", dosageForm: "Syrup" },
      T("ORS", "200ml", "after loose stool", "3 days"),
    ],
  },
  {
    id: "anemia",
    label: "Anaemia support",
    departments: [],
    meds: [
      T("Ferrous Sulphate", "100mg", "OD", "30 days"),
      T("Folic Acid", "5mg", "OD", "30 days"),
    ],
  },
  {
    id: "ayush-vata",
    label: "AYUSH — Vata balance",
    departments: ["ayush"],
    meds: [
      { name: "Ashwagandha", dosage: "500mg", frequency: "BD", duration: "30 days", dosageForm: "Vati", isAyurvedic: true, anupana: "Warm Water", kala: "After food" },
      { name: "Triphala", dosage: "1 tsp", frequency: "OD", duration: "30 days", dosageForm: "Churna", isAyurvedic: true, anupana: "Warm Water", kala: "Bedtime" },
    ],
  },
];

/** Templates relevant to a department (plus generic ones), in priority order. */
export function templatesForDepartment(department?: string): RxTemplate[] {
  const dept = (department || "").toLowerCase();
  const scored = RX_TEMPLATES.map((t) => ({
    t,
    score: t.departments.length === 0 ? 0 : t.departments.some((k) => dept.includes(k)) ? 2 : -1,
  })).filter((s) => s.score >= 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.t);
}

/**
 * Merge a template into the current medicine list: appends entries whose
 * name is not already present (case-insensitive), keeps existing rows
 * untouched. Returns the merged list and how many rows were added.
 */
export function applyRxTemplate(current: Medication[], template: RxTemplate): { meds: Medication[]; added: number } {
  const seen = new Set(current.map((m) => m.name.trim().toLowerCase()).filter(Boolean));
  const fresh = template.meds.filter((m) => {
    const key = m.name.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { meds: [...current, ...fresh.map((m) => ({ ...m }))], added: fresh.length };
}
