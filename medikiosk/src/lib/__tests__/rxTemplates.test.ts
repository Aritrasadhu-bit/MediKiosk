import { describe, expect, it } from "vitest";
import { applyRxTemplate, templatesForDepartment, RX_TEMPLATES } from "@/lib/rxTemplates";

describe("templatesForDepartment", () => {
  it("prioritises department-matching templates", () => {
    const ids = templatesForDepartment("Cardiology").map((t) => t.id);
    expect(ids[0]).toBe("hypertension");
  });

  it("serves AYUSH templates for AYUSH departments", () => {
    const ids = templatesForDepartment("AYUSH - Ayurveda (General)").map((t) => t.id);
    expect(ids).toContain("ayush-vata");
  });

  it("still offers the universal templates for an unknown department", () => {
    const ids = templatesForDepartment("Unknown Dept").map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["urti", "gastritis", "anemia"]));
  });
});

describe("applyRxTemplate", () => {
  it("appends missing medicines and reports the count", () => {
    const tpl = RX_TEMPLATES.find((t) => t.id === "gastritis")!;
    const { meds, added } = applyRxTemplate([{ name: "Paracetamol" }], tpl);
    expect(added).toBe(2);
    expect(meds.map((m) => m.name)).toContain("Pantoprazole");
  });

  it("never duplicates or overwrites existing rows", () => {
    const tpl = RX_TEMPLATES.find((t) => t.id === "urti")!;
    const current = [{ name: "paracetamol", dosage: "650mg" }];
    const { meds, added } = applyRxTemplate(current, tpl);
    expect(added).toBe(2);
    expect(meds[0]).toEqual({ name: "paracetamol", dosage: "650mg" });
    expect(meds.filter((m) => m.name.toLowerCase() === "paracetamol")).toHaveLength(1);
  });
});
