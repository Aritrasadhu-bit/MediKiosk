import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { getAlertWebhook, setAlertWebhook, evaluateFleetAlerts } from "@/lib/server/kioskAlerts";
import { listHeartbeats } from "@/lib/server/heartbeats";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";

export const runtime = "nodejs";

async function requireAdmin() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  if (user.role !== "admin")
    return NextResponse.json({ ok: false, error: "Admins only." }, { status: 403 });
  return null;
}

/** Admin-only: read the configured alert webhook (masked) + last evaluation. */
export async function GET(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!rateLimit(routeRateLimitKey(req), 20, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests. Try again shortly." }, { status: 429 });
  }
  const webhook = await getAlertWebhook();
  return NextResponse.json({ ok: true, webhook });
}

/**
 * Admin-only: save (or clear, with "") the alert webhook URL, or send a test
 * ping ({ test: true }). Fleet health is evaluated on every fleet GET, so
 * alerts fire whenever ops opens the dashboard — no cron needed.
 */
export async function POST(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!rateLimit(routeRateLimitKey(req), 10, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests. Try again shortly." }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as { webhookUrl?: unknown; test?: unknown };
  if (body.test === true) {
    const webhook = await getAlertWebhook();
    if (!webhook.configured) {
      return NextResponse.json({ ok: false, error: "Save a webhook URL first." }, { status: 400 });
    }
    const kiosks = await listHeartbeats();
    const sent = await evaluateFleetAlerts(
      kiosks.length ? kiosks : [{ kioskId: "test-ping", lastSeen: new Date(0).toISOString(), pending: 0, userAgent: "test" }],
      Date.now()
    );
    return NextResponse.json({ ok: true, sent });
  }
  if (typeof body.webhookUrl !== "string") {
    return NextResponse.json({ ok: false, error: "webhookUrl must be a string." }, { status: 400 });
  }
  const saved = await setAlertWebhook(body.webhookUrl);
  if (!saved.ok) return NextResponse.json({ ok: false, error: saved.error }, { status: 400 });
  return NextResponse.json({ ok: true, webhook: await getAlertWebhook() });
}
