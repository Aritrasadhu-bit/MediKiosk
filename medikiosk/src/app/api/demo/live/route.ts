import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { getLiveDemoStatus, startLiveDemo, stopLiveDemo } from "@/lib/server/liveDemo";
import { liveDemoSchema, safeParse } from "@/lib/validation";
import { csrfGuard } from "@/lib/server/csrf";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";
import { bodyTooLarge, payloadTooLarge } from "@/lib/server/bodyLimit";

export const runtime = "nodejs";

/**
 * Living-hospital demo control (Batch C, P2) — admin only.
 *
 *   GET    /api/demo/live        → current run status
 *   POST   /api/demo/live        → start (body: { intervalSeconds })
 *   DELETE /api/demo/live        → stop
 */
export async function GET() {
  const user = await currentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Admin access required." }, { status: 403 });
  }
  return NextResponse.json({ ok: true, status: getLiveDemoStatus() });
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
  const parsed = safeParse(liveDemoSchema, body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const status = await startLiveDemo(parsed.data.intervalSeconds);
  return NextResponse.json({ ok: true, status });
}

export async function DELETE(req: Request) {
  const csrf = csrfGuard(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, error: csrf.error }, { status: 403 });

  const user = await currentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Admin access required." }, { status: 403 });
  }

  const status = stopLiveDemo();
  return NextResponse.json({ ok: true, status });
}