export type HistoryMode = "allopathic" | "ayush";

export type Role = "doctor" | "nurse" | "pharmacist" | "admin";

/** Auth‑priority: pending (kiosk submit) → triage (nurse verified) → confirmed (doctor seen) → er (escalated). */
export type EncounterStatus = "pending" | "triage" | "confirmed" | "er";

export type StaffUser = {
  username: string;
  name: string;
  role: Role;
  /** Department scope: dashboard defaults to this department when set. */
  department?: string;
  /** OPD Room or Counter designation (e.g. "Room 4 - Kaya Chikitsa", "Triage Desk 1", "Dispensary 2") */
  room?: string;
  /** ABDM Healthcare Professional Registry (HPR) ID (e.g. "91-7482-1948-2831") */
  hprId?: string;
  /** State Medical / AYUSH / Pharmacy / Nursing Council Registration No. */
  councilReg?: string;
  /** Clinician qualification / degrees (e.g. "BAMS, MD", "MBBS, MD", "B.Sc Nursing") */
  qualifications?: string;
};

export type Language = {
  code: string;
  name: string;
  native: string;
  voiceCode?: string;
  /** Tesseract.js language code used for document OCR in this language. */
  tesseract?: string;
};

export type Guardian = {
  name: string;
  relation: string;
  mobile?: string;
};

export type Patient = {
  abhaId: string;
  name: string;
  age: number;
  sex: "Male" | "Female" | "Other";
  mobile?: string;
  department: string;
  dateOfBirth?: string;
  vitals?: Vitals;
  /** Set when the person at the kiosk is answering on behalf of the patient (proxy/guardian mode). */
  guardian?: Guardian;
  /** Whether the person is the patient themselves or answering as proxy. */
  respondent?: "self" | "guardian";
};

export type Vitals = {
  systolic?: number;
  diastolic?: number;
  pulse?: number;
  weight?: number;
  height?: number;
  temperature?: number;
  /** Peripheral oxygen saturation %. */
  spo2?: number;
};

export type AuditAction =
  | "consent_granted"
  | "history_submitted"
  | "documents_scanned"
  | "vitals_captured"
  | "summarized"
  | "doctor_viewed"
  | "confirmed"
  | "exported"
  /** Delivered to the configured hospital information system (FHIR / HL7 v2). */
  | "his_export"
  | "prescription_written"
  | "note_added"
  | "called_next"
  | "guardian_consented"
  | "auth_login"
  | "auth_logout"
  | "record_edited"
  | "escalated_er"
  | "triage_verified"
  | "backup"
  | "restored"
  | "document_uploaded"
  | "dispensed"
  | "followup_scheduled"
  | "consent_revoked"
  | "appointment_booked"
  | "appointment_checked_in"
  | "auto_escalated"
  | "referral_issued"
  | "camp_screened"
  | "maintenance_toggled"
  | "demo_live"
  | "break_glass_override"
  | "workstation_locked"
  | "workstation_unlocked"
  | "draft_resumed"
  /** Same-day possible duplicate flagged at registration (warning, not a block). */
  | "possible_duplicate"
  /** Patient ticked the high-severity drug-interaction acknowledgement at the kiosk. */
  | "interaction_acknowledged"
  /** Kiosk session operated by an attendant on the patient's behalf. */
  | "attendant_assisted";

export type AuditEvent = {
  action: AuditAction;
  at: string;
  detail?: string;
  /** Who performed the action: staff username or "kiosk". */
  actor?: string;
  /** origin: "client" (kiosk-appended) or "server" (server-authoritative). */
  origin?: "client" | "server";
};

export type InteractionWarning = {
  type: "drug-drug" | "drug-allergy" | "duplicate" | "allergy";
  severity: "high" | "medium" | "low";
  message: string;
  between: string;
};

export type Allergy = {
  substance: string;
  reaction?: string;
  severity?: "Mild" | "Moderate" | "Severe";
};

export type DosageForm =
  | "Tablet"
  | "Capsule"
  | "Syrup"
  | "Injection"
  | "Churna"
  | "Vati"
  | "Asava/Arishta"
  | "Kwatha"
  | "Taila"
  | "Ghrita"
  | "Avaleha"
  | "Lepa"
  | "Ointment"
  | "Drops"
  | "Other";

export type Medication = {
  name: string;
  dosage?: string;
  frequency?: string;
  duration?: string;
  /** Advised-by (physician) marker for prescriptions. */
  instructions?: string;
  /** Formulation type (Tab, Cap, Churna, Vati, Kwath, etc.) */
  dosageForm?: DosageForm | string;
  /** Ayurvedic vehicle / medium (e.g. Warm water, Honey, Milk, Ghee) */
  anupana?: string;
  /** Ayurvedic administration time (e.g. Before meals, After meals, Bedtime) */
  kala?: string;
  /** True if this is an Ayurvedic formulation */
  isAyurvedic?: boolean;
};

export type PastCondition = {
  condition: string;
  year?: string;
};

export type Surgery = {
  procedure: string;
  year?: string;
};

export type Investigation = {
  test: string;
  value: string;
  unit?: string;
  referenceRange?: string;
  flag?: "high" | "low" | "normal" | "critical";
  date?: string;
};

export type ClinicalHistory = {
  name: string;
  age: number;
  sex: string;
  chiefComplaint: string;
  hpi: string;
  pastMedical: PastCondition[];
  pastSurgical: Surgery[];
  medications: Medication[];
  allergies: Allergy[];
  familyHistory: string;
  personalHistory: string;
  reviewOfSystems: { system: string; positive: string }[];
  priorInvestigations: Investigation[];
  ayush?: AyushHistory;
  /** Menstrual history for female patients (LMP, regularity, menopause). */
  menstrualHistory?: string;
  /** Obstetric history: gravida/para, complications, feeds. */
  obstetricHistory?: string;
};

export type AyushHistory = {
  prakriti: string;
  vikriti: string;
  sara: string;
  samhanana: string;
  pramana: string;
  satmya: string;
  sattva: string;
  aharaShakti: string;
  vyayamaShakti: string;
  vaya: string;
  agni: string;
  koshtha: string;
  nidana: string;
  samprapti: string;
  aharaVihara: string;
};

export type DocType =
  | "Prescription"
  | "Lab Report"
  | "Discharge Summary"
  | "Imaging Report"
  | "Other";

export type MedicalDocument = {
  id: string;
  filename: string;
  type: DocType;
  date?: string;
  text: string;
  entities: {
    diagnoses: string[];
    medications: Medication[];
    investigations: Investigation[];
    procedures: string[];
  };
  abnormalValues: Investigation[];
  previewUrl?: string;
  /** Server-persisted copy of the source scan (survives reloads / other devices). */
  serverUrl?: string;
  /** OCR language used (tesseract code). */
  ocrLang?: string;
  /** Page count when a multi-page PDF was processed. */
  pages?: number;
  /** MIME type of the source file — needed for a valid FHIR Attachment. */
  mimeType?: string;
};

export type RedFlag = {
  id: string;
  severity: "high" | "medium";
  symptom: string;
  message: string;
  /** Where the flag came from: free text, structured answer or vitals. */
  source?: "text" | "answer" | "vitals";
};

export type QuestionType = "options" | "text" | "number" | "confirm";

export type Question = {
  id: string;
  category: string;
  text: string;
  type: QuestionType;
  options?: string[];
  followUp?: (answer: string) => Question[] | null;
  next?: string;
};

export type SummaryItem = {
  label: string;
  content: string;
};

export type Prescription = {
  diagnosis?: string;
  /** Suggested ICD-10 code for the working diagnosis (clinical decision support). */
  icd10?: string;
  /** Disposition set by the treating physician. */
  disposition?: "admit" | "refer" | "discharge" | "observe";
  medications: Medication[];
  advice?: string;
  /** Ayurvedic wholesome diet & lifestyle recommendations (Do's) */
  pathya?: string;
  /** Ayurvedic unwholesome restrictions / contraindicated foods (Don'ts) */
  apathya?: string;
  /** Prescription system mode */
  system?: "allopathic" | "ayush";
  followUpDate?: string;
  prescribedBy?: string;
  /** NMC / State council registration number for formal printed prescriptions. */
  doctorReg?: string;
  /** ABDM Healthcare Professional Registry ID */
  doctorHprId?: string;
  /** Doctor qualification degrees (e.g. BAMS, MD / MBBS, MD) */
  doctorQualifications?: string;
  /** Tamper-evident e-prescription signature hash */
  signatureHash?: string;
  writtenAt?: string;
};

export type StoredHistory = {
  /** Unique encounter identifier (UUID). Replaces patient-name keying. */
  encounterId: string;
  /** Last-modification timestamp, used to merge offline and server copies. */
  updatedAt: string;
  patient: Patient;
  mode: HistoryMode;
  /** Kiosk UI language chosen by/for the patient (e.g. "hi", "pa") — drives
   *  waiting-room call-outs and staff announcements in their own language.
   *  Optional so pre-existing records keep working (callers fall back to hi). */
  lang?: string;
  /** BCP47 voice tag matching lang (e.g. "pa-IN"). */
  voiceCode?: string;
  enteredAt: string;
  history: ClinicalHistory;
  documents: MedicalDocument[];
  redFlags: RedFlag[];
  interactions: InteractionWarning[];
  summary: string;
  /**
   * Legacy single-flag consent, kept for backwards compatibility with records
   * and clients written before granular consent existed. Authoritative when
   * `consent` is absent — see `canStaffView()`.
   */
  consentGranted: boolean;
  /** Granular, per-purpose, revocable consent. The source of truth when present. */
  consent?: ConsentState;
  status: EncounterStatus;
  audit: AuditEvent[];
  doctorNote?: string;
  doctorDiagnosis?: string;
  prescription?: Prescription;
  /** Queue token issued at the kiosk (e.g. TK-1042). */
  token?: string;
  /** Set when the pharmacy fulfils the prescribed medication. */
  dispensedAt?: string;
  /** Printable referral slip attached on ER/triage escalation (Batch B). */
  referral?: ReferralSlip;
  /** Screening-camp context for outreach-mode captures (Batch B). */
  camp?: { campId: string; village?: string; screenedBy?: string; sequence?: number };
  /** Marker for encounters created by the living-hospital demo mode (Batch C). */
  demo?: boolean;
  /**
   * Transient read-time marker: this row reached the UI through a live
   * break-glass activation despite revoked consent. NEVER persisted —
   * `upsertEncounter` strips it at the write choke point — and meaningless
   * once the 15-minute window closes. The UI badges such rows as overrides.
   */
  viaBreakGlass?: boolean;
  /**
   * Same-day possible duplicate recorded at registration: another open
   * encounter looked like the same patient (same ABHA, or walk-in mobile +
   * fuzzy name). Advisory only — genuine re-visits exist — so the physician
   * queue badges it instead of blocking. May go stale once the twin is
   * discharged; the badge text says "possible", not "is".
   */
  possibleDuplicateOf?: { encounterId: string; token?: string; reason: string };
};

/** Referral slip auto-generated on escalation — printable at /referral/[id]. */
export type ReferralSlip = {
  id: string;
  /** Destination department/facility, e.g. "Emergency Department". */
  to: string;
  /** One-line reason, e.g. "MEWS 5 — possible sepsis". */
  reason: string;
  reasons: string[];
  /** MEWS / decision score at the time of issuance. */
  score?: number;
  issuedAt: string;
  fromDepartment: string;
  patientName: string;
  patientAge: number;
  patientSex: string;
  abhaId?: string;
  mobile?: string;
  vitals?: Vitals;
  summary?: string;
};

/**
 * Granular consent scopes (DPDP 2023 s.6 + ABDM consent framework).
 *
 * The old model was a single `consentGranted` boolean that nothing downstream
 * read, so revoking it changed nothing a clinician could see. Consent is now
 * per-purpose and is enforced in the data layer (see `canStaffView` /
 * `listEncounters` in src/lib/server/db.ts).
 */
export const CONSENT_SCOPES = [
  /** Capture the history at the kiosk (always required to submit). */
  "history_capture",
  /** Digitize and store uploaded medical documents. */
  "document_processing",
  /** Show the record to treating clinicians (physician/nurse/pharmacy). */
  "clinical_care",
  /** Store the record in the patient's ABHA personal health record. */
  "abha_linking",
  /** Export/transmit the record to the hospital information system. */
  "his_emr_export",
  /**
   * Send answers or document contents to an external language-model provider.
   * Separate from the clinical scopes on purpose: when a model key is
   * configured, the deterministic engine is bypassed and the patient's text
   * leaves this hospital. That is a distinct processing purpose and needs its
   * own tick, not a side effect of "allow my doctor to see this".
   */
  "ai_processing",
] as const;

export type ConsentScope = (typeof CONSENT_SCOPES)[number];

/** Per-purpose consent state with revocation + purpose limitation metadata. */
export type ConsentState = {
  granted: ConsentScope[];
  /** When each scope was granted/revoked (ISO timestamp) — audit trail. */
  decidedAt?: string;
  /** Specific purpose text shown to the patient in the audio consent script. */
  purpose?: string;
  /** Consent expires; a lapsed scope is treated as not granted. */
  expiresAt?: string;
  /** True once the patient has revoked — scopes are cleared but the fact is kept. */
  revokedAt?: string;
};

export type ConsentDecision = {
  scope: ConsentScope;
  granted: boolean;
};

/** True when a scope is currently usable (granted, not revoked, not expired). */
export function isScopeActive(state: Partial<ConsentState> | undefined, scope: ConsentScope, now = Date.now()): boolean {
  if (!state) return false;
  if (state.revokedAt) return false;
  if (!state.granted?.includes(scope)) return false;
  if (state.expiresAt) {
    const expiry = Date.parse(state.expiresAt);
    if (Number.isFinite(expiry) && expiry <= now) return false;
  }
  return true;
}

/** True when a clinician may read the clinical content of this record. */
export function canStaffView(history: Pick<StoredHistory, "consent" | "consentGranted">, now = Date.now()): boolean {
  if (history.consent) return isScopeActive(history.consent, "clinical_care", now);
  // Records written before granular consent existed carry only the boolean.
  // Honour it, otherwise upgrading would retroactively hide historical records.
  return history.consentGranted === true;
}

/** A patient record grouped by ABHA id (longitudinal view). */
export type PatientRecord = {
  key: string; // ABHA id or a hash of name+mobile
  patient: Patient;
  encounters: StoredHistory[];
};

/**
 * True when the record was captured without an ABHA (walk-in "NEW-REGISTER",
 * camp "CAMP-REGISTER", or missing entirely).
 *
 * Compared on the RAW value, case-insensitively: digit-normalisation strips
 * every non-digit, so a normalised placeholder is "" and can never equal the
 * literal — comparing the normalised form once made every mobile fallback
 * silently unreachable.
 */
export function isWalkInWithoutAbha(abhaId: string | undefined | null): boolean {
  const v = (abhaId ?? "").trim().toLowerCase();
  return v === "" || v === "new-register" || v === "newregister" || v === "camp-register" || v === "campregister";
}

/**
 * Longitudinal grouping key: the ABHA id when the record carries a real one,
 * else name+mobile. Placeholder ids carry no digits (NEW-REGISTER,
 * CAMP-REGISTER), so every placeholder record must fall through to
 * name+mobile — keying on the raw placeholder would merge ALL camp walk-ins
 * into a single patient's history.
 */
export function patientKeyOf(e: Pick<StoredHistory, "patient">): string {
  const abha = e.patient?.abhaId ?? "";
  return /\d{4}/.test(abha)
    ? abha
    : `${(e.patient?.name ?? "").toLowerCase()}|${e.patient?.mobile ?? ""}`;
}

export const SYSTEMS_OF_REVIEW = [
  "General",
  "Cardiovascular",
  "Respiratory",
  "Gastrointestinal",
  "Neurological",
  "Musculoskeletal",
  "Genitourinary",
  "Endocrine",
  "Skin",
  "ENT / Eyes",
];

export const STRINGS: Record<string, Record<string, string>> = {
  en: {
    next: "Next",
    back: "Back",
    speak: "Press & Speak",
    listening: "Listening...",
    tap: "or tap an answer",
    confirm: "Confirm",
    finish: "Finish & Generate Summary",
    skip: "Skip",
  },
  hi: {
    next: "अगला",
    back: "पीछे",
    speak: "बोलें",
    listening: "सुन रहे हैं...",
    tap: "या उत्तर पर टैप करें",
    confirm: "पुष्टि करें",
    finish: "समाप्त करें और सारांश बनाएं",
    skip: "छोड़ें",
  },
};