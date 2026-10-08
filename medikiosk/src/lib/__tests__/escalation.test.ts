import { describe, expect, it } from "vitest";
import { escalationPolicy } from "@/lib/escalation";
import type { Patient, StoredHistory } from "@/lib/types";

function mkEnc(
  over: Partial<Omit<StoredHistory, "patient">> & { encounterId: string; patient?: Partial<Patient> }
): StoredHistory {
  return {
    encounterId: over.encounterId,
    updatedAt: new Date().toISOString(),
    patient: {
      abhaId: "11-0000-0001-2349",
      name: "Test",
      age: over.patient?.age ?? 55,
      sex: "Female",
      department: "General Medicine",
      ...(over.patient ?? {}),
    },
    mode: "allopathic",
    enteredAt: new Date().toISOString(),
    history: {
      name: "Test",
      age: 55,
      sex: "Female",
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
    },
    documents: [],
    redFlags: over.redFlags ?? [],
    interactions: [],
    summary: "",
    consentGranted: true,
    status: over.status ?? "pending",
    audit: [],
  };
}

describe("escalationPolicy", () => {
  it("normal when vitals are within safe bounds", () => {
    const r = escalationPolicy(
      mkEnc({
        encounterId: "a",
        patient: { vitals: { systolic: 128, diastolic: 80, pulse: 78, spo2: 98, temperature: 37.1 } },
      })
    );
    expect(r.level).toBe("normal");
    expect(r.notify).toBe(false);
    expect(r.score).toBe(0);
  });

  it("er on hypoxia (SpO2 < 90)", () => {
    const r = escalationPolicy(
      mkEnc({ encounterId: "b", patient: { vitals: { spo2: 88, pulse: 100, systolic: 120 } } })
    );
    expect(r.level).toBe("er");
    expect(r.notify).toBe(true);
    expect(r.reasons.join(" ")).toContain("SpO2");
  });

  it("er on MEWS ≥ 5 (high temp + tachy + low O2)", () => {
    const r = escalationPolicy(
      mkEnc({
        encounterId: "c",
        patient: { vitals: { systolic: 100, pulse: 142, spo2: 91, temperature: 39.8 } },
      })
    );
    expect(r.level).toBe("er");
    expect(r.reasons.join(" ")).toContain("MEWS");
  });

  it("triage on borderline values (SpO2 92–93, MEWS 1–2 worth of elevation)", () => {
    const r = escalationPolicy(
      mkEnc({ encounterId: "d", patient: { vitals: { systolic: 118, pulse: 110, spo2: 92, temperature: 37.4 } } })
    );
    expect(r.level).toBe("triage");
    expect(r.notify).toBe(false);
  });

  it("triage on a severe red flag even with normal vitals", () => {
    const r = escalationPolicy(
      mkEnc({
        encounterId: "e",
        patient: { vitals: { systolic: 120, pulse: 80, spo2: 98, temperature: 37.0 } },
        redFlags: [{ id: "r", severity: "high", symptom: "Chest Pain", message: "m", source: "text" }],
      })
    );
    expect(r.level).toBe("triage");
  });

  it("no vitals and no flags → normal with empty reasons", () => {
    const r = escalationPolicy(mkEnc({ encounterId: "f" }));
    expect(r.level).toBe("normal");
    expect(r.reasons).toEqual([]);
  });

  it("extreme hypotension routes to er", () => {
    const r = escalationPolicy(
      mkEnc({ encounterId: "g", patient: { vitals: { systolic: 70, pulse: 96, spo2: 97 } } })
    );
    expect(r.level).toBe("er");
  });
});