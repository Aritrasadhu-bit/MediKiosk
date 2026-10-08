import { describe, expect, it } from "vitest";
import { createHash } from "crypto";
import {
  abdmConsentRequest,
  abdmHealthInformation,
  abdmVerifyHealthId,
  abdmConsentId,
  abdmCareContext,
  abdmDemoMobile,
} from "@/lib/abdm";

const VALID_ABHA = "11-0000-0001-2349";

describe("abdmVerifyHealthId (sandbox gateway verification)", () => {
  it("accepts a valid 14-digit ABHA with a good check digit", () => {
    expect(abdmVerifyHealthId(VALID_ABHA)).toEqual({ valid: true, reason: "ok" });
  });

  it("accepts un-grouped digits too (gateway normalises)", () => {
    expect(abdmVerifyHealthId("11000000012349").valid).toBe(true);
  });

  it("rejects a tampered check digit", () => {
    const bad = "11-0000-0001-2348";
    expect(abdmVerifyHealthId(bad).valid).toBe(false);
    expect(abdmVerifyHealthId(bad).reason).toBe("ABHA check digit mismatch");
  });

  it("rejects malformed grouping", () => {
    expect(abdmVerifyHealthId("123-4567-890-12345").valid).toBe(false);
    expect(abdmVerifyHealthId("abcd-efgh-ijkl-wxyz").valid).toBe(false);
  });
});

describe("abdmConsentRequest", () => {
  it("builds a sandbox consent manuscript with patient + care context", () => {
    const req = abdmConsentRequest({
      txnId: "txn-1",
      abhaId: VALID_ABHA,
      purpose: "TREATMENT-MGMT",
      hiTypes: ["Prescription"],
      careContextReference: "enc-1",
      from: "2026-09-20T00:00:00Z",
      to: "2026-09-20T23:59:59Z",
    });
    expect(req.careContexts[0].careContextReference).toBe("enc-1");
    expect(req.patient.id).toBe(VALID_ABHA);
    expect(req.purpose.code).toBe("TREATMENT-MGMT");
  });
});

describe("abdmHealthInformation", () => {
  it("wraps a FHIR bundle as consent-tagged base64 content", () => {
    const out = abdmHealthInformation({
      consentId: "sbx-consent-abc",
      abhaId: VALID_ABHA,
      careContextReference: "enc-1",
      bundle: { resourceType: "Bundle", id: "e1" },
    });
    expect(out.ok).toBe(true);
    const report = out.report as { consent: { consentArtefactId: string }; data: { content: string; mediaType: string; checksum: string } };
    expect(report.consent.consentArtefactId).toContain("abc");
    expect(report.data.mediaType).toBe("application/fhir+json");
    const decoded = JSON.parse(Buffer.from(report.data.content, "base64").toString("utf8"));
    expect(decoded.resourceType).toBe("Bundle");
  });

  it("labels the payload with a verifiable sha256 checksum, not its length", () => {
    // Regression: the field carried `sha256:<base64 length>`, which no
    // verifier could ever match.
    const out = abdmHealthInformation({
      consentId: "sbx-consent-abc",
      abhaId: VALID_ABHA,
      careContextReference: "enc-1",
      bundle: { resourceType: "Bundle", id: "e1" },
    });
    const report = out.report as { data: { content: string; checksum: string } };
    const expected = `sha256:${createHash("sha256").update(report.data.content).digest("hex")}`;
    expect(report.data.checksum).toBe(expected);
  });
});

describe("abdmDemoMobile + consent id", () => {
  it("derives a stable demo mobile from the ABHA (deterministic)", () => {
    expect(abdmDemoMobile(VALID_ABHA)).toMatch(/^\d{4} \d{3} \d{3}$/);
    expect(abdmDemoMobile(VALID_ABHA)).toBe(abdmDemoMobile(VALID_ABHA));
  });

  it("mints a stable consent + care-context id per encounter", () => {
    expect(abdmConsentId("txn-1", "enc-1")).toBe(abdmConsentId("txn-1", "enc-1"));
    expect(abdmCareContext("enc-1", "General Medicine")).toContain("enc-1");
  });
});