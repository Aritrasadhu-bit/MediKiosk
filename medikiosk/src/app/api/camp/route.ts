import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { csrfGuard } from "@/lib/server/csrf";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";
import { bodyTooLarge, payloadTooLarge } from "@/lib/server/bodyLimit";
import { campScreenedSchema, safeParse } from "@/lib/validation";
import { upsertEncounter, recordAuditServer, getEncounter, ensureUniqueToken, listEncounters } from "@/lib/server/db";
import { findSameDayDuplicates } from "@/lib/duplicates";
import { deriveQueueToken } from "@/lib/queue";
import { maintenanceActive } from "@/lib/server/maintenance";
import { log } from "@/lib/server/log";
import { normalizeConsent } from "@/lib/consent";
import type { ClinicalHistory, StoredHistory } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Screening-camp quick capture (Batch B, U2).
 *
 * Outreach / camp mode: a health worker (or the kiosk offline) captures a
 * minimal record — name, age, symptoms, village — at high throughput. These
 * become real pending encounters so they flow into the same queue, register
 * and surveillance feed. Offline captures queue in the browser outbox and
 * replay to this same endpoint, so nothing is lost when the camp has no
 * connectivity.
 */
export async function POST(req: Request) {
  const csrf = csrfGuard(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, error: csrf.error }, { status: 403 });
  if (bodyTooLarge(req, 64 * 1024)) return payloadTooLarge();

  // Unauthenticated and previously unrated: sustained write amplification into
  // the clinical store, the OPD register and the surveillance feed. A busy camp
  // is bursty but nowhere near this volume, so the ceiling is generous.
  if (!rateLimit(routeRateLimitKey(req), 30, 60_000)) {
    return NextResponse.json({ ok: false, error: "Rate limit exceeded. Retry shortly.", retryable: true }, { status: 429 });
  }

  // Maintenance mode (R5): refuse writes; offline captures stay in the outbox.
  if (await maintenanceActive()) {
    return NextResponse.json(
      { ok: false, error: "Camp sync is paused for maintenance — queued captures will replay shortly.", retryable: true },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsed = safeParse(campScreenedSchema, body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }
  const data = parsed.data;

  // Screening consent is collected per patient on the camp form (a mandatory,
  // default-unticked checkbox). Without an explicit grant the record must not
  // be stored — previously every camp capture was saved as implicitly
  // consented with no UI at all.
  if (!data.consentGranted) {
    return NextResponse.json(
      { ok: false, error: "Screening consent is required — tick the consent checkbox for this patient." },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const campSlug = data.campId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 24) || "camp";
  // Deterministic id from the offline clientId when present — an outbox replay
  // of the same capture resolves to the SAME encounter (no duplicate tokens);
  // otherwise a fresh random id.
  const encounterId = data.clientId
    ? `camp-${campSlug}-${data.clientId.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 48)}`
    : `camp-${campSlug}-${randomUUID()}`;

  // Replaying a known campId + clientId mints a deterministic id, so without
  // this guard `upsertEncounter` would overwrite an existing record — letting an
  // unauthenticated caller flip a doctor-reviewed or dispensed camp record back
  // to "pending" and reset its clinician fields. Mirrors the guard in
  // POST /api/encounters.
  const preExisting = await getEncounter(encounterId);
  if (preExisting && preExisting.status && preExisting.status !== "pending") {
    return NextResponse.json(
      { ok: false, error: "This camp record has already been processed and can no longer be updated.", duplicate: true },
      { status: 409 }
    );
  }

  // A replay of a still-pending record keeps its token; a brand-new record
  // gets a token nobody else holds (duplicate tokens merge two patients into
  // one call identity — see ensureUniqueToken).
  const token = preExisting?.token ?? (await ensureUniqueToken(encounterId, deriveQueueToken(encounterId)));

  // Same-day duplicate warning (fresh captures only): warn, never block.
  // Camp throughput makes double-screening likely — the flag lands on the new
  // record so the physician queue can badge it.
  const duplicateWarning =
    !preExisting
      ? findSameDayDuplicates(
          { encounterId, enteredAt: now, patient: { abhaId: "CAMP-REGISTER", name: data.name.trim(), mobile: data.mobile } },
          await listEncounters()
        )[0] ?? null
      : null;

  const campHistory: ClinicalHistory = {
    name: data.name.trim(),
    age: data.age,
    sex: data.sex ?? "Other",
    chiefComplaint: data.symptoms || "Symptom screening",
    hpi: data.symptoms
      ? `Camp screening — presenting symptoms: ${data.symptoms}`
      : "Camp screening — asymptomatic / routine check",
    pastMedical: [],
    pastSurgical: [],
    medications: [],
    allergies: [],
    familyHistory: "",
    personalHistory: "",
    reviewOfSystems: [],
    priorInvestigations: [],
  };

  const record: StoredHistory = {
    encounterId,
    updatedAt: now,
    patient: {
      abhaId: "CAMP-REGISTER",
      name: data.name.trim(),
      age: data.age,
      sex: data.sex ?? "Other",
      mobile: data.mobile || undefined,
      department: "Screening Camp",
    },
    mode: "allopathic",
    lang: data.lang ?? "en",
    voiceCode: data.voiceCode ?? "en-IN",
    enteredAt: now,
    history: campHistory,
    documents: [],
    redFlags: [],
    interactions: [],
    summary: data.symptoms ? `Camp screen: ${data.symptoms}` : "Camp screen: routine",
    // Consent was ticked per patient on the camp form (enforced above), so the
    // legacy boolean is a real grant — normalized so the record carries an
    // explicit granular ConsentState that can never imply `his_emr_export` or
    // `ai_processing`.
    consentGranted: true,
    consent: normalizeConsent(undefined, true),
    status: "pending",
    token,
    possibleDuplicateOf: duplicateWarning
      ? { encounterId: duplicateWarning.encounterId, token: duplicateWarning.token, reason: duplicateWarning.reason }
      : undefined,
    audit: [
      {
        action: "camp_screened",
        at: now,
        detail: `Camp ${data.campId}${data.village ? ` · ${data.village}` : ""}${data.offline ? " · queued offline" : ""}`,
        origin: "server",
      },
    ],
    camp: { campId: data.campId, village: data.village },
  };

  await upsertEncounter(record);
  await recordAuditServer(encounterId, "camp_screened", `Camp ${data.campId} screen complete`, "camp-worker");
  if (duplicateWarning) {
    await recordAuditServer(
      encounterId,
      "possible_duplicate",
      `Same-day possible duplicate of ${duplicateWarning.encounterId} (${duplicateWarning.reason})`,
      "camp-worker"
    );
  }
  log("info", "camp", "screening recorded", { campId: data.campId, village: data.village, offline: data.offline });

  return NextResponse.json({
    ok: true,
    encounter: { encounterId, token, name: data.name, village: data.village },
    duplicateWarning,
  });
}