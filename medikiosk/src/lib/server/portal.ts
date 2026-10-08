import { createHmac } from "crypto";
import { sessionSecret, safeEqual } from "@/lib/server/secret";

/**
 * Patient portal access tokens — a short unguessable per-encounter code
 * derived from SESSION_SECRET, so a public /p/{encounterId} URL cannot be
 * enumerated to exfiltrate anyone else's record.
 *
 * Note: because the code is a deterministic HMAC, a guessable SESSION_SECRET
 * would let anyone derive the code for any encounterId offline. That is why
 * the secret module refuses to run on a placeholder value in production.
 */

export function portalCode(encounterId: string): string {
  return createHmac("sha256", sessionSecret())
    .update(`portal:${encounterId}`)
    .digest("hex")
    .slice(0, 12);
}

export function validPortalCode(encounterId: string, code: string | null | undefined): boolean {
  if (!code) return false;
  return safeEqual(portalCode(encounterId), code);
}