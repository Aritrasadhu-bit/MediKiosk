import type { Medication } from "./types";
import type { IconName } from "@/components/Icon";

/**
 * Pictogram medicine instructions (Batch B, U3).
 *
 * Converts the frequency/instruction strings doctors type into a
 * low-literacy-friendly icon strip: a form icon, one clock icon per dose time,
 * a before/after-food marker and a water reminder. Icons are names from the
 * shared SVG set, so the printed handout, portal view and printed slip all draw
 * the same glyphs. Everything gets a bilingual (English + Hindi) caption so
 * the handout works for patients who don't read English.
 *
 * Pure functions — no I/O — so they are unit-testable.
 */

export type DoseTime = "morning" | "afternoon" | "evening" | "night";

export const DOSE_TIME_META: Record<DoseTime, { icon: IconName; en: string; hi: string }> = {
  morning: { icon: "sunrise", en: "Morning", hi: "सुबह" },
  afternoon: { icon: "sun", en: "Noon", hi: "दोपहर" },
  evening: { icon: "sunset", en: "Evening", hi: "शाम" },
  night: { icon: "moon", en: "Night", hi: "रात" },
};

const TIMES_ORDER: DoseTime[] = ["morning", "afternoon", "evening", "night"];

export type PictogramStep = { icon: IconName; label: string; labelHi: string };

export type PictogramRow = {
  medName: string;
  dosage?: string;
  formIcon: IconName;
  times: DoseTime[];
  meal: "before" | "after" | null;
  water: boolean;
  captionEn: string;
  captionHi: string;
};

function formIcon(name: string): IconName {
  const n = name.toLowerCase();
  if (/syr|elixir|lotion|suspens|paracetamol syrup/.test(n)) return "spoon";
  if (/inj|vaccine|pen ?inject/.test(n)) return "syringe";
  if (/drop|ear|eye|nasal/.test(n)) return "dropper";
  if (/oint|cream|gel|apply|patch|topical/.test(n)) return "tube";
  return "pill";
}

/** Normalised token list from frequency + instruction strings. */
function tokens(frequency?: string, instructions?: string): string[] {
  return `${frequency ?? ""} ${instructions ?? ""}`.toLowerCase().split(/[^a-z0-9+-]+/).filter(Boolean);
}

/** How often per day does this map to? (best-effort parser). */
function parseTimes(tokens: string[]): DoseTime[] {
  const t = tokens.join(" ");
  if (/\b(4 times|qid|four times)\b/.test(t)) return ["morning", "afternoon", "evening", "night"];
  if (/\b(thrice daily|tds|tid|three times|t\.d\.s)\b/.test(t)) {
    // Specific spot checks like 1-0-1-0 map to morning+night.
    const matches = tokens.join(" ").match(/1-0-1/g);
    return matches ? ["morning", "night"] : ["morning", "afternoon", "night"];
  }
  if (/\b(twice daily|bd|bid|two times|b\.d)\b/.test(t)) return ["morning", "night"];
  if (/\b(hs|bedtime|at night|nocte|night)\b/.test(t)) return ["night"];
  if (/\b(once daily|od|once a day|daily)\b/.test(t)) return ["morning"];
  if (/\b(alternate days|every other day)\b/.test(t)) return ["morning"];
  if (/\b(weekly|once a week)\b/.test(t)) return ["morning"];
  if (/\b(prn|as needed|when needed|sos)\b/.test(t)) return ["morning"];
  if (/\b(every 6 hours|6 hourly)\b/.test(t)) return ["morning", "afternoon", "evening", "night"];
  if (/\b(every 8 hours|8 hourly)\b/.test(t)) return ["morning", "afternoon", "night"];
  if (/\b(every 12 hours|12 hourly)\b/.test(t)) return ["morning", "night"];
  if (/\b(every 24 hours|24 hourly)\b/.test(t)) return ["morning"];

  // Fallback: count the 1-..-1 weekday pattern.
  if (/\b1-0-\d/.test(t)) return ["morning", "night"];
  return ["morning"];
}

function mealMarker(tokens: string[]): "before" | "after" | null {
  const t = tokens.join(" ");
  if (/\bempty stomach|before food|before meals|bf |ac\b|pre-meal/.test(t)) return "before";
  if (/\bafter food|after meals|with food|with milk|pc\b|post-meal/.test(t)) return "after";
  return null;
}

function drinkWater(tokens: string[]): boolean {
  const t = tokens.join(" ");
  return /\bwith water|with plenty of water|drink plenty/.test(t);
}

export function pictogramFor(med: Medication): PictogramRow {
  const toks = tokens(med.frequency, med.instructions);
  const times = parseTimes(toks);
  const meal = mealMarker(toks);
  const hasWater = drinkWater(toks);

  const formatCaption = (text: string, isHindi = false): string => {
    let mealText = text;
    if (meal === "before") {
      mealText = isHindi ? `${text} खाली पेट` : `${text} on empty stomach`;
    } else if (meal === "after") {
      mealText = isHindi ? `${text} भोजन के बाद` : `${text} after food`;
    }
    const waterText = hasWater ? (isHindi ? " · पानी के साथ" : " · with water") : "";
    return `${mealText}${waterText}`;
  };

  const en: string[] = [];
  const hi: string[] = [];
  for (const t of TIMES_ORDER) {
    if (times.includes(t)) {
      en.push(DOSE_TIME_META[t].en);
      hi.push(DOSE_TIME_META[t].hi);
    }
  }
  if (!en.length) {
    en.push("As directed");
    hi.push("चिकित्सक के निर्देशानुसार");
  }

  return {
    medName: med.name,
    dosage: med.dosage,
    formIcon: formIcon(med.name),
    times,
    meal,
    water: hasWater,
    captionEn: formatCaption(en.join(", "), false),
    captionHi: formatCaption(hi.join(", "), true),
  };
}

/** One entry per pictogram: dose times, food timing, water. */
export function pictogramSteps(row: PictogramRow): PictogramStep[] {
  const steps: PictogramStep[] = TIMES_ORDER.filter((t) => row.times.includes(t)).map((t) => ({
    icon: DOSE_TIME_META[t].icon,
    label: DOSE_TIME_META[t].en,
    labelHi: DOSE_TIME_META[t].hi,
  }));
  if (row.meal === "after") steps.push({ icon: "bowl", label: "After food", labelHi: "भोजन के बाद" });
  if (row.meal === "before") steps.push({ icon: "bowl", label: "Empty stomach", labelHi: "खाली पेट" });
  if (row.water) steps.push({ icon: "droplet", label: "With water", labelHi: "पानी के साथ" });
  return steps;
}

/** Plain-text instruction line, e.g. "Morning, Night · after food · with water". */
export function pictogramText(row: PictogramRow): string {
  const labels = pictogramSteps(row).map((s) => s.label);
  return labels.length ? labels.join(", ") : "As directed";
}