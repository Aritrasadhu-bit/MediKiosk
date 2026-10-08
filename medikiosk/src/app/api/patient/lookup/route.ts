import { NextResponse } from "next/server";
import { findReturningPatient, findPendingDuplicate } from "@/lib/server/db";
import { lookupRequestSchema, safeParse } from "@/lib/validation";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";
import { csrfGuard } from "@/lib/server/csrf";
import { bodyTooLarge, payloadTooLarge } from "@/lib/server/bodyLimit";

export const runtime = "nodejs";

/**
 * Public (kiosk) returning-patient lookup.
 *
 * The patient types their ABHA (or mobile) and we surface:
 *  - whether they have visited before (with a stripped summary for pre-fill)
 *  - whether there is ALREADY a pending token waiting for them (duplicate detection)
 *
 * Only the minimum needed for the kiosk flow is returned.
 */
export async function POST(req: Request) {
  if (!rateLimit(routeRateLimitKey(req), 30, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  }
  // The response discloses whether an identifier has visited (and a stripped
  // pre-fill record), so a cross-site page must not be able to probe it
  // through a visitor's browser.
  const csrf = csrfGuard(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, error: csrf.error }, { status: 403 });
  if (bodyTooLarge(req, 64 * 1024)) return payloadTooLarge();
  const body = await req.json().catch(() => ({}));
  const parsed = safeParse(lookupRequestSchema, body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  if (!parsed.data.abha && !parsed.data.mobile) {
    return NextResponse.json({ ok: false, error: "Provide abha or mobile." }, { status: 400 });
  }
  if (!parsed.data.abha && parsed.data.mobile && !parsed.data.name?.trim()) {
    // Two-factor lookup: a mobile number alone must not open someone else's
    // pre-fill record — the typed name has to match the stored patient name.
    return NextResponse.json({ ok: false, error: "Provide the patient name with a mobile-only lookup." }, { status: 400 });
  }

  const previous = await findReturningPatient(parsed.data.abha, parsed.data.mobile, parsed.data.name);
  const pending = await findPendingDuplicate(parsed.data.abha, parsed.data.mobile, parsed.data.name);

  return NextResponse.json({
    ok: true,
    returning: Boolean(previous),
    patient: previous
      ? {
          name: previous.patient.name,
          age: previous.patient.age,
          sex: previous.patient.sex,
          department: previous.patient.department,
          lastVisit: previous.enteredAt,
        }
      : null,
    pendingEncounter: pending
      ? {
          encounterId: pending.encounterId,
          token: pending.token ?? pending.encounterId.slice(0, 8).toUpperCase(),
          department: pending.patient.department,
          enteredAt: pending.enteredAt,
        }
      : null,
  });
}