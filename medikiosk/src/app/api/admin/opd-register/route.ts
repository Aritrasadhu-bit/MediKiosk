import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { listEncounters } from "@/lib/server/db";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";
import {
  buildOpdRegister,
  opdRegisterToCsv,
  opdRegisterToHtml,
  registerDateKey,
} from "@/lib/opdRegister";
import { readSettings } from "@/lib/server/settings";

export const runtime = "nodejs";

/** Admin-only: daily OPD register as CSV (default) or printable HTML. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ ok: false, error: "Admins only." }, { status: 403 });
  // Full-store scan per request — bounded like the other admin reads.
  if (!rateLimit(routeRateLimitKey(req), 20, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests. Try again shortly." }, { status: 429 });
  }

  const url = new URL(req.url);
  const date = url.searchParams.get("date") || registerDateKey(new Date());
  const format = url.searchParams.get("format") || "csv";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok: false, error: "date must be YYYY-MM-DD." }, { status: 400 });
  }

  const encounters = await listEncounters();
  const rows = buildOpdRegister(encounters, date);
  const settings = await readSettings();

  if (format === "html") {
    return new Response(opdRegisterToHtml(rows, settings.hospitalName, date), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const csv = opdRegisterToCsv(rows);
  return new Response("\uFEFF" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="opd-register-${date}.csv"`,
    },
  });
}