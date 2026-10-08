import { describe, expect, it } from "vitest";
import { assembleSummary, assembleSummaryHi, buildTemplateSummary, renderAfterVisit } from "@/lib/summarizer";
import type { StoredHistory } from "@/lib/types";

const minimal = {
  history: { name: "Sunita Devi", age: 42, sex: "Female", chiefComplaint: "Headache", hpi: "3 days", pastMedical: [], pastSurgical: [], medications: [], allergies: [], familyHistory: "", personalHistory: "", reviewOfSystems: [], priorInvestigations: [] },
  mode: "allopathic",
  documents: [],
  redFlags: [],
};

describe("summary provenance labelling", () => {
  // The audit finding: the deterministic path is string assembly, not a
  // language model, and the old footer claimed "MediKiosk AI" for both.
  it("labels the offline path as a rules engine, not AI", () => {
    const out = buildTemplateSummary(minimal);
    expect(out).toContain("rules engine");
    expect(out).toContain("deterministic");
    expect(out).not.toMatch(/MediKiosk AI/i);
  });

  it("labels the LLM path as model-drafted and awaiting physician sign-off", () => {
    const out = assembleSummary(minimal, true, "Model narrative.");
    expect(out).toContain("language model");
    expect(out).toContain("reviewed and signed off by the treating physician");
    expect(out).not.toContain("rules engine");
  });

  it("keeps the structured record alongside the model narrative", () => {
    const out = assembleSummary(minimal, true, "Model says the patient has a headache.");
    expect(out).toContain("Model says the patient has a headache.");
    // The verifiable capture must survive so a clinician can check the draft.
    expect(out).toContain("CHIEF COMPLAINT");
    expect(out).toContain("Headache");
    expect(out.indexOf("Model says")).toBeLessThan(out.indexOf("CHIEF COMPLAINT"));
  });

  it("omits the narrative block when the model returned nothing", () => {
    const out = assembleSummary(minimal, true, "   ");
    expect(out).not.toContain("DRAFT NARRATIVE");
    expect(out).toContain("CHIEF COMPLAINT");
  });
});

describe("buildTemplateSummary", () => {
  it("renders a complete allopathic history", () => {
    const out = buildTemplateSummary({
      history: {
        name: "Sunita Devi",
        age: 42,
        sex: "Female",
        chiefComplaint: "Headache",
        hpi: "3 days",
        pastMedical: [{ condition: "Hypertension" }],
        pastSurgical: [],
        medications: [{ name: "Amlodipine" }],
        allergies: [],
        familyHistory: "Mother diabetic",
        personalHistory: "Non-smoker",
        reviewOfSystems: [],
        priorInvestigations: [],
        menstrualHistory: "Regular",
      },
      mode: "allopathic",
      documents: [],
      redFlags: [],
    });
    expect(out).toContain("CHIEF COMPLAINT");
    expect(out).toContain("Sunita Devi");
    expect(out).toContain("MENSTRUAL HISTORY");
    expect(out).toContain("Amlodipine");
    expect(out).toContain("Allopathic");
  });

  it("does NOT throw on a partial/minimal history (regression: pastMedical access)", () => {
    const out = buildTemplateSummary({
      history: { chiefComplaint: "fever" } as never,
      mode: "allopathic",
      documents: [],
      redFlags: [],
    });
    expect(out).toContain("CHIEF COMPLAINT");
    expect(out).toContain("fever");
    expect(out).toContain("None documented");
  });

  it("marks high-severity red flags with [HIGH]", () => {
    const out = buildTemplateSummary({
      history: { name: "R", age: 60, sex: "Male", chiefComplaint: "dyspnoea", hpi: "", pastMedical: [], pastSurgical: [], medications: [], allergies: [], familyHistory: "", personalHistory: "", reviewOfSystems: [], priorInvestigations: [] },
      mode: "allopathic",
      documents: [],
      redFlags: [{ id: "rf-1", severity: "high", symptom: "Chest Pain", message: "Possible cardiac event", source: "text" }],
    });
    expect(out).toContain("[HIGH] Chest Pain");
  });

  it("prints medium-severity red flags instead of dropping them", () => {
    // Regression: the section printed its header for any severity but only
    // listed `high` flags, so a medium-only record (e.g. BP 170/105) produced
    // an empty section and the flag vanished from the physician handoff.
    const out = buildTemplateSummary({
      history: { name: "R", age: 60, sex: "Male", chiefComplaint: "headache", hpi: "", pastMedical: [], pastSurgical: [], medications: [], allergies: [], familyHistory: "", personalHistory: "", reviewOfSystems: [], priorInvestigations: [] },
      mode: "allopathic",
      documents: [],
      redFlags: [{ id: "vit-bp-severe", severity: "medium", symptom: "Severe hypertension", message: "BP ≥ 160/100", source: "vitals" }],
    });
    expect(out).toContain("[MEDIUM] Severe hypertension");
  });

  it("appends the guardian respondent context", () => {
    const out = buildTemplateSummary({
      history: { name: "Baba", age: 70, sex: "Male", chiefComplaint: "joint pain", hpi: "", pastMedical: [], pastSurgical: [], medications: [], allergies: [], familyHistory: "", personalHistory: "", reviewOfSystems: [], priorInvestigations: [] },
      mode: "allopathic",
      documents: [],
      redFlags: [],
      guardian: { name: "Anil", relation: "Son" },
    });
    expect(out).toContain("history given by Anil, Son");
  });
});

describe("renderAfterVisit", () => {
  it("builds a printable handout with diagnosis and prescription", () => {
    const h = {
      encounterId: "ENC-1",
      updatedAt: "2026-09-20T10:00:00.000Z",
      enteredAt: "2026-09-20T09:00:00.000Z",
      status: "confirmed",
      mode: "allopathic",
      consentGranted: true,
      token: "TK-1",
      patient: { abhaId: "12-3456-7890-1234", name: "Sunita Devi", age: 42, sex: "Female", department: "General Medicine" },
      history: { name: "Sunita Devi", age: 42, sex: "Female", chiefComplaint: "Headache", hpi: "", pastMedical: [], pastSurgical: [], medications: [], allergies: [], familyHistory: "", personalHistory: "", reviewOfSystems: [], priorInvestigations: [] },
      documents: [],
      redFlags: [],
      interactions: [],
      audit: [],
      summary: "Draft summary",
      doctorDiagnosis: "Migraine",
      doctorNote: "Rest, hydration.",
      prescription: { medications: [{ name: "Paracetamol", dosage: "650mg", frequency: "TDS" }], advice: "Avoid stress" },
    } as StoredHistory;
    const out = renderAfterVisit(h);
    expect(out).toContain("Migraine");
    expect(out).toContain("Rest, hydration");
    expect(out).toContain("Paracetamol");
    expect(out).toContain("Avoid stress");
    expect(out).toContain("After Visit");
  });
});

describe("hindi summary (assembleSummaryHi)", () => {
  const input = {
    history: { name: "Ramesh Kumar", age: 58, sex: "Male", chiefComplaint: "Chest pain", hpi: "2 hours", pastMedical: [], pastSurgical: [], medications: [{ name: "Metformin", dosage: "500mg" }], allergies: [], familyHistory: "", personalHistory: "", reviewOfSystems: [], priorInvestigations: [] },
    mode: "allopathic",
    documents: [],
    redFlags: [{ id: "rf-1", severity: "high" as const, symptom: "Chest Pain", message: "urgent", source: "text" as const }],
  };

  it("renders Hindi scaffolding with verbatim clinical content", () => {
    const out = assembleSummaryHi(input, false);
    expect(out).toContain("मुख्य शिकायत:");
    expect(out).toContain("वर्तमान बीमारी का विवरण:");
    expect(out).toContain("[उच्च] Chest Pain");
    // Drug names, dosages and captured prose render verbatim — never translated.
    expect(out).toContain("Metformin 500mg");
    expect(out).toContain("Chest pain");
  });

  it("marks gaps in Hindi instead of blanks", () => {
    const out = assembleSummaryHi({ ...input, history: { ...input.history, chiefComplaint: "", hpi: "" } }, false);
    expect(out).toContain("नहीं बताया");
  });

  it("labels the offline path honestly in Hindi", () => {
    const out = assembleSummaryHi(input, false);
    expect(out).toContain("नियम इंजन");
    expect(out).not.toContain("language model");
  });
});
