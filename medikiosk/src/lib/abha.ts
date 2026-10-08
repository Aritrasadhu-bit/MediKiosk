// Verhoeff check-digit algorithm — the dihedral-group D5 check used by Aadhaar
// (12-digit) and ABHA (14-digit) numbers. Detects all single-digit errors and
// all adjacent transpositions.
//
// Tables are the canonical Verhoeff tables (Wikipedia / Verhoeff 1969).

const D: number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const P: number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

/** Right-to-left digit array: n[0] == rightmost digit (Verhoeff convention). */
function digitsReversed(id: string): number[] {
  return id.replace(/[^0-9]/g, "").split("").reverse().map((c) => Number(c));
}

/** True when the full digit string passes the Verhoeff check (last digit is the check digit). */
export function passesVerhoeff(id: string): boolean {
  const n = digitsReversed(id);
  if (n.length < 2) return false;
  let c = 0;
  for (let i = 0; i < n.length; i++) {
    c = D[c][P[i % 8][n[i]]];
  }
  return c === 0;
}

/** Compute the Verhoeff check digit for the given digit string (without check digit). */
export function verhoeffCheckDigit(id: string): number {
  // The check digit is the inv of the checksum computed with a padded 0 at
  // offset 0 — i.e. base digits occupy offsets 1, 2, ... directly.
  const n = digitsReversed(id);
  let c = 0;
  for (let i = 0; i < n.length; i++) {
    c = D[c][P[(i + 1) % 8][n[i]]];
  }
  return INV[c];
}

export function isValidAadhaar(id: string): boolean {
  const digits = id.replace(/[^0-9]/g, "");
  if (digits.length !== 12) return false;
  return passesVerhoeff(digits);
}

export function isValidAbhaId(id: string): boolean {
  // ABHA 2.0: XX-XXXX-XXXX-XXXX (14 digits) with a Verhoeff check digit.
  const cleaned = id.trim();
  const digits = cleaned.replace(/[^0-9]/g, "");
  if (digits.length !== 14) return false;
  if (!/^\d{2}-\d{4}-\d{4}-\d{4}$/.test(cleaned) && !/^\d{14}$/.test(cleaned)) return false;
  return passesVerhoeff(digits);
}

export function formatAbhaId(id: string): string {
  const d = id.replace(/[^0-9]/g, "");
  if (d.length === 12) return d.replace(/(\d{4})(\d{4})(\d{4})/, "$1 $2 $3");
  return d.replace(/(\d{2})(\d{4})(\d{4})(\d{4})/, "$1-$2-$3-$4");
}

export function isAadhaarLike(id: string): boolean {
  const digits = id.replace(/[^0-9]/g, "");
  return digits.length === 12 || digits.length === 14;
}

/**
 * Is this an identifier the kiosk is willing to accept in the "ABHA ID or
 * Aadhaar" field?
 *
 * The field is labelled as taking either, and the UI shows a green tick for a
 * valid Aadhaar, so the submit path has to agree with that. It previously
 * validated with `isValidAbhaId` alone — which only accepts the 14-digit ABHA
 * form — so a correct 12-digit Aadhaar got a green checkmark and then failed
 * on "Next" with "Please correct the highlighted fields".
 *
 * Both formats are Verhoeff-checked, so this is not a loosening of validation:
 * a mistyped number still fails both.
 */
export function isAcceptedIdentifier(id: string): boolean {
  const cleaned = id.trim();
  if (!cleaned) return false;
  return isValidAbhaId(cleaned) || isValidAadhaar(cleaned);
}

/** Which valid format this identifier is, for messaging. */
export function identifierKind(id: string): "abha" | "aadhaar" | null {
  const cleaned = id.trim();
  if (!cleaned) return null;
  if (isValidAbhaId(cleaned)) return "abha";
  if (isValidAadhaar(cleaned)) return "aadhaar";
  return null;
}

export function isValidMobile(mobile: string): boolean {
  return /^[6-9]\d{9}$/.test(mobile);
}

/** Build a valid 14-digit ABHA number from a 2-digit prefix + 11 deterministic digits. */
export function sampleAbhaId(prefix = "11", body = "00000000000"): string {
  const base = `${prefix}${body}`.replace(/[^0-9]/g, "").padEnd(13, "0").slice(0, 13);
  const check = verhoeffCheckDigit(base);
  return formatAbhaId(base + check);
}