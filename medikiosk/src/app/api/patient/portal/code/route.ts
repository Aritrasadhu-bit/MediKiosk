import { NextResponse } from "next/server";
import { getEncounter } from "@/lib/server/db";
import { portalCode } from "@/lib/server/portal";
import { csrfGuard } from "@/lib/server/csrf";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";
import { isValidMobile } from "@/lib/abha";

export const runtime = "nodejs";

/**
 * Hand the portal access code to the kiosk that just registered this patient.
 * Bound exactly like the token-SMS route: the mobile must match the number
 * stored on the encounter, so a code for someone else's record can never be
 * minted here. The done screen turns it into the QR URL the patient's phone
 * can open (/p/{encounterId}?code=…).
 */
export async function POST(req: Request) {
  if (!rateLimit(routeRateLimitKey(req), 10, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests. Try again shortly." }, { status: 429 });
  }
  const csrf = csrfGuard(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, error: csrf.error }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { encounterId?: unknown; mobile?: unknown };
  const encounterId = typeof body.encounterId === "string" ? body.encounterId : "";
  const mobile = typeof body.mobile === "string" ? body.mobile.trim() : "";
  // Patients without a mobile on record keep the legacy staff QR (see done
  // page): there is no verified identity to bind a portal code to.
  if (!encounterId || !isValidMobile(mobile)) {
    return NextResponse.json({ ok: false, error: "Valid encounter and mobile number required." }, { status: 400 });
  }

  const encounter = await getEncounter(encounterId);
  if (!encounter) {
    return NextResponse.json({ ok: false, error: "Encounter not found." }, { status: 404 });
  }
  if (encounter.patient.mobile !== mobile) {
    return NextResponse.json({ ok: false, error: "Mobile number does not match this record." }, { status: 403 });
  }
  return NextResponse.json({ ok: true, code: portalCode(encounterId) });
}
