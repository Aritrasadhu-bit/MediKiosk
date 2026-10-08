import type { StoredHistory } from "./types";
import { computeEarlyWarning, plausibleTemp, vitalsReference, ageGroupOf } from "./redflags";
import { severityOfRedFlags } from "./queue";

/**
 * Escalation policy engine — pure decision rules that turn captured vitals +
 * MEWS + red flags into an automated triage outcome.
 *
 * `er`     → dangerous physiology: route to emergency + auto-notify on-call staff
 * `triage` → needs nurse re-check before the doctor queue
 * `normal` → normal flow
 *
 * Rule-of-thumb thresholds (age-aware MEWS from `redflags.ts`). Kept
 * side-effect free so it is unit-testable and reusable by the kiosk POST route,
 * the nurse view and the physician dashboard.
 */

export type EscalationLevel = "normal" | "triage" | "er";

export type EscalationResult = {
  level: EscalationLevel;
  /** MEWS early-warning score used by the rules. */
  score: number;
  /** Human-readable reasons for the decision (shown to nurses/doctors). */
  reasons: string[];
  /** True when the system should fire an automated ER notification. */
  notify: boolean;
};

export function escalationPolicy(h: StoredHistory): EscalationResult {
  const ew = computeEarlyWarning(h.patient.age, h.patient.vitals);
  const v = h.patient.vitals ?? {};
  const reasons: string[] = [];
  const severe = severityOfRedFlags(h.redFlags) === "high";

  // Pediatric clamping: adult pulse/BP thresholds would auto-ER children
  // (a 6-year-old at pulse 135 or BP 88/55 is NORMAL). For infant/child the
  // dangerous bands come from the age-group vitals reference instead.
  const group = ageGroupOf(h.patient.age);
  const isChild = group === "child" || group === "infant";
  const ref = vitalsReference(h.patient.age);
  const sysHigh = v.systolic !== undefined && v.systolic >= 200;
  const sysLow = v.systolic !== undefined && v.systolic <= (isChild ? ref.bpSystolic[0] : 80);
  const diaHigh = v.diastolic !== undefined && v.diastolic >= 130;
  const pulseHigh = v.pulse !== undefined && v.pulse >= (isChild ? ref.pulse[1] + 25 : 140);
  const pulseLow = v.pulse !== undefined && v.pulse <= (isChild ? ref.pulse[0] - 10 : 40);
  const tempHigh = plausibleTemp(v.temperature) && (v.temperature ?? 0) >= 40.5;
  const tempTriage = plausibleTemp(v.temperature) && (v.temperature ?? 0) >= 39;
  const sysTriage = v.systolic !== undefined && v.systolic >= 160;
  const diaTriage = v.diastolic !== undefined && v.diastolic >= 100;
  const pulseTriage = v.pulse !== undefined && v.pulse >= (isChild ? ref.pulse[1] + 10 : 120);

  if (ew.score >= 5) reasons.push(`MEWS ${ew.score} is critically high (≥5)`);
  else if (ew.score >= 3) reasons.push(`MEWS ${ew.score} is high (≥3)`);
  if (v.spo2 !== undefined && v.spo2 < 90) reasons.push(`SpO2 ${v.spo2}% — hypoxia (<90%)`);
  else if (v.spo2 !== undefined && v.spo2 < 94) reasons.push(`SpO2 ${v.spo2}% is low (<94%)`);
  if (sysHigh) reasons.push(`Systolic BP ${v.systolic} mmHg (≥200)`);
  if (sysLow) reasons.push(`Systolic BP ${v.systolic} mmHg (≤${isChild ? ref.bpSystolic[0] : 80})`);
  if (diaHigh) reasons.push(`Diastolic BP ${v.diastolic} mmHg (≥130)`);
  if (pulseHigh) reasons.push(`Pulse ${v.pulse} bpm — tachycardia (≥${isChild ? ref.pulse[1] + 25 : 140})`);
  if (pulseLow) reasons.push(`Pulse ${v.pulse} bpm — bradycardia (≤${isChild ? ref.pulse[0] - 10 : 40})`);
  if (tempHigh) reasons.push(`Temperature ${v.temperature}°C — hyperpyrexia (≥40.5)`);
  if (severe && !reasons.length) reasons.push("Severe red-flag symptom reported");

  const er =
    ew.score >= 5 ||
    (v.spo2 !== undefined && v.spo2 < 90) ||
    sysHigh ||
    sysLow ||
    tempHigh ||
    pulseHigh ||
    pulseLow;

  const triage =
    !er &&
    (ew.score >= 3 ||
      (v.spo2 !== undefined && v.spo2 < 94) ||
      sysTriage ||
      diaTriage ||
      tempTriage ||
      pulseTriage ||
      severe);

  return {
    level: er ? "er" : triage ? "triage" : "normal",
    score: ew.score,
    reasons,
    notify: er,
  };
}