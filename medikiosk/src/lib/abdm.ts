/**
 * ABDM Gateway — sandbox-local simulation (#1).
 *
 * Real ABDM Gateway integrations require: HealthID verification, consent
 * manuscript signing, and health-information (HI) report push to the consent
 * manager. This module models that wire-format so the demo can show the exact
 * payloads a production HIP would exchange — without registering at the NDHM
 * sandbox. Swap `abdmGateway: "sandbox-prod"` + real mTLS in production.
 *
 * All functions are pure and unit-tested.
 */

import { createHash } from "crypto";
import { passesVerhoeff } from "@/lib/abha";

export type AbdmPurpose = "PATIENT-REQ" | "TREATMENT-MGMT" | "HIMS-OP";

export const ABDM_GATEWAY = "sbx-gateway.ndhm.gov.in";
const HIP_ID = "SBX-HIP-MEDIKIOSK-100001";
export const ABDM_CONSENT_MANAGER = "sbx-m1";

/** Deterministic demo mapping from the 17-digit Verhoeff-valid ABHA id. */
export function abdmDemoMobile(abhaId: string): string {
  const digits = abhaId.replace(/[^0-9]/g, "");
  if (digits.length < 3) return "9999999999";
  const seed = digits.slice(-10);
  let acc = 0;
  for (const ch of seed) acc = (acc * 31 + (ch.charCodeAt(0) - 48)) % 9973;
  const base = String(1000000000 + acc * 1000).slice(0, 10);
  return `${base.slice(0, 4)} ${base.slice(4, 7)} ${base.slice(7, 10)}`;
}

/** Verify an ABHA id the way the gateway's verify-HealthID API would (format + check digit). */
export function abdmVerifyHealthId(abhaId: string): { valid: boolean; reason: string } {
  const cleaned = abhaId.trim();
  const digits = cleaned.replace(/[^0-9]/g, "");
  if (digits.length !== 14) return { valid: false, reason: "ABHA must be 14 digits (XX-XXXX-XXXX-XXXX)" };
  if (!/^\d{2}-\d{4}-\d{4}-\d{4}$/.test(cleaned) && !/^\d{14}$/.test(cleaned)) {
    return { valid: false, reason: "ABHA must use XX-XXXX-XXXX-XXXX grouping" };
  }
  if (!passesVerhoeff(digits)) return { valid: false, reason: "ABHA check digit mismatch" };
  return { valid: true, reason: "ok" };
}

/** Build the consent-request manuscript the HIP sends to the gateway. */
export function abdmConsentRequest(input: {
  txnId: string;
  abhaId: string;
  purpose: AbdmPurpose;
  hiTypes: string[];
  careContextReference: string;
  from: string;
  to: string;
}) {
  return {
    $schema: "abdm/sandbox/consent-request/v1",
    txnId: input.txnId,
    consentManagerId: ABDM_CONSENT_MANAGER,
    patient: {
      id: input.abhaId,
      verification: { type: "MOBILE_OTP", value: abdmDemoMobile(input.abhaId) },
    },
    purpose: { code: input.purpose, text: input.purpose.replace(/-/g, " ") },
    hip: { id: HIP_ID, name: "MediKiosk Community Health Centre (Sandbox)" },
    hiTypes: input.hiTypes,
    period: { from: input.from, to: input.to },
    careContexts: [{ careContextReference: input.careContextReference }],
  };
}

/**
 * Package a FHIR R4 bundle (toFhirBundle output) as an ABDM health-information
 * report: consent-tagged, base64-encoded FHIR content — the shape delivered to
 * the patient's consent manager / ABDM app.
 */
export function abdmHealthInformation(input: {
  consentId: string;
  abhaId: string;
  careContextReference: string;
  bundle: unknown;
}): { ok: boolean; report: object } {
  const content = Buffer.from(JSON.stringify(input.bundle)).toString("base64");
  return {
    ok: true,
    report: {
      consent: {
        id: input.consentId,
        consentArtefactId: `artefact:${input.consentId}`,
        patient: { referenceNumber: input.abhaId },
      },
      careContextReference: input.careContextReference,
      data: {
        content,
        mediaType: "application/fhir+json",
        // A real integrity checksum over the payload. This previously carried
        // the base64 length under a `sha256:` label, which no verifier could
        // ever match.
        checksum: `sha256:${createHash("sha256").update(content).digest("hex")}`,
      },
      hiTypes: ["Prescription", "OPD"],
    },
  };
}

/** Demo consent id — an ABDM-style UUID the gateway would mint. */
export function abdmConsentId(txnId: string, encounterId: string): string {
  const h = Math.abs(
    [...(`${txnId}${encounterId}`)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
  ).toString(16).padStart(8, "0");
  return `sbx-consent-${h}`;
}

/** Map a Medikiosk encounter payload to the ABHA format (demo, PHI-minimal). */
export function abdmCareContext(encounterId: string, department: string): string {
  return `${department.replace(/\s+/g, "-").slice(0, 24)}|${encounterId}`;
}