import { describe, expect, it } from "vitest";
import { buildOpdRegister, opdRegisterToCsv, opdRegisterToHtml, registerDateKey } from "@/lib/opdRegister";
import type { StoredHistory } from "@/lib/types";

function mockEncounter(id: string, enteredAt: string, opts: Partial<StoredHistory> = {}): StoredHistory {
  return {
    encounterId: id,
    updatedAt: enteredAt,
    enteredAt,
    mode: "allopathic",
    patient: {
      name: "Ramesh Kumar",
      age: 58,
      sex: "Male",
      abhaId: "22-0000-0000-0017",
      mobile: "9876543210",
      department: "General Medicine",
      vitals: opts.patient?.vitals,
    },
    history: {
      name: "Ramesh Kumar",
      age: 58,
      sex: "Male",
      chiefComplaint: "Fever since 2 days",
      hpi: "Low grade fever with body ache.",
      pastMedical: [],
      pastSurgical: [],
      medications: [],
      allergies: [],
      familyHistory: "",
      personalHistory: "",
      reviewOfSystems: [],
      priorInvestigations: [],
    },
    documents: [],
    redFlags: [],
    interactions: [],
    audit: [],
    summary: "Fever",
    consentGranted: true,
    status: "pending",
    ...opts,
  };
}

describe("opdRegister (Batch A, P3)", () => {
  it("groups encounters by server-local date and sorts ascending", () => {
    const today = new Date(2026, 8, 21, 12, 0, 0);
    const key = registerDateKey(today);
    const e1 = mockEncounter("a", new Date(today.getTime() - 60_000).toISOString(), { token: "TK-1001" });
    const e2 = mockEncounter("b", new Date(today.getTime() - 30_000).toISOString(), { token: "TK-1002" });
    const yesterday = mockEncounter("c", new Date(today.getTime() - 24 * 3600_000).toISOString(), { token: "TK-1003" });

    const rows = buildOpdRegister([yesterday, e2, e1], key);
    expect(rows).toHaveLength(2);
    expect(rows[0].token).toBe("TK-1001");
    expect(rows[1].token).toBe("TK-1002");
    expect(rows[0].serial).toBe(1);
  });

  it("includes diagnosis, medicines and doctor from the prescription", () => {
    const today = new Date(2026, 8, 21, 12, 0, 0);
    const key = registerDateKey(today);
    const e = mockEncounter("rx", new Date(today.getTime() - 60_000).toISOString(), {
      doctorDiagnosis: "Viral fever",
      prescription: {
        medications: [{ name: "Paracetamol" }, { name: "ORF" }],
        prescribedBy: "Dr. Sharma",
      },
      status: "confirmed",
    });
    const rows = buildOpdRegister([e], key);
    expect(rows[0].diagnosis).toBe("Viral fever");
    expect(rows[0].medicines).toBe("Paracetamol; ORF");
    expect(rows[0].doctor).toBe("Dr. Sharma");
  });

  it("emits CSV with header row and quoted cells", () => {
    const today = new Date(2026, 8, 21, 12, 0, 0);
    const key = registerDateKey(today);
    const e = mockEncounter("csv", new Date(today.getTime() - 60_000).toISOString(), {
      token: "TK-4200",
      history: { ...mockEncounter("x", "").history, chiefComplaint: "Fever, cough" },
    });
    const csv = opdRegisterToCsv(buildOpdRegister([e], key));
    expect(csv.split("\n")[0]).toContain("serial");
    expect(csv).toContain("TK-4200");
    expect(csv).toContain('"Fever, cough"'); // comma inside a field is quoted
  });

  it("renders an HTML register with hospital name and count", () => {
    const html = opdRegisterToHtml([], "Test Hospital", "2026-09-21");
    expect(html).toContain("Test Hospital");
    expect(html).toContain("2026-09-21");
    expect(html).toContain("<!doctype html>");
  });

  it("neutralises spreadsheet formula injection from patient-controlled fields", () => {
    // A name like `=HYPERLINK(...)` would execute when the admin opens the
    // CSV in Excel — it must be forced into text interpretation.
    const today = new Date(2026, 8, 21, 12, 0, 0);
    const key = registerDateKey(today);
    const e = mockEncounter("csv", new Date(today.getTime() - 60_000).toISOString(), {
      history: { ...mockEncounter("x", "").history, chiefComplaint: "=HYPERLINK(\"http://evil\",\"x\")" },
    });
    e.patient.name = "=2+2";
    const csv = opdRegisterToCsv(buildOpdRegister([e], key));
    expect(csv).toContain("'=2+2");
    expect(csv).toContain("'=HYPERLINK(");
  });

  it("escapes HTML in patient-controlled fields", () => {
    const today = new Date(2026, 8, 21, 12, 0, 0);
    const key = registerDateKey(today);
    const e = mockEncounter("csv", new Date(today.getTime() - 60_000).toISOString(), {
      history: { ...mockEncounter("x", "").history, chiefComplaint: "<img src=x onerror=alert(1)>" },
    });
    const html = opdRegisterToHtml(buildOpdRegister([e], key), "H", "2026-09-21");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});