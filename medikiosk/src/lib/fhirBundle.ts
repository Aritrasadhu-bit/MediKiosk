import type { StoredHistory, Vitals } from "./types";

/**
 * Converts a MediKiosk encounter into an ABDM-aligned FHIR R4 document Bundle:
 * Patient + Encounter + Composition + AllergyIntolerance + MedicationStatement +
 * Observation (conversational, document and vital records) + DocumentReference +
 * Provenance (audit trail). Pure module so it can be unit-tested.
 */

const LOINC = {
  bpSystolic: "8480-6",
  bpDiastolic: "8462-4",
  pulse: "8867-4",
  temperature: "8310-5",
  weight: "29463-7",
  height: "8302-2",
  spo2: "59408-5",
} as const;

type FhirEntry = Record<string, unknown>;

/** RFC 4122 v4 UUID. Bundle.entry.fullUrl "urn:uuid:" references must be real UUIDs. */
function uuid(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * FHIR `id` — 1..64 chars of [A-Za-z0-9\-.]. Not a UUID (a resource id only has
 * to be unique within the server), but it must match the idType regex or
 * validators reject the whole resource.
 */
function fhirId(...parts: Array<string | number>): string {
  const joined = parts
    .join("-")
    .replace(/[^A-Za-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  return joined || "unknown";
}

/**
 * Escape text for an XHTML narrative div. The previous implementation stripped
 * `<`, `>` and `&` outright, which silently corrupted every clinical value
 * containing a comparison operator (e.g. "HbA1c > 6.5") — the exact data a
 * physician reads.
 */
function xhtmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Preserve line breaks as paragraphs inside the narrative. */
function narrative(text: string): string {
  const paragraphs = xhtmlEscape(text)
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, "<br/>"))
    .filter(Boolean)
    .map((p) => `<p>${p}</p>`)
    .join("");
  return paragraphs || "<p/>";
}

function vitalsObservations(patientId: string, vitals?: Vitals): FhirEntry[] {
  const out: FhirEntry[] = [];
  if (!vitals) return out;
  const add = (code: string, display: string, value?: number, unit?: string) => {
    if (value === undefined || value === null || !Number.isFinite(value)) return;
    out.push({
      // A real UUID: `urn:uuid:` references must resolve to a conformant UUID.
      fullUrl: `urn:uuid:${uuid()}`,
      resource: {
        resourceType: "Observation",
        id: fhirId("vital", code.replace(/\D/g, "")),
        status: "final",
        code: { coding: [{ system: "http://loinc.org", code, display }] },
        subject: { reference: `Patient/${patientId}` },
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs" }] }],
        valueQuantity: { value, unit, system: "http://unitsofmeasure.org", code: unit },
        effectiveDateTime: new Date().toISOString(),
      },
    });
  };
  add(LOINC.bpSystolic, "Systolic blood pressure", vitals.systolic, "mmHg");
  add(LOINC.bpDiastolic, "Diastolic blood pressure", vitals.diastolic, "mmHg");
  add(LOINC.pulse, "Heart rate", vitals.pulse, "beats/min");
  add(LOINC.temperature, "Body temperature", vitals.temperature, "Cel");
  add(LOINC.weight, "Body weight", vitals.weight, "kg");
  add(LOINC.height, "Body height", vitals.height, "cm");
  add(LOINC.spo2, "Oxygen saturation in Arterial blood by Pulse oximetry", vitals.spo2, "%");
  return out;
}

export function toFhirBundle(h: StoredHistory): Record<string, unknown> {
  const now = new Date().toISOString();
  const patientId = fhirId("patient", h.encounterId);
  const encounterId = fhirId("encounter", h.encounterId);
  const compositionId = fhirId("composition", h.encounterId);
  const entries: FhirEntry[] = [];
  // Each entry gets a distinct conformant UUID, and the resource `id` is
  // mirrored into the fullUrl reference target so internal references resolve.
  const push = (_resourceType: string, resource: FhirEntry) => {
    entries.push({ fullUrl: `urn:uuid:${uuid()}`, resource });
  };

  /** Best-effort MIME type from a filename, for the Attachment.contentType. */
  function guessContentType(filename: string): string {
    const ext = filename.toLowerCase().split(".").pop() ?? "";
    const map: Record<string, string> = {
      pdf: "application/pdf",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      heic: "image/heic",
      tif: "image/tiff",
      tiff: "image/tiff",
    };
    return map[ext] ?? "application/octet-stream";
  }

  // ------------------------------------------------------------ Patient
  push("Patient", {
    resourceType: "Patient",
    id: patientId,
    identifier: [{ system: "https://abdm.gov.in/ndhm/phr/abha", value: h.patient.abhaId || "NEW-REGISTER" }],
    name: [{ text: h.history.name }],
    gender: (["male", "female", "other", "unknown"] as const).includes(h.history.sex?.toLowerCase() as never)
      ? h.history.sex?.toLowerCase()
      : "unknown",
    birthDate: h.patient.dateOfBirth || undefined,
    telecom: h.patient.mobile ? [{ system: "phone", value: h.patient.mobile }] : undefined,
    guardian: h.patient.guardian
      ? {
          name: { text: h.patient.guardian.name },
          relationship: [{ text: h.patient.guardian.relation }],
        }
      : undefined,
  });

  // ------------------------------------------------------------ Encounter
  push("Encounter", {
    resourceType: "Encounter",
    id: encounterId,
    status: h.status === "confirmed" ? "finished" : "in-progress",
    class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "AMB" },
    type: [{ text: h.patient.department || "OPD" }],
    subject: { reference: `Patient/${patientId}` },
    period: { start: h.enteredAt, end: h.status === "confirmed" ? now : undefined },
  });

  // ------------------------------------------------------------ Composition sections
  const textSections: { title: string; code: string; text: string }[] = [
    { title: "Chief Complaint", code: "10164-2", text: h.history.chiefComplaint },
    { title: "History of Present Illness", code: "10164-2", text: h.history.hpi },
    { title: "Past Medical History", code: "11348-0", text: (h.history.pastMedical ?? []).map((p) => p.condition).join(", ") || "None" },
    { title: "Past Surgical History", code: "10154-3", text: (h.history.pastSurgical ?? []).map((p) => p.procedure).join(", ") || "None" },
    { title: "Current Medications", code: "10160-0", text: (h.history.medications ?? []).map((m) => `${m.name} ${m.dosage ?? ""}`.trim()).join(", ") || "None" },
    { title: "Allergies", code: "52472-8", text: (h.history.allergies ?? []).map((a) => a.substance).join(", ") || "None known" },
    { title: "Family History", code: "10157-6", text: h.history.familyHistory || "Not elicited" },
    { title: "Personal History", code: "29762-2", text: h.history.personalHistory || "Not elicited" },
    { title: "Review of Systems", code: "10187-3", text: (h.history.reviewOfSystems ?? []).map((r) => `${r.system}: ${r.positive}`).join("; ") },
  ];
  if (h.history.sex === "Female") {
    if (h.history.menstrualHistory) textSections.push({ title: "Menstrual History", code: "28387-3", text: h.history.menstrualHistory });
    if (h.history.obstetricHistory) textSections.push({ title: "Obstetric History", code: "10164-2", text: h.history.obstetricHistory });
  }
  if (h.history.ayush) {
    const a = h.history.ayush;
    textSections.push({
      title: "AYUSH Assessment (Dashavidha Pariksha)",
      code: "10164-2",
      text: Object.entries(a)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`)
        .join("; "),
    });
  }
  if (h.prescription) {
    const p = h.prescription;
    const rxText = [
      p.diagnosis ? `Diagnosis: ${p.diagnosis}` : "",
      `Rx: ${(p.medications ?? []).map((m) => `${m.name} ${m.dosage ?? ""} ${m.frequency ?? ""} ${m.duration ?? ""}`.trim()).join("; ") || "None"}`,
      p.advice ? `Advice: ${p.advice}` : "",
      p.followUpDate ? `Follow-up: ${p.followUpDate}` : "",
    ].filter(Boolean).join("\n");
    textSections.push({ title: "Prescription", code: "57135-7", text: rxText });
  }

  // ------------------------------------------------------------ AllergyIntolerance
  (h.history.allergies ?? []).forEach((a, i) => {
    push("AllergyIntolerance", {
      resourceType: "AllergyIntolerance",
      id: fhirId("allergy", a.substance, i),
      patient: { reference: `Patient/${patientId}` },
      code: { text: a.substance },
      clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }] },
      recordedDate: h.enteredAt,
      reaction: a.reaction ? [{ manifestation: [{ text: a.reaction }] }] : undefined,
    });
  });

  // ------------------------------------------------------------ MedicationStatement
  (h.history.medications ?? []).forEach((m, i) => {
    push("MedicationStatement", {
      resourceType: "MedicationStatement",
      id: fhirId("med", m.name, i),
      status: "active",
      medicationCodeableConcept: { text: m.name },
      subject: { reference: `Patient/${patientId}` },
      context: { reference: `Encounter/${encounterId}` },
      effectiveDateTime: h.enteredAt,
      dosage:
        m.dosage || m.frequency
          ? [{ text: [m.dosage, m.frequency, m.duration].filter(Boolean).join(" ") || undefined }]
          : undefined,
    });
  });

  // ------------------------------------------------------------ Observations (prior + document labs)
  const allInv = [
    ...(h.history.priorInvestigations ?? []),
    ...h.documents.flatMap((d) => d.entities.investigations ?? []),
  ];
  allInv.forEach((i, idx) => {
    // Deterministic id (test slug + stable index) — random suffixes made the
    // bundle non-reproducible, defeating content-hash caching of FHIR records.
    const slug = String(i.test).toLowerCase().replace(/\W/g, "") || "obs";
    // Numeric quantities when parseable; otherwise a valueString (e.g. "Positive",
    // "<0.5") — `Number("Positive")` is NaN and was silently dropping the value.
    const numeric = Number(String(i.value ?? "").replace(/,/g, ""));
    const hasNumeric = i.value !== undefined && i.value !== null && i.value !== "" && Number.isFinite(numeric);
    push("Observation", {
      resourceType: "Observation",
      id: fhirId("obs", slug, idx + 1),
      status: "final",
      code: { text: i.test },
      subject: { reference: `Patient/${patientId}` },
      encounter: { reference: `Encounter/${encounterId}` },
      // R4 invariant obs-7: if value[x] is present, effective[x] must be too.
      valueQuantity: hasNumeric
        ? { value: numeric, unit: i.unit, system: "http://unitsofmeasure.org", code: i.unit }
        : undefined,
      valueString: i.value !== undefined && i.value !== null ? String(i.value) : undefined,
      referenceRange: i.referenceRange ? [{ text: i.referenceRange }] : undefined,
      interpretation: i.flag && i.flag !== "normal" ? [{ text: i.flag }] : undefined,
      effectiveDateTime: i.date || h.enteredAt,
    });
  });

  // Vitals as typed Observations (ABDM-valid)
  for (const entry of vitalsObservations(patientId, h.patient.vitals)) {
    entries.push(entry);
  }

  // ------------------------------------------------------------ DocumentReference (digitized uploads)
  h.documents.forEach((d) => {
    const contentType = d.mimeType || guessContentType(d.filename);
    // R4 invariant doc-1: Attachment must carry either `data` or `url`. The
    // previous bundle supplied only a title, which is invalid — a validator
    // rejects the DocumentReference and, in a document Bundle, the whole bundle.
    const attachment: FhirEntry = {
      contentType,
      title: d.filename,
      creation: d.date ? new Date(d.date).toISOString() : h.enteredAt,
    };
    if (d.serverUrl) {
      // Server-held scan: reference it by URL rather than inlining base64 PHI.
      attachment.url = d.serverUrl;
    } else {
      // No stored image — point at the extracted text so the resource stays valid.
      attachment.data = Buffer.from(d.text.slice(0, 8000), "utf8").toString("base64");
    }
    push("DocumentReference", {
      resourceType: "DocumentReference",
      id: fhirId("doc", d.id),
      status: "current",
      type: { text: d.type },
      subject: { reference: `Patient/${patientId}` },
      date: d.date ? new Date(d.date).toISOString() : h.enteredAt,
      content: [{ attachment }],
      description: d.text.slice(0, 400),
    });
  });

  // ------------------------------------------------------------ Composition
  push("Composition", {
    resourceType: "Composition",
    id: compositionId,
    status: "final",
    type: { coding: [{ system: "http://loinc.org", code: "34117-2", display: "History and physical note" }] },
    subject: { reference: `Patient/${patientId}` },
    encounter: { reference: `Encounter/${encounterId}` },
    date: now,
    author: [{ display: "MediKiosk clinical-history platform" }],
    title: `${h.history.name} — Structured Clinical History`,
    section: textSections
      // A Composition.section requires text (or contained resources); empty or
      // "None" sections were previously emitted as blank narratives.
      .filter((s) => s.text && s.text.trim() && s.text.trim().toLowerCase() !== "none")
      .map((s) => ({
        title: s.title,
        code: { coding: [{ system: "http://loinc.org", code: s.code }] },
        text: {
          status: "generated",
          div: `<div xmlns="http://www.w3.org/1999/xhtml">${narrative(s.text)}</div>`,
        },
      })),
  });

  // ------------------------------------------------------------ Provenance (audit trail)
  // Provenance has no `note` element in R4. Audit events belong in `entity`
  // (describing *what*), and the lawful basis of the disclosure belongs there
  // too so a downstream ABDM/ABHA consumer can see why it was shared.
  push("Provenance", {
    resourceType: "Provenance",
    id: fhirId("provenance", h.encounterId),
    target: [
      { reference: `Composition/${compositionId}` },
      { reference: `Encounter/${encounterId}` },
    ],
    recorded: now,
    activity: { text: "MediKiosk clinical-history intake and review" },
    agent: [
      {
        type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/provenance-participant-type", code: "author" }] },
        who: {
          display:
            h.patient.respondent === "guardian"
              ? `Guardian: ${h.patient.guardian?.name ?? ""} (${h.patient.guardian?.relation ?? ""})`
              : "Patient",
        },
      },
      {
        type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/provenance-participant-type", code: "assembler" }] },
        who: { display: "MediKiosk clinical-history platform" },
      },
      ...(h.doctorNote || h.prescription
        ? [
            {
              type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/provenance-participant-type", code: "verifier" }] },
              who: { display: "Physician" },
            },
          ]
        : []),
    ],
    entity: [
      {
        role: "derivation",
        what: {
          display: `Consent: ${
            h.consent?.granted?.join(", ") || (h.consentGranted ? "clinical_care" : "none recorded")
          }`,
        },
      },
      ...(h.audit ?? []).slice(0, 50).map((e) => ({
        role: "source",
        what: { display: `${e.action} @ ${e.at}${e.detail ? ` — ${e.detail}` : ""}` },
      })),
    ],
  });

  const bundle = {
    resourceType: "Bundle",
    type: "document",
    timestamp: now,
    meta: {
      lastUpdated: now,
      source: "https://medikiosk.in/fhir",
      tag: [
        { system: "urn:medikiosk", code: h.mode },
        { system: "https://abdm.gov.in", code: h.patient.abhaId || "phr-untagged" },
      ],
    },
    entry: entries,
  };

  return bundle;
}