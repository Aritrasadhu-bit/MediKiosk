import { NextResponse } from "next/server";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";

export const runtime = "nodejs";

/**
 * Camp summary endpoint — aggregate stats for a screening camp.
 * Public read (camp-id scoped) so the field worker can print a day-end
 * summary sheet without needing staff credentials.
 */
export async function GET(req: Request) {
  // Every call scans the whole encounter store, so an unbounded poller could
  // burn disk/CPU for free.
  if (!rateLimit(routeRateLimitKey(req), 30, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests. Try again shortly." }, { status: 429 });
  }
  const url = new URL(req.url);
  const campId = url.searchParams.get("campId") || "";
  if (!campId.trim()) return NextResponse.json({ ok: false, error: "campId is required." }, { status: 400 });

  // Imported lazily so the tests that don't need DB stay light.
  const { listEncounters } = await import("@/lib/server/db");
  const encounters = await listEncounters();
  const campRecords = encounters.filter((e) => e.camp?.campId === campId);

  const bySex: Record<string, number> = {};
  const byVillage: Record<string, number> = {};
  const symptomsCount: Record<string, number> = {};
  for (const e of campRecords) {
    const sex = e.patient?.sex || "Unknown";
    bySex[sex] = (bySex[sex] ?? 0) + 1;
    const village = e.camp?.village || "Unknown";
    byVillage[village] = (byVillage[village] ?? 0) + 1;
    const symptoms = (e.history?.chiefComplaint || e.summary || "").toLowerCase();
    // Count first symptom mentioned
    for (const s of ["fever", "cough", "cold", "diarrhea", "rash", "headache", "chest pain", "weakness", "vomiting", "pain"]) {
      if (symptoms.includes(s)) symptomsCount[s] = (symptomsCount[s] ?? 0) + 1;
    }
  }

  return NextResponse.json({
    ok: true,
    campId,
    total: campRecords.length,
    bySex,
    byVillage,
    symptomBreakdown: symptomsCount,
    // Aggregates ONLY — the individual roster (names, tokens, phones) is PII
    // and must not be served to the public field-worker page. Roster views go
    // through the authenticated staff list / OPD register instead.
  });
}