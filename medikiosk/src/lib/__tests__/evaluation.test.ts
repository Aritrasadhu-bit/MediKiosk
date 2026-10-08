import { describe, expect, it } from "vitest";
import { evaluateRedFlags, evaluateVitalsRedFlags } from "@/lib/redflags";
import { escalationPolicy } from "@/lib/escalation";
import { buildTemplateSummary } from "@/lib/summarizer";
import { heuristicExtract } from "@/lib/extractor";
import type { StoredHistory } from "@/lib/types";

/**
 * Evaluation harness: scripted clinical cases with expected outcomes.
 *
 * Doubles as the judges' evidence table (run with --reporter=verbose and the
 * console table below prints) and as a CI regression gate — if triage starts
 * missing emergencies or the summary drops sections, this file fails first.
 *
 * Three batteries:
 *   1. red-flag catch rate — scripted presentations → expected severity/flow
 *   2. history completeness — a full capture must render every section, a
 *      sparse one must mark gaps explicitly (never silently blank)
 *   3. OCR extraction — fixture document texts → expected entities
 */

function history(overrides: Partial<StoredHistory["history"]> = {}) {
  return {
    name: "Eval Patient",
    age: 45,
    sex: "Male",
    chiefComplaint: "chest pain",
    hpi: "2 hours",
    pastMedical: [],
    pastSurgical: [],
    medications: [],
    allergies: [],
    familyHistory: "",
    personalHistory: "",
    reviewOfSystems: [],
    priorInvestigations: [],
    ...overrides,
  };
}

function encounter(overrides: Partial<StoredHistory> = {}): StoredHistory {
  return {
    encounterId: "eval-1",
    updatedAt: "2026-09-01T00:00:00.000Z",
    enteredAt: "2026-09-01T00:00:00.000Z",
    mode: "allopathic",
    patient: { name: "Eval Patient", age: 45, sex: "Male", abhaId: "11-0000-0001-2349", department: "General Medicine" },
    history: history(),
    documents: [],
    redFlags: [],
    interactions: [],
    audit: [],
    summary: "",
    consentGranted: true,
    status: "pending",
    ...overrides,
  };
}

const RED_FLAG_CASES: Array<{
  name: string;
  text?: string;
  vitals?: Record<string, number>;
  expectEscalation: "er" | "triage" | "normal";
  expectFlagged: boolean;
}> = [
  {
    // Policy note: severe text-only red flags route to TRIAGE (nurse
    // fast-track), never straight to ER — the problem statement specifies a
    // "priority alert to triage staff". Whether stroke/chest-pain patterns
    // deserve auto-ER is an open clinical-policy question for medical review,
    // not something this harness decides unilaterally.
    name: "crushing chest pain with breathlessness → triage fast-track",
    text: "crushing chest pain with breathlessness for 1 hour",
    expectEscalation: "triage",
    expectFlagged: true,
  },
  {
    name: "stroke symptoms (slurred speech, face droop) → triage fast-track",
    text: "slurred speech and face droop since morning",
    expectEscalation: "triage",
    expectFlagged: true,
  },
  {
    name: "hypoxia SpO2 88 → ER",
    vitals: { spo2: 88 },
    expectEscalation: "er",
    expectFlagged: true,
  },
  {
    name: "hypertensive crisis 210/130 → ER",
    vitals: { systolic: 210, diastolic: 130 },
    expectEscalation: "er",
    expectFlagged: true,
  },
  {
    name: "severe hypertension 170/105, SpO2 93 → triage, not ER",
    vitals: { systolic: 170, diastolic: 105, spo2: 93 },
    expectEscalation: "triage",
    expectFlagged: true,
  },
  {
    // MEWS stacking: pulse 132 scores 3 (>129) + temp 39.5 scores 2 = 5, which
    // the engine defines as critically high (≥5 → ER). Correct per policy.
    name: "high fever 39.5 + tachycardia 132 → ER on MEWS 5",
    vitals: { temperature: 39.5, pulse: 132 },
    expectEscalation: "er",
    expectFlagged: true,
  },
  {
    name: "routine headache, normal vitals → normal flow",
    text: "mild headache for 2 days",
    vitals: { systolic: 118, diastolic: 76, pulse: 72, spo2: 98, temperature: 36.8 },
    expectEscalation: "normal",
    expectFlagged: false,
  },
];

describe("evaluation: red-flag catch rate", () => {
  const results: Array<{ case: string; escalation: string; flagged: boolean; pass: boolean }> = [];

  for (const c of RED_FLAG_CASES) {
    it(`${c.expectFlagged ? "catches" : "clears"}: ${c.name}`, () => {
      const textFlags = c.text ? evaluateRedFlags(c.text, c.text) : [];
      const vitalsFlags = evaluateVitalsRedFlags(
        { ...(c.vitals ?? {}), } as Parameters<typeof evaluateVitalsRedFlags>[0],
        45
      );
      const flagged = textFlags.length + vitalsFlags.length > 0;
      const enc = encounter({
        history: history({ chiefComplaint: c.text ?? "checkup" }),
        redFlags: [...textFlags, ...vitalsFlags],
        patient: {
          name: "Eval Patient",
          age: 45,
          sex: "Male",
          abhaId: "11-0000-0001-2349",
          department: "General Medicine",
          vitals: c.vitals as StoredHistory["patient"]["vitals"],
        },
      });
      const level = escalationPolicy(enc).level;
      const pass = flagged === c.expectFlagged && level === c.expectEscalation;
      results.push({ case: c.name, escalation: level, flagged, pass });
      expect(flagged).toBe(c.expectFlagged);
      expect(level).toBe(c.expectEscalation);
    });
  }

  it("prints the evidence table", () => {
    const caught = results.filter((r) => r.pass).length;
    console.log(`\nred-flag battery: ${caught}/${results.length} cases behave as specified`);
    for (const r of results) {
      console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.case} → ${r.escalation}, flagged=${r.flagged}`);
    }
    expect(caught).toBe(results.length);
  });
});

describe("evaluation: history completeness", () => {
  const REQUIRED_SECTIONS = [
    "CHIEF COMPLAINT",
    "HISTORY OF PRESENT ILLNESS",
    "PAST MEDICAL HISTORY",
    "PAST SURGICAL HISTORY",
    "CURRENT MEDICATIONS",
    "ALLERGIES",
    "FAMILY HISTORY",
    "PERSONAL HISTORY",
  ];

  it("renders every section for a full capture", () => {
    const out = buildTemplateSummary({
      history: history({
        pastMedical: [{ condition: "Diabetes" }],
        pastSurgical: [{ procedure: "Appendectomy" }],
        medications: [{ name: "Metformin" }],
        allergies: [{ substance: "Penicillin" }],
        familyHistory: "Father diabetic",
        personalHistory: "Non-smoker",
      }),
      mode: "allopathic",
      documents: [],
      redFlags: [],
    });
    for (const s of REQUIRED_SECTIONS) {
      expect(out, `missing section ${s}`).toContain(s);
    }
    expect(out).toContain("Metformin");
  });

  it("marks gaps explicitly instead of leaving blanks", () => {
    const out = buildTemplateSummary({
      history: history({ chiefComplaint: "", hpi: "" }),
      mode: "allopathic",
      documents: [],
      redFlags: [],
    });
    expect(out).toMatch(/Not stated|Not elicited|None documented|None known/);
  });
});

describe("evaluation: OCR extraction fixtures", () => {
  const FIXTURES: Array<{ name: string; text: string; filename: string; expectMed?: string; expectTest?: string }> = [
    {
      name: "printed prescription",
      text: "Dr. Sharma\nTab. Metformin 500mg BD\nTab. Amlodipine 5mg OD\nReview after 1 month with reports.",
      filename: "rx.jpg",
      expectMed: "metformin",
    },
    {
      name: "lab report with abnormal sugar",
      text: "Fasting Blood Sugar: 168 mg/dL\nHemoglobin: 13.5 g/dL",
      filename: "lab.pdf",
      expectTest: "Fasting Blood Sugar",
    },
    {
      name: "discharge summary",
      text: "Discharge Summary: admitted with pneumonia, treated with Azithromycin. Follow up in OPD.",
      filename: "discharge.pdf",
      expectMed: "azithromycin",
    },
  ];

  for (const f of FIXTURES) {
    it(`extracts entities: ${f.name}`, () => {
      const ent = heuristicExtract(f.text, f.filename);
      if (f.expectMed) {
        expect(
          ent.entities.medications.map((m) => m.name.toLowerCase()),
          "medication missed"
        ).toContain(f.expectMed);
      }
      if (f.expectTest) {
        expect(
          ent.entities.investigations.map((i) => i.test),
          "investigation missed"
        ).toContain(f.expectTest);
      }
    });
  }
});
