import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-level authorization regressions.
 *
 * Every bug pinned here shipped because a guard was written in a shape that
 * quietly did the opposite of what its comment claimed. They are cheap to
 * reintroduce, so they get tests.
 *
 * `vi.mock` is used (rather than a temp data dir) because these assertions are
 * about *authorization decisions*, not about persistence — mocking the store
 * keeps the test from passing just because a record happened to be absent.
 */

const currentUser = vi.fn();
const verifyToken = vi.fn();
const revokeUserSessions = vi.fn();
const revokeSession = vi.fn();
const SESSION_COOKIE = "medikiosk_session";
const latestHisDelivery = vi.fn();
const getEncounterForStaff = vi.fn();
const getEncounterForStaffOrBreakGlass = vi.fn(async (): Promise<unknown> => null);
const getEncounter = vi.fn();
const upsertEncounter = vi.fn();
const seedEncounters = vi.fn();
const recordAuditServer = vi.fn();
const listEncounters = vi.fn(async (): Promise<unknown[]> => []);
const getQueueState = vi.fn(async () => ({ currentCall: null, recentCalls: [] }));
const takeBackup = vi.fn(async () => ({ filename: "b.json", bytes: 1, sha256: "x", at: new Date().toISOString() }));
// Uniqueness itself is unit-tested in queue.test.ts (mintUniqueToken); here
// the mock stands in for the storage-backed wrapper so route tests pin the
// wiring: fresh writes go through it, resubmissions keep their token.
const ensureUniqueToken = vi.fn(async (_encounterId: string, candidate: string) => candidate);
const pushEncounterToHis = vi.fn(async () => ({
  state: "skipped",
  mode: "none",
  detail: "not configured",
}));
const llmJson = vi.fn(async (): Promise<unknown> => null);

vi.mock("@/lib/server/auth", () => ({
  currentUser,
  verifyToken,
  revokeUserSessions,
  revokeSession,
  SESSION_COOKIE,
}));
vi.mock("@/lib/server/llm", () => ({
  llmJson,
  completeText: vi.fn(async () => null),
  llmAvailable: () => false,
}));
vi.mock("@/lib/server/db", () => ({
  getEncounterForStaff,
  getEncounterForStaffOrBreakGlass,
  getEncounter,
  listEncounters,
  getQueueState,
  takeBackup,
  ensureUniqueToken,
  upsertEncounter,
  seedEncounters,
  patchEncounter: vi.fn(),
  recordAuditServer,
  listEncountersForStaff: vi.fn(),
  saveUpload: vi.fn(),
}));
vi.mock("@/lib/server/his", () => ({
  latestHisDelivery,
  hisConfig: () => ({ mode: "fhir", fhirUrl: "https://his.internal/fhir", hl7Host: "", hl7Port: 0 }),
  hisConfigured: () => true,
  toPublicDelivery: (d: unknown) => d,
  pushEncounterToHis,
}));
// The routes under test are about authorization; CSRF and rate limiting are
// covered by security.test.ts. Neutralise both so these tests isolate the
// decision they actually assert.
vi.mock("@/lib/server/csrf", () => ({ csrfGuard: () => ({ ok: true }) }));
vi.mock("@/lib/server/rateLimit", () => ({
  rateLimit: (...args: [string, number, number]) => rateLimitMock(...args),
  routeRateLimitKey: () => "test",
}));
// Parameter names document the real signature; values are ignored by default.
const rateLimitMock = vi.fn(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  (_key: string, _max: number, _windowMs: number) => true
);
vi.mock("@/lib/server/maintenance", () => ({ maintenanceActive: async () => false }));
// next/headers cookies() throws outside a request scope — the logout route is
// about revocation wiring, so stub the cookie jar with a fixed token.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "stub-token" }) }),
}));
vi.mock("@/lib/server/settings", () => ({
  readSettings: async () => ({ hospitalName: "Test Hospital", departments: ["General Medicine"], configured: true }),
}));
vi.mock("@/lib/server/notify", () => ({ notifyPatient: vi.fn() }));
vi.mock("@/lib/demoData", () => ({ buildDemoPatients: () => [] }));
// log() appends to data/logs/app.log — the authorization assertions must not
// depend on (or pollute) the real data dir.
vi.mock("@/lib/server/log", () => ({ log: vi.fn() }));

type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

function ctx(id = "enc-1") {
  return { params: Promise.resolve({ id }) };
}

/** No Origin/Referer — csrfGuard's documented non-browser exemption. */
function post(path: string, body: unknown = {}) {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/his/[id] authorization", () => {
  it("rejects an anonymous caller even when a delivery receipt exists", async () => {
    // The original check was `if (!user && !delivery)` — auth was required only
    // when there was NO receipt. That is inverted: it handed anonymous callers a
    // 200 for every id that had been exported, i.e. an existence oracle across
    // the whole clinical store, and disclosed `configured` + transport `mode`.
    currentUser.mockResolvedValue(null);
    latestHisDelivery.mockResolvedValue({ state: "delivered", at: "2026-01-01T00:00:00.000Z" });

    const { GET } = (await import("@/app/api/his/[id]/route")) as { GET: Handler };
    const res = await GET(new Request("http://localhost:3000/api/his/enc-1"), ctx());

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ ok: false });
  });

  it("rejects an anonymous caller when no delivery exists", async () => {
    currentUser.mockResolvedValue(null);
    latestHisDelivery.mockResolvedValue(null);

    const { GET } = (await import("@/app/api/his/[id]/route")) as { GET: Handler };
    const res = await GET(new Request("http://localhost:3000/api/his/enc-1"), ctx());

    expect(res.status).toBe(401);
  });

  it("still refuses a signed-in user for a record their consent does not cover", async () => {
    currentUser.mockResolvedValue({ username: "dr", role: "doctor" });
    getEncounterForStaff.mockResolvedValue(null);

    const { GET } = (await import("@/app/api/his/[id]/route")) as { GET: Handler };
    const res = await GET(new Request("http://localhost:3000/api/his/enc-1"), ctx());

    expect(res.status).toBe(404);
  });

  it("serves staff whose consent covers the record", async () => {
    currentUser.mockResolvedValue({ username: "dr", role: "doctor" });
    getEncounterForStaff.mockResolvedValue({ encounterId: "enc-1" });
    latestHisDelivery.mockResolvedValue({ state: "delivered", at: "2026-01-01T00:00:00.000Z" });

    const { GET } = (await import("@/app/api/his/[id]/route")) as { GET: Handler };
    const res = await GET(new Request("http://localhost:3000/api/his/enc-1"), ctx());

    expect(res.status).toBe(200);
  });
});

describe("POST /api/encounters/seed authorization", () => {
  it("refuses a non-admin signed-in user", async () => {
    // Seeding injects fabricated patients into the live clinical store, the OPD
    // register and the surveillance feed. It previously accepted any signed-in
    // role, so a nurse or pharmacist could pollute all three.
    currentUser.mockResolvedValue({ username: "nurse", role: "nurse" });

    const { POST } = (await import("@/app/api/encounters/seed/route")) as { POST: Handler };
    const res = await POST(post("/api/encounters/seed"), ctx());

    expect(res.status).toBe(403);
    expect(seedEncounters).not.toHaveBeenCalled();
  });

  it("refuses an anonymous caller", async () => {
    currentUser.mockResolvedValue(null);

    const { POST } = (await import("@/app/api/encounters/seed/route")) as { POST: Handler };
    const res = await POST(post("/api/encounters/seed"), ctx());

    expect(res.status).toBe(401);
    expect(seedEncounters).not.toHaveBeenCalled();
  });

  it("allows an admin", async () => {
    currentUser.mockResolvedValue({ username: "admin", role: "admin" });
    seedEncounters.mockResolvedValue(3);

    const { POST } = (await import("@/app/api/encounters/seed/route")) as { POST: Handler };
    const res = await POST(post("/api/encounters/seed"), ctx());

    expect(res.status).toBe(200);
    expect(seedEncounters).toHaveBeenCalledOnce();
  });
});

describe("POST /api/encounters does not echo the stored record", () => {
  const minimalSubmission = {
    encounterId: "enc-leak",
    updatedAt: "2020-01-01T00:00:00.000Z",
    mode: "allopathic",
    enteredAt: "2026-06-01T00:00:00.000Z",
    patient: { name: "Attacker", age: 30, sex: "Male" },
    history: { chiefComplaint: "cough" },
  };

  /** The record an attacker would be after: someone else's PHI. */
  const storedRecord = {
    encounterId: "enc-leak",
    updatedAt: "2026-06-01T00:00:00.000Z",
    enteredAt: "2026-06-01T00:00:00.000Z",
    mode: "allopathic",
    status: "pending",
    patient: {
      name: "Real Patient",
      abhaId: "11-0000-0001-2349",
      mobile: "9876543210",
      age: 62,
    },
    history: { chiefComplaint: "chest pain" },
    vitals: { heartRate: 120 },
    redFlags: [],
    interactions: [],
    documents: [],
    summary: "Chest pain, hypertensive",
    doctorNote: "Review in cardiology",
    audit: [{ action: "note_added", at: "2026-06-01T00:00:00.000Z", origin: "doctor" }],
  };

  it("does not return the stored record on an idempotent retry", async () => {
    // This endpoint is unauthenticated and `encounterId` is published by the
    // public queue route, so an anonymous caller could retrieve the full stored
    // record — name, ABHA, mobile, vitals, clinician note — by supplying the id
    // plus any timestamp older than the record's own.
    currentUser.mockResolvedValue(null);
    getEncounter.mockResolvedValue(storedRecord);
    upsertEncounter.mockResolvedValue(storedRecord);

    const { POST } = (await import("@/app/api/encounters/route")) as { POST: Handler };
    const res = await POST(post("/api/encounters", minimalSubmission), ctx());
    const body = await res.json();

    expect(body.duplicate).toBe(true);
    expect(body.encounter).toBeUndefined();
    // No PHI from the stored record may appear anywhere in the response.
    const serialised = JSON.stringify(body);
    for (const secret of ["Real Patient", "11-0000-0001-2349", "9876543210", "Chest pain", "Review in cardiology"]) {
      expect(serialised).not.toContain(secret);
    }
  });

  it("does not return the stored record on a fresh write", async () => {
    currentUser.mockResolvedValue(null);
    getEncounter.mockResolvedValue(null);
    upsertEncounter.mockResolvedValue({ ...storedRecord, patient: minimalSubmission.patient });

    const { POST } = (await import("@/app/api/encounters/route")) as { POST: Handler };
    const res = await POST(
      post("/api/encounters", { ...minimalSubmission, updatedAt: undefined }),
      ctx()
    );
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.encounter).toBeUndefined();
  });

  it("still returns an escalation policy so the kiosk can act on red flags", async () => {
    currentUser.mockResolvedValue(null);
    getEncounter.mockResolvedValue(storedRecord);
    upsertEncounter.mockResolvedValue(storedRecord);

    const { POST } = (await import("@/app/api/encounters/route")) as { POST: Handler };
    const res = await POST(post("/api/encounters", minimalSubmission), ctx());
    const body = await res.json();

    expect(body.escalation).toBeDefined();
    expect(body.encounterId).toBe("enc-leak");
  });

  it("rate-limits anonymous submissions instead of writing unboundedly", async () => {
    // Every accepted write fans out to disk, SMS and the HIS push — without a
    // budget one client could fill the disk and pump SMS anonymously.
    rateLimitMock.mockReturnValueOnce(false);

    const { POST } = (await import("@/app/api/encounters/route")) as { POST: Handler };
    const res = await POST(post("/api/encounters", minimalSubmission), ctx());

    expect(res.status).toBe(429);
    expect(upsertEncounter).not.toHaveBeenCalled();
  });

  it("coerces an unparseable enteredAt instead of storing NaN poison", async () => {
    // Queue math does date arithmetic on enteredAt; a garbage value would
    // store fine and then surface as "NaN min" with unstable queue order.
    currentUser.mockResolvedValue(null);
    getEncounter.mockResolvedValue(null);
    upsertEncounter.mockImplementation(async (r: unknown) => r);

    const { POST } = (await import("@/app/api/encounters/route")) as { POST: Handler };
    const res = await POST(
      post("/api/encounters", { ...minimalSubmission, enteredAt: "not-a-date" }),
      ctx()
    );

    expect(res.status).toBe(200);
    const saved = upsertEncounter.mock.calls[0][0] as { enteredAt: string };
    expect(Number.isFinite(new Date(saved.enteredAt).getTime())).toBe(true);
  });

  it("mints the queue token through the uniqueness check on fresh writes", async () => {
    // Duplicate tokens merge two patients into one call identity on the
    // display, the slip and the position lookup — a fresh write must go
    // through ensureUniqueToken, and the stored record must carry exactly the
    // token the response reports.
    currentUser.mockResolvedValue(null);
    getEncounter.mockResolvedValue(null);
    ensureUniqueToken.mockResolvedValue("TK-7777");
    upsertEncounter.mockImplementation(async (r: unknown) => r);

    const { POST } = (await import("@/app/api/encounters/route")) as { POST: Handler };
    const res = await POST(post("/api/encounters", { ...minimalSubmission, token: "TK-1042" }), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(ensureUniqueToken).toHaveBeenCalledWith("enc-leak", "TK-1042");
    expect(body.token).toBe("TK-7777");
    const saved = upsertEncounter.mock.calls[0][0] as { token: string };
    expect(saved.token).toBe("TK-7777");
  });

  it("keeps a resubmission on its original token", async () => {
    currentUser.mockResolvedValue(null);
    getEncounter.mockResolvedValue({ ...storedRecord, status: "pending", token: "TK-1042" });
    upsertEncounter.mockImplementation(async (r: unknown) => r);

    const { POST } = (await import("@/app/api/encounters/route")) as { POST: Handler };
    const res = await POST(
      post("/api/encounters", {
        ...minimalSubmission,
        token: "TK-1042",
        updatedAt: new Date(Date.now() + 60_000).toISOString(),
      }),
      ctx()
    );

    expect(res.status).toBe(200);
    expect(ensureUniqueToken).not.toHaveBeenCalled();
    const saved = upsertEncounter.mock.calls[0][0] as { token: string };
    expect(saved.token).toBe("TK-1042");
  });

  it("flags a same-day possible duplicate on the new record without blocking", async () => {
    // Two kiosks, one patient: the second registration must warn, never fail.
    const today = new Date().toISOString();
    currentUser.mockResolvedValue(null);
    getEncounter.mockResolvedValue(null);
    listEncounters.mockResolvedValue([
      {
        encounterId: "enc-twin",
        enteredAt: today,
        status: "pending",
        token: "TK-1111",
        patient: { abhaId: "NEW-REGISTER", name: "Same Person", mobile: "9876500001" },
      },
    ]);
    upsertEncounter.mockImplementation(async (r: unknown) => r);

    const { POST } = (await import("@/app/api/encounters/route")) as { POST: Handler };
    const res = await POST(
      post("/api/encounters", {
        ...minimalSubmission,
        encounterId: "enc-second",
        enteredAt: today,
        updatedAt: today,
        patient: { name: "Same Person", age: 30, sex: "Male", mobile: "9876500001" },
      }),
      ctx()
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.duplicateWarning?.encounterId).toBe("enc-twin");
    const saved = upsertEncounter.mock.calls[0][0] as {
      possibleDuplicateOf?: { encounterId: string };
    };
    expect(saved.possibleDuplicateOf?.encounterId).toBe("enc-twin");
    expect(recordAuditServer).toHaveBeenCalledWith(
      "enc-second",
      "possible_duplicate",
      expect.stringContaining("enc-twin"),
      "system"
    );
  });

  it("stores no duplicate flag when nobody matches", async () => {
    currentUser.mockResolvedValue(null);
    getEncounter.mockResolvedValue(null);
    listEncounters.mockResolvedValue([]);
    upsertEncounter.mockImplementation(async (r: unknown) => r);

    const { POST } = (await import("@/app/api/encounters/route")) as { POST: Handler };
    const res = await POST(post("/api/encounters", minimalSubmission), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.duplicateWarning).toBeNull();
  });

  it("clamps a wild client clock instead of letting it win arbitration forever", async () => {
    // Last-write-wins trusts updatedAt; a kiosk stuck in 2099 would beat every
    // future legitimate write. Skew beyond a day is stamped with server time
    // (the kiosk keeps working — no 400 for a dying CMOS battery).
    currentUser.mockResolvedValue(null);
    getEncounter.mockResolvedValue(null);
    listEncounters.mockResolvedValue([]);
    upsertEncounter.mockImplementation(async (r: unknown) => r);

    const { POST } = (await import("@/app/api/encounters/route")) as { POST: Handler };
    const res = await POST(
      post("/api/encounters", { ...minimalSubmission, updatedAt: "2099-01-01T00:00:00.000Z" }),
      ctx()
    );

    expect(res.status).toBe(200);
    const saved = upsertEncounter.mock.calls[0][0] as { updatedAt: string };
    const storedMs = new Date(saved.updatedAt).getTime();
    expect(Math.abs(storedMs - Date.now())).toBeLessThan(24 * 3600 * 1000);
    expect(new Date(saved.updatedAt).getFullYear()).not.toBe(2099);
  });
});

describe("POST /api/camp abuse controls", () => {
  const campBody = { campId: "camp-1", name: "Screened Person", age: 40, consentGranted: true };

  it("refuses to store a screening without explicit consent", async () => {
    // Camp capture previously saved every record as implicitly consented with
    // no UI at all. The form now ticks consent per patient and the route
    // rejects anything else — including older queued payloads that predate
    // the checkbox (they fail closed with a clear error, not silent storage).
    const { POST } = (await import("@/app/api/camp/route")) as { POST: Handler };
    const res = await POST(
      post("/api/camp", { campId: "camp-1", name: "Screened Person", age: 40, clientId: "abc-12345" }),
      ctx()
    );

    expect(res.status).toBe(400);
    expect(upsertEncounter).not.toHaveBeenCalled();
  });

  it("refuses to overwrite a record that has already been processed", async () => {
    // campId + clientId mint a deterministic id, so replaying them previously
    // upserted over an existing record — letting an unauthenticated caller flip
    // a doctor-reviewed or dispensed camp record back to "pending".
    getEncounter.mockResolvedValue({ encounterId: "camp-camp-1-abc-12345", status: "dispensed", updatedAt: "2026-01-01T00:00:00.000Z" });

    const { POST } = (await import("@/app/api/camp/route")) as { POST: Handler };
    const res = await POST(post("/api/camp", { ...campBody, clientId: "abc-12345" }), ctx());
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.duplicate).toBe(true);
    expect(upsertEncounter).not.toHaveBeenCalled();
  });

  it("stores a normalized granular consent, never a bare true", async () => {
    getEncounter.mockResolvedValue(null);
    upsertEncounter.mockResolvedValue({ encounterId: "camp-camp-1-abc-12345" });

    const { POST } = (await import("@/app/api/camp/route")) as { POST: Handler };
    await POST(post("/api/camp", { ...campBody, clientId: "abc-12345" }), ctx());

    const saved = upsertEncounter.mock.calls[0][0];
    // A bare `consentGranted: true` left the granular scopes implicit. The
    // normalized state must not claim HIS export or external AI processing.
    expect(saved.consent).toBeDefined();
    expect(saved.consent.granted).not.toContain("ai_processing");
    expect(saved.consent.granted).not.toContain("his_emr_export");
  });
});

describe("external-model consent gates", () => {
  const baseRecord = {
    encounterId: "enc-ai",
    status: "pending",
    redFlags: [],
    summary: "Chest pain",
    history: { chiefComplaint: "chest pain" },
    patient: { name: "P", age: 50, sex: "Male", vitals: {} },
  };
  const clinicalOnly = {
    granted: ["history_capture", "clinical_care"],
    decidedAt: "2026-01-01T00:00:00.000Z",
  };
  const withAi = {
    granted: ["history_capture", "clinical_care", "ai_processing"],
    decidedAt: "2026-01-01T00:00:00.000Z",
  };

  it("GET /api/patient/[id]/ai withholds a consent-revoked record", async () => {
    // The route previously read via raw getEncounter after auth, so any signed
    // in role could pull the clinical panel for a record the patient revoked.
    currentUser.mockResolvedValue({ username: "ph", role: "pharmacist" });
    getEncounterForStaff.mockResolvedValue(null);

    const { GET } = (await import("@/app/api/patient/[id]/ai/route")) as { GET: Handler };
    const res = await GET(new Request("http://localhost:3000/api/patient/enc-ai/ai"), ctx("enc-ai"));

    expect(res.status).toBe(404);
    expect(llmJson).not.toHaveBeenCalled();
  });

  it("GET /api/patient/[id]/ai stays offline without the ai_processing scope", async () => {
    currentUser.mockResolvedValue({ username: "dr", role: "doctor" });
    getEncounterForStaff.mockResolvedValue({ ...baseRecord, consent: clinicalOnly });

    const { GET } = (await import("@/app/api/patient/[id]/ai/route")) as { GET: Handler };
    const res = await GET(new Request("http://localhost:3000/api/patient/enc-ai/ai"), ctx("enc-ai"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe("rules-engine");
    expect(body.panel).toBeDefined();
    expect(llmJson).not.toHaveBeenCalled();
  });

  it("POST /api/rx/dictate stays rule-based when the linked record lacks ai_processing", async () => {
    currentUser.mockResolvedValue({ username: "dr", role: "doctor" });
    getEncounter.mockResolvedValue({ ...baseRecord, consent: clinicalOnly });

    const { POST } = (await import("@/app/api/rx/dictate/route")) as { POST: Handler };
    const res = await POST(
      post("/api/rx/dictate", { text: "Paracetamol 500mg twice daily for 3 days", encounterId: "enc-ai" }),
      ctx()
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.hinted).toBe(false);
    expect(body.draft.some((d: { name: string }) => d.name === "paracetamol")).toBe(true);
    expect(llmJson).not.toHaveBeenCalled();
  });

  it("POST /api/rx/dictate may use the model when ai_processing was granted", async () => {
    currentUser.mockResolvedValue({ username: "dr", role: "doctor" });
    getEncounter.mockResolvedValue({ ...baseRecord, consent: withAi });
    llmJson.mockResolvedValueOnce({ items: [{ name: "Paracetamol", dosage: "500mg" }] });

    const { POST } = (await import("@/app/api/rx/dictate/route")) as { POST: Handler };
    const res = await POST(
      post("/api/rx/dictate", { text: "Paracetamol 500mg", encounterId: "enc-ai" }),
      ctx()
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.hinted).toBe(true);
    expect(llmJson).toHaveBeenCalledTimes(1);
  });
});

describe("pre-save external-AI consent gates", () => {
  const aiConsent = {
    granted: ["history_capture", "clinical_care", "ai_processing"],
    decidedAt: "2026-01-01T00:00:00.000Z",
  };
  const noAiConsent = {
    granted: ["history_capture", "clinical_care"],
    decidedAt: "2026-01-01T00:00:00.000Z",
  };

  it("POST /api/converse refuses without the ai_processing scope", async () => {
    // The patient's words go to an external model — without the explicit
    // scope the kiosk must stay on the guided interview flow.
    const { POST } = (await import("@/app/api/converse/route")) as { POST: Handler };
    const res = await POST(post("/api/converse", { chiefComplaint: "fever", consent: noAiConsent }), ctx());

    expect(res.status).toBe(403);
  });

  it("POST /api/converse passes the gate with ai_processing granted", async () => {
    // No OPENAI_API_KEY in tests, so a passed gate surfaces as 501 (no
    // backend) rather than 403 (no consent) — the distinction under test.
    const { POST } = (await import("@/app/api/converse/route")) as { POST: Handler };
    const res = await POST(post("/api/converse", { chiefComplaint: "fever", consent: aiConsent }), ctx());

    expect(res.status).toBe(501);
  });

  it("POST /api/asr refuses backend transcription without the ai_processing scope", async () => {
    const { POST } = (await import("@/app/api/asr/route")) as { POST: Handler };
    const res = await POST(
      post("/api/asr", { audioBase64: "AAAA", consent: noAiConsent }),
      ctx()
    );

    expect(res.status).toBe(403);
  });

  it("POST /api/extract still answers from the rules engine without ai_processing", async () => {
    // Extraction degrades to the offline heuristic — declining external
    // processing loses the structuring upgrade, nothing else.
    const { POST } = (await import("@/app/api/extract/route")) as { POST: Handler };
    const res = await POST(
      post("/api/extract", { text: "Tab. Metformin 500mg", consent: noAiConsent }),
      ctx()
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(
      body.entities.entities.medications.some((m: { name: string }) => m.name.toLowerCase() === "metformin")
    ).toBe(true);
  });
});

describe("POST /api/staff/break-glass", () => {
  it("rejects an anonymous activation", async () => {
    currentUser.mockResolvedValue(null);

    const { POST } = (await import("@/app/api/staff/break-glass/route")) as { POST: Handler };
    const res = await POST(post("/api/staff/break-glass", { reason: "Unconscious patient" }), ctx());

    expect(res.status).toBe(401);
    expect(recordAuditServer).not.toHaveBeenCalled();
  });

  it("rejects an activation without a clinical justification", async () => {
    currentUser.mockResolvedValue({ username: "dr", role: "doctor" });

    const { POST } = (await import("@/app/api/staff/break-glass/route")) as { POST: Handler };
    const res = await POST(post("/api/staff/break-glass", { reason: "   " }), ctx());

    expect(res.status).toBe(400);
    expect(recordAuditServer).not.toHaveBeenCalled();
  });

  it("records the override on the named encounter with clinician + reason", async () => {
    // The dialog used to flip a local badge and record nothing server-side,
    // despite promising immutable audit. The activation must land an audit
    // entry carrying who overrode and why.
    currentUser.mockResolvedValue({ username: "dr", role: "doctor" });
    getEncounter.mockResolvedValue({ encounterId: "enc-er" });

    const { POST } = (await import("@/app/api/staff/break-glass/route")) as { POST: Handler };
    const res = await POST(
      post("/api/staff/break-glass", { reason: "Unconscious RTA victim", encounterId: "enc-er" }),
      ctx()
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(recordAuditServer).toHaveBeenCalledWith(
      "enc-er",
      "break_glass_override",
      expect.stringContaining("Unconscious RTA victim"),
      "dr"
    );
  });

  it("serves the activation list to admins only", async () => {
    currentUser.mockResolvedValue({ username: "dr", role: "doctor" });

    const { GET } = (await import("@/app/api/staff/break-glass/route")) as {
      GET: () => Promise<Response>;
    };
    expect((await GET()).status).toBe(403);

    currentUser.mockResolvedValue({ username: "root", role: "admin" });
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
  });
});

describe("break-glass emergency reads", () => {
  const revokedRecord = {
    encounterId: "enc-revoked",
    status: "pending",
    redFlags: [],
    patient: { name: "P", age: 60 },
    history: {},
    // Clinical-care consent revoked: staff reads are normally withheld.
    consent: { granted: [], revokedAt: "2026-01-01T00:00:00.000Z" },
    consentGranted: false,
  };

  it("still withholds a revoked record with no live activation", async () => {
    currentUser.mockResolvedValue({ username: "dr", role: "doctor" });
    getEncounter.mockResolvedValue(revokedRecord);
    getEncounterForStaffOrBreakGlass.mockResolvedValue(null);

    const { GET } = (await import("@/app/api/encounters/[id]/route")) as { GET: Handler };
    const res = await GET(new Request("http://localhost:3000/api/encounters/enc-revoked"), ctx("enc-revoked"));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.code).toBe("consent_revoked");
    expect(recordAuditServer).not.toHaveBeenCalled();
  });

  it("opens a revoked record under a live activation and audits the override", async () => {
    currentUser.mockResolvedValue({ username: "dr", role: "doctor" });
    getEncounter.mockResolvedValue(revokedRecord);
    getEncounterForStaffOrBreakGlass.mockResolvedValue({ encounter: revokedRecord, viaBreakGlass: true });

    const { GET } = (await import("@/app/api/encounters/[id]/route")) as { GET: Handler };
    const res = await GET(new Request("http://localhost:3000/api/encounters/enc-revoked"), ctx("enc-revoked"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.viaBreakGlass).toBe(true);
    expect(body.encounter.encounterId).toBe("enc-revoked");
    expect(recordAuditServer).toHaveBeenCalledWith(
      "enc-revoked",
      "break_glass_override",
      expect.stringContaining("dr"),
      "dr"
    );
  });
});

describe("sign-out and export hardening", () => {
  it("logout revokes every session of the user, not just the presented token", async () => {
    // Per-token revocation left sessions on other stations valid for up to 8h
    // after the user believed they signed out of a shared terminal.
    verifyToken.mockReturnValue({ username: "dr", role: "doctor" });

    const { POST } = (await import("@/app/api/auth/logout/route")) as { POST: Handler };
    const res = await POST(
      new Request("http://localhost:3000/api/auth/logout", { method: "POST" }),
      ctx()
    );

    expect(res.status).toBe(200);
    expect(revokeUserSessions).toHaveBeenCalledWith("dr");
  });

  it("admin CSV export neutralises spreadsheet formulas in patient fields", async () => {
    currentUser.mockResolvedValue({ username: "root", role: "admin" });
    listEncounters.mockResolvedValue([
      {
        encounterId: "enc-1",
        enteredAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        status: "pending",
        mode: "allopathic",
        patient: { name: "=2+2", age: 40, sex: "Male" },
        redFlags: [],
        summary: "",
      },
    ]);

    const { GET } = (await import("@/app/api/admin/export/route")) as {
      GET: (req: Request) => Promise<Response>;
    };
    const res = await GET(new Request("http://localhost:3000/api/admin/export?format=csv"));
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toContain("'=2+2");
    // No unprotected formula cell may survive: every field starting with =
    // must carry the text-forcing quote.
    expect(text).not.toMatch(/,=2\+2/);
  });

  it("appointment booking rejects off-list departments", async () => {
    const { POST } = (await import("@/app/api/appointments/route")) as { POST: Handler };
    const res = await POST(
      post("/api/appointments", {
        name: "X",
        mobile: "9876501234",
        department: "Onkology",
        date: "2026-10-02",
        slot: "10:00",
      }),
      ctx()
    );

    expect(res.status).toBe(400);
  });

  it("rejects declared-oversize bodies before parsing", async () => {
    // content-length is a forbidden request header (undici drops it), so the
    // wiring is exercised with a minimal stub: the guard reads only headers
    // and returns before req.json() ever runs.
    const { POST } = (await import("@/app/api/camp/route")) as { POST: Handler };
    const req = {
      headers: { get: (name: string) => (name.toLowerCase() === "content-length" ? "99999999" : null) },
      json: async () => {
        throw new Error("must not parse");
      },
    } as unknown as Request;
    const res = await POST(req, ctx());

    expect(res.status).toBe(413);
  });
});
