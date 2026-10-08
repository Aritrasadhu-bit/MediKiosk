import type { StoredHistory } from "@/lib/types";

/**
 * HL7 v2 message construction.
 *
 * Kept free of `server-only` and any I/O so the wire format can be unit tested
 * directly — a malformed ORU^R01 fails silently at a real hospital interface,
 * which is exactly where you do not want to discover it.
 */

/** Escape HL7 delimiters so free text cannot inject extra fields or segments. */
function escapeHl7(value: string): string {
  return value.replace(/[\\^~&|]/g, " ").replace(/[\r\n]+/g, " ").trim();
}

/** Timestamp format required by HL7 v2 (YYYYMMDDHHmmss). */
export function hl7Timestamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Build an HL7 v2.5.1 ORU^R01 observation result carrying the structured
 * history as a single free-text segment plus coded vitals as OBX values.
 *
 * Segments are separated by CR and the message ends with CR, per the HL7
 * v2.x framing rules (the MLLP transport adds its own VT/FS/CR framing).
 */
export function buildOrUMessage(h: StoredHistory, now: Date = new Date()): string {
  const stamp = hl7Timestamp(now);

  // PID-3 carries the ABHA identifier, PID-5 the patient name in the standard
  // family^given form. The segment name is PID-0 and must be the first field.
  const pid = ["PID", "1", "", h.patient.abhaId || h.encounterId, "", `^${escapeHl7(h.history.name)}`].join("|");
  const pv1 = ["PV1", "1", "O", "", "", "", escapeHl7(h.patient.department || "OPD")].join("|");

  // OBX-3 coded vitals so the receiving EMR stores them as real observations
  // rather than burying them in free text.
  const obx: string[] = [];
  const addObx = (setId: string, type: string, code: string, subId: string, value: string, unit: string) => {
    obx.push(["OBX", setId, type, code, subId, escapeHl7(value), unit, "", "F"].join("|"));
  };
  const v = h.patient.vitals ?? {};
  if (Number.isFinite(v.systolic)) addObx("1", "NM", "8480-6", "Systolic BP", String(v.systolic), "mmHg");
  if (Number.isFinite(v.diastolic)) addObx("2", "NM", "8462-4", "Diastolic BP", String(v.diastolic), "mmHg");
  if (Number.isFinite(v.pulse)) addObx("3", "NM", "8867-4", "Heart rate", String(v.pulse), "beats/min");
  if (Number.isFinite(v.temperature)) addObx("4", "NM", "8310-5", "Temperature", String(v.temperature), "Cel");
  if (Number.isFinite(v.weight)) addObx("5", "NM", "29463-7", "Weight", String(v.weight), "kg");
  if (Number.isFinite(v.height)) addObx("6", "NM", "8302-2", "Height", String(v.height), "cm");
  if (Number.isFinite(v.spo2)) addObx("7", "NM", "59408-5", "SpO2", String(v.spo2), "%");
  // The clinical narrative itself.
  addObx("8", "TX", "HISTORY-NARRATIVE", "MediKiosk structured clinical history", h.summary || "", "");

  const segments = [
    [
      "MSH",
      "^~\\&",                // MSH-2 encoding characters
      "MediKiosk",            // MSH-3 sending application
      "Kiosk History Capture",// MSH-4 sending facility
      "",                     // MSH-5 receiving application
      "",                     // MSH-6 receiving facility
      stamp,                  // MSH-7 date/time
      "",                     // MSH-8 security
      "ORU^R01",              // MSH-9 message type
      `MK${h.encounterId.replace(/\W/g, "").slice(0, 16)}`, // MSH-10 control id
      "P",                    // MSH-11 processing id
      "2.5.1",                // MSH-12 version
    ].join("|"),
    pid,
    pv1,
    ...obx,
  ];
  return `${segments.join("\r")}\r`;
}
