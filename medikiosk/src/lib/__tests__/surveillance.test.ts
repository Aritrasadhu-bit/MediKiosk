import { describe, expect, it } from "vitest";
import { buildSurveillance, findClusterAlerts, syndromesOf } from "@/lib/surveillance";
import type { StoredHistory } from "@/lib/types";

function mockEncounter(id: string, enteredAt: string, chiefComplaint: string, department = "General Medicine"): StoredHistory {
  return {
    encounterId: id,
    updatedAt: enteredAt,
    enteredAt,
    mode: "allopathic",
    patient: {
      name: "Test Patient",
      age: 30,
      sex: "Male",
      abhaId: "11-0000-0000-0001",
      department,
    },
    history: {
      name: "Test Patient",
      age: 30,
      sex: "Male",
      chiefComplaint,
      hpi: chiefComplaint,
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
    redFlags: [],
    interactions: [],
    audit: [],
    summary: chiefComplaint,
    consentGranted: true,
    status: "pending",
  };
}

describe("surveillance", () => {
  it("identifies syndromes correctly", () => {
    const enc = mockEncounter("e1", new Date().toISOString(), "High grade fever with severe cough and chills");
    const syndromes = syndromesOf(enc);
    expect(syndromes).toContain("fever");
    expect(syndromes).toContain("respiratory");
  });

  it("does not count a unit-mismatched temperature as fever", () => {
    // 98.4 typed in °F-as-°C is implausible and must not poison the outbreak
    // signal — the triage engine already excludes it via plausibleTemp.
    const enc = mockEncounter("e1", new Date().toISOString(), "Routine checkup");
    enc.patient.vitals = { temperature: 98.4 };
    expect(syndromesOf(enc)).not.toContain("fever");
  });

  it("still infers fever from a genuinely febrile reading", () => {
    const enc = mockEncounter("e1", new Date().toISOString(), "Routine checkup");
    enc.patient.vitals = { temperature: 39.2 };
    expect(syndromesOf(enc)).toContain("fever");
  });

  it("detects cluster outbreak alerts when >=3 matching cases occur within window", () => {
    const base = Date.now();
    const encounters = [
      mockEncounter("e1", new Date(base).toISOString(), "Acute diarrhea and vomiting", "Paediatrics"),
      mockEncounter("e2", new Date(base + 10 * 60 * 1000).toISOString(), "Watery stool and abdominal pain", "Paediatrics"),
      mockEncounter("e3", new Date(base + 25 * 60 * 1000).toISOString(), "Loose motions with vomiting", "Paediatrics"),
    ];

    const alerts = findClusterAlerts(encounters);
    expect(alerts.length).toBeGreaterThan(0);
    const giAlert = alerts.find((a) => a.key === "gi");
    expect(giAlert).toBeDefined();
    expect(giAlert?.count).toBe(3);
    expect(giAlert?.department).toBe("Paediatrics");
  });

  it("builds surveillance reports aggregated across departments", () => {
    const now = new Date().toISOString();
    const encounters = [
      mockEncounter("e1", now, "Fever and chills", "General Medicine"),
      mockEncounter("e2", now, "Skin rash and itching", "Dermatology"),
    ];

    const report = buildSurveillance(encounters, 24);
    expect(report.totalEncounters).toBe(2);
    expect(report.buckets.length).toBeGreaterThan(0);
  });
});
