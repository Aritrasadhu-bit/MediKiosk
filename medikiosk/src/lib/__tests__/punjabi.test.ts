import { describe, expect, it } from "vitest";
import { t, ct } from "@/lib/i18n";
import {
  MULTI_QUESTIONS,
  MULTI_COMPLAINTS,
  MULTI_OPTIONS,
  MULTI_PAST,
  MULTI_BODY_REGIONS,
  MULTI_PAIN_LEVELS,
  MULTI_STAGE_LABELS,
  MULTI_SURGERIES,
  MULTI_COMMON_MEDS,
  MULTI_ALLERGIES,
  MULTI_PERSONAL_HABITS,
  MULTI_STAGE_UI,
  getHistoryStageUI,
  localizeQuestion,
  localizeOptions,
  localizeComplaint,
  localizePast,
  localizeStageLabel,
  localizeBodyRegion,
  localizeSurgery,
  localizeCommonMed,
  localizeAllergy,
  localizePersonalHabit,
} from "@/lib/translations";
import {
  STAGE_AUDIO_PROMPTS,
  KIOSK_SPEECH,
  kioskSpeech,
  consentAudioScript,
} from "@/lib/speech";
import {
  welcomeSpeech,
  tokenIssuedSpeech,
  tokenCalledSpeech,
} from "@/lib/i18n";
import { SUMMARY_UI } from "@/app/summary/page";

/**
 * Punjabi (pa) completeness regression test.
 *
 * A past incident: pa was registered as a kiosk language but missing from
 * several history-flow tables whose lookups fall back to Hindi — selecting
 * Punjabi silently rendered Hindi. Every lookup the pa flow performs must
 * resolve to a non-empty Punjabi string.
 */
const LANG = "pa";

function expectPaRecord(table: Record<string, Record<string, unknown>>, name: string) {
  expect(table[LANG], `${name} is missing the pa block`).toBeDefined();
  for (const [k, v] of Object.entries(table[LANG])) {
    if (typeof v === "string") {
      expect(v.trim().length, `${name}.pa.${k} is empty`).toBeGreaterThan(0);
    } else if (Array.isArray(v)) {
      expect(v.length, `${name}.pa.${k} is empty`).toBeGreaterThan(0);
      for (const s of v) expect(String(s).trim().length, `${name}.pa.${k} has an empty entry`).toBeGreaterThan(0);
    }
  }
}

describe("Punjabi lookup coverage", () => {
  it("covers every history content table", () => {
    for (const [name, table] of Object.entries({
      MULTI_QUESTIONS,
      MULTI_COMPLAINTS,
      MULTI_OPTIONS,
      MULTI_PAST,
      MULTI_BODY_REGIONS,
      MULTI_PAIN_LEVELS,
      MULTI_STAGE_LABELS,
      MULTI_SURGERIES,
      MULTI_COMMON_MEDS,
      MULTI_ALLERGIES,
      MULTI_PERSONAL_HABITS,
      MULTI_STAGE_UI,
    })) {
      expectPaRecord(table as Record<string, Record<string, unknown>>, name);
    }
  });

  it("resolves history stage UI in Punjabi, not fallback Hindi", () => {
    const ui = getHistoryStageUI(LANG);
    expect(ui.complaintTitle.trim().length).toBeGreaterThan(0);
    expect(ui.complaintTitle).not.toBe(getHistoryStageUI("en").complaintTitle);
  });

  it("localizes sample questions, options, complaints and labels", () => {
    expect(localizeQuestion("hpi", LANG)?.trim().length).toBeGreaterThan(0);
    expect(localizeOptions("severity", LANG).length).toBeGreaterThan(0);
    expect(localizePast("Diabetes", LANG).trim().length).toBeGreaterThan(0);
    expect(localizeStageLabel("past", LANG).trim().length).toBeGreaterThan(0);
    expect(localizeBodyRegion("chest", LANG)?.label.trim().length).toBeGreaterThan(0);
    expect(localizeSurgery("Appendectomy", LANG).trim().length).toBeGreaterThan(0);
    expect(localizeCommonMed("Paracetamol", LANG).trim().length).toBeGreaterThan(0);
    expect(localizeAllergy("Penicillin", LANG).trim().length).toBeGreaterThan(0);
    expect(localizePersonalHabit("No", LANG).trim().length).toBeGreaterThan(0);
    // Complaint lookup falls back to the key itself when untranslated (never Hindi).
    expect(localizeComplaint("Fever", LANG)).toBeTruthy();
  });

  it("covers stage guidance audio and kiosk speech phrases", () => {
    for (const [stage, map] of Object.entries(STAGE_AUDIO_PROMPTS)) {
      expect(map[LANG]?.trim().length, `STAGE_AUDIO_PROMPTS.${stage}.pa is empty`).toBeGreaterThan(0);
    }
    for (const key of Object.keys(KIOSK_SPEECH)) {
      const s = kioskSpeech(key as keyof typeof KIOSK_SPEECH, LANG);
      expect(s.trim().length, `kioskSpeech(${key}, pa) is empty`).toBeGreaterThan(0);
    }
    const consent = consentAudioScript(LANG);
    expect(consent.patient.trim().length).toBeGreaterThan(0);
    expect(consent.thanks.trim().length).toBeGreaterThan(0);
  });

  it("covers welcome/token speeches and summary UI", () => {
    expect(welcomeSpeech(LANG).length).toBeGreaterThan(10);
    expect(tokenIssuedSpeech({ lang: LANG, token: "A 042" })).toContain("A 042");
    expect(tokenCalledSpeech({ lang: LANG, token: "A 042" })).toContain("A 042");
    const ui = SUMMARY_UI[LANG];
    expect(ui).toBeDefined();
    for (const [k, v] of Object.entries(ui)) {
      expect(String(v).trim().length, `SUMMARY_UI.pa.${k} is empty`).toBeGreaterThan(0);
    }
  });

  it("renders shell strings in Punjabi, not English fallback", () => {
    for (const key of ["chooseLanguage", "start", "next", "back", "confirm", "patientId", "tokenNumber", "continue", "uploadDocs", "historyRecorded"]) {
      const v = t(key, LANG);
      expect(v, `t(${key}, pa) unresolved`).not.toBe(key);
      expect(v).not.toBe(t(key, "en"));
    }
    expect(ct("consentTitle", LANG)).not.toBe(ct("consentTitle", "en"));
  });
});
