import { describe, expect, it } from "vitest";
import { buildReferralSlip, referralToText } from "@/lib/referral";
import type { StoredHistory } from "@/lib/types";

function dangerEncounter(): StoredHistory {
  return {
    encounterId: "enc-danger-1",
    updatedAt: new Date().toISOString(),
    enteredAt: new Date().toISOString(),
    mode: "allopathic",
    token: "TK-7777",
    patient: {
      name: "Sunita Devi",
      age: 62,
      sex: "Female",
      abhaId: "11-0000-0000-0002",
      mobile: "9876543210",
      department: "Cardiology",
      vitals: { systolic: 168, diastolic: 104, pulse: 118, spo2: 88, temperature: 38.2 },
    },
    history: {
      name: "Sunita Devi",
      age: 62,
      sex: "Female",
      chiefComplaint: "Chest pain",
      hpi: "Chest tightness radiating to left arm.",
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
    redFlags: [{ id: "rf1", severity: "high", symptom: "Chest pain", message: "MEWS high" }],
    interactions: [],
    audit: [],
    summary: "Chest pain, hypertensive.",
    consentGranted: true,
    status: "pending",
  };
}

describe("referral slip (Batch B, U7)", () => {
  it("builds an ER referral with destination, reasons and snapshot", () => {
    const slip = buildReferralSlip(dangerEncounter());
    expect(slip.id.startsWith("REF-TK-7777-")).toBe(true);
    expect(slip.to).toBe("Emergency Department");
    expect(slip.patientName).toBe("Sunita Devi");
    expect(slip.vitals?.systolic).toBe(168);
    expect(slip.reasons.length).toBeGreaterThan(0);
    expect(slip.fromDepartment).toBe("Cardiology");
  });

  it("renders a printable text block that carries the decision info", () => {
    const slip = buildReferralSlip(dangerEncounter());
    const text = referralToText(slip);
    expect(text).toContain("MEDIKIOSK REFERRAL SLIP");
    expect(text).toContain(slip.id);
    expect(text).toContain("Emergency Department");
    expect(text).toContain("MEWS");
  });

  it("survives an encounter with no vitals or summary (graceful)", () => {
    const bare: StoredHistory = {
      ...dangerEncounter(),
      patient: { ...dangerEncounter().patient, vitals: undefined },
      summary: "",
      redFlags: [],
      history: { ...dangerEncounter().history, chiefComplaint: "" },
    };
    const slip = buildReferralSlip(bare);
    const text = referralToText(slip);
    expect(slip.id).toBeTruthy();
    expect(text).toContain("(none recorded)");
  });
});