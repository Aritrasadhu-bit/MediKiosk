import { NextResponse } from "next/server";
import { setupSchema, safeParse } from "@/lib/validation";
import { DEFAULT_SETTINGS, readSettings, writeSettings } from "@/lib/server/settings";
import { setupInitialAdmin } from "@/lib/server/auth";
import { csrfGuard } from "@/lib/server/csrf";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";
import { bodyTooLarge, payloadTooLarge } from "@/lib/server/bodyLimit";
import { log } from "@/lib/server/log";

export const runtime = "nodejs";

/**
 * First-run setup wizard (Batch C, P5).
 *
 * Runs ONCE, before the site is configured. Capture: hospital name and custom
 * departments (kiosk department list), plus the initial admin credentials the
 * operator will use to sign in. After success the site is marked configured
 * and the wizard is permanently closed (409 on any later attempt).
 */
export async function POST(req: Request) {
  if (!rateLimit(routeRateLimitKey(req), 5, 60_000)) {
    return NextResponse.json({ ok: false, error: "Rate limit" }, { status: 429 });
  }
  const csrf = csrfGuard(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, error: csrf.error }, { status: 403 });

  const settings = await readSettings();
  if (settings.configured) {
    return NextResponse.json({ ok: false, error: "Site is already configured." }, { status: 409 });
  }
  if (bodyTooLarge(req, 64 * 1024)) return payloadTooLarge();

  const body = await req.json().catch(() => null);
  const parsed = safeParse(setupSchema, body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  await setupInitialAdmin(parsed.data.username, parsed.data.password);
  const site = await writeSettings({
    hospitalName: parsed.data.hospitalName,
    departments:
      parsed.data.departments && parsed.data.departments.length
        ? parsed.data.departments
        : DEFAULT_SETTINGS.departments,
    configured: true,
  });

  log("info", "setup", "first-run setup complete", {
    hospitalName: site.hospitalName,
    departments: site.departments.length,
    admin: parsed.data.username.toLowerCase(),
  });

  return NextResponse.json({
    ok: true,
    configured: true,
    message: "Setup complete — sign in with your new admin credentials.",
  });
}