import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { bookedForDate, markReminded } from "@/lib/server/appointments-db";
import { notifyPatient } from "@/lib/server/notify";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";

export const runtime = "nodejs";

/** Cap per call so one click can never become an SMS flood. */
const MAX_REMINDERS = 200;

/**
 * Admin-only: send appointment-reminder SMS for a date (default tomorrow).
 * Idempotent — already-reminded bookings are skipped unless `resend: true`.
 * Without an SMS provider configured each attempt is logged and reported as
 * unsent rather than failing silently.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ ok: false, error: "Admins only." }, { status: 403 });
  if (!rateLimit(routeRateLimitKey(req), 5, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests. Try again shortly." }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as { date?: unknown; resend?: unknown };
  const date =
    typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 10);
  const resend = body.resend === true;

  const booked = (await bookedForDate(date)).slice(0, MAX_REMINDERS);
  const due = resend ? booked : booked.filter((a) => !a.remindedAt);
  let sent = 0;
  const sentIds: string[] = [];
  for (const appt of due) {
    const ok = await notifyPatient({
      mobile: appt.mobile,
      template: "appointment_reminder",
      vars: { name: appt.name, date: appt.date, slot: appt.slot, department: appt.department },
    });
    if (ok) {
      sent++;
      sentIds.push(appt.id);
    }
  }
  await markReminded(sentIds);
  return NextResponse.json({
    ok: true,
    date,
    total: booked.length,
    sent,
    skipped: booked.length - due.length,
    failed: due.length - sent,
    provider: process.env.SMS_PROVIDER_URL ? "external" : "stub (logged only — set SMS_PROVIDER_URL to send)",
  });
}
