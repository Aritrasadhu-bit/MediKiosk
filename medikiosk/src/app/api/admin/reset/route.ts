import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { resetEncounters, resetQueueState, seedEncounters, listEncounters } from "@/lib/server/db";
import { resetAppointments } from "@/lib/server/appointments-db";
import { buildDemoPatients } from "@/lib/demoData";
import { csrfGuard } from "@/lib/server/csrf";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";
import { log } from "@/lib/server/log";

export const runtime = "nodejs";

/**
 * Admin-only "Reset demo state" — wipes encounters/queue/appointments and
 * re-seeds the three demo patients so a judge demo slot starts clean in one
 * click. Never touches users, sessions or stored uploads.
 */
export async function POST(req: Request) {
  if (!rateLimit(routeRateLimitKey(req), 20, 60_000)) {
    return NextResponse.json({ ok: false, error: "Rate limit" }, { status: 429 });
  }
  const csrf = csrfGuard(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, error: csrf.error }, { status: 403 });

  const user = await currentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Admin access required." }, { status: 403 });
  }

  await resetEncounters();
  await resetQueueState();
  await resetAppointments();
  const seeded = await seedEncounters(buildDemoPatients());
  const remaining = await listEncounters();
  log("info", "admin", "demo reset", { by: user.username, seeded, encounters: remaining.length });
  return NextResponse.json({
    ok: true,
    seeded,
    encounters: remaining.length,
    message: `Demo reset complete — ${seeded} demo patients seeded, queue cleared.`,
  });
}