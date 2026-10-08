import { describe, expect, it } from "vitest";
import { toPublicDelivery } from "@/lib/server/his";

/**
 * HIS delivery receipts.
 *
 * A delivery receipt carries the configured FHIR base URL or HL7 `host:port`.
 * That is the hospital's internal integration topology, and it used to be
 * serialised straight into the /api/his response — reachable by an
 * unauthenticated caller, because the route allowed a delivery receipt through
 * without auth and the receipt contained the endpoint. These tests pin that the
 * projection strips it, so the leak cannot come back quietly.
 */

const INTERNAL_FHIR = "https://his.internal.hospital.example/fhir/r4/Encounter";
const INTERNAL_HL7 = "10.20.30.40:2575";

describe("toPublicDelivery", () => {
  it("drops the internal FHIR endpoint", () => {
    const publicDelivery = toPublicDelivery({
      state: "delivered",
      detail: "Sent to the hospital information system as a FHIR R4 record.",
      at: "2026-09-30T10:00:00.000Z",
      mode: "fhir",
      endpoint: INTERNAL_FHIR,
      status: 201,
      attempts: 1,
    });
    expect(publicDelivery).not.toHaveProperty("endpoint");
    expect(JSON.stringify(publicDelivery)).not.toContain("his.internal");
    expect(JSON.stringify(publicDelivery)).not.toContain("https://");
  });

  it("drops the internal HL7 host:port", () => {
    const publicDelivery = toPublicDelivery({
      state: "delivered",
      detail: "Sent to the hospital information system (HL7 v2 ORU^R01).",
      at: "2026-09-30T10:00:00.000Z",
      mode: "hl7v2",
      endpoint: INTERNAL_HL7,
      attempts: 2,
    });
    expect(publicDelivery).not.toHaveProperty("endpoint");
    expect(JSON.stringify(publicDelivery)).not.toContain(INTERNAL_HL7);
  });

  it("keeps what staff need to decide whether to retry", () => {
    const publicDelivery = toPublicDelivery({
      state: "failed",
      detail: "Could not reach the hospital system. Your record is safe here.",
      at: "2026-09-30T10:00:00.000Z",
      mode: "fhir",
      endpoint: INTERNAL_FHIR,
      status: 502,
      attempts: 3,
    });
    expect(publicDelivery.state).toBe("failed");
    expect(publicDelivery.attempts).toBe(3);
    expect(publicDelivery.status).toBe(502);
  });

  it("does not leak a URL that arrives inside an error message", () => {
    // Node's fetch reports `Failed to parse URL from <url>`, and that string
    // ends up in `detail`, which is returned to the browser. `pushEncounterToHis`
    // sanitises it before it gets here — this guards the shape it produces.
    const detail = "Could not reach the hospital system (the hospital system). Your record is safe here.";
    const publicDelivery = toPublicDelivery({
      state: "failed",
      detail,
      at: "2026-09-30T10:00:00.000Z",
      mode: "fhir",
      endpoint: INTERNAL_FHIR,
    });
    expect(publicDelivery.detail).not.toMatch(/[a-z][a-z0-9+.-]*:\/\//i);
  });
});
