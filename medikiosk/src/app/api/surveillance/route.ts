import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { listEncounters } from "@/lib/server/db";
import { buildSurveillance, surveillanceToCsv } from "@/lib/surveillance";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";

export const runtime = "nodejs";

/**
 * Syndromic surveillance (Batch B, U1).
 *
 * Anonymized aggregation of routine kiosk histories into syndrome buckets
 * (fever, respiratory, GI, rash, …) plus rolling-window cluster alerts —
 * an IDSP-style early-warning feed for the hospital / district admin.
 *
 * Admin-only. The doctor/nurse dashboards intentionally do not expose this;
 * it belongs on the public-health monitoring screen.
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ ok: false, error: "Admins only." }, { status: 403 });
  // Full-store aggregation per request — bounded like the other admin reads.
  if (!rateLimit(routeRateLimitKey(req), 20, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests. Try again shortly." }, { status: 429 });
  }

  const url = new URL(req.url);
  const windowHoursRaw = Number(url.searchParams.get("hours") || 72);
  const windowHours = Number.isFinite(windowHoursRaw) ? Math.min(168, Math.max(1, windowHoursRaw)) : 72;
  const format = url.searchParams.get("format") || "json";

  const encounters = await listEncounters();
  const report = buildSurveillance(encounters, windowHours);

  if (format === "csv") {
    return new Response("\uFEFF" + surveillanceToCsv(report), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=\"syndromic-surveillance.csv\"",
      },
    });
  }

  return NextResponse.json({ ok: true, report });
}