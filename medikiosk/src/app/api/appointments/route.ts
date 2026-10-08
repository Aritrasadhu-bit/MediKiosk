import { NextResponse } from "next/server";
import { upsertAppointment, findAppointments } from "@/lib/server/appointments-db";
import { appointmentSchema, appointmentLookupSchema, safeParse } from "@/lib/validation";
import { csrfGuard } from "@/lib/server/csrf";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";
import { bodyTooLarge, payloadTooLarge } from "@/lib/server/bodyLimit";
import { readSettings } from "@/lib/server/settings";
import { DEPARTMENTS } from "@/lib/data";
import { maintenanceActive } from "@/lib/server/maintenance";
import { log } from "@/lib/server/log";

export const runtime = "nodejs";

/** Whoever you are: check your own booked appointments by mobile (+ today's date). */
export async function GET(req: Request) {
  if (!rateLimit(routeRateLimitKey(req), 30, 60_000)) {
    return NextResponse.json({ ok: false, error: "Rate limit" }, { status: 429 });
  }
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const parsed = safeParse(appointmentLookupSchema, params);
  if (!parsed.ok || !parsed.data.mobile) {
    return NextResponse.json({ ok: false, error: "A valid mobile number is required." }, { status: 400 });
  }
  if (!parsed.data.name?.trim()) {
    // Two-factor lookup: a mobile number alone must not open someone else's
    // bookings (name + department + slot leaks health information). The name
    // has to match the booking; non-matching names simply see nothing.
    return NextResponse.json({ ok: false, error: "Provide the booked name with the mobile number." }, { status: 400 });
  }
  const appointments = await findAppointments(parsed.data.mobile, parsed.data.date, parsed.data.name);
  return NextResponse.json({
    ok: true,
    appointments: appointments.map((a) => ({
      id: a.id,
      name: a.name,
      department: a.department,
      date: a.date,
      slot: a.slot,
      status: a.status,
      checkedInAt: a.checkedInAt ?? null,
    })),
  });
}

/** Public booking: reserve a slot at the kiosk / from home. */
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
      { ok: false, error: "Appointments are paused for maintenance — please try again shortly.", retryable: true },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsed = safeParse(appointmentSchema, body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  // The department feeds queue stats, surveillance buckets and the OPD
  // register — a free-text field would let anyone fragment them with junk
  // ("Onkology") or poison them at 20 requests/min. Accept the union of the
  // admin-configured list and the kiosk's built-in list (they differ: the
  // built-in list carries the AYUSH departments).
  const settings = await readSettings();
  const allowedDepartments = new Set(
    [...settings.departments, ...DEPARTMENTS].map((d) => d.trim().toLowerCase())
  );
  if (!allowedDepartments.has(parsed.data.department.trim().toLowerCase())) {
    return NextResponse.json({ ok: false, error: "Unknown department — choose one from the kiosk list." }, { status: 400 });
  }

  try {
    const appointment = await upsertAppointment(parsed.data);
    log("info", "appointment", "booked", { by: parsed.data.mobile, department: parsed.data.department, slot: parsed.data.slot, date: parsed.data.date });
    return NextResponse.json({ ok: true, appointment });
  } catch {
    // Never echo raw DB/filesystem errors to an unauthenticated caller.
    return NextResponse.json({ ok: false, error: "Could not book the appointment. Please retry." }, { status: 400 });
  }
}