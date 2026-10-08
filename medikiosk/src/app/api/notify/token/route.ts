import { NextResponse } from "next/server";
import { getEncounter } from "@/lib/server/db";
import { notifyPatient } from "@/lib/server/notify";
import { csrfGuard } from "@/lib/server/csrf";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";
import { isValidMobile } from "@/lib/abha";

export const runtime = "nodejs";

/**
 * Kiosk token-by-SMS: sends the just-issued token + department to the
 * patient's own phone so a lost paper slip doesn't mean a lost turn.
 *
 * Abuse-bound: the mobile must exactly match the number stored on the
 * encounter (no free-form SMS to arbitrary numbers), the encounter must
 * exist, and the route is tightly rate-limited. Without an SMS provider
 * configured the attempt isLogged to notifications.log and `sent` is false.
 */
export async function POST(req: Request) {
  if (!rateLimit(routeRateLimitKey(req), 5, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests. Try again shortly." }, { status: 429 });
  }
  const csrf = csrfGuard(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, error: csrf.error }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { encounterId?: unknown; mobile?: unknown };
  const encounterId = typeof body.encounterId === "string" ? body.encounterId : "";
  const mobile = typeof body.mobile === "string" ? body.mobile.trim() : "";
  if (!encounterId || !isValidMobile(mobile)) {
    return NextResponse.json({ ok: false, error: "Valid encounter and mobile number required." }, { status: 400 });
  }

  const encounter = await getEncounter(encounterId);
  if (!encounter) {
    return NextResponse.json({ ok: false, error: "Encounter not found." }, { status: 404 });
  }
  if (encounter.patient.mobile !== mobile) {
    // The number must belong to this record — never send tokens elsewhere.
    return NextResponse.json({ ok: false, error: "Mobile number does not match this record." }, { status: 403 });
  }

  const sent = await notifyPatient({
    mobile,
    template: "token_issued",
    vars: {
      name: encounter.patient.name,
      token: encounter.token ?? encounterId.slice(0, 8).toUpperCase(),
      department: encounter.patient.department,
    },
  });
  return NextResponse.json({ ok: true, sent });
}
