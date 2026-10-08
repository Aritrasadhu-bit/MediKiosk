import { describe, expect, it } from "vitest";
import { findSameDayDuplicates } from "@/lib/duplicates";

/**
 * Same-day duplicate-patient warnings.
 *
 * Two kiosks can register one patient twice; the match must fire across
 * ABHA, tolerate transliteration slips in walk-in names — and never fire on
 * family members sharing a phone, discharged records, or other days.
 */

const DAY = "2026-09-10T10:00:00.000Z";

function rec(
  id: string,
  enteredAt: string,
  status: string,
  patient: { abhaId?: string; name?: string; mobile?: string }
) {
  return {
    encounterId: id,
    enteredAt,
    status,
    token: `TK-${id}`,
    patient: { name: "Ramesh Kumar", ...patient },
  };
}

const candidate = rec("enc-new", DAY, "pending", {
  abhaId: "NEW-REGISTER",
  name: "Ramesh Kumar",
  mobile: "9876500001",
});

describe("findSameDayDuplicates", () => {
  it("matches the same ABHA already waiting today", () => {
    const other = rec("enc-old", "2026-09-10T08:00:00.000Z", "pending", {
      abhaId: "11-0000-0001-2349",
      mobile: "9000000000",
    });
    const cand = { ...candidate, patient: { ...candidate.patient, abhaId: "11-0000-0001-2349" } };
    const out = findSameDayDuplicates(cand, [other]);
    expect(out.map((m) => m.encounterId)).toEqual(["enc-old"]);
    expect(out[0].reason).toMatch(/ABHA/);
  });

  it("matches walk-ins on mobile plus fuzzy name", () => {
    const other = rec("enc-old", "2026-09-10T08:00:00.000Z", "pending", {
      abhaId: "NEW-REGISTER",
      name: "Ramesh Kumaar",
      mobile: "9876500001",
    });
    const out = findSameDayDuplicates(candidate, [other]);
    expect(out.map((m) => m.encounterId)).toEqual(["enc-old"]);
  });

  it("does not match a shared phone with a different name", () => {
    const other = rec("enc-old", "2026-09-10T08:00:00.000Z", "pending", {
      abhaId: "NEW-REGISTER",
      name: "Sunita Devi",
      mobile: "9876500001",
    });
    expect(findSameDayDuplicates(candidate, [other])).toEqual([]);
  });

  it("ignores discharged records and other days", () => {
    const done = rec("enc-done", "2026-09-10T08:00:00.000Z", "confirmed", {
      abhaId: "NEW-REGISTER",
      name: "Ramesh Kumar",
      mobile: "9876500001",
    });
    const old = rec("enc-old", "2026-09-01T08:00:00.000Z", "pending", {
      abhaId: "NEW-REGISTER",
      name: "Ramesh Kumar",
      mobile: "9876500001",
    });
    expect(findSameDayDuplicates(candidate, [done, old])).toEqual([]);
  });

  it("never matches the candidate itself", () => {
    expect(findSameDayDuplicates(candidate, [candidate])).toEqual([]);
  });
});
