import { NextResponse } from "next/server";
import { getEncounter, patchEncounter, recordAuditServer } from "@/lib/server/db";
import { validPortalCode } from "@/lib/server/portal";
import { csrfGuard } from "@/lib/server/csrf";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";
import { bodyTooLarge, payloadTooLarge } from "@/lib/server/bodyLimit";
import { portalConsentSchema, safeParse } from "@/lib/validation";
import { canStaffView, CONSENT_SCOPES, type ConsentState, type ConsentScope } from "@/lib/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Patient-controlled consent: the portal lets the patient grant/revoke record
 * visibility live (DPDP 2023 patient-control story). Code-gated + audited.
 *
 * Revocation is *enforced*, not cosmetic: `clinical_care` consent is what
 * `listEncountersForStaff()` filters on, so revoking it withdraws the record
 * from the physician, triage and pharmacy screens immediately.
 */
export async function POST(req: Request, ctx: Ctx) {
  if (!rateLimit(routeRateLimitKey(req), 20, 60_000)) {
    return NextResponse.json({ ok: false, error: "Rate limit" }, { status: 429 });
  }
  const csrf = csrfGuard(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, error: csrf.error }, { status: 403 });
  if (bodyTooLarge(req, 64 * 1024)) return payloadTooLarge();

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const parsed = safeParse(portalConsentSchema, body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  if (!validPortalCode(id, parsed.data.code)) {
    return NextResponse.json({ ok: false, error: "Invalid portal access code." }, { status: 403 });
  }

  const enc = await getEncounter(id);
  if (!enc) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  // Clinical content is gated on the clinical_care scope. The other scopes are
  // patient-controlled too, so a revoke takes effect in the data layer rather
  // than only flipping a cosmetic flag.
  const grant = parsed.data.consent;
  const prior = enc.consent;

  // The portal toggle governs *clinical care only*. Every other purpose is
  // whatever the patient ticked at intake, and re-granting clinical care must
  // never widen the record's reach.
  //
  // The previous implementation rebuilt `granted` from CONSENT_SCOPES on a
  // grant, which meant a patient who deliberately left the HIS/EMR export box
  // unticked would acquire export consent the first time they toggled clinical
  // care back on — a silent, retrospective expansion of consent that nobody
  // had asked for and which then authorises a push to a hospital system.
  const preserved = (prior?.granted ?? []).filter((s) => CONSENT_SCOPES.includes(s));
  const next: ConsentState = {
    granted: grant ? [...new Set<ConsentScope>([...preserved, "clinical_care"])] : [],
    decidedAt: new Date().toISOString(),
    purpose:
      "Capture of this clinical history, digitisation of uploaded documents, and " +
      "use by treating clinicians at this hospital.",
    // Consent is re-asserted for a year on every grant (DPDP 2023 s.6
    // purpose limitation with a defined retention horizon). Purposes that are
    // not being re-granted keep their original expiry.
    expiresAt: grant ? new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString() : prior?.expiresAt,
    revokedAt: grant ? undefined : new Date().toISOString(),
  };

  const updated = await patchEncounter(id, { consentGranted: grant, consent: next });
  await recordAuditServer(
    id,
    grant ? "consent_granted" : "consent_revoked",
    `Patient ${grant ? "granted" : "revoked"} clinical-care consent via portal` +
      (grant ? "" : " — record withdrawn from clinician views until re-granted"),
    "patient-portal"
  );
  return NextResponse.json({
    ok: true,
    consentGranted: updated?.consentGranted ?? grant,
    consent: updated?.consent ?? next,
    // Explicit so the portal can warn that the record is no longer on the
    // clinician's screen while it stays visible in the public queue.
    visibleToClinicians: canStaffView(updated ?? { consent: next, consentGranted: grant }),
  });
}