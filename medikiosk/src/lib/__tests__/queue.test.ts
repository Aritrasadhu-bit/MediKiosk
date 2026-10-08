import { describe, expect, it } from "vitest";
import {
  deriveQueueToken,
  etaMinutes,
  isOpen,
  isWaiting,
  mintUniqueToken,
  queuePosition,
  queuePositionByToken,
  severityOfRedFlags,
  severityRank,
  slaLevel,
  slotAgeMinutes,
  smoothedConsultMinutes,
  sortQueue,
  summarizeQueue,
  waitMinutes,
} from "@/lib/queue";
import type { StoredHistory } from "@/lib/types";

const MIN = 60_000;

function mkEnc(over: Partial<StoredHistory> & { encounterId: string; enteredAt: string }): StoredHistory {
  return {
    encounterId: over.encounterId,
    updatedAt: over.enteredAt,
    patient: {
      abhaId: "11-0000-0001-2349",
      name: "Test Patient",
      age: 40,
      sex: "Female",
      department: "General Medicine",
    },
    mode: "allopathic",
    enteredAt: over.enteredAt,
    history: {
      name: "Test Patient",
      age: 40,
      sex: "Female",
      chiefComplaint: "Fever",
      hpi: "",
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
    redFlags: over.redFlags ?? [],
    interactions: [],
    summary: "",
    consentGranted: true,
    status: over.status ?? "pending",
    audit: [],
    token: over.token,
  };
}

describe("severityOfRedFlags / severityRank", () => {
  it("high dominates medium and normal", () => {
    expect(severityOfRedFlags([{ id: "x", severity: "high", symptom: "s", message: "m", source: "text" }])).toBe("high");
    expect(severityOfRedFlags([{ id: "x", severity: "medium", symptom: "s", message: "m", source: "text" }])).toBe("medium");
    expect(severityOfRedFlags([])).toBe("normal");
  });
  it("ranks high > medium > normal", () => {
    expect(severityRank("high")).toBe(3);
    expect(severityRank("medium")).toBe(2);
    expect(severityRank("normal")).toBe(1);
  });
});

describe("slaLevel / waitMinutes (SLA colours + ETA)", () => {
  const now = Date.now();
  const entered = (minutesAgo: number) => new Date(now - minutesAgo * MIN).toISOString();

  it("normal: green <20min, amber 20–30, red ≥30", () => {
    expect(slaLevel(entered(5), "normal", now)).toBe("green");
    expect(slaLevel(entered(20), "normal", now)).toBe("amber");
    expect(slaLevel(entered(31), "normal", now)).toBe("red");
  });
  it("high urgency escalates faster (amber 2min, red 5min)", () => {
    expect(slaLevel(entered(1), "high", now)).toBe("green");
    expect(slaLevel(entered(3), "high", now)).toBe("amber");
    expect(slaLevel(entered(6), "high", now)).toBe("red");
  });
  it("waitMinutes never negative", () => {
    expect(waitMinutes(new Date(now + 10 * MIN).toISOString(), now)).toBe(0);
    expect(waitMinutes(entered(3), now)).toBe(3);
  });
  it("etaMinutes scales with queue position", () => {
    expect(etaMinutes(3)).toBe(21); // 3 × 7 min consults
    expect(etaMinutes(0)).toBe(0);
    expect(etaMinutes(2, 10)).toBe(20);
  });
});

describe("sortQueue / queuePosition", () => {
  const t0 = new Date("2026-09-20T09:00:00Z").toISOString();
  const t1 = new Date("2026-09-20T09:01:00Z").toISOString();

  it("sorts urgent first, then FIFO", () => {
    const normalEarly = mkEnc({ encounterId: "a", enteredAt: t0, status: "pending" });
    const urgent = mkEnc({
      encounterId: "u",
      enteredAt: t1,
      status: "pending",
      redFlags: [{ id: "r", severity: "high", symptom: "Chest Pain", message: "m", source: "text" }],
    });
    const ordered = sortQueue([normalEarly, urgent]);
    expect(ordered[0].encounterId).toBe("u");
    expect(ordered[1].encounterId).toBe("a");
  });
  it("excludes confirmed/er encounters from the waiting queue", () => {
    const done = mkEnc({ encounterId: "d", enteredAt: t0, status: "confirmed" });
    const esc = mkEnc({ encounterId: "e", enteredAt: t0, status: "er" });
    expect(sortQueue([done, esc])).toEqual([]);
  });
  it("queuePosition is 1-based in the prioritised queue", () => {
    const a = mkEnc({ encounterId: "a", enteredAt: t0, status: "pending" });
    const b = mkEnc({ encounterId: "b", enteredAt: t1, status: "pending" });
    expect(queuePosition([b, a], "a")).toBe(1);
    expect(queuePosition([a], "missing")).toBe(-1);
  });
});

describe("status helpers", () => {
  const w = mkEnc({ encounterId: "w", enteredAt: new Date().toISOString(), status: "pending" });
  const t = mkEnc({ encounterId: "t", enteredAt: new Date().toISOString(), status: "triage" });
  const c = mkEnc({ encounterId: "c", enteredAt: new Date().toISOString(), status: "confirmed" });
  const e = mkEnc({ encounterId: "e", enteredAt: new Date().toISOString(), status: "er" });

  it("isWaiting: pending + triage", () => {
    expect(isWaiting(w)).toBe(true);
    expect(isWaiting(t)).toBe(true);
    expect(isWaiting(c)).toBe(false);
    expect(isWaiting(e)).toBe(false);
  });
  it("isOpen: everything not confirmed/er", () => {
    expect(isOpen(w)).toBe(true);
    expect(isOpen(t)).toBe(true);
    expect(isOpen(c)).toBe(false);
    expect(isOpen(e)).toBe(false);
  });
  it("slotAgeMinutes measures from enteredAt", () => {
    const now = Date.now();
    expect(slotAgeMinutes(mkEnc({ encounterId: "s", enteredAt: new Date(now - 5 * MIN).toISOString() }), now)).toBe(5);
  });
});

describe("summarizeQueue", () => {
  const now = Date.now();
  it("counts waiting/byStatus/bySeverity and oldest wait", () => {
    const encs = [
      mkEnc({ encounterId: "a", enteredAt: new Date(now - 30 * MIN).toISOString(), status: "pending" }),
      mkEnc({ encounterId: "b", enteredAt: new Date(now - 10 * MIN).toISOString(), status: "triage" }),
      mkEnc({
        encounterId: "c",
        enteredAt: new Date(now - 4 * MIN).toISOString(),
        status: "pending",
        redFlags: [{ id: "r", severity: "high", symptom: "Stroke", message: "m", source: "text" }],
      }),
      mkEnc({ encounterId: "d", enteredAt: new Date(now - 2 * MIN).toISOString(), status: "confirmed" }),
      mkEnc({ encounterId: "e", enteredAt: new Date(now - 1 * MIN).toISOString(), status: "er" }),
    ];
    const s = summarizeQueue(encs, now);
    expect(s.waiting).toBe(3);
    expect(s.byStatus.pending).toBe(2);
    expect(s.byStatus.triage).toBe(1);
    expect(s.byStatus.confirmed).toBe(1);
    expect(s.byStatus.er).toBe(1);
    expect(s.bySeverity.high).toBe(1);
    expect(s.bySeverity.normal).toBe(2);
    expect(s.oldestWaitMinutes).toBe(30);
  });
});

describe("smoothedConsultMinutes (EWMA smart ETA)", () => {
  it("falls back to the default when no completed visits exist", () => {
    expect(smoothedConsultMinutes([])).toBe(7);
    expect(smoothedConsultMinutes([{ enteredAt: "2026-09-20T09:00:00Z" }])).toBe(7);
  });
  it("computes a smoothed duration from confirmed visits", () => {
    const t0 = "2026-09-20T09:00:00Z";
    const samples = [
      { enteredAt: t0, confirmedAt: "2026-09-20T09:08:00Z" }, // 8 min
      { enteredAt: t0, confirmedAt: "2026-09-20T09:15:00Z" }, // 15 min
    ];
    const avg = smoothedConsultMinutes(samples, 7);
    expect(avg).toBeGreaterThan(8);
    expect(avg).toBeLessThan(15);
  });
  it("clamps to the [2,30] band", () => {
    expect(smoothedConsultMinutes([{ enteredAt: "2026-09-20T09:00:00Z", confirmedAt: "2026-09-20T09:01:00Z" }])).toBe(2);
    expect(smoothedConsultMinutes([{ enteredAt: "2026-09-20T09:00:00Z", confirmedAt: "2026-09-20T09:40:00Z" }])).toBe(30);
  });
});

describe("queuePositionByToken", () => {
  it("finds a 1-based position by queue token", () => {
    const t0 = new Date("2026-09-20T09:00:00Z").toISOString();
    const t1 = new Date("2026-09-20T09:01:00Z").toISOString();
    const a = mkEnc({ encounterId: "a", enteredAt: t0, status: "pending", token: "TK-001" });
    const b = mkEnc({ encounterId: "b", enteredAt: t1, status: "pending", token: "TK-002" });
    expect(queuePositionByToken([b, a], "TK-001")).toBe(1);
    expect(queuePositionByToken([a], "TK-999")).toBe(-1);
  });
});

describe("deriveQueueToken", () => {
  it("mints a deterministic TK-XXXX token per encounter id", () => {
    const t = deriveQueueToken("enc-12345");
    expect(t).toMatch(/^TK-\d{4}$/);
    expect(deriveQueueToken("enc-12345")).toBe(t);
    // Different ids get different tokens (extremely likely).
    expect(deriveQueueToken("enc-99999")).not.toBe(t);
  });
});

describe("mintUniqueToken", () => {
  it("keeps a free candidate untouched", () => {
    expect(mintUniqueToken("enc-new", "TK-1042", new Set(["TK-9999"]))).toBe("TK-1042");
  });

  it("re-derives until the token is free, case-insensitively", () => {
    // A taken candidate must never come back, whatever its casing.
    const out = mintUniqueToken("enc-new", "tk-1042", new Set(["TK-1042"]));
    expect(out).toMatch(/^TK-\d{4}$/);
    expect(out.toUpperCase()).not.toBe("TK-1042");
  });

  it("treats its own encounter id as not taken (stable resubmissions)", () => {
    // The caller excludes the record itself from the taken-set, so a replay
    // keeps its token; assert the primitive honours an empty set trivially.
    expect(mintUniqueToken("enc-same", "TK-1042", new Set())).toBe("TK-1042");
  });

  it("walks past a run of taken tokens to the first free one", () => {
    // Candidate plus the first 24 re-derivations are taken: the mint must
    // land exactly on #25 rather than returning a duplicate or looping.
    const taken = new Set<string>(["TK-1042"]);
    for (let n = 1; n <= 24; n++) taken.add(deriveQueueToken(`enc-crowded#${n}`).toUpperCase());
    const out = mintUniqueToken("enc-crowded", "TK-1042", taken);
    expect(out).toBe(deriveQueueToken("enc-crowded#25"));
  });
});