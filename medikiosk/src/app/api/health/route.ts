import { NextResponse } from "next/server";
import { getQueueState, healthStorage, getStoreLoadError } from "@/lib/server/db";
import { listAppointments } from "@/lib/server/appointments-db";
import { readMaintenance } from "@/lib/server/maintenance";
import { readSettings } from "@/lib/server/settings";
import { backupScheduleInfo, ensureBackupScheduler } from "@/lib/server/backupScheduler";
import { buildInfo } from "@/lib/server/buildInfo";

export const runtime = "nodejs";

const VERSION = "2.3.0";

/**
 * Deep health check (#10) — beyond "server is up", verifies the storage layer,
 * encryption config, cookie hardening and that critical stores are readable.
 * Also reports the engine (JSON/SQLite), maintenance mode and backup schedule.
 *
 * Deliberately does NOT expose filesystem paths (dataDir/storeFile) or the
 * in-memory error ring — that's operator detail that leaks deployment layout.
 */
export async function GET() {
  const [state, storage, appointments, maintenance, settings, build] = await Promise.all([
    getQueueState(),
    healthStorage(),
    listAppointments().catch(() => []),
    readMaintenance(),
    readSettings(),
    buildInfo(),
  ]);
  const warnings: string[] = [];
  try {
    ensureBackupScheduler();
  } catch {
    warnings.push("backup scheduler unavailable");
  }
  if (!storage.writable) warnings.push("data directory is not writable");
  if (!storage.encountersFile) warnings.push("encounters store missing — first write will create it");
  if (process.env.SESSION_SECRET && !process.env.MEDIKIOSK_ENCRYPT_PHI) warnings.push("SESSION_SECRET set but PHI encryption is off (MEDIKIOSK_ENCRYPT_PHI=1)");
  if (storage.freeBytes !== null && storage.freeBytes < 50 * 1024 * 1024) warnings.push("low disk space");
  if (maintenance.active) warnings.push(`maintenance mode active${maintenance.reason ? ` — ${maintenance.reason}` : ""}`);
  if (!settings.configured) warnings.push("first-run setup not completed — /setup is open");

  const backups = backupScheduleInfo();

  return NextResponse.json(
    {
      ok: true,
      status: maintenance.active ? "maintenance" : "healthy",
      ver: VERSION,
      build,
      time: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
      persistence: "server-file",
      engine: storage.engine,
      mode: maintenance.active ? "maintenance" : "live",
      warnings,
      setup: {
        configured: settings.configured,
        hospitalName: settings.hospitalName,
      },
      storage: {
        engine: storage.engine,
        writable: storage.writable,
        encountersFile: storage.encountersFile,
        encounterCount: storage.encounterCount,
        appointments: appointments.length,
        queueStateFile: storage.queueStateFile,
        backups: { dir: storage.backupsDir, count: storage.backupsCount, scheduleMinutes: backups.intervalMinutes, scheduler: backups.armed },
        freeBytes: storage.freeBytes,
        loadError: getStoreLoadError(),
      },
      security: {
        phiEncrypted: process.env.MEDIKIOSK_ENCRYPT_PHI === "1",
        hostCookie: process.env.MEDIKIOSK_HOST_COOKIE_PREFIX === "1",
        sessionSecretSet: Boolean(process.env.SESSION_SECRET),
      },
      capabilities: {
        llm: Boolean(process.env.OPENAI_API_KEY),
        asr: Boolean(process.env.AI4BHARAT_ASR_URL || process.env.BHASHINI_API_KEY),
        fhir: true,
        abdmGateway: "sandbox-local",
        patientPortal: true,
        livingDemo: true,
        thermalSlip: true,
        maintenanceMode: true,
        selfHealingQueue: true,
      },
      queue: {
        currentCall: state.currentCall,
        recentCalls: state.recentCalls.length,
        waiting: undefined,
      },
    },
    { status: 200 }
  );
}