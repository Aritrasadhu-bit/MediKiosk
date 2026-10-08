import type { ReferralSlip, StoredHistory } from "./types";
import { escalationPolicy, type EscalationResult } from "./escalation";

/**
 * Referral-slip builder (Batch B, U7).
 *
 * When the escalation engine flags danger (ER or severe triage), a printable
 * referral slip is auto-generated so the patient can present a compact,
 * structured handoff at the emergency / higher facility — vitals snapshot,
 * MEWS score, decision reasons, and the kiosk summary travel with the patient.
 *
 * Pure function: given an encounter (and optional policy), returns the slip.
 */

export function buildReferralSlip(
  encounter: StoredHistory,
  policy?: EscalationResult
): ReferralSlip {
  const p = policy ?? escalationPolicy(encounter);
  const to = p.level === "er" ? "Emergency Department" : "Triage / Higher Centre";

  const reason =
    p.reasons[0] ??
    (p.level === "er" ? "Automated escalation — immediate review" : "Physician referral");

  return {
    id: `REF-${encounter.token ?? encounter.encounterId.slice(0, 8).toUpperCase()}-${new Date()
      .getTime()
      .toString(36)
      .toUpperCase()}`,
    to,
    reason,
    reasons: p.reasons,
    score: p.score,
    issuedAt: new Date().toISOString(),
    fromDepartment: encounter.patient?.department ?? "Unknown",
    patientName: encounter.patient?.name ?? "Unknown",
    patientAge: encounter.patient?.age ?? 0,
    patientSex: encounter.patient?.sex ?? "Unknown",
    abhaId: encounter.patient?.abhaId,
    mobile: encounter.patient?.mobile,
    vitals: encounter.patient?.vitals,
    summary: encounter.summary,
  };
}

/** Render the slip as a compact, printable text block (80-col friendly). */
export function referralToText(slip: ReferralSlip): string {
  const lines = [
    "MEDIKIOSK REFERRAL SLIP",
    "=======================",
    `Ref: ${slip.id}`,
    `To: ${slip.to}`,
    `From: ${slip.fromDepartment}`,
    `Issued: ${new Date(slip.issuedAt).toLocaleString("en-IN")}`,
    "-----------------------",
    `Patient: ${slip.patientName}, ${slip.patientAge} yrs, ${slip.patientSex}`,
    slip.abhaId ? `ABHA: ${slip.abhaId}` : null,
    slip.mobile ? `Mobile: ${slip.mobile}` : null,
    "-----------------------",
    `Reason: ${slip.reason}`,
    ...slip.reasons.map((r) => ` • ${r}`),
    slip.score !== undefined ? `MEWS: ${slip.score}` : null,
    "-----------------------",
    "Vitals snapshot:",
    ...(slip.vitals
      ? [
          ` BP ${slip.vitals.systolic ?? "—"}/${slip.vitals.diastolic ?? "—"} mmHg`,
          ` Pulse ${slip.vitals.pulse ?? "—"} bpm`,
          ` SpO2 ${slip.vitals.spo2 ?? "—"}%`,
          ` Temp ${slip.vitals.temperature ?? "—"}°C`,
        ]
      : [" (none recorded)"]),
    "-----------------------",
    ...(slip.summary ? ["Summary:", slip.summary] : []),
    "",
    "THIS SLIP ACCOMPANIES THE PATIENT — PLEASE REVIEW AT THE DESTINATION FACILITY.",
  ];
  return lines.filter((l) => l !== null).join("\n");
}