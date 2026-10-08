import { describe, expect, it } from "vitest";
import { patientKeyOf } from "@/lib/types";

/**
 * Longitudinal grouping keys.
 *
 * Placeholder ids (NEW-REGISTER, CAMP-REGISTER) carry no digits, so they must
 * fall through to name+mobile — keying on the raw placeholder once merged ALL
 * camp walk-ins into a single patient's history on the physician dashboard.
 */

const patient = (abhaId: string, name = "Ramesh Kumar", mobile = "9876500001") => ({
  patient: { name, age: 40, sex: "Male" as const, abhaId, mobile, department: "General Medicine" },
});

describe("patientKeyOf", () => {
  it("keys real ABHA ids directly", () => {
    expect(patientKeyOf(patient("11-0000-0001-2349"))).toBe("11-0000-0001-2349");
  });

  it("falls through to name+mobile for NEW-REGISTER walk-ins", () => {
    expect(patientKeyOf(patient("NEW-REGISTER"))).toBe("ramesh kumar|9876500001");
  });

  it("falls through to name+mobile for CAMP-REGISTER records", () => {
    expect(patientKeyOf(patient("CAMP-REGISTER", "Sunita Devi", "9000000002"))).toBe(
      "sunita devi|9000000002"
    );
  });

  it("keeps distinct walk-ins distinct", () => {
    expect(patientKeyOf(patient("NEW-REGISTER", "Asha", "9111111111"))).not.toBe(
      patientKeyOf(patient("NEW-REGISTER", "Mira", "9222222222"))
    );
  });
});
