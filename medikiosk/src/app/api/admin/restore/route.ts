import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { upsertEncounter, recordAuditServer } from "@/lib/server/db";
import { csrfGuard } from "@/lib/server/csrf";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";
import { bodyTooLarge, payloadTooLarge } from "@/lib/server/bodyLimit";
import { log } from "@/lib/server/log";

export const runtime = "nodejs";

/** Records per restore request. Backups larger than this must be split. */
const MAX_RESTORE = 500;

/** Admin-only: re-import a JSON backup (restore). Merge-base per encounter. */
export async function POST(req: Request) {
  const csrf = csrfGuard(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, error: csrf.error }, { status: 403 });
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ ok: false, error: "Admins only." }, { status: 403 });
  // Each restore loops hundreds of file writes: bound it so one client cannot
  // saturate the event loop with unbounded 64MB restores.
  if (!rateLimit(routeRateLimitKey(req), 5, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests. Try again shortly." }, { status: 429 });
  }

  // A backup of 500 full records is megabytes — bound the envelope well above
  // any legitimate backup before JSON.parse allocates it.
  if (bodyTooLarge(req, 64 * 1024 * 1024)) return payloadTooLarge();

  const body = await req.json().catch(() => ({}));
  const encounters = Array.isArray(body?.encounters) ? body.encounters : [];
  if (!encounters.length) return NextResponse.json({ ok: false, error: "No encounters to restore." }, { status: 400 });
  // A restore is one admin click looping `upsertEncounter` + audit writes with
  // no backpressure. An oversized backup would hold the event loop on thousands
  // of sequential file writes, so bound the batch rather than truncating
  // silently.
  if (encounters.length > MAX_RESTORE) {
    return NextResponse.json(
      { ok: false, error: `Backup exceeds the ${MAX_RESTORE}-record limit. Split it into smaller files.` },
      { status: 413 }
    );
  }

  let restored = 0;
  for (const rec of encounters) {
    if (!rec?.encounterId || !rec?.patient || !rec?.history) continue;
    await upsertEncounter({
      ...rec,
      updatedAt: rec.updatedAt || new Date().toISOString(),
      documents: rec.documents ?? [],
      redFlags: rec.redFlags ?? [],
      interactions: rec.interactions ?? [],
      audit: rec.audit ?? [],
      summary: rec.summary ?? "",
      consentGranted: rec.consentGranted ?? false,
      status: rec.status ?? "pending",
    } as never);
    await recordAuditServer(rec.encounterId, "restored", `Restored from backup by ${user.username}`, user.username);
    restored += 1;
  }
  log("info", "admin", "restore", { by: user.username, count: restored });
  return NextResponse.json({ ok: true, restored });
}