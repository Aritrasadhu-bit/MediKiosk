import { NextResponse } from "next/server";
import {
  pushEncounterToHis,
  latestHisDelivery,
  hisConfigured,
  hisConfig,
  toPublicDelivery,
} from "@/lib/server/his";
import { getEncounterForStaff } from "@/lib/server/db";
import { currentUser } from "@/lib/server/auth";
import { csrfGuard } from "@/lib/server/csrf";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * HIS/EMR delivery status for one encounter.
 *
 * GET  — what actually happened to this record (delivered / failed /
 *        not configured / no consent) plus the connection state. This is what
 *        the /done screen renders, so the patient is never told a record was
 *        "pushed" when nothing left the kiosk.
 * POST — staff-triggered (re)send, for when a failure needs retrying.
 */
export async function GET(req: Request, ctx: Ctx) {
  if (!rateLimit(routeRateLimitKey(req), 30, 60_000)) {
    return NextResponse.json({ ok: false, error: "Rate limit" }, { status: 429 });
  }
  const { id } = await ctx.params;

  const cfg = hisConfig();

  // A delivery receipt is not clinical content, but it does reveal that a
  // record with this id exists — staff-only. This was previously
  // `if (!user && !delivery)`, which required auth only when there was NO
  // receipt: exactly inverted, so any anonymous caller who guessed an
  // encounterId with a delivery got a 200 plus an existence oracle over the
  // whole clinical store. Authenticate first, then do the store reads.
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  }

  // Confirm the encounter is visible to this clinician before disclosing.
  const enc = await getEncounterForStaff(id);
  if (!enc) {
    return NextResponse.json(
      { ok: false, error: "Not found or consent withdrawn.", code: "not_available" },
      { status: 404 }
    );
  }

  const delivery = await latestHisDelivery(id);

  // Never disclose the configured endpoint. Reporting `configured` and the
  // transport `mode` is enough for the UI to explain "not connected to the
  // hospital system yet"; the FHIR base URL or HL7 host:port is internal
  // infrastructure and belongs only in the server-side delivery log.
  return NextResponse.json({
    ok: true,
    configured: hisConfigured(),
    mode: cfg.mode,
    delivery: delivery
      ? toPublicDelivery(delivery)
      : { state: "skipped", detail: "No delivery attempted yet.", at: new Date().toISOString() },
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const csrf = csrfGuard(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, error: csrf.error }, { status: 403 });
  if (!rateLimit(routeRateLimitKey(req), 10, 60_000)) {
    return NextResponse.json({ ok: false, error: "Rate limit" }, { status: 429 });
  }

  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  if (!["doctor", "admin", "nurse"].includes(user.role)) {
    return NextResponse.json(
      { ok: false, error: "Only clinicians and admins can send a record to the hospital system." },
      { status: 403 }
    );
  }

  const { id } = await ctx.params;
  const enc = await getEncounterForStaff(id);
  if (!enc) {
    return NextResponse.json(
      { ok: false, error: "Not found or consent withdrawn.", code: "not_available" },
      { status: 404 }
    );
  }

  const delivery = await pushEncounterToHis(enc);
  return NextResponse.json(
    { ok: true, delivery: toPublicDelivery(delivery) },
    { status: delivery.state === "delivered" ? 200 : 202 }
  );
}
