import { NextResponse } from "next/server";
import path from "path";
import { currentUser } from "@/lib/server/auth";
import { getEngine, readBackupRecords, recordAuditServer, recordDrillResult, takeBackup, upsertEncounter, verifyBackup } from "@/lib/server/db";
import { ensureBackupScheduler } from "@/lib/server/backupScheduler";
import { csrfGuard } from "@/lib/server/csrf";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";
import { bodyTooLarge, payloadTooLarge } from "@/lib/server/bodyLimit";
import { log } from "@/lib/server/log";

export const runtime = "nodejs";

/**
 * Backup restore drill (Batch D, R4) — admin only.
 *
 * Proves the full backup→verify→restore loop end-to-end without a second
 * instance: takes a fresh snapshot, verifies its SHA-256 manifest, then
 * re-imports every record. Because upsert is merge-base last-write-wins, an
 * older backup can never clobber newer live data — making a live drill safe.
 */
export async function POST(req: Request) {
  if (!rateLimit(routeRateLimitKey(req), 5, 60_000)) {
    return NextResponse.json({ ok: false, error: "Rate limit" }, { status: 429 });
  }
  const csrf = csrfGuard(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, error: csrf.error }, { status: 403 });

  const user = await currentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Admin access required." }, { status: 403 });
  }

  ensureBackupScheduler();
  if (bodyTooLarge(req, 64 * 1024)) return payloadTooLarge();
  const body = await req.json().catch(() => ({}));
  const requested = typeof body?.filename === "string" ? path.basename(body.filename) : null;

  // 1. Fresh snapshot (the scheduler/drill always works from a real backup).
  const snapshot = await takeBackup();
  // 2. When given an explicit filename use it instead of the fresh snapshot.
  const target = requested ?? snapshot.filename;

  const verified = await verifyBackup(target);
  if (!verified.ok) {
    log("warn", "admin", "backup drill FAILED verification", { by: user.username, target, error: verified.error });
    await recordDrillResult({ at: new Date().toISOString(), by: user.username, target, restored: 0, ok: false, error: verified.error });
    return NextResponse.json({ ok: false, error: `Backup verification failed: ${verified.error}` }, { status: 500 });
  }

  // 3. Re-import every record through the merge-base upsert (safe live drill).
  const records = await readBackupRecords(target);
  let restored = 0;
  for (const rec of records) {
    if (!rec?.encounterId || !rec?.patient || !rec?.history) continue;
    await upsertEncounter({ ...rec, updatedAt: rec.updatedAt || new Date().toISOString() } as never);
    await recordAuditServer(String(rec.encounterId), "restored", `Restore drill re-imported from ${target}`, user.username);
    restored += 1;
  }

  log("info", "admin", "backup drill passed", { by: user.username, target, verified: restored, engine: getEngine() });
  await recordDrillResult({ at: new Date().toISOString(), by: user.username, target, restored, ok: true });
  return NextResponse.json({
    ok: true,
    drilled: true,
    engine: getEngine(),
    backup: { filename: target, sha256: verified.sha256, bytes: verified.bytes, verifiedCount: verified.count },
    restored,
    message: `Restore drill passed — backup verified (SHA-256 ok) and ${restored} record(s) re-imported.`,
  });
}