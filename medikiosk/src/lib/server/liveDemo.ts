import "server-only";
import { log } from "./log";
import type { StoredHistory } from "@/lib/types";
import { listEncounters, patchEncounter, upsertEncounter } from "./db";
import { deriveQueueToken } from "@/lib/queue";
import { buildDemoPatients } from "@/lib/demoData";

/**
 * Living-hospital demo (Batch C, P2).
 *
 * The admin can start a scripted "live hospital" that keeps the demo floor
 * moving: every `intervalSeconds` a new patient arrives (rotating through the
 * seeded demo personas with fresh encounter ids) and the queue self-advances —
 * pending → triage → confirmed — without anyone touching the keyboard. Great
 * for trade-show / judging slots where a static queue looks abandoned.
 *
 * State is in-memory per server process (the demo is a presentation aid, not
 * durable state). Encounters it spawns are marked `demo: true` so they are
 * easy to filter and the reset button clears them with everything else.
 */

export type LiveDemoStatus = {
  running: boolean;
  intervalSeconds: number;
  startedAt: string | null;
  lastSpawnAt: string | null;
  spawned: number;
  progressed: number;
  demoEncounters: number;
};

const STATUS_INIT: LiveDemoStatus = {
  running: false,
  intervalSeconds: 8,
  startedAt: null,
  lastSpawnAt: null,
  spawned: 0,
  progressed: 0,
  demoEncounters: 0,
};

let status: LiveDemoStatus = { ...STATUS_INIT };
let timer: ReturnType<typeof setInterval> | null = null;
let cycle = 0;

export function getLiveDemoStatus(): LiveDemoStatus {
  return { ...status };
}

/** Spawn one fresh demo encounter (unique id each time, rotates personas). */
async function spawnOne(): Promise<void> {
  const templates = buildDemoPatients();
  const tpl = templates[cycle % templates.length];
  cycle += 1;

  const nowIso = new Date().toISOString();
  const encounterId = `demo-live-${Date.now()}-${cycle}`;
  const fresh: StoredHistory = {
    ...tpl,
    encounterId,
    token: deriveQueueToken(encounterId),
    enteredAt: nowIso,
    updatedAt: nowIso,
    status: "pending",
    demo: true,
    referral: undefined,
    audit: [{ action: "history_submitted", at: nowIso, actor: "demo-live", origin: "server" }],
  };

  await upsertEncounter(fresh);
  status = { ...status, spawned: status.spawned + 1, lastSpawnAt: nowIso };
}

/** Advance demo encounters through pending → triage → confirmed as they age. */
async function advance(): Promise<void> {
  const all = await listEncounters();
  const now = Date.now();
  const tickMs = status.intervalSeconds * 1000;
  let moved = 0;
  for (const e of all) {
    if (e.demo !== true || e.status === "confirmed" || e.status === "er") continue;
    const ageMs = now - new Date(e.enteredAt).getTime();
    const next =
      e.status === "pending" && ageMs >= tickMs * 1.5
        ? "triage"
        : e.status === "triage" && ageMs >= tickMs * 3
        ? "confirmed"
        : null;
    if (next) {
      await patchEncounter(e.encounterId, {
        status: next,
        audit: [
          ...(e.audit ?? []),
          { action: next === "triage" ? "triage_verified" : "confirmed", at: new Date().toISOString(), actor: "demo-live", origin: "server" },
        ],
      });
      moved += 1;
    }
  }
  if (moved > 0) status = { ...status, progressed: status.progressed + moved };
}

async function tick(): Promise<void> {
  try {
    await spawnOne();
    await advance();
  } catch (err) {
    log("warn", "demo-live", "tick failed", { error: String(err) });
  } finally {
    const all = await listEncounters().catch(() => []);
    status = { ...status, demoEncounters: all.filter((e) => e.demo === true).length };
  }
}

/** Start the loop. Spawns the first patient immediately, then every interval. */
export async function startLiveDemo(intervalSeconds: number): Promise<LiveDemoStatus> {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  status = { ...STATUS_INIT, running: true, intervalSeconds, startedAt: new Date().toISOString() };
  log("info", "demo-live", "demo started", { intervalSeconds });
  await tick();
  timer = setInterval(() => void tick(), intervalSeconds * 1000);
  // Never keep the process alive on its own — the Next server already does.
  if (typeof timer.unref === "function") timer.unref();
  return getLiveDemoStatus();
}

/** Stop the loop. Leaves already-spawned demo encounters in place. */
export function stopLiveDemo(): LiveDemoStatus {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  status = { ...status, running: false, startedAt: null };
  log("info", "demo-live", "demo stopped", {});
  return getLiveDemoStatus();
}