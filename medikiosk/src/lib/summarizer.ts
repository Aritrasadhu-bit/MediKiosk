import type { ClinicalHistory, MedicalDocument, RedFlag, Vitals, StoredHistory } from "./types";
import { pictogramFor, pictogramText } from "./pictograms";

export type SummaryInput = {
  history: ClinicalHistory;
  mode: string;
  documents: MedicalDocument[];
  redFlags: RedFlag[];
  vitals?: Vitals;
  guardian?: { name: string; relation: string };
  interactionsText?: string;
};

export function buildTemplateSummary(body: SummaryInput): string {
  return assembleSummary(body, false);
}

/**
 * Hindi rendering of the structured summary for Hindi-reading physicians.
 *
 * Only the FIXED scaffolding is translated (headers, labels, provenance
 * footer, severity tags). Free-text clinical content — complaints, HPI,
 * diagnoses, notes, LLM narrative — renders exactly as captured: translating
 * clinical prose without a verified medical-MT pipeline would invent meaning,
 * and drug names/dosages stay in Latin script universally. Vitals keep numeric
 * values with Hindi unit labels.
 */
export function assembleSummaryHi(body: SummaryInput, llm: boolean, narrative?: string): string {
  const h = body.history;
  const mode = body.mode === "ayush" ? "आयुष (आयुर्वेदिक)" : "एलोपैथिक";
  const lines: string[] = [];

  const respondent =
    body.guardian && body.guardian.name
      ? ` (जानकारी देने वाले: ${body.guardian.name}, ${body.guardian.relation})`
      : "";
  lines.push(`${h.name || "रोगी"}, ${h.age || "-"} वर्ष, ${h.sex || "-"} | ${mode}${respondent}`);
  lines.push("============================================");

  if (narrative && narrative.trim()) {
    lines.push(`\nमसौदा विवरण (लैंग्वेज मॉडल — हस्ताक्षर से पहले हर पंक्ति सत्यापित करें):`);
    lines.push(narrative.trim());
    lines.push(`\n──────── संरचित रिकॉर्ड (किओस्क पर जैसा दर्ज) ────────`);
  }

  if (body.vitals && Object.keys(body.vitals).length > 0) {
    const v = body.vitals;
    const vList: string[] = [];
    if (v.systolic || v.diastolic) vList.push(`बीपी: ${v.systolic ?? "-"}/${v.diastolic ?? "-"} mmHg`);
    if (v.pulse) vList.push(`नाड़ी: ${v.pulse} प्रति मिनट`);
    if (v.temperature) vList.push(`तापमान: ${v.temperature}°C`);
    if (v.spo2) vList.push(`SpO2: ${v.spo2}%`);
    if (v.weight) vList.push(`वजन: ${v.weight} किग्रा`);
    if (v.height) vList.push(`ऊंचाई: ${v.height} सेमी`);
    if (vList.length) {
      lines.push(`\nदर्ज वाइटल्स:`);
      lines.push(` • ${vList.join(" | ")}`);
    }
  }

  lines.push(`\nमुख्य शिकायत:`);
  lines.push(`• ${h.chiefComplaint || "नहीं बताया"}`);

  lines.push(`\nवर्तमान बीमारी का विवरण:`);
  lines.push(` • ${h.hpi || "नहीं पूछा गया"}`);

  const pm = h.pastMedical ?? [];
  if (pm.length) {
    lines.push(`\nपुरानी बीमारियाँ:`);
    pm.forEach((p) => lines.push(` • ${p.condition}${p.year ? ` (${p.year})` : ""}`));
  } else {
    lines.push(`\nपुरानी बीमारियाँ: कोई दस्तावेज नहीं`);
  }

  const ps = h.pastSurgical ?? [];
  if (ps.length) {
    lines.push(`\nपुराने ऑपरेशन:`);
    ps.forEach((p) => lines.push(` • ${p.procedure}${p.year ? ` (${p.year})` : ""}`));
  } else {
    lines.push(`\nपुराने ऑपरेशन: कोई दस्तावेज नहीं`);
  }

  const meds = h.medications ?? [];
  if (meds.length) {
    lines.push(`\nचल रही दवाइयाँ:`);
    meds.forEach((m) => lines.push(` • ${m.name}${m.dosage ? ` ${m.dosage}` : ""}${m.frequency ? ` ${m.frequency}` : ""}`));
  } else {
    lines.push(`\nचल रही दवाइयाँ: कोई दस्तावेज नहीं`);
  }

  const all = h.allergies ?? [];
  if (all.length) {
    lines.push(`\nएलर्जी:`);
    all.forEach((a) => lines.push(` • ${a.substance}${a.reaction ? ` (${a.reaction})` : ""}`));
  } else {
    lines.push(`\nएलर्जी: कोई ज्ञात नहीं`);
  }

  lines.push(`\nपारिवारिक इतिहास:`);
  lines.push(` • ${h.familyHistory || "नहीं पूछा गया"}`);

  lines.push(`\nव्यक्तिगत इतिहास:`);
  lines.push(` • ${h.personalHistory || "नहीं पूछा गया"}`);

  if (h.sex === "Female") {
    if (h.menstrualHistory) {
      lines.push(`\nमासिक इतिहास:`);
      lines.push(` • ${h.menstrualHistory}`);
    }
    if (h.obstetricHistory) {
      lines.push(`\nप्रसूति इतिहास:`);
      lines.push(` • ${h.obstetricHistory}`);
    }
  }

  const ros = h.reviewOfSystems ?? [];
  if (ros.length) {
    lines.push(`\nतंत्र समीक्षा:`);
    ros.forEach((r) => lines.push(` • ${r.system}: ${r.positive}`));
  }

  const docs = body.documents ?? [];
  const allInvestigations: MedicalDocument["entities"]["investigations"][number][] = [];
  docs.forEach((d) => {
    (d.entities?.investigations ?? []).forEach((i) => allInvestigations.push({ ...i, date: d.date }));
  });
  if (allInvestigations.length) {
    lines.push(`\nपुरानी जाँचें:`);
    allInvestigations.forEach((i) =>
      lines.push(` • ${i.test}: ${i.value}${i.unit ? ` ${i.unit}` : ""} [${i.referenceRange ?? ""}] ${i.flag && i.flag !== "normal" ? `⚠ ${i.flag.toUpperCase()}` : ""}${i.date ? ` (${i.date})` : ""}`)
    );
  }

  const allDiag: string[] = [];
  docs.forEach((d) => (d.entities?.diagnoses ?? []).forEach((x) => allDiag.includes(x) || allDiag.push(x)));
  if (allDiag.length) {
    lines.push(`\nदस्तावेज़ी निदान:`);
    allDiag.forEach((d) => lines.push(` • ${d}`));
  }

  if (mode.startsWith("आयुष") && h.ayush) {
    lines.push(`\nआयुष आकलन (दशविध परीक्षा):`);
    const a = h.ayush;
    const entries: [string, string][] = [
      ["प्रकृति", a.prakriti],
      ["अग्नि", a.agni],
      ["कोष्ठ", a.koshtha],
      ["सत्त्व", a.sattva],
      ["आहार शक्ति", a.aharaShakti],
      ["वय", a.vaya],
      ["आहार-विहार", a.aharaVihara],
    ];
    entries.forEach(([k, v]) => {
      if (v) lines.push(` • ${k}: ${v}`);
    });
  }

  const rf = body.redFlags ?? [];
  if (rf.length) {
    lines.push(`\n⚠️ रेड फ्लैग / प्राथमिकता चेतावनी:`);
    rf.forEach((r) => {
      if (r.severity === "high") lines.push(` • [उच्च] ${r.symptom}: ${r.message}`);
      else if (r.severity === "medium") lines.push(` • [मध्यम] ${r.symptom}: ${r.message}`);
    });
  }

  if (body.interactionsText) {
    lines.push(`\n— दवा परस्पर-क्रिया जाँच —`);
    lines.push(body.interactionsText);
  }

  lines.push(
    `\n${llm
      ? "──── लैंग्वेज मॉडल की सहायता से मसौदा; उपचार करने वाले चिकित्सक द्वारा समीक्षित एवं हस्ताक्षरित ────"
      : "──── MediKiosk नियम इंजन द्वारा संरचित सारांश (निश्चित); चिकित्सक समीक्षा प्रतीक्षित ────"}`
  );
  return lines.join("\n");
}

/**
 * Label the provenance of a summary honestly. The deterministic path is
 * string assembly over validated fields, not a language model, and labelling
 * it "MediKiosk AI" overstated what produced it.
 */
function summaryFooter(llm: boolean): string {
  return llm
    ? "──── Summary drafted with a language model; reviewed and signed off by the treating physician ────"
    : "──── Structured summary generated by MediKiosk rules engine (deterministic); awaiting physician review ────";
}

/**
 * @param llm     whether a language model drafted the narrative
 * @param narrative optional model-drafted text, inserted ahead of the
 *   deterministic structured record. The structured sections are never
 *   replaced — they are the machine-checked capture of what the patient said,
 *   and a physician must be able to verify the draft against them.
 */
export function assembleSummary(body: SummaryInput, llm: boolean, narrative?: string): string {
  const h = body.history;
  const mode = body.mode === "ayush" ? "AYUSH (Ayurvedic)" : "Allopathic";
  const lines: string[] = [];

  const respondent =
    body.guardian && body.guardian.name
      ? ` (history given by ${body.guardian.name}, ${body.guardian.relation})`
      : "";
  lines.push(`${h.name || "Patient"}, ${h.age || "-"}y, ${h.sex || "-"} | ${mode}${respondent}`);
  lines.push("============================================");

  if (narrative && narrative.trim()) {
    lines.push(`\nDRAFT NARRATIVE (language model — verify every line before signing off):`);
    lines.push(narrative.trim());
    lines.push(`\n──────── STRUCTURED RECORD (as captured at the kiosk) ────────`);
  }

  if (body.vitals && Object.keys(body.vitals).length > 0) {
    const v = body.vitals;
    const vList: string[] = [];
    if (v.systolic || v.diastolic) vList.push(`BP: ${v.systolic ?? "-"}/${v.diastolic ?? "-"} mmHg`);
    if (v.pulse) vList.push(`Pulse: ${v.pulse} bpm`);
    if (v.temperature) vList.push(`Temp: ${v.temperature}°C`);
    if (v.spo2) vList.push(`SpO2: ${v.spo2}%`);
    if (v.weight) vList.push(`Weight: ${v.weight} kg`);
    if (v.height) vList.push(`Height: ${v.height} cm`);
    if (vList.length) {
      lines.push(`\nRECORDED VITALS:`);
      lines.push(` • ${vList.join(" | ")}`);
    }
  }

  lines.push(`\nCHIEF COMPLAINT:`);
  lines.push(`• ${h.chiefComplaint || "Not stated"}`);

  lines.push(`\nHISTORY OF PRESENT ILLNESS:`);
  lines.push(` • ${h.hpi || "Not elicited"}`);

  const pm = h.pastMedical ?? [];
  if (pm.length) {
    lines.push(`\nPAST MEDICAL HISTORY:`);
    pm.forEach((p) => lines.push(` • ${p.condition}${p.year ? ` (${p.year})` : ""}`));
  } else {
    lines.push(`\nPAST MEDICAL HISTORY: None documented`);
  }

  const ps = h.pastSurgical ?? [];
  if (ps.length) {
    lines.push(`\nPAST SURGICAL HISTORY:`);
    ps.forEach((p) => lines.push(` • ${p.procedure}${p.year ? ` (${p.year})` : ""}`));
  } else {
    lines.push(`\nPAST SURGICAL HISTORY: None documented`);
  }

  const meds = h.medications ?? [];
  if (meds.length) {
    lines.push(`\nCURRENT MEDICATIONS:`);
    meds.forEach((m) => lines.push(` • ${m.name}${m.dosage ? ` ${m.dosage}` : ""}${m.frequency ? ` ${m.frequency}` : ""}`));
  } else {
    lines.push(`\nCURRENT MEDICATIONS: None documented`);
  }

  const all = h.allergies ?? [];
  if (all.length) {
    lines.push(`\nALLERGIES:`);
    all.forEach((a) => lines.push(` • ${a.substance}${a.reaction ? ` (${a.reaction})` : ""}`));
  } else {
    lines.push(`\nALLERGIES: None known`);
  }

  lines.push(`\nFAMILY HISTORY:`);
  lines.push(` • ${h.familyHistory || "Not elicited"}`);

  lines.push(`\nPERSONAL HISTORY:`);
  lines.push(` • ${h.personalHistory || "Not elicited"}`);

  if (h.sex === "Female") {
    if (h.menstrualHistory) {
      lines.push(`\nMENSTRUAL HISTORY:`);
      lines.push(` • ${h.menstrualHistory}`);
    }
    if (h.obstetricHistory) {
      lines.push(`\nOBSTETRIC HISTORY:`);
      lines.push(` • ${h.obstetricHistory}`);
    }
  }

  const ros = h.reviewOfSystems ?? [];
  if (ros.length) {
    lines.push(`\nREVIEW OF SYSTEMS:`);
    ros.forEach((r) => lines.push(` • ${r.system}: ${r.positive}`));
  }

  // Prior investigations from docs
  const docs = body.documents ?? [];
  const allInvestigations: MedicalDocument["entities"]["investigations"][number][] = [];
  docs.forEach((d) => {
    (d.entities?.investigations ?? []).forEach((i) => allInvestigations.push({ ...i, date: d.date }));
  });
  if (allInvestigations.length) {
    lines.push(`\nPRIOR INVESTIGATIONS:`);
    allInvestigations.forEach((i) =>
      lines.push(` • ${i.test}: ${i.value}${i.unit ? ` ${i.unit}` : ""} [${i.referenceRange ?? ""}] ${i.flag && i.flag !== "normal" ? `⚠ ${i.flag.toUpperCase()}` : ""}${i.date ? ` (${i.date})` : ""}`)
    );
  }

  // Diagnoses from docs
  const allDiag: string[] = [];
  docs.forEach((d) => (d.entities?.diagnoses ?? []).forEach((x) => allDiag.includes(x) || allDiag.push(x)));
  if (allDiag.length) {
    lines.push(`\nDOCUMENTED DIAGNOSES:`);
    allDiag.forEach((d) => lines.push(` • ${d}`));
  }

  // AYUSH
  if (mode.startsWith("AYUSH") && h.ayush) {
    lines.push(`\nAYUSH ASSESSMENT (Dashavidha Pariksha):`);
    const a = h.ayush;
    const entries: [string, string][] = [
      ["Prakriti", a.prakriti],
      ["Agni", a.agni],
      ["Koshtha", a.koshtha],
      ["Sattva", a.sattva],
      ["Ahara Shakti", a.aharaShakti],
      ["Vaya", a.vaya],
      ["Ahara-Vihara", a.aharaVihara],
    ];
    entries.forEach(([k, v]) => {
      if (v) lines.push(` • ${k}: ${v}`);
    });
  }

  // Red flags. BOTH severities are printed: medium flags (severe
  // hypertension, low SpO2, bradycardia…) change management and must not be
  // silently dropped from the handoff the physician signs off — an earlier
  // version printed the header but only listed `high` flags, so a
  // medium-only record produced an empty section and the flag disappeared.
  const rf = body.redFlags ?? [];
  if (rf.length) {
    lines.push(`\n⚠️ RED FLAGS / PRIORITY ALERTS:`);
    rf.forEach((r) => {
      if (r.severity === "high") lines.push(` • [HIGH] ${r.symptom}: ${r.message}`);
      else if (r.severity === "medium") lines.push(` • [MEDIUM] ${r.symptom}: ${r.message}`);
    });
  }

  if (body.interactionsText) {
    lines.push(`\n— DRUG INTERACTION CHECK —`);
    lines.push(body.interactionsText);
  }

  lines.push(`\n${summaryFooter(llm)}`);
  return lines.join("\n");
}

/** Renders a physician-authored prescription into a printable after-visit handout. */
export function renderAfterVisit(h: StoredHistory): string {
  const lines: string[] = [];
  lines.push(`🏥 MediKiosk — After Visit Summary`);
  lines.push(`Patient: ${h.history.name}, ${h.history.age}y, ${h.history.sex}`);
  lines.push(`Dept: ${h.patient.department} | ABHA: ${h.patient.abhaId}`);
  lines.push(`Date: ${new Date(h.enteredAt).toLocaleString()}`);
  lines.push("============================================");
  lines.push(`CHIEF COMPLAINT: ${h.history.chiefComplaint}`);
  if (h.doctorDiagnosis) lines.push(`\nDIAGNOSIS: ${h.doctorDiagnosis}`);
  if (h.prescription?.diagnosis) lines.push(`\nDIAGNOSIS: ${h.prescription.diagnosis}`);
  if (h.prescription?.medications?.length) {
    lines.push(`\nPRESCRIBED MEDICINES:`);
    h.prescription.medications.forEach((m) => {
      const formStr = m.dosageForm ? `[${m.dosageForm}] ` : "";
      const anupanaStr = m.anupana ? ` | Anupana: ${m.anupana}` : "";
      const kalaStr = m.kala ? ` | Time: ${m.kala}` : "";
      lines.push(
        ` • ${formStr}${m.name}${m.dosage ? ` ${m.dosage}` : ""}${m.frequency ? ` — ${m.frequency}` : ""}${m.duration ? ` for ${m.duration}` : ""}${m.instructions ? ` (${m.instructions})` : ""}${anupanaStr}${kalaStr}`
      );
    });
    // Pictogram instructions (Batch B, U3)
    lines.push(`\nHOW TO TAKE:`);
    h.prescription.medications.forEach((m) => {
      const row = pictogramFor(m);
      lines.push(` • ${row.medName}${row.dosage ? ` ${row.dosage}` : ""}: ${pictogramText(row)}`);
      lines.push(`   ${row.captionEn} | ${row.captionHi}`);
    });
  }
  if (h.prescription?.pathya) {
    lines.push(`\nPATHYA (DO'S / WHOLESOME DIET & LIFESTYLE):`);
    lines.push(` • ${h.prescription.pathya}`);
  }
  if (h.prescription?.apathya) {
    lines.push(`\nAPATHYA (DON'TS / FOOD RESTRICTIONS):`);
    lines.push(` • ${h.prescription.apathya}`);
  }
  if (h.prescription?.advice) {
    lines.push(`\nADVICE:`);
    lines.push(` • ${h.prescription.advice}`);
  }
  if (h.prescription?.followUpDate) lines.push(`\nFOLLOW-UP: ${h.prescription.followUpDate}`);
  if (h.doctorNote) {
    lines.push(`\nDOCTOR'S NOTE:`);
    lines.push(` • ${h.doctorNote}`);
  }
  lines.push(`\n——— Please consult your doctor for interpretation. Draft, not a diagnosis. ———`);
  return lines.join("\n");
}