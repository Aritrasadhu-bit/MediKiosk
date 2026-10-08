import { NextResponse } from "next/server";
import { getEncounter, recordAuditServer } from "@/lib/server/db";
import { validPortalCode } from "@/lib/server/portal";
import { csrfGuard } from "@/lib/server/csrf";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";
import { toFhirBundle } from "@/lib/fhirBundle";
import {
  abdmConsentRequest,
  abdmHealthInformation,
  abdmConsentId,
  abdmCareContext,
} from "@/lib/abdm";
import { abdmLiveConfigured, submitConsentLive } from "@/lib/server/abdmClient";
import { bodyTooLarge, payloadTooLarge } from "@/lib/server/bodyLimit";
import { log } from "@/lib/server/log";

export const runtime = "nodejs";

/**
 * ABDM sandbox (#1): the patient requests their record be pushed to their
 * ABDM app; MediKiosk (as the HIP) builds the gateway consent manuscript and
 * the consent-tagged health-information report — the exact wire format the
 * NDHM sandbox exchanges. Fully local, deterministic, PHI-safe.
 */
export async function POST(req: Request) {
  if (!rateLimit(routeRateLimitKey(req), 20, 60_000)) {
    return NextResponse.json({ ok: false, error: "Rate limit" }, { status: 429 });
  }
  const csrf = csrfGuard(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, error: csrf.error }, { status: 403 });
  if (bodyTooLarge(req, 64 * 1024)) return payloadTooLarge();

  const body = await req.json().catch(() => ({}));
  const { encounterId, code } = body as { encounterId?: string; code?: string };
  if (!encounterId || !code || !validPortalCode(encounterId, code)) {
    return NextResponse.json({ ok: false, error: "A valid portal access code is required." }, { status: 403 });
  }
  const enc = await getEncounter(encounterId);
  if (!enc) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const now = new Date();
  const txnId = `txn-${now.getTime()}`;
  const consentId = abdmConsentId(txnId, enc.encounterId);
  const careContext = abdmCareContext(enc.encounterId, enc.patient.department);
  const from = now.toISOString();
  const to = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();

  const consentRequest = abdmConsentRequest({
    txnId,
    abhaId: enc.patient.abhaId,
    purpose: "PATIENT-REQ",
    hiTypes: ["Prescription", "OPD"],
    careContextReference: careContext,
    from,
    to,
  });
  const bundle = toFhirBundle(enc);
  const hi = abdmHealthInformation({ consentId, abhaId: enc.patient.abhaId, careContextReference: careContext, bundle });

  // Live gateway seam: when the deployment points at a real bridge, submit
  // the manuscript for real and report the gateway receipt. Unconfigured (the
  // default) or unreachable keeps everything local with delivered: false —
  // the response always says which world this request lived in.
  const live = abdmLiveConfigured();
  const receipt = live ? await submitConsentLive(consentRequest as unknown as Record<string, unknown>) : null;
  const delivered = Boolean(receipt?.ok && receipt?.gatewayConsentId);

  // Truthful audit: in sandbox-local nothing was transmitted to the ABDM
  // gateway. This build has no live gateway, so the record must not say it
  // was "sent to the patient's ABDM app" — that was a false claim in the
  // audit trail. Live submissions record the gateway receipt instead.
  await recordAuditServer(
    encounterId,
    "exported",
    delivered
      ? `ABDM consent request submitted to live gateway (${receipt?.gatewayConsentId}) by patient-portal request`
      : `ABDM consent request + health-information payload prepared locally (${consentId}); gateway submission not performed in this build`,
    "patient-portal"
  );
  log("info", "abdm", delivered ? "live consent request submitted" : "sandbox consent request", { encounterId, consentId });

  return NextResponse.json({
    ok: true,
    gateway: live ? "live" : "sandbox-local",
    txnId,
    consentId,
    consentRequest,
    healthInformation: hi.report,
    fhir: {
      resourceType: bundle.resourceType,
      total: bundle.total,
      id: bundle.id,
    },
    // Explicit so no caller can present a locally-built payload as delivered.
    delivered,
    ...(receipt ? { receipt } : {}),
    note: delivered
      ? "Consent request submitted to the configured ABDM gateway bridge; see receipt."
      : "Consent request and health-information payload were built locally in the documented NDHM wire format. No request was sent to the ABDM gateway in this build.",
  });
}