import { describe, expect, it } from "vitest";
import { encounterSchema, patchEncounterSchema, safeParse } from "@/lib/validation";

/**
 * Free-text length caps on the open patient/history records.
 *
 * Those records stay open for flexible capture, so shape alone cannot bound
 * them — but an uncapped `name` bloats every dashboard load and can exhaust
 * the kiosk's localStorage. These tests pin the caps at the edge.
 */

const base = {
  encounterId: "enc-1",
  patient: { name: "Ramesh Kumar" },
  mode: "allopathic",
  enteredAt: new Date().toISOString(),
  history: { chiefComplaint: "Fever" },
};

describe("encounter free-text caps", () => {
  it("accepts ordinary values", () => {
    expect(safeParse(encounterSchema, base).ok).toBe(true);
  });

  it("rejects an over-long patient name", () => {
    const r = safeParse(encounterSchema, {
      ...base,
      patient: { name: "x".repeat(121) },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects an over-long chief complaint", () => {
    const r = safeParse(encounterSchema, {
      ...base,
      history: { chiefComplaint: "x".repeat(2001) },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects an over-long hpi on patch", () => {
    const r = safeParse(patchEncounterSchema, {
      history: { hpi: "x".repeat(20001) },
    });
    expect(r.ok).toBe(false);
  });

  it("leaves non-string values alone", () => {
    const r = safeParse(encounterSchema, {
      ...base,
      patient: { name: "Ramesh Kumar", age: 58 },
    });
    expect(r.ok).toBe(true);
  });
});
