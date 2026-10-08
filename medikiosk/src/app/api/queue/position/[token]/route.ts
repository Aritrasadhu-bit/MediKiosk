import { NextResponse } from "next/server";
import { listEncounters } from "@/lib/server/db";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";
import { queuePositionByToken, waitMinutes, etaMinutes, smoothedConsultMinutes, type ConsultSample } from "@/lib/queue";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ token: string }> };

/**
 * Public queue-position lookup — the QR on the printed token slip points here.
 * Sanitised (no PHI: no name, no complaint) so a family member can check the
 * live "X ahead of you / ~N min" from their own phone.
 */
export async function GET(req: Request, ctx: Ctx) {
  if (!rateLimit(routeRateLimitKey(req), 30, 60_000)) {
    return NextResponse.json({ ok: false, error: "Rate limit" }, { status: 429 });
  }
  const { token } = await ctx.params;
  if (!token) return NextResponse.json({ ok: false, error: "Token required" }, { status: 400 });

  const encounters = await listEncounters();
  const waiting = encounters.filter((e) => e.status === "pending" || e.status === "triage");
  const position = queuePositionByToken(waiting, token);

  const deptSamples: Record<string, ConsultSample[]> = {};
  for (const e of encounters) {
    if (e.status === "confirmed") {
      (deptSamples[e.patient.department] ??= []).push({ enteredAt: e.enteredAt, confirmedAt: e.updatedAt });
    }
  }
  const target = waiting.find((e) => e.token === token);
  const avg = target ? smoothedConsultMinutes(deptSamples[target.patient.department] ?? []) : 7;

  if (position === -1 || !target) {
    return NextResponse.json({ ok: true, found: false, token });
  }
  return NextResponse.json({
    ok: true,
    found: true,
    token,
    position,
    waitingCount: waiting.length,
    waitingMin: waitMinutes(target.enteredAt),
    etaMin: etaMinutes(position, avg),
  });
}