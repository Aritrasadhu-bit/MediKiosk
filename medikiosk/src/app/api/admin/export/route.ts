import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { listEncounters, getQueueState, takeBackup } from "@/lib/server/db";
import { log } from "@/lib/server/log";
import { summarizeQueue } from "@/lib/queue";
import { sha256Hex } from "@/lib/crypto";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";

export const runtime = "nodejs";

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Formula injection: patient-controlled fields (name, guardian, diagnosis)
  // flow into this CSV, which admins open in spreadsheets. Same guard as the
  // OPD register and surveillance exports.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function toCsv(encounters: Awaited<ReturnType<typeof listEncounters>>): string {
  const header = [
    "encounterId", "enteredAt", "updatedAt", "status", "mode", "name", "age", "sex",
    "abhaId", "mobile", "department", "respondent", "guardianName",
    "highFlags", "mediumFlags", "summaryChars", "prescriptions", "consentGranted", "doctorDiagnosis",
  ];
  const rows = encounters.map((e) => [
    e.encounterId,
    e.enteredAt,
    e.updatedAt,
    e.status,
    e.mode,
    e.patient.name,
    e.patient.age,
    e.patient.sex,
    e.patient.abhaId,
    e.patient.mobile ?? "",
    e.patient.department,
    e.patient.respondent ?? "self",
    e.patient.guardian?.name ?? "",
    (e.redFlags ?? []).filter((r) => r.severity === "high").length,
    (e.redFlags ?? []).filter((r) => r.severity === "medium").length,
    e.summary?.length ?? 0,
    e.prescription?.medications?.length ?? 0,
    e.consentGranted ? "yes" : "no",
    e.doctorDiagnosis ?? "",
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

/** Admin-only export of all encounters as CSV or JSON (for reporting/backup). */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ ok: false, error: "Admins only." }, { status: 403 });
  // Full-store scan + serialization per request — bounded like the other
  // admin reads.
  if (!rateLimit(routeRateLimitKey(req), 10, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests. Try again shortly." }, { status: 429 });
  }

  const format = new URL(req.url).searchParams.get("format") ?? "json";
  const encounters = await listEncounters();
  const queue = summarizeQueue(encounters);
  const state = await getQueueState();

  if (format === "csv") {
    const csv = "\uFEFF" + toCsv(encounters); // BOM so Excel opens UTF-8 cleanly
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="medikiosk-encounters-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    by: user.username,
    queue,
    currentCall: state.currentCall,
    encounters,
    // Tamper-evidence manifest: hash of the exact JSON payload body.
    manifest: {
      algorithm: "sha256",
      digest: sha256Hex(JSON.stringify(encounters)),
      encounterCount: encounters.length,
    },
    // A rotating snapshot is archived automatically (retention: last 7).
    backup: await takeBackup(),
  };
  log("info", "admin", "export", { by: user.username, format: "json", count: encounters.length });
  return NextResponse.json(payload, {
    headers: {
      "Content-Disposition": `attachment; filename="medikiosk-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}