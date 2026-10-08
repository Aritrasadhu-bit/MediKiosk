import { z } from "zod";

/** Central location for request-body validation used by every API route. */

/**
 * Granular consent as ticked at the kiosk. Validated here so an unknown or
 * malformed scope is rejected at the edge rather than being silently stored
 * and then trusted by the staff-side consent filter. Shared with the summary
 * route, which must decide whether external AI processing is permitted before
 * it sends any patient text to a model provider.
 */
export const consentSchema = z.object({
  granted: z
    .array(
      z.enum([
        "history_capture",
        "clinical_care",
        "document_processing",
        "abha_linking",
        "his_emr_export",
        "ai_processing",
      ])
    )
    .max(10)
    .default([]),
  decidedAt: z.string().max(60).optional(),
  purpose: z.string().max(1_000).optional(),
  expiresAt: z.string().max(60).optional(),
  revokedAt: z.string().max(60).optional(),
});

export const medicationSchema = z
  .object({
    name: z.string().max(120).default(""),
    dosage: z.string().max(60).optional(),
    frequency: z.string().max(60).optional(),
    duration: z.string().max(60).optional(),
    instructions: z.string().max(300).optional(),
  })
  .passthrough();

export const investigationSchema = z
  .object({
    test: z.string().max(120),
    value: z.string().max(40),
    unit: z.string().max(40).optional(),
    referenceRange: z.string().max(80).optional(),
    flag: z.enum(["high", "low", "normal", "critical"]).optional(),
    date: z.string().max(40).optional(),
  })
  .passthrough();

export const extractRequestSchema = z.object({
  text: z.string().max(200_000),
  filename: z.string().max(200).default("document.jpg"),
  language: z.string().max(10).optional(),
  /**
   * Pre-save consent for the LLM structuring path. The heuristic engine runs
   * regardless; without an explicit `ai_processing` scope the text never
   * leaves the hospital.
   */
  consent: consentSchema.optional(),
});

export const summarizeRequestSchema = z.object({
  history: z.record(z.string(), z.unknown()),
  mode: z.enum(["allopathic", "ayush"]).default("allopathic"),
  documents: z.array(z.record(z.string(), z.unknown())).default([]),
  redFlags: z.array(z.record(z.string(), z.unknown())).default([]),
  vitals: z.record(z.string(), z.unknown()).optional(),
  guardian: z
    .object({
      name: z.string().max(120).optional(),
      relation: z.string().max(80).optional(),
      mobile: z.string().max(20).optional(),
    })
    .optional(),
  /**
   * Set by staff actions against an already-saved record. When present, the
   * route resolves the stored consent from the database instead of trusting a
   * caller-supplied one, so an `ai_processing` scope cannot be forged.
   */
  encounterId: z.string().min(1).max(80).optional(),
  /**
   * The kiosk's granular consent, submitted alongside the first (pre-save)
   * summary request. `ai_processing` must appear here before any patient text
   * is sent to a model provider; absent or incomplete, the deterministic
   * rules engine is used and nothing leaves the hospital.
   */
  consent: consentSchema.optional(),
});

export const converseRequestSchema = z.object({
  chiefComplaint: z.string().max(400).optional(),
  department: z.string().max(120).optional(),
  hpi: z.string().max(20_000).optional(),
  priorQuestions: z.string().max(4_000).optional(),
  language: z.string().max(10).optional(),
  /**
   * Pre-save consent for the model-generated follow-up question. Without an
   * explicit `ai_processing` scope the route refuses and the kiosk stays on
   * the guided (rules) flow.
   */
  consent: consentSchema.optional(),
});

export const fhirRequestSchema = z.record(z.string(), z.unknown());

export const asrRequestSchema = z.object({
  audioBase64: z.string().max(20_000_000),
  language: z.string().max(12).optional(),
  mime: z.string().max(40).optional(),
  /**
   * Pre-save consent for server-side transcription. Without an explicit
   * `ai_processing` scope the audio is not sent to the backend — the kiosk
   * falls back to the on-device Web Speech API.
   */
  consent: consentSchema.optional(),
});

export const loginRequestSchema = z.object({
  username: z.string().min(1).max(60),
  password: z.string().min(1).max(200),
});

/**
 * Length caps on the free-text fields of the open patient/history records.
 * Those records stay open (flexible capture across allopathic + AYUSH flows),
 * so over-long values cannot be rejected by shape — but an uncapped `name` or
 * `chiefComplaint` bloats every dashboard load (GET /api/encounters returns the
 * whole store) and can exhaust the kiosk's 5MB localStorage. Caps here fail
 * the write at the edge instead.
 */
const TEXT_CAPS: Array<[top: "patient" | "history", key: string, max: number]> = [
  ["patient", "name", 120],
  ["history", "name", 120],
  ["history", "chiefComplaint", 2000],
  ["history", "hpi", 20000],
  ["history", "familyHistory", 5000],
  ["history", "personalHistory", 5000],
  ["history", "menstrualHistory", 2000],
  ["history", "obstetricHistory", 2000],
];

function checkTextCaps(body: { patient?: unknown; history?: unknown }, ctx: z.RefinementCtx) {
  for (const [top, key, max] of TEXT_CAPS) {
    const obj = (body as Record<string, unknown>)[top];
    if (obj && typeof obj === "object") {
      const v = (obj as Record<string, unknown>)[key];
      if (typeof v === "string" && v.length > max) {
        ctx.addIssue({
          code: "too_big",
          origin: "string",
          maximum: max,
          inclusive: true,
          message: `${top}.${key} exceeds ${max} characters`,
          path: [top, key],
        });
      }
    }
  }
}

export const encounterSchema = z.object({
  encounterId: z.string().min(1).max(80),
  updatedAt: z.string().max(60).optional(),
  /** Queue token the kiosk mints on the submitted history (e.g. TK-1042). */
  token: z.string().max(20).optional(),
  patient: z.record(z.string(), z.unknown()),
  mode: z.enum(["allopathic", "ayush"]),
  enteredAt: z.string().max(60),
  history: z.record(z.string(), z.unknown()),
  documents: z.array(z.record(z.string(), z.unknown())).default([]),
  redFlags: z.array(z.record(z.string(), z.unknown())).default([]),
  interactions: z.array(z.record(z.string(), z.unknown())).default([]),
  summary: z.string().max(200_000).default(""),
  consentGranted: z.boolean().default(false),
  /**
   * Granular consent as ticked at the kiosk. Validated here so an unknown or
   * malformed scope is rejected at the edge rather than being silently stored
   * and then trusted by the staff-side consent filter.
   */
  consent: consentSchema.optional(),
  status: z.enum(["pending", "triage", "confirmed", "er"]).default("pending"),
  audit: z.array(z.record(z.string(), z.unknown())).default([]),
  doctorNote: z.string().max(20_000).optional(),
  doctorDiagnosis: z.string().max(2_000).optional(),
  prescription: z.record(z.string(), z.unknown()).optional(),
}).superRefine((val, ctx) => checkTextCaps(val, ctx));

export const patchEncounterSchema = z.object({
  status: z.enum(["pending", "triage", "confirmed", "er"]).optional(),
  summary: z.string().max(200_000).optional(),
  doctorNote: z.string().max(20_000).optional(),
  doctorDiagnosis: z.string().max(2_000).optional(),
  prescription: z.record(z.string(), z.unknown()).optional(),
  history: z.record(z.string(), z.unknown()).optional(),
  audit: z.array(z.record(z.string(), z.unknown())).optional(),
  updatedAt: z.string().max(60).optional(),
  /** Nurse re-check of vitals at triage. */
  patient: z.object({ vitals: z.record(z.string(), z.unknown()).optional() }).optional(),
  /** Pharmacy fulfilment marker. */
  dispensedAt: z.string().max(60).optional(),
}).superRefine((val, ctx) => checkTextCaps(val, ctx));

/** Returning-patient lookup (public, kiosk): ABHA and/or mobile. */
export const lookupRequestSchema = z.object({
  abha: z.string().max(40).optional(),
  mobile: z.string().max(20).optional(),
  /** Second factor for mobile-only lookups: must match the stored patient name. */
  name: z.string().max(120).optional(),
});

/** Scan image upload (public, kiosk): base64 payload. */
export const documentUploadSchema = z.object({
  dataBase64: z.string().min(1).max(20_000_000),
  filename: z.string().max(200),
  mime: z.string().max(40).optional(),
});

/** Waiting-room / call-next control (authenticated). */
export const queueCallSchema = z.object({
  encounterId: z.string().min(1).max(80),
  action: z.enum(["call", "clear"]).default("call"),
  notify: z.boolean().optional().default(true),
});

/** AI scribe: dictate free text and get a structured prescription. */
export const dictateSchema = z.object({
  text: z.string().min(1).max(10_000),
  encounterId: z.string().min(1).max(80).optional(),
});

/** Patient portal: toggle consent with the access code. */
export const portalConsentSchema = z.object({
  code: z.string().min(8).max(24),
  consent: z.boolean(),
});

/** Appointment booking (public). */
export const appointmentSchema = z.object({
  name: z.string().min(1).max(120),
  mobile: z.string().min(10).max(20),
  department: z.string().min(1).max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  slot: z.string().min(1).max(40),
});

export const appointmentLookupSchema = z.object({
  mobile: z.string().min(10).max(20),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Second lookup factor (see GET /api/appointments): must match the booking. */
  name: z.string().min(1).max(120).optional(),
});

export const appointmentCheckinSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
});

/** Screening-camp quick capture (public, offline-friendly). */
export const campScreenedSchema = z.object({
  campId: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  // z.coerce.number() would turn "" into 0 — reject empty/vacuous age strings.
  age: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.coerce.number().int().min(0).max(130)
  ),
  sex: z.enum(["Male", "Female", "Other"]).optional(),
  village: z.string().max(120).optional(),
  mobile: z.string().max(20).optional(),
  symptoms: z.string().max(1000).default(""),
  /** True when the kiosk is offline — queued for sync, not yet on server. */
  offline: z.boolean().default(false),
  /** Stable per-patient id minted by the offline camp capture — de-duplicates
   * outbox replays so one offline patient can never be saved twice. */
  clientId: z.string().min(8).max(64).optional(),
  /** Kiosk UI language for this capture (drives call-out language). */
  lang: z.string().max(12).optional(),
  voiceCode: z.string().max(12).optional(),
  /**
   * Verbal screening consent ticked by the field worker for THIS patient.
   * Defaults false so older queued payloads (pre-checkbox) are rejected with
   * a clear error instead of being stored as implicitly consented.
   */
  consentGranted: z.boolean().default(false),
});

/** First-run setup wizard (public, only before configuration exists). */
export const setupSchema = z.object({
  username: z.string().min(3).max(60),
  password: z.string().min(8).max(200),
  hospitalName: z.string().min(2).max(160),
  departments: z.array(z.string().min(2).max(60)).max(30).optional(),
});

/** Maintenance-mode toggle (admin). */
export const maintenanceSchema = z.object({
  active: z.boolean(),
  reason: z.string().max(300).optional(),
});

/** Referral slip (admin/doctor). */
export const referralSchema = z.object({
  encounterId: z.string().min(1).max(80),
  /** Override destination (defaults to "Emergency Department"). */
  to: z.string().max(120).optional(),
});

/** OPD register export filter (admin). */
export const opdRegisterSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD").optional(),
  format: z.enum(["csv", "html"]).default("csv"),
});

/** Live demo start (admin). */
export const liveDemoSchema = z.object({
  /** Seconds between new patient arrivals (≥1). */
  intervalSeconds: z.coerce.number().int().min(1).max(120).default(8),
});

export function safeParse<T>(schema: z.ZodType<T>, body: unknown):
  | { ok: true; data: T }
  | { ok: false; error: string } {
  const result = schema.safeParse(body);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}