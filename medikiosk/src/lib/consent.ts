import { CONSENT_SCOPES, isScopeActive, type ConsentScope, type ConsentState } from "@/lib/types";

/**
 * Consent normalisation — the single place where a client-supplied consent
 * payload is turned into a state the rest of the system is willing to trust.
 *
 * Kept out of the route so it can be unit-tested directly: every rule below is
 * a privacy guarantee, and a bug here silently widens who can read what.
 */

/**
 * Coerce a client-supplied consent payload into a safe granular state.
 *
 * Two rules matter here:
 *   1. Unknown scopes are dropped. A public, unauthenticated endpoint must not
 *      be able to widen what a clinician is permitted to read by inventing a
 *      scope name.
 *   2. `clinical_care` is forced consistent with the top-level legacy boolean,
 *      because that boolean is what gates staff visibility. If the two
 *      disagree, the more restrictive answer wins.
 *
 * `his_emr_export` is honoured when explicitly ticked. It was previously
 * filtered out here, which meant the kiosk's "Send it to this hospital's
 * information system" checkbox could never take effect and every HIS push was
 * permanently blocked by its own consent check.
 *
 * `ai_processing` is likewise honoured only when explicitly ticked — never
 * implied by the legacy boolean. Consent to send text to an external model
 * provider is a separate purpose from consent to share a record with the
 * treating team, and must be asked for on its own.
 */

/**
 * The longest a single client-supplied grant may last. The kiosk mints +365
 * days and the portal re-grant mints +365 days, so 2 years clears every
 * legitimate flow while stopping a crafted payload from stretching consent to
 * 2100 (or smuggling in an unparsable value that `isScopeActive` would ignore
 * and treat as never-expiring).
 */
const MAX_CONSENT_TTL_MS = 2 * 365 * 24 * 3600 * 1000;

/** Accept only a real date; clamp it to the maximum grant window. */
function sanitizeExpiry(raw: unknown, now: number): string | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return undefined;
  if (parsed <= now) return new Date(parsed).toISOString();
  return new Date(Math.min(parsed, now + MAX_CONSENT_TTL_MS)).toISOString();
}
export function normalizeConsent(raw: unknown, legacyGranted: boolean): ConsentState {
  const now = new Date().toISOString();
  const known: ConsentScope[] = [...CONSENT_SCOPES];

  if (!raw || typeof raw !== "object") {
    // No granular payload: honour the legacy boolean so existing kiosks and
    // older stored records keep behaving as they did. This implies neither
    // export consent nor external AI processing — a legacy record predates both
    // scopes and stays local.
    const implied: ConsentScope[] = legacyGranted
      ? known.filter((s) => s !== "his_emr_export" && s !== "ai_processing")
      : [];
    return {
      granted: implied,
      decidedAt: now,
      purpose: "Clinical history capture and care-team use at this hospital.",
    };
  }

  const input = raw as Partial<ConsentState>;
  const requested = Array.isArray(input.granted) ? (input.granted as string[]) : [];
  const granted = known.filter((s) => requested.includes(s));

  // The legacy boolean is the gate on staff visibility, so it wins.
  if (!legacyGranted) {
    return { granted: [], decidedAt: now, revokedAt: now };
  }
  if (!granted.includes("clinical_care")) granted.push("clinical_care");

  return {
    granted,
    decidedAt: input.decidedAt ?? now,
    purpose: input.purpose,
    expiresAt: sanitizeExpiry(input.expiresAt, Date.parse(now)),
  };
}

/**
 * May this record's text be sent to an external language-model provider?
 *
 * Deliberately fail-closed: no consent state, a revoked state, an expired
 * state, or a state that simply lacks the scope all return false, and the
 * caller must fall back to the offline deterministic engine. `encounterId` is
 * resolved server-side before this is called so a staff client cannot widen the
 * answer by editing its request body.
 */
export function canUseExternalModel(consent: Partial<ConsentState> | undefined, now = Date.now()): boolean {
  return isScopeActive(consent, "ai_processing", now);
}

/**
 * Build the pre-save consent payload the kiosk sends alongside the first
 * external-AI request (summary, follow-up questions, extraction, voice
 * transcription). Same shape and +365-day window the summary page always
 * minted — shared so every pre-save caller offers identical terms. The server
 * still re-validates via `normalizeConsent` / `canUseExternalModel`; this is
 * the patient's tick, not the enforcement.
 */
export function buildKioskConsent(granted: ConsentScope[], now: string = new Date().toISOString()): ConsentState {
  return {
    granted: [...CONSENT_SCOPES].filter((s) => granted.includes(s)),
    decidedAt: now,
    purpose: "Clinical history capture and care-team use at this hospital.",
    expiresAt: new Date(Date.parse(now) + 365 * 24 * 3600 * 1000).toISOString(),
  };
}
