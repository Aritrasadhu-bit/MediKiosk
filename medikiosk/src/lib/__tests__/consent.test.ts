import { describe, expect, it } from "vitest";
import {
  canStaffView,
  isScopeActive,
  CONSENT_SCOPES,
  type ConsentState,
  type StoredHistory,
} from "@/lib/types";
import { normalizeConsent, canUseExternalModel } from "@/lib/consent";

/**
 * Granular consent enforcement.
 *
 * Consent used to be a boolean that nothing read: a patient could revoke it
 * from the portal and the full record stayed on the physician, nurse and
 * pharmacy screens. These tests pin the rule that closes that gap.
 */

const NOW = Date.parse("2026-09-20T10:00:00.000Z");

function withConsent(consent: ConsentState, legacy = true): Pick<StoredHistory, "consent" | "consentGranted"> {
  return { consent, consentGranted: legacy };
}

const allGranted: ConsentState = {
  granted: [...CONSENT_SCOPES],
  decidedAt: "2026-09-20T09:00:00.000Z",
};

describe("isScopeActive", () => {
  it("accepts a granted, unexpired, unrevoked scope", () => {
    expect(isScopeActive(allGranted, "clinical_care", NOW)).toBe(true);
  });

  it("rejects a scope that was never granted", () => {
    const partial: ConsentState = { granted: ["history_capture"] };
    expect(isScopeActive(partial, "clinical_care", NOW)).toBe(false);
  });

  it("rejects every scope once consent is revoked", () => {
    const revoked: ConsentState = { ...allGranted, revokedAt: "2026-09-20T09:30:00.000Z" };
    for (const scope of CONSENT_SCOPES) {
      expect(isScopeActive(revoked, scope, NOW), scope).toBe(false);
    }
  });

  it("rejects a scope whose consent has expired", () => {
    const expired: ConsentState = { ...allGranted, expiresAt: "2026-09-20T09:59:00.000Z" };
    expect(isScopeActive(expired, "clinical_care", NOW)).toBe(false);
  });

  it("accepts a scope inside its consent window", () => {
    const valid: ConsentState = { ...allGranted, expiresAt: "2026-09-20T10:01:00.000Z" };
    expect(isScopeActive(valid, "clinical_care", NOW)).toBe(true);
  });

  it("returns false for missing state rather than throwing", () => {
    expect(isScopeActive(undefined, "clinical_care", NOW)).toBe(false);
    expect(isScopeActive({}, "clinical_care", NOW)).toBe(false);
  });
});

describe("canStaffView", () => {
  it("shows the record to clinicians when clinical-care consent is active", () => {
    expect(canStaffView(withConsent(allGranted), NOW)).toBe(true);
  });

  it("withholds the record the moment the patient revokes consent", () => {
    const revoked: ConsentState = { ...allGranted, granted: [], revokedAt: "2026-09-20T09:45:00.000Z" };
    expect(canStaffView(withConsent(revoked), NOW)).toBe(false);
  });

  it("withholds the record once consent lapses, even if still listed as granted", () => {
    const lapsed: ConsentState = { ...allGranted, expiresAt: "2026-09-19T00:00:00.000Z" };
    expect(canStaffView(withConsent(lapsed), NOW)).toBe(false);
  });

  it("does not grant access when only non-clinical purposes were consented", () => {
    const documentOnly: ConsentState = { granted: ["document_processing", "abha_linking"] };
    expect(canStaffView(withConsent(documentOnly), NOW)).toBe(false);
  });

  it("honours the legacy boolean for records predating granular consent", () => {
    // Upgrading must not retroactively hide historical records.
    expect(canStaffView({ consent: undefined, consentGranted: true }, NOW)).toBe(true);
    expect(canStaffView({ consent: undefined, consentGranted: false }, NOW)).toBe(false);
  });

  it("prefers granular state over the legacy boolean when both are present", () => {
    // A stale `consentGranted: true` must not survive a revocation.
    const revoked: ConsentState = { granted: [], revokedAt: "2026-09-20T09:50:00.000Z" };
    expect(canStaffView(withConsent(revoked, true), NOW)).toBe(false);
  });
});

/**
 * External AI processing is a separate purpose from sharing a record with the
 * care team. If it ever became implied rather than explicitly ticked, a
 * patient who agreed to "share with my doctors" would silently have their
 * medical text shipped to a third-party model provider.
 */
describe("canUseExternalModel", () => {
  it("allows the external provider only when ai_processing is explicitly granted", () => {
    expect(canUseExternalModel({ granted: ["history_capture", "clinical_care", "ai_processing"] }, NOW)).toBe(true);
  });

  it("refuses when the care-team scopes are granted but ai_processing is not", () => {
    expect(
      canUseExternalModel({ granted: ["history_capture", "clinical_care", "document_processing", "abha_linking"] }, NOW)
    ).toBe(false);
  });

  it("refuses when there is no consent state at all", () => {
    expect(canUseExternalModel(undefined, NOW)).toBe(false);
    expect(canUseExternalModel({}, NOW)).toBe(false);
  });

  it("refuses after revocation or expiry, even if the scope is still listed", () => {
    expect(
      canUseExternalModel({ granted: ["ai_processing"], revokedAt: "2026-09-20T09:50:00.000Z" }, NOW)
    ).toBe(false);
    expect(
      canUseExternalModel({ granted: ["ai_processing"], expiresAt: "2026-09-19T00:00:00.000Z" }, NOW)
    ).toBe(false);
  });
});

describe("normalizeConsent", () => {
  it("keeps an explicitly ticked ai_processing scope", () => {
    const state = normalizeConsent({ granted: ["history_capture", "clinical_care", "ai_processing"] }, true);
    expect(state.granted).toContain("ai_processing");
    expect(canUseExternalModel(state, NOW)).toBe(true);
  });

  it("never implies external AI processing from the legacy boolean", () => {
    // A pre-granular record has no ai_processing tick. Upgrading the schema
    // must not retroactively authorise sending old records to a model API.
    const state = normalizeConsent(undefined, true);
    expect(state.granted).not.toContain("ai_processing");
    expect(state.granted).not.toContain("his_emr_export");
    expect(canUseExternalModel(state, NOW)).toBe(false);
  });

  it("drops unknown scope names so a public endpoint cannot widen access", () => {
    const state = normalizeConsent(
      { granted: ["clinical_care", "superuser", "ai_processing_please", "__proto__"] },
      true
    );
    expect(state.granted).toEqual(["clinical_care"]);
    expect(canUseExternalModel(state, NOW)).toBe(false);
  });

  it("grants nothing when the legacy boolean is false, whatever was requested", () => {
    const state = normalizeConsent({ granted: ["clinical_care", "ai_processing"] }, false);
    expect(state.granted).toEqual([]);
    expect(state.revokedAt).toBeTruthy();
    expect(canUseExternalModel(state, NOW)).toBe(false);
  });

  it("clamps a client-supplied expiry to the maximum grant window", () => {
    // A crafted payload could otherwise stretch consent to 2100.
    const state = normalizeConsent(
      { granted: ["clinical_care"], expiresAt: "2100-01-01T00:00:00.000Z" },
      true
    );
    expect(state.expiresAt).toBeDefined();
    expect(Date.parse(state.expiresAt as string)).toBeLessThanOrEqual(Date.now() + 2 * 365 * 24 * 3600 * 1000);
  });

  it("drops an unparsable expiry rather than treating it as never-expiring", () => {
    // isScopeActive ignores garbage dates, so passing one through would leave
    // the scope active forever.
    const state = normalizeConsent({ granted: ["clinical_care"], expiresAt: "whenever" }, true);
    expect(state.expiresAt).toBeUndefined();
  });

  it("keeps a sane client-supplied expiry intact", () => {
    // The kiosk mints +365 days; normalisation must not disturb it.
    const state = normalizeConsent(
      { granted: ["clinical_care"], expiresAt: "2027-09-20T10:00:00.000Z" },
      true
    );
    expect(state.expiresAt).toBe("2027-09-20T10:00:00.000Z");
  });
});
