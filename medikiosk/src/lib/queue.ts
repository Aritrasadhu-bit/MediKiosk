import type { EncounterStatus, RedFlag, StoredHistory } from "./types";

/**
 * Queue intelligence for the physician dashboard.
 *
 * Pure functions: (awaiting) encounter, urgency, and wait-time → SLA colour,
 * ETA, and priority ordering. Kept side-effect free so they are unit-testable
 * and reusable by nurse triage and the waiting-room display.
 */

export type SlaLevel = "green" | "amber" | "red";
export type SeverityLevel = "high" | "medium" | "normal";

/**
 * A record missing its flags array (a pre-validation-era store, a hand-edited
 * backup) must sort as normal, not crash the whole queue display with a
 * TypeError on `.some`.
 */
export function severityOfRedFlags(flags: RedFlag[] | undefined | null): SeverityLevel {
  if (!Array.isArray(flags)) return "normal";
  if (flags.some((f) => f.severity === "high")) return "high";
  if (flags.some((f) => f.severity === "medium")) return "medium";
  return "normal";
}

/** Urgency rank for sorting: high(3) > medium(2) > normal(1). */
export function severityRank(level: SeverityLevel): number {
  return level === "high" ? 3 : level === "medium" ? 2 : 1;
}

/**
 * SLA colour by wait time vs urgency:
 *  - high urgency  → red at 5 min, amber at 2 min
 *  - medium        → red at 15 min, amber at 10 min
 *  - normal        → red at 30 min, amber at 20 min
 */
export function slaLevel(
  enteredAt: string,
  severity: SeverityLevel,
  now = Date.now()
): SlaLevel {
  const waitMin = (now - new Date(enteredAt).getTime()) / 60_000;
  if (severity === "high") return waitMin >= 5 ? "red" : waitMin >= 2 ? "amber" : "green";
  if (severity === "medium") return waitMin >= 15 ? "red" : waitMin >= 10 ? "amber" : "green";
  return waitMin >= 30 ? "red" : waitMin >= 20 ? "amber" : "green";
}

export function waitMinutes(enteredAt: string, now = Date.now()): number {
  return Math.max(0, Math.round((now - new Date(enteredAt).getTime()) / 60_000));
}

/** Estimated minutes until this queue slot is seen (position × avg consult). */
export function etaMinutes(position: number, avgConsultMinutes = 7): number {
  return Math.max(0, Math.round(position * avgConsultMinutes));
}

export type ConsultSample = { enteredAt: string; confirmedAt?: string };

/**
 * EWMA-smoothed average consult duration (minutes) from recently completed
 * visits. The estimator is a demand-forecast proxy: as real consults speed up
 * or slow down, the ETA the display/physician page shows converges on observed
 * behaviour. Clamped to a sane [2, 30] minute band.
 */
export function smoothedConsultMinutes(
  samples: ConsultSample[],
  fallback = 7,
  alpha = 0.3
): number {
  const durations = samples
    .filter((s) => s.confirmedAt && s.enteredAt)
    .map((s) => (new Date(s.confirmedAt as string).getTime() - new Date(s.enteredAt).getTime()) / 60_000)
    .filter((d) => d >= 0.1)
    .sort((a, b) => a - b);
  if (!durations.length) return fallback;
  let ewa = durations[0];
  for (let i = 1; i < durations.length; i++) {
    ewa = alpha * durations[i] + (1 - alpha) * ewa;
  }
  return Math.min(30, Math.max(2, Math.round(ewa * 10) / 10));
}

/** Position of the encounter by queue token in the prioritised queue (1-based), or -1. */
export function queuePositionByToken(encounters: StoredHistory[], token: string): number {
  const idx = sortQueue(encounters).findIndex((e) => e.token && e.token === token);
  return idx === -1 ? -1 : idx + 1;
}

/**
 * Queue token issued at the kiosk (e.g. TK-1042). When a submission arrives
 * without one, derive a deterministic, visually-consistent token from the
 * encounter id so the token slip, the /display feed, the QR position lookup and
 * duplicate-waiting detection all work for every record.
 */
export function deriveQueueToken(encounterId: string): string {
  let h = 0;
  for (let i = 0; i < encounterId.length; i++) {
    h = (h * 31 + encounterId.charCodeAt(i)) >>> 0;
  }
  return `TK-${1000 + (h % 9000)}`;
}

/**
 * Mint a queue token nobody else holds. Tokens live in a 9000-slot space
 * (`TK-1000`–`TK-9999`) and callers historically minted them randomly or
 * deterministically per encounter — both collide in production (at ~50
 * patients/day a random mint collides about one day in seven). A duplicate
 * token is not cosmetic: position lookup, the waiting-room display call-out,
 * the printed slip and the portal QR lookup all resolve a token to the FIRST
 * match, so two patients end up sharing one call identity. Re-derive with a
 * salt until free; the loop is bounded and the space dwarfs any real queue.
 *
 * Pure (takes the taken-set) so it is unit-testable without the store; the
 * async `ensureUniqueToken` in db.ts supplies the set from storage.
 */
export function mintUniqueToken(encounterId: string, candidate: string, taken: Set<string>): string {
  const norm = (t: string) => t.trim().toUpperCase();
  let token = candidate;
  for (let n = 1; n <= 25 && taken.has(norm(token)); n++) {
    token = deriveQueueToken(`${encounterId}#${n}`);
  }
  return token;
}

/** Position of the encounter in the urgency-prioritised queue (1-based), or -1. */
export function queuePosition(encounters: StoredHistory[], encounterId: string): number {
  const idx = sortQueue(encounters).findIndex((e) => e.encounterId === encounterId);
  return idx === -1 ? -1 : idx + 1;
}

/** Still waiting to be seen: submitted but not yet confirmed / escalated. */
export function isWaiting(encounter: StoredHistory): boolean {
  return encounter.status === "pending" || encounter.status === "triage";
}

export function isOpen(encounter: StoredHistory): boolean {
  return encounter.status !== "confirmed" && encounter.status !== "er";
}

/** Urgency-first, then FIFO by entry time. */
export function sortQueue(encounters: StoredHistory[]): StoredHistory[] {
  return [...encounters]
    .filter((e) => isWaiting(e))
    .sort((a, b) => {
      const ra = severityRank(severityOfRedFlags(a.redFlags));
      const rb = severityRank(severityOfRedFlags(b.redFlags));
      if (ra !== rb) return rb - ra;
      return new Date(a.enteredAt).getTime() - new Date(b.enteredAt).getTime();
    });
}

/** How long the encounter has been sitting (in minutes). */
export function slotAgeMinutes(encounter: StoredHistory, now = Date.now()): number {
  return Math.max(0, (now - new Date(encounter.enteredAt).getTime()) / 60_000);
}

export type QueueSummary = {
  waiting: number;
  byStatus: Record<EncounterStatus, number>;
  bySeverity: Record<SeverityLevel, number>;
  oldestWaitMinutes: number;
};

export function summarizeQueue(encounters: StoredHistory[], now = Date.now()): QueueSummary {
  const byStatus: Record<EncounterStatus, number> = {
    pending: 0,
    triage: 0,
    confirmed: 0,
    er: 0,
  };
  const bySeverity: Record<SeverityLevel, number> = { high: 0, medium: 0, normal: 0 };
  let oldestWaitMinutes = 0;
  for (const e of encounters) {
    byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
    const sev = severityOfRedFlags(e.redFlags);
    if (isWaiting(e)) {
      bySeverity[sev] += 1;
      oldestWaitMinutes = Math.max(oldestWaitMinutes, slotAgeMinutes(e, now));
    }
  }
  return {
    waiting: byStatus.pending + byStatus.triage,
    byStatus,
    bySeverity,
    oldestWaitMinutes: Math.round(oldestWaitMinutes),
  };
}