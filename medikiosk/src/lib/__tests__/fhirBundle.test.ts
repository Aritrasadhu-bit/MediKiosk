import { describe, expect, it } from "vitest";
import { toFhirBundle } from "@/lib/fhirBundle";
import type { StoredHistory } from "@/lib/types";

function fixture(overrides: Partial<StoredHistory> = {}): StoredHistory {
  return {
    encounterId: "ENC-0001",
    updatedAt: "2026-09-20T10:00:00.000Z",
    enteredAt: "2026-09-20T09:30:00.000Z",
    status: "pending",
    mode: "allopathic",
    consentGranted: true,
    token: "TK-1042",
    patient: {
      abhaId: "12-3456-7890-1234",
      name: "Sunita Devi",
      age: 42,
      sex: "Female",
      mobile: "9876543210",
      department: "General Medicine",
      vitals: { systolic: 150, diastolic: 96, pulse: 88, temperature: 38.5, spo2: 96 },
    },
    history: {
      name: "Sunita Devi",
      age: 42,
      sex: "Female",
      chiefComplaint: "Headache and fever",
      hpi: "Fever with headache for 3 days.",
      pastMedical: [{ condition: "Hypertension" }],
      pastSurgical: [],
      medications: [{ name: "Amlodipine", dosage: "5mg", frequency: "OD" }],
      allergies: [{ substance: "Penicillin", reaction: "Rash" }],
      familyHistory: "Mother diabetic",
      personalHistory: "No smoking",
      reviewOfSystems: [{ system: "Cardiovascular", positive: "No palpitations" }],
      priorInvestigations: [{ test: "Hemoglobin", value: "12.1", unit: "g/dL", flag: "normal" }],
      menstrualHistory: "Periods: Regular",
    },
    documents: [
      {
        id: "doc-1",
        filename: "old-rx.jpg",
        type: "Other",
        text: "Tab. Enalapril 5mg",
        entities: { diagnoses: [], medications: [{ name: "Enalapril" }], investigations: [], procedures: [] },
        abnormalValues: [],
      },
    ],
    redFlags: [{ id: "rf-0", severity: "medium", symptom: "Fever", message: "Temp 38.5", source: "vitals" }],
    interactions: [],
    summary: "Summary text",
    audit: [{ action: "consent_granted", at: "2026-09-20T09:25:00.000Z" }],
    ...overrides,
  };
}

const entriesOf = (bundle: Record<string, unknown>) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper casting FHIR resources
  bundle.entry as { resource: Record<string, any> }[];

describe("toFhirBundle", () => {
  it("produces an R4 document Bundle", () => {
    const b = toFhirBundle(fixture());
    expect(b.resourceType).toBe("Bundle");
    expect(b.type).toBe("document");
  });

  it("includes Patient with ABHA identifier", () => {
    const b = toFhirBundle(fixture());
    const patient = entriesOf(b).find((e) => e.resource.resourceType === "Patient")!;
    const idents = (patient.resource as { identifier: { system: string; value: string }[] }).identifier;
    expect(idents[0].system).toContain("abdm.gov.in");
    expect(idents[0].value).toBe("12-3456-7890-1234");
  });

  it("includes Encounter tied to the patient", () => {
    const b = toFhirBundle(fixture());
    const enc = entriesOf(b).find((e) => e.resource.resourceType === "Encounter")!;
    // The id must match the Patient resource's own `id` so the reference resolves.
    const patient = entriesOf(b).find((e) => e.resource.resourceType === "Patient")!;
    const patientId = (patient.resource as { id: string }).id;
    expect((enc.resource as { subject: { reference: string } }).subject.reference).toBe(`Patient/${patientId}`);
  });

  it("maps status pending → in-progress, confirmed → finished", () => {
    const pending = toFhirBundle(fixture());
    const e1 = entriesOf(pending).find((e) => e.resource.resourceType === "Encounter")!;
    expect((e1.resource as { status: string }).status).toBe("in-progress");

    const done = toFhirBundle(fixture({ status: "confirmed" }));
    const e2 = entriesOf(done).find((e) => e.resource.resourceType === "Encounter")!;
    expect((e2.resource as { status: string }).status).toBe("finished");
  });

  it("emits vitals as LOINC-coded Observations", () => {
    const b = toFhirBundle(fixture());
    const obs = entriesOf(b).filter((e) => e.resource.resourceType === "Observation");
    const spo2 = obs.find((o) => {
      const code = (o.resource as { code?: { coding?: { code?: string }[] } }).code?.coding?.[0]?.code;
      return code === "59408-5";
    });
    expect(spo2).toBeDefined();
    expect((spo2!.resource as { valueQuantity: { value: number } }).valueQuantity.value).toBe(96);
  });

  it("emits MedicationStatement for current meds", () => {
    const b = toFhirBundle(fixture());
    const ms = entriesOf(b).filter((e) => e.resource.resourceType === "MedicationStatement");
    expect(ms.length).toBeGreaterThanOrEqual(1);
  });

  it("emits AllergyIntolerance", () => {
    const b = toFhirBundle(fixture());
    expect(entriesOf(b).some((e) => e.resource.resourceType === "AllergyIntolerance")).toBe(true);
  });

  it("includes a Composition with menstrual history section for females", () => {
    const b = toFhirBundle(fixture());
    const comp = entriesOf(b).find((e) => e.resource.resourceType === "Composition")!;
    const sections = (comp.resource as { section: { title: string }[] }).section;
    expect(sections.some((s) => s.title === "Menstrual History")).toBe(true);
  });

  it("records the audit trail in Provenance entity entries (R4 has no `note`)", () => {
    const b = toFhirBundle(fixture());
    const prov = entriesOf(b).find((e) => e.resource.resourceType === "Provenance")!;
    const resource = prov.resource as {
      note?: unknown;
      entity: { role: string; what: { display: string } }[];
    };
    // Provenance has no `note` element in R4; audit events live in `entity`.
    expect(resource.note).toBeUndefined();
    expect(resource.entity.some((e) => e.what.display.includes("consent_granted"))).toBe(true);
  });

  it("includes DocumentReference for digitized uploads", () => {
    const b = toFhirBundle(fixture());
    expect(entriesOf(b).some((e) => e.resource.resourceType === "DocumentReference")).toBe(true);
  });

  it("gives every DocumentReference attachment a url or data (R4 invariant doc-1)", () => {
    const b = toFhirBundle(
      fixture({
        documents: [
          {
            id: "doc-1",
            filename: "report.pdf",
            type: "Lab Report",
            text: "HbA1c 7.2",
            mimeType: "application/pdf",
            entities: { diagnoses: [], medications: [], investigations: [], procedures: [] },
            abnormalValues: [],
          },
        ],
      })
    );
    const doc = entriesOf(b).find((e) => e.resource.resourceType === "DocumentReference")!;
    const content = (doc.resource as { content: { attachment: { url?: string; data?: string } }[] }).content;
    expect(content.length).toBeGreaterThan(0);
    for (const c of content) {
      expect(Boolean(c.attachment.url) || Boolean(c.attachment.data)).toBe(true);
    }
  });

  it("emits conformant UUIDs for every urn:uuid: fullUrl", () => {
    const b = toFhirBundle(fixture());
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (const e of entriesOf(b) as Array<{ fullUrl?: string; resource: Record<string, unknown> }>) {
      const fullUrl = e.fullUrl ?? "";
      if (fullUrl?.startsWith("urn:uuid:")) {
        expect(fullUrl.slice("urn:uuid:".length)).toMatch(uuidRe);
      }
    }
  });

  it("uses only idType-valid resource ids ([A-Za-z0-9-])", () => {
    const b = toFhirBundle(
      fixture({ encounterId: "ENC/2026 #7 (a)", history: { ...fixture().history, name: "Sunita Devi" } })
    );
    const idRe = /^[A-Za-z0-9\-.]{1,64}$/;
    for (const e of entriesOf(b)) {
      const id = (e.resource as { id?: string }).id;
      if (id !== undefined) expect(id).toMatch(idRe);
    }
  });

  it("escapes markup in narrative text instead of stripping it", () => {
    // "HbA1c > 6.5" must survive; the old implementation deleted '<' '>' '&'.
    const b = toFhirBundle(
      fixture({
        history: { ...fixture().history, hpi: "HbA1c > 6.5 & rising <7.0" },
      })
    );
    const comp = entriesOf(b).find((e) => e.resource.resourceType === "Composition")!;
    const sections = (comp.resource as { section: { title: string; text: { div: string } }[] }).section;
    const hpi = sections.find((s) => s.title === "History of Present Illness")!;
    expect(hpi.text.div).toContain("&gt;");
    expect(hpi.text.div).toContain("&amp;");
    expect(hpi.text.div).toContain("6.5");
  });

  it("omits empty Composition sections", () => {
    const b = toFhirBundle(fixture());
    const comp = entriesOf(b).find((e) => e.resource.resourceType === "Composition")!;
    const sections = (comp.resource as { section: { text: { div: string } }[] }).section;
    for (const s of sections) {
      expect(s.text.div).not.toBe("<div xmlns=\"http://www.w3.org/1999/xhtml\"></div>");
    }
  });

  it("records the lawful basis (consent scopes) in Provenance", () => {
    const b = toFhirBundle(fixture());
    const prov = entriesOf(b).find((e) => e.resource.resourceType === "Provenance")!;
    const entity = (prov.resource as { entity: { role: string; what: { display: string } }[] }).entity;
    const consent = entity.find((e) => e.role === "derivation");
    expect(consent?.what.display).toContain("Consent:");
  });

  it("records the guardian as author when respondent is guardian", () => {
    const b = toFhirBundle(
      fixture({
        patient: {
          abhaId: "98-7654-3210-0001",
          name: "Ravi Kumar",
          age: 66,
          sex: "Male",
          department: "General Medicine",
          guardian: { name: "Anil Kumar", relation: "Son" },
          respondent: "guardian",
        },
      })
    );
    const prov = entriesOf(b).find((e) => e.resource.resourceType === "Provenance")!;
    const agent = (prov.resource as { agent: { who: { display: string } }[] }).agent;
    expect(agent.some((a) => a.who.display.includes("Guardian: Anil Kumar"))).toBe(true);
  });
});