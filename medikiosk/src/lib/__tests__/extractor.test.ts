import { describe, expect, it } from "vitest";
import {
  heuristicExtract,
  inferDocType,
  parseDate,
  correctDrugName,
  levenshteinDistance,
} from "@/lib/extractor";

describe("inferDocType", () => {
  it("detects discharge summary", () => {
    expect(inferDocType("notes.txt", "This is a discharge summary of Mr X")).toBe("Discharge Summary");
  });
  it("detects lab report", () => {
    expect(inferDocType("file.pdf", "Complete blood count report Hemoglobin 10.2")).toBe("Lab Report");
  });
  it("detects prescription via Rx forms", () => {
    expect(inferDocType("scan.png", "Tab. Metformin 500mg BD")).toBe("Prescription");
  });
  it("detects imaging report", () => {
    expect(inferDocType("img.pdf", "X-Ray chest PA view done")).toBe("Imaging Report");
  });
  it("defaults to Other", () => {
    expect(inferDocType("misc.txt", "nothing here")).toBe("Other");
  });
  it("does not fire on substrings of ordinary words", () => {
    // Unanchored "rx" matched "matrix", "lab" matched "label", "count"
    // matched "discount" — none of which is medical.
    expect(inferDocType("note.txt", "ankle matrix twist, stable joint")).toBe("Other");
    expect(inferDocType("note.txt", "check the label for discount offers")).toBe("Other");
  });
  it("prefers prescription markers over bare report/count words", () => {
    // "Review with reports" / "blood count advised" on a prescription must
    // not promote it to a Lab Report (which would then extract phantom
    // investigations from printed reference ranges).
    expect(inferDocType("rx.jpg", "Tab. Metformin 500mg BD. Review with reports after 1 month.")).toBe(
      "Prescription"
    );
    expect(inferDocType("rx.jpg", "Metformin 500mg twice daily")).toBe("Prescription");
  });
});

describe("parseDate", () => {
  it("parses DD/MM/YYYY into ISO", () => {
    expect(parseDate("dated 12/08/2026")).toBe("2026-08-12");
  });
  it("parses YYYY-MM-DD", () => {
    expect(parseDate("2026-08-12 event")).toBe("2026-08-12");
  });
  it("normalizes 2-digit year", () => {
    expect(parseDate("on 5/4/24")).toBe("2024-04-05");
  });
  it("returns undefined when no date", () => {
    expect(parseDate("no date here")).toBeUndefined();
  });
});

describe("heuristicExtract", () => {
  it("extracts medications from a prescription", () => {
    const text = "Rx: Tab. Metformin 500mg BD, Tab. Amlodipine 5mg OD for blood pressure.";
    const out = heuristicExtract(text, "prescription.png");
    expect(out.type).toBe("Prescription");
    const names = out.entities.medications.map((m) => m.name.toLowerCase());
    expect(names).toContain("metformin");
    expect(names).toContain("amlodipine");
  });

  it("captures dosage when present", () => {
    const out = heuristicExtract("Tab. Dolo 650mg after food", "rx.jpg");
    const dolo = out.entities.medications.find((m) => m.name.toLowerCase() === "dolo");
    expect(dolo?.dosage).toContain("650");
  });

  it("extracts known investigations and flags abnormal values", () => {
    const text = "Hemoglobin: 9.2 g/dL\nFasting Blood Sugar: 160 mg/dL\n";
    const out = heuristicExtract(text, "lab.pdf");
    const hb = out.entities.investigations.find((i) => i.test === "Hemoglobin");
    const fbs = out.entities.investigations.find((i) => i.test === "Fasting Blood Sugar");
    expect(hb?.flag).toBe("low");
    expect(fbs?.flag).toBe("high");
    expect(out.abnormalValues.length).toBeGreaterThanOrEqual(2);
  });

  it("extracts diagnoses from keywords", () => {
    const out = heuristicExtract("Patient has hypertension and type 2 diabetes mellitus.", "note.txt");
    expect(out.entities.diagnoses).toContain("HYPERTENSION");
    expect(out.entities.diagnoses.some((d) => d.includes("DIABETES"))).toBe(true);
  });

  it("keeps normal values out of abnormalValues", () => {
    const out = heuristicExtract("Urea: 20, Creatinine: 0.9", "lab.txt");
    expect(out.abnormalValues).toEqual([]);
  });

  it("does not invent a value from a bare reference range", () => {
    // "Hemoglobin 13-17 g/dL" with no patient result is the printed range —
    // the low end (13) must not become a phantom investigation.
    const out = heuristicExtract("Hemoglobin 13-17 g/dL. Creatinine 0.6-1.2 mg/dL.", "lab.txt");
    expect(out.entities.investigations).toEqual([]);
  });

  it("still reads a value when the dash is only a separator", () => {
    const out = heuristicExtract("Hemoglobin - 13.5 g/dL", "lab.txt");
    expect(out.entities.investigations.find((i) => i.test === "Hemoglobin")?.value).toBe("13.5");
  });

  it("still reads a value followed by its range in parens", () => {
    const out = heuristicExtract("Hemoglobin: 9.2 g/dL (13-17)", "lab.txt");
    const hb = out.entities.investigations.find((i) => i.test === "Hemoglobin");
    expect(hb?.value).toBe("9.2");
    expect(hb?.flag).toBe("low");
  });

  it("corrects misspelled allopathic drug names via Levenshtein matching", () => {
    // Typos common in OCR
    const c1 = correctDrugName("Amldipne");
    expect(c1.name).toBe("Amlodipine");
    expect(c1.corrected).toBe(true);

    const c2 = correctDrugName("Paracetmol");
    expect(c2.name).toBe("Paracetamol");

    const c3 = correctDrugName("Omeprzole");
    expect(c3.name).toBe("Omeprazole");
  });

  it("identifies and matches Ayurvedic formulations", () => {
    const c1 = correctDrugName("Triphala");
    expect(c1.name).toBe("Triphala Churna");
    expect(c1.isAyurvedic).toBe(true);

    const c2 = correctDrugName("Ashwagandh");
    expect(c2.name).toBe("Ashwagandha Churna");
    expect(c2.isAyurvedic).toBe(true);
  });

  it("extracts Ayurvedic formulations from prescriptions", () => {
    const text = "Rx: Churna Triphala 1 tsp with warm water at bed time; Vati Chandraprabha 2 BD";
    const out = heuristicExtract(text, "ayur_rx.jpg");
    expect(out.type).toBe("Prescription");
    const meds = out.entities.medications.map((m) => m.name);
    expect(meds).toContain("Triphala Churna");
    expect(meds).toContain("Chandraprabha Vati");
  });

  it("calculates edit distance correctly", () => {
    expect(levenshteinDistance("kitten", "sitting")).toBe(3);
    expect(levenshteinDistance("same", "same")).toBe(0);
  });
});