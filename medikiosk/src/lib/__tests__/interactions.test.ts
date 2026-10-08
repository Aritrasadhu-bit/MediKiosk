import { describe, expect, it } from "vitest";
import { checkInteractions, checkPregnancyRisk, interactionsToSummary, pregnancySignalled, drugsWithoutCoverage, INTERACTION_COVERAGE_NOTE } from "@/lib/interactions";
import type { Allergy, Medication } from "@/lib/types";

const med = (name: string): Medication => ({ name });
const allergy = (substance: string, reaction?: string): Allergy => ({ substance, reaction });

describe("checkInteractions", () => {
  it("flags duplicate medications as low severity", () => {
    const w = checkInteractions([med("Paracetamol"), med("Paracetamol")], []);
    expect(w.some((x) => x.type === "duplicate" && x.severity === "low")).toBe(true);
  });

  it("flags anticoagulant + antiplatelet as high", () => {
    const w = checkInteractions([med("Warfarin"), med("Aspirin")], []);
    expect(w.some((x) => x.type === "drug-drug" && x.severity === "high" && x.between.includes("anticoagulant"))).toBe(true);
  });

  it("flags sildenafil + nitrate as high (contraindicated)", () => {
    const w = checkInteractions([med("Sildenafil"), med("Isosorbide")], []);
    expect(w.some((x) => x.severity === "high" && x.between.includes("sildenafil"))).toBe(true);
  });

  it("flags CCB + statin as medium", () => {
    const w = checkInteractions([med("Amlodipine"), med("Atorvastatin")], []);
    expect(w.some((x) => x.type === "drug-drug" && x.severity === "medium" && x.between.includes("ccb"))).toBe(true);
  });

  it("counts a dual-class drug in every family it belongs to", () => {
    // Aspirin is listed under both `nsaid` and `antiplatelet`. If only the
    // first family counted, the antiplatelet + PPI rule would be unreachable
    // for aspirin while still firing for clopidogrel.
    const w = checkInteractions([med("Aspirin"), med("Omeprazole")], []);
    expect(w.some((x) => x.between === "antiplatelet ↔ ppi")).toBe(true);
  });

  it("does not report a single dual-class drug as interacting with itself", () => {
    // Aspirin alone satisfies both families at once, so the cross-family rule
    // must still require two distinct drugs.
    expect(checkInteractions([med("Aspirin")], [])).toEqual([]);
  });

  it("raises aspirin + anticoagulant to the antiplatelet rule", () => {
    const w = checkInteractions([med("Warfarin"), med("Aspirin")], []);
    expect(w.some((x) => x.between === "anticoagulant ↔ antiplatelet")).toBe(true);
  });

  it("flags drug-allergy cross-reaction (penicillin ↔ amoxicillin) as high", () => {
    const w = checkInteractions([med("Amoxicillin")], [allergy("Penicillin")]);
    expect(w.some((x) => x.type === "drug-allergy" && x.severity === "high")).toBe(true);
  });

  it("flags NSAID with aspirin allergy as high", () => {
    const w = checkInteractions([med("Ibuprofen")], [allergy("Aspirin")]);
    expect(w.some((x) => x.type === "drug-allergy" && x.severity === "high")).toBe(true);
  });

  it("includes extraMedications (new Rx) in the check", () => {
    const w = checkInteractions([med("Metformin")], [], [med("Diclofenac"), med("Warfarin")]);
    expect(w.some((x) => x.between.includes("anticoagulant"))).toBe(true);
  });

  it("returns empty for a clean history", () => {
    expect(checkInteractions([med("Paracetamol"), med("Metformin")], [allergy("Sulpha drugs")])).toEqual([]);
  });
});

describe("interactionsToSummary", () => {
  it("states when no interactions", () => {
    expect(interactionsToSummary([])).toContain("No drug-drug");
  });

  it("formats warnings with severity", () => {
    const w = checkInteractions([med("Warfarin"), med("Aspirin")], []);
    const out = interactionsToSummary(w);
    expect(out).toContain("[HIGH]");
    expect(out).toContain("bleeding");
  });
});

describe("drugsWithoutCoverage", () => {
  it("returns empty for recognised drugs", () => {
    expect(drugsWithoutCoverage([med("Aspirin"), med("Metformin"), med("Ashwagandha Churna")])).toEqual([]);
  });

  it("names drugs the curated checker does not recognise", () => {
    // A silent empty result reads as "checked and safe" — the UI must be able
    // to say "never checked at all" instead.
    expect(drugsWithoutCoverage([med("Mystery Herb XYZ")])).toEqual(["Mystery Herb XYZ"]);
  });

  it("dedupes case-insensitively and skips blanks", () => {
    expect(drugsWithoutCoverage([med("Mystery Herb"), med("mystery herb"), med("  ")])).toEqual(["Mystery Herb"]);
  });

  it("states the curated scope honestly", () => {
    expect(INTERACTION_COVERAGE_NOTE).toMatch(/curated/);
    expect(INTERACTION_COVERAGE_NOTE).toMatch(/independently/);
  });
});

describe("pregnancySignalled", () => {
  it("detects obstetric history wording", () => {
    expect(pregnancySignalled("gravida 2 para 1")).toBe(true);
    expect(pregnancySignalled("Pregnant — 24 weeks")).toBe(true);
    expect(pregnancySignalled("गर्भवती")).toBe(true);
  });
  it("returns false for unrelated notes", () => {
    expect(pregnancySignalled(undefined)).toBe(false);
    expect(pregnancySignalled("Hypertension since 5 years")).toBe(false);
  });
});

describe("checkPregnancyRisk", () => {
  const female = { female: true, age: 30 };

  it("flags category X drugs high when pregnant", () => {
    const risks = checkPregnancyRisk([med("Warfarin")], { ...female, pregnant: true });
    expect(risks.length).toBeGreaterThan(0);
    expect(risks[0].category).toBe("X");
    expect(risks[0].severity).toBe("high");
  });

  it("flags statins (X) for any reproductive-age female", () => {
    const risks = checkPregnancyRisk([med("Atorvastatin 20mg")], female);
    expect(risks.some((r) => r.category === "X")).toBe(true);
  });

  it("flags ACE inhibitors (D) and escalates severity when pregnant", () => {
    const notPregnant = checkPregnancyRisk([med("Ramipril 5mg")], female);
    expect(notPregnant.some((r) => r.category === "D" && r.severity === "low")).toBe(true);
    const pregnant = checkPregnancyRisk([med("Ramipril 5mg")], { ...female, pregnant: true });
    expect(pregnant.some((r) => r.category === "D" && r.severity === "high")).toBe(true);
  });

  it("does not flag category B drugs (paracetamol/metformin)", () => {
    const risks = checkPregnancyRisk([med("Paracetamol"), med("Metformin")], female);
    expect(risks.some((r) => r.category === "X" || r.category === "D")).toBe(false);
  });

  it("skips males and non-reproductive ages", () => {
    expect(checkPregnancyRisk([med("Warfarin")], { female: false, age: 30 })).toEqual([]);
    expect(checkPregnancyRisk([med("Warfarin")], { female: true, age: 12 })).toEqual([]);
    expect(checkPregnancyRisk([med("Warfarin")], { female: true, age: 52 })).toEqual([]);
  });

  it("flags NSAIDs as D when pregnant", () => {
    const risks = checkPregnancyRisk([med("Ibuprofen")], { ...female, pregnant: true });
    expect(risks.some((r) => r.drug === "Ibuprofen" && r.category === "D" && r.severity === "high")).toBe(true);
  });

  it("returns empty when no medications", () => {
    expect(checkPregnancyRisk([], female)).toEqual([]);
  });
});