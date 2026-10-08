import { describe, expect, it } from "vitest";
import { buildTimeline } from "@/lib/timeline";
import type { StoredHistory, MedicalDocument, ClinicalHistory } from "@/lib/types";

/**
 * Medical timeline merging (Module B: chronological organization).
 *
 * The physician needs one spine — visits, prescriptions, documents, alerts —
 * not four places to hunt. These tests pin the merge, the ordering and the
 * document dedupe.
 */

const baseHistory: ClinicalHistory = {
  name: "Ramesh Kumar",
  age: 58,
  sex: "Male",
  chiefComplaint: "Fever",
  hpi: "2 days",
  pastMedical: [],
  pastSurgical: [],
  medications: [],
  allergies: [],
  familyHistory: "",
  personalHistory: "",
  reviewOfSystems: [],
  priorInvestigations: [],
};

function doc(id: string, filename: string, date: string): MedicalDocument {
  return {
    id,
    filename,
    type: "Lab Report",
    date,
    text: "",
    entities: { diagnoses: [], medications: [], investigations: [], procedures: [] },
    abnormalValues: [],
  };
}

function encounter(id: string, enteredAt: string, overrides: Partial<StoredHistory> = {}): StoredHistory {
  return {
    encounterId: id,
    updatedAt: enteredAt,
    enteredAt,
    mode: "allopathic",
    patient: {
      name: "Ramesh Kumar",
      age: 58,
      sex: "Male",
      abhaId: "11-0000-0001-2349",
      department: "General Medicine",
    },
    history: baseHistory,
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

describe("buildTimeline", () => {
  it("emits a visit event with complaint and diagnosis", () => {
    const e = encounter("enc-1", "2026-09-01T10:00:00.000Z", { doctorDiagnosis: "Viral fever" });
    const [visit] = buildTimeline(e, []);
    expect(visit.kind).toBe("visit");
    expect(visit.title).toContain("Fever");
    expect(visit.detail).toContain("Viral fever");
  });

  it("orders newest-first across visits", () => {
    const current = encounter("enc-2", "2026-09-10T10:00:00.000Z");
    const older = encounter("enc-1", "2026-09-01T10:00:00.000Z");
    const events = buildTimeline(current, [older]);
    expect(events[0].encounterId).toBe("enc-2");
    expect(events[events.length - 1].encounterId).toBe("enc-1");
  });

  it("adds prescription and alert events per encounter", () => {
    const e = encounter("enc-1", "2026-09-01T10:00:00.000Z", {
      prescription: {
        medications: [{ name: "Paracetamol", dosage: "500mg" }],
        diagnosis: "Fever",
      },
      redFlags: [{ id: "rf-1", severity: "high", symptom: "High fever", message: "Temp 40.2", source: "vitals" }],
    });
    const kinds = buildTimeline(e, []).map((ev) => ev.kind);
    expect(kinds).toContain("prescription");
    expect(kinds).toContain("alert");
  });

  it("dedupes a scan attached to several visits", () => {
    const scan = doc("doc-1", "lab.pdf", "2026-08-20");
    const current = encounter("enc-2", "2026-09-10T10:00:00.000Z", { documents: [scan] });
    const older = encounter("enc-1", "2026-09-01T10:00:00.000Z", { documents: [scan] });
    const docs = buildTimeline(current, [older]).filter((ev) => ev.kind === "document");
    expect(docs).toHaveLength(1);
  });

  it("dates document events by the document date, not the visit", () => {
    const scan = doc("doc-9", "old.pdf", "2026-01-05");
    const e = encounter("enc-1", "2026-09-01T10:00:00.000Z", { documents: [scan] });
    const [first] = buildTimeline(e, []);
    // Newest-first: the September visit sorts above its January document.
    expect(first.kind).toBe("visit");
    const docEvent = buildTimeline(e, []).find((ev) => ev.kind === "document");
    expect(docEvent?.at).toBe("2026-01-05");
  });

  it("never shares keys between events", () => {
    const e = encounter("enc-1", "2026-09-01T10:00:00.000Z", {
      prescription: { medications: [{ name: "Aspirin" }] },
      redFlags: [{ id: "rf-1", severity: "medium", symptom: "BP", message: "High", source: "vitals" }],
    });
    const keys = buildTimeline(e, []).map((ev) => ev.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
