import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { recordHeartbeat, listHeartbeats } from "@/lib/server/heartbeats";
import { evaluateFleetAlerts } from "@/lib/server/kioskAlerts";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";

export const runtime = "nodejs";

/** Kiosk ping (public, high-volume): last-seen + queued-write count. No PHI. */
export async function POST(req: Request) {
  if (!rateLimit(routeRateLimitKey(req), 30, 60_000)) {
    return NextResponse.json({ ok: false, error: "Rate limit" }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as { kioskId?: unknown; pending?: unknown };
  const kioskId = typeof body.kioskId === "string" ? body.kioskId.trim().slice(0, 64) : "";
  const pending = typeof body.pending === "number" && Number.isFinite(body.pending) ? Math.max(0, Math.floor(body.pending)) : 0;
  if (!kioskId) {
    return NextResponse.json({ ok: false, error: "kioskId required." }, { status: 400 });
  }
  await recordHeartbeat({
    kioskId,
    lastSeen: new Date().toISOString(),
    pending,
    userAgent: (req.headers.get("user-agent") ?? "").slice(0, 200),
  });
  return NextResponse.json({ ok: true });
}

/** Admin-only: fleet view of kiosk health. Evaluating alerts here (rather
 * than on a cron) means they fire whenever ops opens the dashboard. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ ok: false, error: "Admins only." }, { status: 403 });
  if (!rateLimit(routeRateLimitKey(req), 20, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests. Try again shortly." }, { status: 429 });
  }
  const kiosks = await listHeartbeats();
  const alerted = await evaluateFleetAlerts(kiosks).catch(() => [] as string[]);
  return NextResponse.json({ ok: true, kiosks, alerted });
}
