import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { maintenanceSchema, safeParse } from "@/lib/validation";
import { readMaintenance, setMaintenance } from "@/lib/server/maintenance";
import { csrfGuard } from "@/lib/server/csrf";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";
import { bodyTooLarge, payloadTooLarge } from "@/lib/server/bodyLimit";
import { log } from "@/lib/server/log";

export const runtime = "nodejs";

/**
 * Maintenance mode (Batch D, R5) — admin only.
 *
 *   GET  /api/admin/maintenance → current state
 *   POST /api/admin/maintenance → toggle { active, reason? }
 *
 * While active, kiosk write endpoints (encounters POST, appointment booking /
 * check-in) answer 503 instead of accepting data, and /api/health reports the
 * mode — so a backup/migration window can never silently drop patient data.
 */
export async function GET() {
  const user = await currentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Admin access required." }, { status: 403 });
  }
  return NextResponse.json({ ok: true, maintenance: await readMaintenance() });
}

export async function POST(req: Request) {
  if (!rateLimit(routeRateLimitKey(req), 10, 60_000)) {
    return NextResponse.json({ ok: false, error: "Rate limit" }, { status: 429 });
  }
  const csrf = csrfGuard(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, error: csrf.error }, { status: 403 });

  const user = await currentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Admin access required." }, { status: 403 });
  }
  if (bodyTooLarge(req, 64 * 1024)) return payloadTooLarge();

  const body = await req.json().catch(() => null);
  const parsed = safeParse(maintenanceSchema, body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  const maintenance = await setMaintenance(parsed.data.active, parsed.data.reason);
  log("info", "admin", "maintenance toggled", { by: user.username, active: parsed.data.active, reason: parsed.data.reason });
  return NextResponse.json({ ok: true, maintenance });
}