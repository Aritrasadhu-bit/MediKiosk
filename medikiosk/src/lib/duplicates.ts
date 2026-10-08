import { isWalkInWithoutAbha } from "./types";
import { levenshteinDistance } from "./extractor";
import { registerDateKey } from "./opdRegister";
/**
 * Same-day duplicate-patient detection.
 *
 * Two kiosks (or a kiosk and a camp worker) can register the same person
 * twice with no shared client state — by ABHA when present, otherwise by
 * mobile + fuzzy name. This is a WARNING, never a block: genuine re-visits
 * exist, and refusing care at intake is worse than a duplicate token. The
 * match rides on the stored record (`possibleDuplicateOf`) so the physician
 * queue can badge it, and the submitter gets it echoed in the response.
 *
 * Pure over an explicit record list so it is unit-testable without storage.
 */

export type DuplicateMatch = { encounterId: string; token?: string; reason: string };

/** Minimal identity surface the matcher reads — full records not required. */
export type DuplicateIdentity = {
  abhaId?: string;
  mobile?: string;
  name?: string;
};

function digits(s: string | undefined): string {
  return (s ?? "").replace(/[^0-9]/g, "");
}

function normName(s: string | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Fuzzy name equality tolerant of transliteration/typing slips. */
function samePersonName(a: string, b: string): boolean {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.abs(x.length - y.length) > 2) return false;
  return levenshteinDistance(x, y) <= 2;
}

function sameDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false;
  return registerDateKey(da) === registerDateKey(db);
}

const OPEN = new Set(["pending", "triage"]);

/**
 * Open (pending/triage) same-day records that look like the same patient as
 * `candidate`, excluding the candidate itself. Empty when nothing matches.
 */
export function findSameDayDuplicates(
  candidate: { encounterId: string; enteredAt: string; patient?: DuplicateIdentity | null },
  all: { encounterId: string; enteredAt: string; status: string; token?: string; patient?: DuplicateIdentity | null }[]
): DuplicateMatch[] {
  const out: DuplicateMatch[] = [];
  const candAbha = digits(candidate.patient?.abhaId);
  const candMobile = digits(candidate.patient?.mobile);
  const candName = candidate.patient?.name ?? "";
  for (const e of all) {
    if (e.encounterId === candidate.encounterId) continue;
    if (!OPEN.has(e.status)) continue;
    if (!sameDay(e.enteredAt, candidate.enteredAt)) continue;
    const encAbha = digits(e.patient?.abhaId);
    if (candAbha && encAbha === candAbha) {
      out.push({ encounterId: e.encounterId, token: e.token, reason: "same ABHA, already waiting today" });
      continue;
    }
    // Walk-ins have placeholder ABHAs: match on mobile + fuzzy name so one
    // typo'd digit or transliteration variant does not hide the duplicate —
    // but a mobile alone is never enough (family members share phones). Only
    // the STORED side must be a walk-in (mirrors findReturningPatient): a
    // caller who has since obtained an ABHA still links to their walk-in
    // record when mobile + name agree.
    if (
      isWalkInWithoutAbha(e.patient?.abhaId) &&
      candMobile &&
      digits(e.patient?.mobile) === candMobile &&
      samePersonName(candName, e.patient?.name ?? "")
    ) {
      out.push({ encounterId: e.encounterId, token: e.token, reason: "same name + mobile, already waiting today" });
    }
  }
  return out;
}
