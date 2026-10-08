import { describe, expect, it } from "vitest";
import {
  ageGroupOf,
  computeEarlyWarning,
  evaluateRedFlags,
  evaluateVitalsRedFlags,
  ewLabel,
  vitalsReference,
  vitalsSuggestions,
} from "@/lib/redflags";

describe("evaluateVitalsRedFlags", () => {
  it("returns empty when no vitals provided", () => {
    expect(evaluateVitalsRedFlags(undefined)).toEqual([]);
    expect(evaluateVitalsRedFlags({})).toEqual([]);
  });

  it("flags hypertensive crisis ≥180/120 as high", () => {
    const flags = evaluateVitalsRedFlags({ systolic: 190, diastolic: 122 });
    expect(flags.some((f) => f.id === "vit-bp-crisis" && f.severity === "high")).toBe(true);
  });

  it("flags BP ≥160/100 as medium (severe hypertension)", () => {
    const flags = evaluateVitalsRedFlags({ systolic: 165, diastolic: 100 });
    expect(flags.some((f) => f.id === "vit-bp-severe" && f.severity === "medium")).toBe(true);
  });

  it("flags systolic <90 as hypotension (medium)", () => {
    const flags = evaluateVitalsRedFlags({ systolic: 85, diastolic: 55 });
    expect(flags.some((f) => f.id === "vit-bp-low")).toBe(true);
  });

  it("flags SpO2 <92 as high (hypoxia)", () => {
    const flags = evaluateVitalsRedFlags({ spo2: 88 });
    expect(flags.some((f) => f.id === "vit-spo2-low" && f.severity === "high")).toBe(true);
  });

  it("flags SpO2 93-94 as medium only", () => {
    const flags = evaluateVitalsRedFlags({ spo2: 93 });
    expect(flags.some((f) => f.id === "vit-spo2-med")).toBe(true);
    expect(flags.some((f) => f.id === "vit-spo2-low")).toBe(false);
  });

  it("flags pulse >130 as high tachycardia", () => {
    const flags = evaluateVitalsRedFlags({ pulse: 142 });
    expect(flags.some((f) => f.id === "vit-pulse-fast")).toBe(true);
  });

  it("flags temp ≥40 as high-grade fever", () => {
    const flags = evaluateVitalsRedFlags({ temperature: 40.3 });
    expect(flags.some((f) => f.id === "vit-fever-high")).toBe(true);
  });

  it("returns no flags for healthy normal vitals", () => {
    const flags = evaluateVitalsRedFlags({ systolic: 120, diastolic: 80, pulse: 76, temperature: 37, spo2: 98 });
    expect(flags).toEqual([]);
  });

  it("tags every flag with source=vitals", () => {
    const flags = evaluateVitalsRedFlags({ systolic: 200 });
    expect(flags.every((f) => f.source === "vitals")).toBe(true);
  });
});

describe("evaluateRedFlags (free text)", () => {
  it("flags 'chest pain' as high", () => {
    const flags = evaluateRedFlags("I have chest pain since morning", "");
    expect(flags.some((f) => f.symptom === "Chest Pain" && f.severity === "high")).toBe(true);
  });

  it("flags Hindi keyword सीने में दर्द as chest pain", () => {
    const flags = evaluateRedFlags("मुझे सीने में दर्द है", "");
    expect(flags.some((f) => f.symptom === "Chest Pain")).toBe(true);
  });

  it("flags 'diabetes' as medium, not high", () => {
    const flags = evaluateRedFlags("I have diabetes", "");
    const diag = flags.find((f) => f.symptom === "Diabetes");
    expect(diag?.severity).toBe("medium");
  });

  it("checks both text and overallText", () => {
    const flags = evaluateRedFlags("anything", "patient reports fainted yesterday");
    expect(flags.some((f) => f.symptom === "Loss of consciousness")).toBe(true);
  });

  it("returns empty for benign text", () => {
    expect(evaluateRedFlags("feeling a bit tired, ok appetite", "")).toEqual([]);
  });
});

describe("ageGroupOf / vitalsReference", () => {
  it("maps ages to groups", () => {
    expect(ageGroupOf()).toBe("adult");
    expect(ageGroupOf(0)).toBe("infant");
    expect(ageGroupOf(0.8)).toBe("infant");
    expect(ageGroupOf(6)).toBe("child");
    expect(ageGroupOf(12)).toBe("child");
    expect(ageGroupOf(13)).toBe("adult");
    expect(ageGroupOf(64)).toBe("adult");
    expect(ageGroupOf(65)).toBe("elderly");
  });
  it("children have lower BP and higher pulse references than adults", () => {
    expect(vitalsReference(6).bpSystolic[0]).toBeLessThan(vitalsReference(40).bpSystolic[0]);
    expect(vitalsReference(6).pulse[1]).toBeGreaterThan(vitalsReference(40).pulse[1]);
  });
});

describe("age-aware vitals flags (children)", () => {
  it("does not flag a normal child BP for hypotension", () => {
    const flags = evaluateVitalsRedFlags({ systolic: 98, diastolic: 60 }, 6);
    expect(flags.some((f) => f.id.includes("bp-low"))).toBe(false);
  });
  it("flags child tachycardia with age-adjusted thresholds", () => {
    const flags = evaluateVitalsRedFlags({ pulse: 175 }, 6);
    expect(flags.some((f) => f.symptom.includes("age-adjusted") && f.severity === "medium")).toBe(true);
  });
  it("adult thresholds still apply to adults", () => {
    expect(evaluateVitalsRedFlags({ systolic: 90 }, 40)).toEqual([]);
    expect(evaluateVitalsRedFlags({ systolic: 84 }, 40).some((f) => f.id === "vit-bp-low")).toBe(true);
  });
});

describe("computeEarlyWarning (MEWS)", () => {
  it("healthy adult vitals score 0 / low", () => {
    const ew = computeEarlyWarning(40, { systolic: 120, diastolic: 80, pulse: 76, temperature: 37, spo2: 98 });
    expect(ew.score).toBe(0);
    expect(ew.level).toBe("low");
    expect(ew.ageGroup).toBe("adult");
  });
  it("scores deceptively high values", () => {
    const ew = computeEarlyWarning(40, { systolic: 220, pulse: 150, temperature: 40.5, spo2: 80 });
    expect(ew.score).toBeGreaterThanOrEqual(3);
    expect(ew.level).toBe("high");
  });
  it("uses child thresholds (child BP 90 is fine; adult would score)", () => {
    const child = computeEarlyWarning(6, { systolic: 90 });
    const adult = computeEarlyWarning(40, { systolic: 90 });
    expect(child.score).toBe(0);
    expect(adult.score).toBeGreaterThan(0);
  });
  it("labels levels for badges", () => {
    expect(ewLabel("high")).toBe("Urgent");
    expect(ewLabel("medium")).toBe("Monitor");
    expect(ewLabel("low")).toBe("Stable");
  });
});

describe("vitalsSuggestions", () => {
  it("suggests review for elevated BP 140-159", () => {
    const s = vitalsSuggestions({ systolic: 145 });
    expect(s.some((x) => x.includes("elevated"))).toBe(true);
  });

  it("no suggestions for normal vitals", () => {
    expect(vitalsSuggestions({ systolic: 120, temperature: 37 })).toEqual([]);
  });

  it("no suggestions when vitals undefined", () => {
    expect(vitalsSuggestions(undefined)).toEqual([]);
  });
});