import { describe, expect, it, afterEach } from "vitest";
import { sameOrigin, csrfGuard } from "@/lib/server/csrf";
import { buildOrUMessage, hl7Timestamp } from "@/lib/hl7";
import type { StoredHistory } from "@/lib/types";

/**
 * CSRF same-origin guard.
 *
 * The guard is the protection on every state-changing route (PATCH
 * /api/encounters/[id], portal consent, HIS re-send, login). A regression here
 * would let another site drive authenticated actions in a clinician's browser.
 */
function req(headers: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/encounters/abc", {
    method: "PATCH",
    headers,
  });
}

/**
 * Forwarded headers are only honoured behind a proxy we control. Each proxy
 * test opts in explicitly so it fails loudly if that gate is ever removed. The
 * opt-in wraps the whole check, since the guard reads the env at call time.
 */
function behindProxy(headers: Record<string, string>): boolean {
  process.env.MEDIKIOSK_TRUST_PROXY = "1";
  try {
    return sameOrigin(req(headers));
  } finally {
    delete process.env.MEDIKIOSK_TRUST_PROXY;
  }
}

describe("sameOrigin", () => {
  it("accepts a matching Origin", () => {
    expect(sameOrigin(req({ origin: "http://localhost:3000", host: "localhost:3000" }))).toBe(true);
  });

  it("rejects a cross-site Origin", () => {
    expect(sameOrigin(req({ origin: "https://evil.example", host: "localhost:3000" }))).toBe(false);
  });

  it("rejects a cross-site Referer when Origin is absent", () => {
    expect(sameOrigin(req({ referer: "https://evil.example/form", host: "localhost:3000" }))).toBe(false);
  });

  it("accepts a matching Referer", () => {
    expect(sameOrigin(req({ referer: "http://localhost:3000/physician", host: "localhost:3000" }))).toBe(true);
  });

  afterEach(() => {
    delete process.env.MEDIKIOSK_TRUST_PROXY;
  });

  it("allows requests with no Origin or Referer (non-browser clients)", () => {
    // The kiosk outbox and smoke scripts run outside a browser; blocking them
    // would break offline sync.
    expect(sameOrigin(req({ host: "localhost:3000" }))).toBe(true);
  });

  it("rejects a malformed Referer rather than trusting it", () => {
    expect(sameOrigin(req({ referer: "not a url", host: "localhost:3000" }))).toBe(false);
  });

  it("ignores X-Forwarded-Host unless the proxy is trusted", () => {
    // A client that sets both headers could otherwise choose the very origin it
    // is compared against, making the check self-fulfilling.
    expect(
      sameOrigin(
        req({
          origin: "https://evil.example",
          host: "kiosk.hospital.example",
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "https",
        })
      )
    ).toBe(false);
  });

  it("compares against X-Forwarded-Host when the proxy is trusted", () => {
    expect(behindProxy({
          origin: "https://kiosk.hospital.example",
          host: "kiosk.hospital.example",
          "x-forwarded-host": "kiosk.hospital.example",
          "x-forwarded-proto": "https",
        })).toBe(true);
    expect(behindProxy({
          origin: "https://evil.example",
          host: "kiosk.hospital.example",
          "x-forwarded-host": "kiosk.hospital.example",
          "x-forwarded-proto": "https",
        })).toBe(false);
  });

  it("is not fooled by an Origin on a different port of the same host", () => {
    // Scheme + host + port must all match: another app on :9999 of the same
    // machine is a different origin and must not drive kiosk actions.
    expect(sameOrigin(req({ origin: "http://localhost:9999", host: "localhost:3000" }))).toBe(false);
    expect(sameOrigin(req({ origin: "http://localhost:3000", host: "localhost:3000" }))).toBe(true);
  });

  it("normalises the default port so :443 and :80 are not a mismatch", () => {
    expect(
      behindProxy({
        origin: "https://kiosk.hospital.example",
        host: "kiosk.hospital.example:443",
        "x-forwarded-proto": "https",
      })
    ).toBe(true);
    expect(
      sameOrigin(req({ origin: "http://kiosk.hospital.example", host: "kiosk.hospital.example:80" }))
    ).toBe(true);
  });

  it("rejects a scheme change on the same host", () => {
    // An http:// Origin must not be accepted when the request arrived as https.
    expect(behindProxy({
          origin: "http://kiosk.hospital.example",
          host: "kiosk.hospital.example",
          "x-forwarded-proto": "https",
        })).toBe(false);
  });

  it("accepts an operator-declared public origin behind a tunnel", () => {
    // Tunneled deployments serve https://public-name while the server only
    // sees localhost:3000 — without the allowlist every browser POST 403s
    // while the page itself renders fine.
    process.env.MEDIKIOSK_PUBLIC_ORIGIN = "https://kiosk.hospital.example";
    try {
      expect(
        sameOrigin(
          req({
            origin: "https://kiosk.hospital.example",
            host: "localhost:3000",
          })
        )
      ).toBe(true);
      // Anything NOT listed is still rejected.
      expect(
        sameOrigin(
          req({
            origin: "https://evil.example",
            host: "localhost:3000",
          })
        )
      ).toBe(false);
    } finally {
      delete process.env.MEDIKIOSK_PUBLIC_ORIGIN;
    }
  });

  it("ignores malformed entries in the public-origin list", () => {
    process.env.MEDIKIOSK_PUBLIC_ORIGIN = "not a url, , https://kiosk.hospital.example";
    try {
      expect(
        sameOrigin(req({ origin: "https://kiosk.hospital.example", host: "localhost:3000" }))
      ).toBe(true);
      expect(
        sameOrigin(req({ origin: "https://evil.example", host: "localhost:3000" }))
      ).toBe(false);
    } finally {
      delete process.env.MEDIKIOSK_PUBLIC_ORIGIN;
    }
  });

  it("honours X-Forwarded-Proto behind a TLS-terminating proxy", () => {
    expect(behindProxy({
          origin: "https://kiosk.hospital.example",
          host: "kiosk.hospital.example",
          "x-forwarded-proto": "https",
        })).toBe(true);
    expect(behindProxy({
          origin: "http://kiosk.hospital.example",
          host: "kiosk.hospital.example",
          "x-forwarded-proto": "http",
        })).toBe(true);
  });

  it("rejects a non-http Origin scheme", () => {
    expect(sameOrigin(req({ origin: "null", host: "localhost:3000" }))).toBe(false);
    expect(sameOrigin(req({ origin: "file://", host: "localhost:3000" }))).toBe(false);
  });
});

describe("csrfGuard", () => {
  it("passes a same-origin mutation", () => {
    const r = csrfGuard(req({ origin: "http://localhost:3000", host: "localhost:3000" }));
    expect(r.ok).toBe(true);
  });

  it("blocks a cross-site mutation with a 403-style error", () => {
    const r = csrfGuard(req({ origin: "https://evil.example", host: "localhost:3000" }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Cross-site/i);
  });
});

describe("HL7 v2 ORU^R01 message builder", () => {
  const base: StoredHistory = {
    encounterId: "ENC-0001",
    updatedAt: "2026-09-20T10:00:00.000Z",
    enteredAt: "2026-09-20T09:30:00.000Z",
    status: "pending",
    mode: "allopathic",
    consentGranted: true,
    token: "TK-1042",
    patient: {
      abhaId: "12-3456-7890-1234",
      name: "Sunita Devi",
      age: 42,
      sex: "Female",
      department: "General Medicine",
      vitals: { systolic: 150, diastolic: 96, pulse: 88, temperature: 38.5, weight: 62, height: 158, spo2: 96 },
    },
    history: {
      name: "Sunita Devi",
      age: 42,
      sex: "Female",
      chiefComplaint: "Fever",
      hpi: "3 days",
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
    summary: "Fever and headache for 3 days",
    audit: [],
  };

  // Imported from the pure module: the transport module pulls in server-only
  // and filesystem access, which a unit test has no business triggering.
  const build = (h: StoredHistory) => buildOrUMessage(h, new Date("2026-09-20T10:00:00.000Z"));

  it("produces a well-formed MSH with ORU^R01 and version 2.5.1", () => {
    const [msh] = build(base).split("\r");
    const f = msh.split("|");
    expect(f[0]).toBe("MSH");
    expect(f[1]).toBe("^~\\&");
    expect(f[8]).toBe("ORU^R01");
    expect(f[11]).toBe("2.5.1");
    // MSH-10 control id, and MSH-7 must be a 14-digit timestamp.
    expect(f[9]).toBe("MKENC0001");
    expect(f[6]).toMatch(/^\d{14}$/);
  });

  it("formats MSH-7 as a 14-digit local timestamp", () => {
    expect(hl7Timestamp(new Date(2026, 0, 5, 7, 3, 9))).toBe("20260105070309");
  });

  it("carries the ABHA id in PID-3", () => {
    const pid = build(base).split("\r").find((s) => s.startsWith("PID"))!;
    expect(pid.split("|")[3]).toBe("12-3456-7890-1234");
  });

  it("falls back to the encounter id when no ABHA id is known", () => {
    const noAbha = { ...base, patient: { ...base.patient, abhaId: "" } };
    const pid = build(noAbha).split("\r").find((s) => s.startsWith("PID"))!;
    expect(pid.split("|")[3]).toBe("ENC-0001");
  });

  it("emits coded numeric observations for the recorded vitals", () => {
    const obx = build(base).split("\r").filter((s) => s.startsWith("OBX"));
    // 7 vitals + 1 narrative
    expect(obx.length).toBe(8);
    const systolic = obx.find((s) => s.includes("8480-6"))!;
    expect(systolic.split("|")[2]).toBe("NM");
    expect(systolic.split("|")[5]).toBe("150");
    expect(obx.find((s) => s.includes("29463-7"))!.split("|")[6]).toBe("kg");
    expect(obx.some((s) => s.includes("59408-5") && s.includes("96"))).toBe(true);
    const narrative = obx.find((s) => s.includes("HISTORY-NARRATIVE"))!;
    expect(narrative.split("|")[2]).toBe("TX");
    // OBX-11 result status F = final
    expect(narrative.split("|")[8]).toBe("F");
  });

  it("skips vitals that were never recorded", () => {
    const noVitals = { ...base, patient: { ...base.patient, vitals: { pulse: 70 } } };
    const obx = build(noVitals).split("\r").filter((s) => s.startsWith("OBX"));
    expect(obx.some((s) => s.includes("8480-6"))).toBe(false);
    expect(obx.some((s) => s.includes("8867-4"))).toBe(true);
  });

  it("escapes HL7 delimiters so a field cannot break the message", () => {
    const nasty = {
      ...base,
      summary: "Fever ~and^ headache | with & backslash \\ here",
    };
    const msg = build(nasty);
    const tx = msg.split("\r").find((s) => s.includes("HISTORY-NARRATIVE"))!;
    // No unescaped delimiter may appear inside the narrative value.
    const value = tx.split("|")[5];
    expect(value).not.toMatch(/[\\^~&|]/);
    // Every non-empty line must still be a single well-formed segment, so the
    // delimiters could not have leaked into the framing.
    const segments = msg.split("\r").filter(Boolean);
    expect(segments.every((s) => /^(MSH|PID|PV1|OBX)\|/.test(s))).toBe(true);
    expect(segments).toHaveLength(11);
  });

  it("strips newlines so a field cannot inject an extra segment", () => {
    const injected = { ...base, summary: "line one\rOBX|9|TX|INJECTED|x|y" };
    const msg = build(injected);
    // The words survive as inert text, but the newlines and pipes are gone, so
    // no ninth OBX segment exists for the receiving EMR to act on.
    expect(msg.split("\r").filter((s) => s.startsWith("OBX")).length).toBe(8);
    expect(msg.split("\r").filter(Boolean)).toHaveLength(11);
    expect(msg.split("\r").some((s) => s.split("|")[3] === "INJECTED")).toBe(false);
  });

  it("terminates the message with a carriage return", () => {
    expect(build(base).endsWith("\r")).toBe(true);
  });
});
