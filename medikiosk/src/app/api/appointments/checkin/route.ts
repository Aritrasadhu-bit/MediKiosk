import { NextResponse } from "next/server";
import { checkInAppointment, getAppointmentById } from "@/lib/server/appointments-db";
import { appointmentCheckinSchema, safeParse } from "@/lib/validation";
import { csrfGuard } from "@/lib/server/csrf";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";
import { bodyTooLarge, payloadTooLarge } from "@/lib/server/bodyLimit";
import { maintenanceActive } from "@/lib/server/maintenance";

export const runtime = "nodejs";

/**
 * Kiosk check-in: a patient who booked a slot taps "check in" on arrival and
 * slides straight into the queue at the right priority.
 */
export async function POST(req: Request) {
  if (!rateLimit(routeRateLimitKey(req), 20, 60_000)) {
    return NextResponse.json({ ok: false, error: "Rate limit" }, { status: 429 });
  }
  const csrf = csrfGuard(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, error: csrf.error }, { status: 403 });
  if (bodyTooLarge(req, 64 * 1024)) return payloadTooLarge();

  // Maintenance mode (R5): refuse writes during backup/migration windows.
  if (await maintenanceActive()) {
    return NextResponse.json(
      { ok: false, error: "Check-in is paused for maintenance — please try again shortly.", retryable: true },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsed = safeParse(appointmentCheckinSchema, body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  // Verify the patient name matches the booking BEFORE mutating status — an
  // id alone must not let anyone check in (or cancel) someone else's slot.
  const appointment = await getAppointmentById(parsed.data.id);
  if (!appointment) return NextResponse.json({ ok: false, error: "Appointment not found" }, { status: 404 });
  if (appointment.name.trim().toLowerCase() !== parsed.data.name.trim().toLowerCase()) {
    return NextResponse.json(
      { ok: false, error: "The name entered does not match this appointment — please check the booking details." },
      { status: 400 }
    );
  }

  const updated = await checkInAppointment(parsed.data.id);
  if (!updated) return NextResponse.json({ ok: false, error: "Appointment not found" }, { status: 404 });
  return NextResponse.json({ ok: true, appointment: updated });
}