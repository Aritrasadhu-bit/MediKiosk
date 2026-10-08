import type { InteractionWarning, Medication, Allergy } from "./types";

type DrugFamily = { names: string[] };

const FAMILIES: Record<string, DrugFamily> = {
  penicillin: { names: ["penicillin", "amoxicillin", "ampicillin", "amoxiclav", "piperacillin", "augmentin", "cloxacillin", "flucloxacillin", "dicloxacillin"] },
  sulfa: { names: ["sulfasalazine", "sulfamethoxazole", "cotrimoxazole", "dapsone", "sulpha"] },
  nsaid: { names: ["aspirin", "diclofenac", "ibuprofen", "naproxen", "aceclofenac", "indomethacin", "mefenamic", "brufen", "cataflam", "diclomol", "etoricoxib", "ketorolac"] },
  paracetamol: { names: ["paracetamol", "acetaminophen", "calpol", "dolo", "crocin", "pcm"] },
  acei: { names: ["ramipril", "enalapril", "lisinopril", "perindopril", "captopril"] },
  arb: { names: ["telmisartan", "losartan", "valsartan", "olmesartan"] },
  ccb: { names: ["amlodipine", "nifedipine", "cilnidipine"] },
  betablocker: { names: ["atenolol", "metoprolol", "propranolol", "bisoprolol", "carvedilol"] },
  statin: { names: ["atorvastatin", "rosuvastatin", "simvastatin", "pitavastatin"] },
  nitrate: { names: ["nitroglycerine", "isosorbide", "nitrate"] },
  sildenafil: { names: ["sildenafil", "tadalafil", "vardenafil"] },
  antidiabetic: { names: ["metformin", "glimepiride", "gliclazide", "sitagliptin", "insulin", "empagliflozin", "dapagliflozin"] },
  ppi: { names: ["omeprazole", "pantoprazole", "esomeprazole", "rabeprazole"] },
  antiplatelet: { names: ["aspirin", "clopidogrel", "ticagrelor", "prasugrel"] },
  anticoagulant: { names: ["warfarin", "rivaroxaban", "apixaban", "edoxaban", "heparin"] },
  thyroid: { names: ["levothyroxine", "eltroxin", "thyronorm", "thyroxine"] },
  // Ayurvedic & Herbal formulations
  ayur_guggulu: { names: ["guggul", "guggulu", "yogaraj", "kanchnar", "kaishore"] },
  ayur_ashwagandha: { names: ["ashwagandha", "asgandh", "ashwagandharishta"] },
  ayur_karela_gurmar: { names: ["karela", "bitter gourd", "gurmar", "gymnema", "madhumehari", "jamun seed"] },
  ayur_garlic_ginger: { names: ["lasuna", "garlic", "ginger", "shunthi", "adrak", "ginkgo"] },
  ayur_licorice: { names: ["yashtimadhu", "mulethi", "licorice", "liquorice"] },
  ayur_triphala: { names: ["triphala", "haritaki", "amla", "bibhitaki", "avipattikar"] },
};

/**
 * Every family a drug name belongs to. A drug can legitimately sit in more than
 * one — aspirin is both an NSAID and an antiplatelet — and returning only the
 * first match would make whichever rule was checked second unreachable. Order
 * in FAMILIES must therefore never change the clinical result.
 */
function familiesOf(drug: string): string[] {
  const d = drug.toLowerCase();
  const out: string[] = [];
  for (const [fam, { names }] of Object.entries(FAMILIES)) {
    if (names.some((n) => d.includes(n))) out.push(fam);
  }
  return out;
}

const DRUG_DRUG_RULES: { between: [string, string]; severity: InteractionWarning["severity"]; message: string }[] = [
  { between: ["anticoagulant", "antiplatelet"], severity: "high", message: "Combined anticoagulant + antiplatelet significantly increases bleeding risk." },
  { between: ["anticoagulant", "nsaid"], severity: "high", message: "NSAID with anticoagulant raises bleeding risk." },
  { between: ["antiplatelet", "nsaid"], severity: "medium", message: "NSAID + antiplatelet increases GI bleeding risk." },
  { between: ["acei", "ccb"], severity: "low", message: "Combine cautiously for additive BP lowering; monitor dizziness." },
  { between: ["ccb", "betablocker"], severity: "medium", message: "CCB + beta-blocker may cause bradycardia/hypotension." },
  { between: ["ccb", "statin"], severity: "medium", message: "Calcium-channel blockers raise statin levels (myopathy risk). Use the lowest statin dose." },
  { between: ["acei", "nsaid"], severity: "medium", message: "NSAID reduces ACE-I effect and risks renal impairment/hyperkalaemia." },
  { between: ["sildenafil", "nitrate"], severity: "high", message: "Sildenafil + nitrates causes severe hypotension — contraindicated." },
  { between: ["antiplatelet", "ppi"], severity: "low", message: "PPI with clopidogrel may reduce antiplatelet effectiveness." },
  { between: ["nsaid", "nsaid"], severity: "low", message: "Multiple NSAIDs increase GI and renal risk." },
  // Cross-system Herb-Drug Interactions (Ministry of Ayush / Integrative Medicine)
  { between: ["anticoagulant", "ayur_guggulu"], severity: "high", message: "AYUSH Alert: Guggulu enhances anticoagulant activity and markedly raises bleeding risk." },
  { between: ["antiplatelet", "ayur_garlic_ginger"], severity: "medium", message: "AYUSH Alert: High-dose Lasuna/Shunthi inhibits platelet aggregation; monitor for bruising or bleeding." },
  { between: ["antidiabetic", "ayur_karela_gurmar"], severity: "medium", message: "AYUSH Alert: Karela/Gurmar has potent additive hypoglycemic effect; monitor blood sugar to avoid severe hypoglycemia." },
  { between: ["acei", "ayur_licorice"], severity: "high", message: "AYUSH Alert: Mulethi (Yashtimadhu) causes mineralocorticoid excess and potassium depletion, negating ACE-inhibitor effect." },
  { between: ["thyroid", "ayur_ashwagandha"], severity: "medium", message: "AYUSH Alert: Ashwagandha stimulates thyroid hormone production; monitor TSH/Free T4 when co-administered with Levothyroxine." },
];

const ALLERGY_RULES: { allergen: string; drugFamilies: string[] }[] = [
  { allergen: "penicillin", drugFamilies: ["penicillin"] },
  { allergen: "sulpha", drugFamilies: ["sulfa"] },
  { allergen: "sulfa", drugFamilies: ["sulfa"] },
  { allergen: "aspirin", drugFamilies: ["nsaid", "antiplatelet"] },
  { allergen: "nsaid", drugFamilies: ["nsaid"] },
  { allergen: "paracetamol", drugFamilies: ["paracetamol"] },
];

export function checkInteractions(medications: Medication[], allergies: Allergy[], extraMedications: Medication[] = []): InteractionWarning[] {
  const warnings: InteractionWarning[] = [];
  const allMeds = [...medications, ...extraMedications];
  const drugNames = allMeds.map((m) => m.name.toLowerCase()).filter(Boolean);

  // Duplicates
  const counts = new Map<string, number>();
  drugNames.forEach((n) => counts.set(n, (counts.get(n) ?? 0) + 1));
  counts.forEach((count, name) => {
    if (count > 1) {
      warnings.push({
        type: "duplicate",
        severity: "low",
        message: `Duplicate entry for "${name}" — verify dosage to avoid overdose risk.`,
        between: name,
      });
    }
  });

  // Drug-drug. Each drug maps to *all* of its families so a drug in two
  // families (aspirin = NSAID + antiplatelet) participates in both rules. A
  // cross-family rule must be satisfied by two DISTINCT drugs — otherwise a
  // single dual-class drug such as aspirin would be reported as interacting
  // with itself.
  const drugFamilies = drugNames.map((d) => familiesOf(d));
  for (const rule of DRUG_DRUG_RULES) {
    const [a, b] = rule.between;
    if (a === b) {
      // Same family on both sides: needs two *distinct* drugs in that family,
      // which is why the duplicate check above does not subsume this.
      const matchingDrugs = drugNames.filter((_, i) => drugFamilies[i].includes(a));
      if (matchingDrugs.length >= 2) {
        warnings.push({ type: "drug-drug", severity: rule.severity, message: rule.message, between: `${a} ↔ ${b}` });
      }
    } else if (
      drugFamilies.some((fams, i) => fams.includes(a) && drugFamilies.some((other, j) => j !== i && other.includes(b)))
    ) {
      warnings.push({ type: "drug-drug", severity: rule.severity, message: rule.message, between: `${a} ↔ ${b}` });
    }
  }

  // Drug-allergy
  for (const allegy of allergies) {
    const key = allegy.substance.toLowerCase().trim();
    if (!key) continue;
    const rule = ALLERGY_RULES.find((r) => key.includes(r.allergen));
    // Direct match: the prescribed drug IS the documented allergen (same drug,
    // or its brand/generic alias). Family cross-reaction rules miss these — e.g.
    // allergy "ibuprofen" + Rx "ibuprofen" matched no family because the
    // allergen isn't one of the family-key terms.
    const directMatch = (d: string): boolean =>
      d.length >= 3 && (key.includes(d) || d.includes(key));
    const offending = drugNames.find((d) => {
      const famsOfDrug = familiesOf(d);
      if (rule && famsOfDrug.some((f) => rule.drugFamilies.includes(f))) return true;
      if (rule && rule.drugFamilies.some((f) => FAMILIES[f]?.names.some((n) => d.includes(n)) || d.includes(f))) return true;
      return directMatch(d);
    });
    if (offending) {
      const sameDrug = directMatch(offending);
      warnings.push({
        type: "drug-allergy",
        severity: "high",
        message: sameDrug
          ? `ALERT: ${offending} is the documented ${allegy.substance} allergy — do not prescribe.`
          : `ALERT: ${offending} may cross-react with documented ${allegy.substance} allergy.`,
        between: `${allegy.substance} ↔ ${offending}`,
      });
    }
  }

  return warnings;
}

export function interactionsToSummary(warnings: InteractionWarning[]): string {
  if (!warnings.length) return "No drug-drug or drug-allergy interactions identified.";
  return warnings
    .map((w) => ` • [${w.severity.toUpperCase()}] ${w.message}`)
    .join("\n");
}

/**
 * Coverage transparency for the interaction check.
 *
 * The checker works off a curated dictionary (drug families above plus the
 * pregnancy catalogue) — it is a safety net, not a pharmacopoeia. A drug that
 * matches no known family is silently unchecked, which reads exactly like "no
 * interactions". Surfacing the unchecked names next to the warnings keeps that
 * distinction visible so the physician verifies them independently.
 */
export function drugsWithoutCoverage(medications: Medication[]): string[] {
  const unknown: string[] = [];
  for (const m of medications) {
    const name = (m.name ?? "").trim();
    if (!name) continue;
    if (familiesOf(name).length === 0 && pregnancyRuleFor(name) === null) {
      if (!unknown.some((u) => u.toLowerCase() === name.toLowerCase())) unknown.push(name);
    }
  }
  return unknown;
}

/** Static scope footnote rendered wherever interaction results are shown. */
export const INTERACTION_COVERAGE_NOTE =
  "Interaction check covers a curated list of common allopathic + AYUSH drug families and pregnancy categories — not a complete pharmacopoeia. Verify unchecked drugs independently.";

// ---------------------------------------------------------------- pregnancy / lactation safety

export type PregnancyContext = {
  female: boolean;
  age?: number;
  /** Clinically confirmed pregnancy (physician record). */
  pregnant?: boolean;
  lactating?: boolean;
  /** Free-text obstetric/menstrual history used as a fallback indicator. */
  notes?: string;
};

export type PregnancyRisk = {
  drug: string;
  category: "A" | "B" | "C" | "D" | "X";
  severity: "high" | "medium" | "low";
  message: string;
};

type PregnancyRule = {
  pattern: string;
  category: PregnancyRisk["category"];
  message: string;
};

// FDA-style categories. Where a family spans categories the most conservative
// (later-trimester) category is used.
const PREGNANCY_RULES: PregnancyRule[] = [
  { pattern: "isotretinoin", category: "X", message: "contraindicated in pregnancy — severe birth defects (retinoid)." },
  { pattern: "warfarin", category: "X", message: "contraindicated in pregnancy — fetal haemorrhage/teratogenicity; use LMWH instead." },
  { pattern: "methotrexate", category: "X", message: "contraindicated — abortifacient and teratogenic." },
  { pattern: "misoprostol", category: "X", message: "contraindicated in pregnancy." },
  { pattern: "carbamazepine", category: "D", message: "documented teratogen (neural tube defects) — needs folate + specialist review." },
  { pattern: "valproate", category: "D", message: "high teratogenic risk — avoid in pregnancy." },
  { pattern: "statins", category: "X", message: "withhold in pregnancy / lactation; stop before conception." },
  { pattern: "acei", category: "D", message: "ACE inhibitors can harm the fetal kidney in 2nd/3rd trimester — switch to a pregnancy-safe antihypertensive." },
  { pattern: "arb", category: "D", message: "ARBs can harm the fetal kidney in 2nd/3rd trimester — switch to a pregnancy-safe antihypertensive." },
  { pattern: "nsaid", category: "D", message: "NSAIDs in 3rd trimester risk premature ductus arteriosus closure; limit use." },
  { pattern: "aspirin", category: "C", message: "low-dose aspirin is sometimes used in pregnancy, but avoid high doses near term." },
  { pattern: "ciprofloxacin", category: "C", message: "fluoroquinolones — avoid unless no alternative (cartilage risk)." },
  { pattern: "metformin", category: "B", message: "commonly used in gestational diabetes — generally acceptable." },
  { pattern: "paracetamol", category: "B", message: "generally safe at therapeutic doses." },
  { pattern: "amoxicillin", category: "B", message: "generally safe." },
  { pattern: "ondansetron", category: "B", message: "generally used for pregnancy nausea." },
];

function pregnancyRuleFor(drug: string): PregnancyRule | null {
  const d = drug.toLowerCase();
  // Exact-family terms expand via the drug-family catalogue.
  if (d.includes("statin")) return PREGNANCY_RULES[6];
  for (const rule of PREGNANCY_RULES) {
    if (rule.pattern === "nsaid") {
      if (["diclofenac", "ibuprofen", "naproxen", "aceclofenac", "indomethacin", "mefenamic"].some((n) => d.includes(n))) return rule;
    } else if (rule.pattern === "acei") {
      if (FAMILIES.acei.names.some((n) => d.includes(n))) return rule;
    } else if (rule.pattern === "arb") {
      if (FAMILIES.arb.names.some((n) => d.includes(n))) return rule;
    } else if (rule.pattern === "aspirin") {
      if (d.includes("aspirin")) return rule;
    } else if (rule.pattern === "statins") {
      if (["atorvastatin", "rosuvastatin", "simvastatin", "pitavastatin"].some((n) => d.includes(n))) return rule;
    } else if (d.includes(rule.pattern)) {
      return rule;
    }
  }
  return null;
}

// Boundary is a JS word char check which excludes Devanagari — so Hindi terms
// must match without \b. Latin terms tolerate substring matches (they only
// appear in pregnancy-relevant notes anyway).
const PREG_INDICATOR = /(pregnan|gravida|pregnant|obstetric|expecting|g\d+p|गर्भ|गर्भवती)/;
// "not/denies/never pregnant" must NOT be read as a positive signal.
const PREG_NEGATIVE = /\b(?:no|not|denies|denied|rules? ?out|negative for|never)\b[^.?!\n]{0,30}\b(?:pregnan|gravida|obstetric|expecting)\b/i;
export function pregnancySignalled(notes?: string): boolean {
  if (!notes) return false;
  const lower = notes.toLowerCase();
  if (PREG_NEGATIVE.test(lower)) return false;
  return PREG_INDICATOR.test(lower);
}

/**
 * Warns when a prescribed medication is risky during pregnancy or lactation.
 * Only applies to females of reproductive age; flagged drugs are surfaced on
 * the e-prescription panel and in the after-visit summary.
 */
export function checkPregnancyRisk(medications: Medication[], ctx: PregnancyContext): PregnancyRisk[] {
  if (!ctx.female || !medications?.length) return [];
  const age = ctx.age;
  if (age !== undefined && (age < 15 || age > 49)) return [];
  const likPregnant = ctx.pregnant === true || pregnancySignalled(ctx.notes);
  const lactating = ctx.lactating === true;

  const risks: PregnancyRisk[] = [];
  for (const med of medications) {
    const rule = pregnancyRuleFor(med.name);
    if (!rule) continue;
    const severe = rule.category === "X" || (rule.category === "D" && (likPregnant || lactating));
    risks.push({
      drug: med.name,
      category: rule.category,
      severity: severe ? "high" : likPregnant ? "medium" : "low",
      message: `${med.name} (${rule.category}) — ${rule.message}`,
    });
  }
  return risks;
}