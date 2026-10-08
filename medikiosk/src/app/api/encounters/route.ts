import { NextResponse } from "next/server";
import {
  listEncounters,
  listEncountersForStaffOrBreakGlass,
  upsertEncounter,
  patchEncounter,
  getEncounter,
  ensureUniqueToken,
  recordAuditServer,
} from "@/lib/server/db";
import { findSameDayDuplicates } from "@/lib/duplicates";
import { currentUser } from "@/lib/server/auth";
import { normalizeConsent } from "@/lib/consent";
import { encounterSchema, safeParse } from "@/lib/validation";
import { csrfGuard } from "@/lib/server/csrf";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";
import { escalationPolicy } from "@/lib/escalation";
import { deriveQueueToken } from "@/lib/queue";
import { notifyPatient } from "@/lib/server/notify";
import { buildReferralSlip } from "@/lib/referral";
import { maintenanceActive } from "@/lib/server/maintenance";
import { pushEncounterToHis, toPublicDelivery, type HisTransport } from "@/lib/server/his";

export const runtime = "nodejs";

/**
 * Name the transport for an audit entry without naming the endpoint. Audit
 * details are readable by the care team and shown in the patient portal, so
 * "FHIR R4" is acceptable and "https://his.internal/fhir" is not.
 */
function hisEndpointLabel(mode: HisTransport): string {
  return mode === "fhir" ? "FHIR R4" : mode === "hl7v2" ? "HL7 v2 (MLLP)" : "the hospital integration";
}

/**
 * Queue math, wait-time displays and duplicate arbitration all do date
 * arithmetic on `enteredAt`, and the schema accepts any short string — so a
 * garbage value would store fine and then poison every downstream computation
 * with NaN (wait-time "NaN min", unstable queue order). Coerce to now.
 */
function normalizeTimestamp(raw: string): string {
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString();
}

/**
 * Physician/admin read path — requires authentication, and withholds records
 * whose clinical-care consent the patient has revoked (unless a live
 * break-glass activation opens the emergency exception; those rows arrive
 * marked `viaBreakGlass` and every open is audited as an override).
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  }
  if (!rateLimit(routeRateLimitKey(req), 60, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests. Try again shortly." }, { status: 429 });
  }
  const { encounters, breakGlassActive } = await listEncountersForStaffOrBreakGlass();
  return NextResponse.json({ ok: true, encounters, breakGlassActive });
}

/** Kiosk submission path — a patient submitting their own consent-gated history is allowed. */
export async function POST(req: Request) {
  const csrf = csrfGuard(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, error: csrf.error }, { status: 403 });

  // This is the heaviest unauthenticated endpoint: every accepted write does a
  // store flush, an escalation evaluation, a possible SMS notification and a
  // possible HIS push. Without a budget, one client can fill the disk, pump
  // SMS to arbitrary numbers via crafted vitals + mobile, and hammer the
  // hospital integration — all anonymously. 429s are retryable: the kiosk
  // outbox backs off and replays.
  if (!rateLimit(routeRateLimitKey(req), 30, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests. Try again shortly." }, { status: 429 });
  }

  // Maintenance mode (R5): refuse writes so a backup/migration window never
  // silently drops patient data — the kiosk keeps the submission in its
  // offline outbox and retries once maintenance clears.
  if (await maintenanceActive()) {
    return NextResponse.json(
      { ok: false, error: "Kiosk is in maintenance mode — please try again in a few minutes.", retryable: true },
      { status: 503 }
    );
  }

  // Reject oversized bodies up front (before JSON.parse allocates).
  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (declaredLength > 8 * 1024 * 1024) {
    return NextResponse.json({ ok: false, error: "Payload too large." }, { status: 413 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = safeParse(encounterSchema, body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }
  const record = parsed.data as unknown as Parameters<typeof upsertEncounter>[0];

  // Array caps — reject rather than silently slice so records stay intact.
  if (
    (record.documents?.length ?? 0) > 25 ||
    (record.redFlags?.length ?? 0) > 40 ||
    (record.interactions?.length ?? 0) > 40 ||
    (record.audit?.length ?? 0) > 50
  ) {
    return NextResponse.json({ ok: false, error: "Too many documents/flags/interactions/audit entries." }, { status: 400 });
  }

  const submittedAt = record.updatedAt ? new Date(record.updatedAt).getTime() : 0;
  // Clock-skew guard: last-write-wins arbitration trusts the client's
  // updatedAt, so a kiosk with a wild FUTURE clock (year 2099) would permanently
  // win every merge. Only the future is clamped: old timestamps are harmless
  // by construction (last-write-wins buries them, which is exactly what
  // protects multi-day offline replays), and missing/unparseable ones become
  // server time. The kiosk keeps working either way — no 400 for a dying CMOS
  // battery. Tolerance is a day so legitimately offline kiosks are untouched.
  const nowMs = Date.now();
  const saneUpdatedAt =
    record.updatedAt &&
    Number.isFinite(submittedAt) &&
    submittedAt <= nowMs + 24 * 3600 * 1000
      ? record.updatedAt
      : new Date(nowMs).toISOString();
  const effectiveSubmittedAt = new Date(saneUpdatedAt).getTime();
  const preExisting = await getEncounter(record.encounterId);
  if (preExisting && preExisting.status && preExisting.status !== "pending") {
    // A processed record (seen by the doctor, escalated, dispensed…) must not be
    // overwritten by a public kiosk resubmission — the outbox retries against a
    // fresh token instead.
    return NextResponse.json(
      { ok: false, error: "This record has already been processed and can no longer be updated from the kiosk.", duplicate: true },
      { status: 409 }
    );
  }
  if (preExisting && preExisting.updatedAt && effectiveSubmittedAt && effectiveSubmittedAt <= new Date(preExisting.updatedAt).getTime()) {
    // An idempotent no-op retry. The stored record is deliberately NOT echoed:
    // this endpoint is unauthenticated (shared public kiosk) and the caller
    // supplies only `encounterId`, which is published by the public queue
    // route. Returning the record would hand anyone who knew or guessed an id
    // the patient's name, ABHA, mobile, vitals, summary and any clinician note
    // already on it. Nothing client-side reads this body — the outbox only
    // checks the HTTP status — so the escalation policy is all a caller needs.
    return NextResponse.json({
      ok: true,
      duplicate: true,
      encounterId: preExisting.encounterId,
      status: preExisting.status,
      escalation: escalationPolicy(preExisting),
    });
  }

  // Kiosk sanitization: only patient-facing fields may be written through this
  // public endpoint. Clinician-owned fields (doctorNote, diagnosis, referral,
  // dispensedAt) are never accepted here — on merge they survive untouched;
  // status is always forced to "pending" (no ER/confirmed forgery).
  //
  // The queue token is minted unique: a resubmission of a known record keeps
  // its token, while a brand-new record gets a token nobody else holds (see
  // ensureUniqueToken — duplicate tokens merge two patients into one call
  // identity on the display, the slip and the position lookup).
  const candidate = record.token || deriveQueueToken(record.encounterId);
  const token = preExisting ? preExisting.token ?? candidate : await ensureUniqueToken(record.encounterId, candidate);
  // Same-day duplicate warning (fresh writes only): another open encounter
  // looking like the same patient gets flagged ON THE NEW RECORD — warn, never
  // block. Needs the store scan anyway (see ensureUniqueToken above), so the
  // marginal cost is one pass over an in-memory list.
  const duplicateWarning =
    !preExisting && record.enteredAt
      ? findSameDayDuplicates(
          { encounterId: record.encounterId, enteredAt: normalizeTimestamp(record.enteredAt), patient: record.patient as never },
          await listEncounters()
        )[0] ?? null
      : null;
  const sanitized: Parameters<typeof upsertEncounter>[0] = {
    ...record,
    token,
    enteredAt: normalizeTimestamp(record.enteredAt),
    updatedAt: saneUpdatedAt,
    documents: record.documents ?? [],
    redFlags: record.redFlags ?? [],
    interactions: record.interactions ?? [],
    audit: (record.audit ?? []).slice(0, 50),
    summary: record.summary ?? "",
    consentGranted: record.consentGranted ?? false,
    // Granular consent is patient-supplied and must be normalized here so a
    // malformed or over-broad payload cannot widen what a clinician may read.
    // Revoking `clinical_care` after submission goes through the portal route.
    consent: normalizeConsent(record.consent, record.consentGranted ?? false),
    status: "pending",
    doctorNote: undefined,
    doctorDiagnosis: undefined,
    dispensedAt: undefined,
    referral: undefined,
    // Advisory duplicate flag (see above) — persisted so the physician queue
    // can badge it. Warnings, not blocks: genuine re-visits exist.
    possibleDuplicateOf: duplicateWarning
      ? { encounterId: duplicateWarning.encounterId, token: duplicateWarning.token, reason: duplicateWarning.reason }
      : undefined,
  };

  // Normalize to a fully-shaped StoredHistory. Every record ends up with a
  // queue token (kiosk-supplied, or derived deterministically when absent) so
  // the token slip / display / portal QR position always work.
  const saved = await upsertEncounter(sanitized);

  // Escalation policy engine: dangerous vitals auto-route to ER + notify on-call.
  const policy = escalationPolicy(saved);
  let final = saved;
  if (policy.level === "er" && saved.status !== "er") {
    final = (await patchEncounter(saved.encounterId, { status: "er" })) ?? saved;
    await recordAuditServer(
      saved.encounterId,
      "auto_escalated",
      `Automated ER escalation — ${policy.reasons.join("; ") || "threshold exceeded"}`,
      "system"
    );
    // Batch B (U7): attach a printable referral slip so the elevated patient
    // carries a structured handoff to the emergency / higher facility.
    const slip = buildReferralSlip(final, policy);
    final = (await patchEncounter(saved.encounterId, { referral: slip })) ?? final;
    await recordAuditServer(
      saved.encounterId,
      "referral_issued",
      `Referral slip ${slip.id} ’ ${slip.to}`,
      "system"
    );
  } else if (policy.level === "triage" && saved.status !== "triage") {
    await recordAuditServer(
      saved.encounterId,
      "triage_verified",
      `Auto-triage flag — ${policy.reasons.join("; ") || "borderline vitals"}`,
      "system"
    );
  }
  if (policy.notify && final.patient?.mobile) {
    await notifyPatient({
      mobile: final.patient.mobile,
      template: "er_escalation",
      vars: { token: final.token ?? final.encounterId.slice(0, 8).toUpperCase() },
    });
  }

  // Hand off to the hospital information system, if one is configured and the
  // patient consented to it. `pushEncounterToHis` never throws and records the
  // real outcome (delivered / failed / not configured / no consent) so the
  // /done screen reports the truth rather than an assumed success.
  let his: Awaited<ReturnType<typeof pushEncounterToHis>> | null = null;
  if (!preExisting) {
    his = await pushEncounterToHis(final);
    if (his.state === "delivered") {
      // Audit details are readable by the care team and surfaced in the patient
      // portal, so they record that the export happened and by which transport
      // — never the internal FHIR URL or HL7 host:port.
      await recordAuditServer(
        saved.encounterId,
        "his_export",
        `Record sent to the hospital information system over ${hisEndpointLabel(his.mode)}`,
        "system"
      );
    }
  }

  // Same reasoning as the idempotent branch above: this endpoint is
  // unauthenticated, so the response acknowledges the write without echoing
  // the stored record. `final` can carry a clinician note that survived the
  // merge of a previous pending submission, which must not reach an anonymous
  // caller. Nothing client-side reads this body — the outbox checks the HTTP
  // status only — so the identifiers below are more than enough. The duplicate
  // warning IS echoed (identifiers only, no PHI) for future clients.
  if (duplicateWarning) {
    await recordAuditServer(
      saved.encounterId,
      "possible_duplicate",
      `Same-day possible duplicate of ${duplicateWarning.encounterId} (${duplicateWarning.reason})`,
      "system"
    );
  }
  return NextResponse.json({
    ok: true,
    encounterId: final.encounterId,
    token: final.token,
    status: final.status,
    escalation: policy,
    his: his ? toPublicDelivery(his) : null,
    duplicateWarning,
  });
}
