import { describe, expect, it } from "vitest";
import { buildFallbackAiPanel, parseDictatedRx, suggestedDifferentials, stdSuggestedQuestions } from "@/lib/clinical";
import type { StoredHistory } from "@/lib/types";

function mkEnc(
  over: Partial<Omit<StoredHistory, "patient" | "history">> & {
    encounterId: string;
    patient?: Partial<StoredHistory["patient"]>;
    history?: Partial<StoredHistory["history"]>;
  }
): StoredHistory {
  return {
    encounterId: over.encounterId,
    updatedAt: new Date().toISOString(),
    patient: {
      abhaId: "11-0000-0001-2349",
      name: "Test",
      age: 40,
      sex: "Male",
      department: "General Medicine",
      ...(over.patient ?? {}),
    },
    mode: "allopathic",
    enteredAt: new Date().toISOString(),
    history: {
      name: "Test",
      age: 40,
      sex: "Male",
      chiefComplaint: "Fever",
      hpi: "",
      pastMedical: [],
      pastSurgical: [],
      medications: [],
      allergies: [],
      familyHistory: "",
      personalHistory: "",
      reviewOfSystems: [],
      priorInvestigations: [],
      ...(over.history ?? {}),
    },
    documents: [],
    redFlags: over.redFlags ?? [],
    interactions: [],
    summary: over.summary ?? "",
    consentGranted: true,
    status: "pending",
    audit: [],
  };
}

describe("suggestedDifferentials / stdSuggestedQuestions", () => {
  it("maps chest pain to cardiac + respiratory differentials", () => {
    const h = mkEnc({ encounterId: "a", history: { chiefComplaint: "Chest Pain" } });
    expect(suggestedDifferentials(h).join(" ")).toMatch(/coronary|pleurisy|gerd/i);
    expect(stdSuggestedQuestions(h).join(" ")).toMatch(/exertional|radiat/i);
  });

  it("adds pregnancy question for female patients with fever", () => {
    const h = mkEnc({ encounterId: "b", patient: { sex: "Female" }, history: { chiefComplaint: "Fever" } });
    expect(stdSuggestedQuestions(h).join(" ")).toMatch(/pregnancy/i);
  });

  it("flags urgent review when a severe red flag exists", () => {
    const h = mkEnc({
      encounterId: "c",
      redFlags: [{ id: "r", severity: "high", symptom: "Stroke", message: "m", source: "text" }],
    });
    expect(stdSuggestedQuestions(h).join(" ")).toMatch(/urgent review|urgent/i);
  });

  it("buildFallbackAiPanel returns hinted=false shape", () => {
    const p = buildFallbackAiPanel(mkEnc({ encounterId: "d", history: { chiefComplaint: "Headache" } }));
    expect(p.hinted).toBe(false);
    expect(p.differentials.length).toBeGreaterThan(0);
    expect(p.suggestedQuestions.length).toBeGreaterThan(0);
  });
});

describe("parseDictatedRx", () => {
  it("parses a multiline dictated prescription", () => {
    const items = parseDictatedRx(
      "Tab paracetamol 500mg tds for 5 days; Tab amoxicillin 500mg bd for 7 days after meals"
    );
    expect(items.length).toBe(2);
    expect(items[0]).toMatchObject({ name: "paracetamol", dosage: "500mg", frequency: "thrice daily", duration: "5 days" });
    expect(items[1].name).toBe("amoxicillin");
    expect(items[1].frequency).toBe("twice daily");
  });

  it("ignores non-medication lines (history/notes)", () => {
    const items = parseDictatedRx("patient is stable. Tab dolo 650mg bd sos for pain");
    expect(items.length).toBe(1);
    expect(items[0].name).toBe("dolo");
    expect(items[0].dosage).toBe("650mg");
  });

  it("handles q8h notation", () => {
    const items = parseDictatedRx("Inj insulin 10 units q8h");
    expect(items[0].frequency).toContain("every 8 hours");
  });

  it("returns [] for empty/garbage input", () => {
    expect(parseDictatedRx("")).toEqual([]);
    expect(parseDictatedRx("I am fine today")).toEqual([]);
  });
});

describe("getDepartmentQuestions", () => {
  it("returns specialty-specific questions for all registered departments", async () => {
    const { getDepartmentQuestions } = await import("@/lib/data");

    expect(getDepartmentQuestions("Cardiology")[0].category).toBe("Cardiology HPI");
    expect(getDepartmentQuestions("Orthopaedics")[0].category).toBe("Orthopaedics HPI");
    expect(getDepartmentQuestions("Dermatology")[0].category).toBe("Dermatology HPI");
    expect(getDepartmentQuestions("ENT")[0].category).toBe("ENT HPI");
    expect(getDepartmentQuestions("Ophthalmology")[0].category).toBe("Ophthalmology HPI");
    expect(getDepartmentQuestions("Paediatrics")[0].category).toBe("Paediatrics HPI");
    expect(getDepartmentQuestions("Gynaecology & Obstetrics")[0].category).toBe("Gynaecology HPI");
    expect(getDepartmentQuestions("Neurology")[0].category).toBe("Neurology HPI");
    expect(getDepartmentQuestions("Pulmonology")[0].category).toBe("Pulmonology HPI");
    expect(getDepartmentQuestions("Gastroenterology")[0].category).toBe("Gastroenterology HPI");
    expect(getDepartmentQuestions("Nephrology")[0].category).toBe("Nephrology HPI");
    expect(getDepartmentQuestions("Endocrinology")[0].category).toBe("Endocrinology HPI");
    expect(getDepartmentQuestions("Psychiatry")[0].category).toBe("Psychiatry HPI");
    expect(getDepartmentQuestions("Surgery")[0].category).toBe("Surgery HPI");
    expect(getDepartmentQuestions("Dentistry")[0].category).toBe("Dentistry HPI");
    expect(getDepartmentQuestions("AYUSH - Ayurveda (General)")[0].category).toBe("AYUSH HPI");
    expect(getDepartmentQuestions("General Medicine")[0].category).toBe("HPI - SOCRATES");
  });
});

describe("getDepartmentClinicalGuidance", () => {
  it("provides tailored clinical guidance for every OPD department", async () => {
    const { getDepartmentClinicalGuidance } = await import("@/app/api/converse/route");
    const { DEPARTMENTS } = await import("@/lib/data");

    for (const dept of DEPARTMENTS) {
      const guidance = getDepartmentClinicalGuidance(dept);
      expect(guidance).toBeTruthy();
      expect(typeof guidance).toBe("string");
      expect(guidance.length).toBeGreaterThan(30);
    }

    expect(getDepartmentClinicalGuidance("Cardiology")).toContain("Cardiology");
    expect(getDepartmentClinicalGuidance("Neurology")).toContain("Neurology");
    expect(getDepartmentClinicalGuidance("Pulmonology")).toContain("Pulmonology");
    expect(getDepartmentClinicalGuidance("Gastroenterology")).toContain("Gastroenterology");
    expect(getDepartmentClinicalGuidance("Nephrology")).toContain("Nephrology");
    expect(getDepartmentClinicalGuidance("Endocrinology")).toContain("Endocrinology");
    expect(getDepartmentClinicalGuidance("Orthopaedics")).toContain("Orthopaedics");
    expect(getDepartmentClinicalGuidance("Dermatology")).toContain("Dermatology");
    expect(getDepartmentClinicalGuidance("ENT")).toContain("ENT");
    expect(getDepartmentClinicalGuidance("Ophthalmology")).toContain("Ophthalmology");
    expect(getDepartmentClinicalGuidance("Paediatrics")).toContain("Paediatrics");
    expect(getDepartmentClinicalGuidance("Gynaecology & Obstetrics")).toContain("Gynaecology");
    expect(getDepartmentClinicalGuidance("Psychiatry")).toContain("Psychiatry");
    expect(getDepartmentClinicalGuidance("Surgery")).toContain("Surgery");
    expect(getDepartmentClinicalGuidance("Dentistry")).toContain("Dentistry");
    expect(getDepartmentClinicalGuidance("AYUSH - Panchakarma")).toContain("Panchakarma");
    expect(getDepartmentClinicalGuidance("AYUSH - Yoga & Naturopathy")).toContain("Yoga & Naturopathy");
    expect(getDepartmentClinicalGuidance("AYUSH - Ayurveda (General)")).toContain("Ayurveda");
    expect(getDepartmentClinicalGuidance("General Medicine")).toContain("General Medicine");
  });
});