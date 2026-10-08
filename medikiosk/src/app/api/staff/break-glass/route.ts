import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { recordAuditServer, getEncounter } from "@/lib/server/db";
import {
  recordBreakGlassActivation,
  listBreakGlassActivations,
  BREAK_GLASS_WINDOW_MS,
} from "@/lib/server/breakglass";
import { csrfGuard } from "@/lib/server/csrf";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";
import { bodyTooLarge, payloadTooLarge } from "@/lib/server/bodyLimit";
import { log } from "@/lib/server/log";

export const runtime = "nodejs";

/** Admin review queue: every emergency override, newest first. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ ok: false, error: "Admins only." }, { status: 403 });
  return NextResponse.json({ ok: true, activations: await listBreakGlassActivations() });
}

/**
 * Emergency break-glass activation (acute trauma / unconscious patient).
 *
 * The override dialog promises that the activation is recorded with an
 * immutable audit entry — previously that promise was UI-only: the badge
 * flipped locally and nothing reached the server. This route makes it true:
 * every activation lands in the server log, and when it names an encounter
 * the record carries a `break_glass_override` audit entry with the clinician
 * and their stated reason.
 */
export async function POST(req: Request) {
  if (!rateLimit(routeRateLimitKey(req), 10, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests. Try again shortly." }, { status: 429 });
  }
  const csrf = csrfGuard(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, error: csrf.error }, { status: 403 });

  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  if (bodyTooLarge(req, 64 * 1024)) return payloadTooLarge();

  const body = await req.json().catch(() => ({}));
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (!reason) {
    return NextResponse.json({ ok: false, error: "A clinical justification is required." }, { status: 400 });
  }
  const encounterId = typeof body?.encounterId === "string" ? body.encounterId.slice(0, 80) : null;

  log("warn", "break-glass", "emergency override activated", {
    by: user.username,
    role: user.role,
    reason,
    encounterId,
  });
  // The activation opens a 15-minute emergency read window on the named
  // encounter (see getEncounterForStaffOrBreakGlass) — without this write the
  // badge would be theatre and revoked records would stay unreachable in a
  // genuine resuscitation.
  if (encounterId) {
    await recordBreakGlassActivation({
      encounterId,
      by: user.username,
      role: user.role,
      reason,
      at: new Date().toISOString(),
    });
  }
  if (encounterId && (await getEncounter(encounterId))) {
    await recordAuditServer(
      encounterId,
      "break_glass_override",
      `Emergency override by ${user.username} (${user.role}): ${reason}`,
      user.username
    );
  }

  return NextResponse.json({ ok: true, windowMinutes: BREAK_GLASS_WINDOW_MS / 60000 });
}
