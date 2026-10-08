import "server-only";

import { promises as fs } from "fs";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { StoredHistory, AuditAction, AuditEvent } from "@/lib/types";
import { canStaffView } from "@/lib/types";
import { decryptJson, encryptJson, sha256Hex } from "@/lib/crypto";
import { deriveQueueToken, mintUniqueToken, sortQueue } from "@/lib/queue";
import { breakGlassActiveFor, anyBreakGlassActive } from "@/lib/server/breakglass";
import { isWalkInWithoutAbha } from "@/lib/types";
import { resolveStorageEngine, selectDefaultEngine, type StorageEngine } from "@/lib/storageEngine";
import { sessionSecret } from "@/lib/server/secret";

/**
 * Tiny persistence layer for the hospital demo.
 *
 * Two interchangeable engines behind one facade, so callers never care which
 * one is live:
 *   - "json"    — crash-safe JSON file store (tmp + atomic rename + .bak).
 *                 Fine for demos and single-kiosk pilots (dozens of patients).
 *   - "sqlite"  — default for fresh production data dirs. Uses Node's built-in
 *                 node:sqlite (no native deps): WAL journaling, indexed primary
 *                 key, no full-file rewrite per write, so concurrent kiosks do
 *                 not serialize on one file lock.
 *
 * Engine choice: MEDIKIOSK_DB=sqlite|json wins when set. When unset, a FRESH
 * data dir takes SQLite (if node:sqlite exists); a dir that already holds a
 * JSON store keeps using it — switching silently would orphan live data, so
 * existing deployments migrate explicitly (`npm run migrate:json-sqlite`).
 *
 * Both engines serialize writes through a promise mutex to avoid
 * read-modify-write races between requests.
 */

const DATA_DIR = process.env.MEDIKIOSK_DATA_DIR || path.join(process.cwd(), "data");
const ENCOUNTERS_FILE = path.join(DATA_DIR, "encounters.json");

/**
 * Optional PHI-at-rest encryption (AES-256-GCM keyed from SESSION_SECRET via
 * MEDIKIOSK_ENCRYPT_PHI=1). The whole store is encrypted on write and
 * decrypted on read; a wrong/missing SESSION_SECRET fails loudly rather than
 * silently corrupting data.
 */
const ENCRYPT_PHI = process.env.MEDIKIOSK_ENCRYPT_PHI === "1";
// Resolved lazily: `next build` sets NODE_ENV=production and imports this module
// during page-data collection, which must not throw before any request exists.
const PHI_SECRET = () => sessionSecret();

/**
 * Set when the store could not be read OR decrypted (wrong SESSION_SECRET /
 * wrong encryption toggle / torn file). While set, every write is refused so a
 * misconfigured server can never silently wipe encrypted data it can't read.
 */
let storeLoadError: string | null = null;

/** Expose the load error (surfaced by /api/health as `storage.loadError`). */
export function getStoreLoadError(): string | null {
  return storeLoadError;
}

// ---------------------------------------------------------------- engine selection

/** node:sqlite availability (Node ≥ 22.5 with --experimental-sqlite in older lines). */
function builtinSqlite(): { DatabaseSync?: new (file: string) => unknown } | null {
  try {
    const getBuiltin = (process as { getBuiltinModule?: (name: string) => unknown }).getBuiltinModule;
    if (typeof getBuiltin !== "function") return null;
    return (getBuiltin("node:sqlite") as { DatabaseSync?: new (file: string) => unknown }) ?? null;
  } catch {
    return null;
  }
}

const sqliteModule = builtinSqlite();
const sqliteAvailable = Boolean(sqliteModule?.DatabaseSync);

/** A JSON store counts as "existing" by file presence — even an encrypted or
 * torn one. Only a never-created store is fresh enough to auto-select SQLite;
 * anything else keeps its engine so live data is never orphaned. */
function jsonStoreExists(): boolean {
  try {
    return existsSync(ENCOUNTERS_FILE);
  } catch {
    return false;
  }
}

const ENGINE: StorageEngine =
  process.env.MEDIKIOSK_DB !== undefined
    ? resolveStorageEngine(process.env.MEDIKIOSK_DB, sqliteAvailable)
    : selectDefaultEngine(sqliteAvailable, jsonStoreExists());

if (process.env.MEDIKIOSK_DB === "sqlite" && ENGINE === "json") {
  // Requested but unavailable — fall back loudly in logs so operators notice.
  console.warn("[medikiosk] MEDIKIOSK_DB=sqlite requested but node:sqlite is unavailable — falling back to JSON store.");
}
if (process.env.MEDIKIOSK_DB === undefined) {
  console.warn(
    `[medikiosk] Storage engine auto-selected: ${ENGINE} ` +
      (ENGINE === "sqlite"
        ? "(fresh data dir). Pin it with MEDIKIOSK_DB=sqlite."
        : "(existing JSON store preserved). Migrate with: npm run migrate:json-sqlite")
  );
}

export function getEngine(): StorageEngine {
  return ENGINE;
}

const SQLITE_FILE = path.join(DATA_DIR, "medikiosk.db");

type SqliteDb = {
  prepare: (sql: string) => {
    run: (...args: unknown[]) => unknown;
    get: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown[];
  };
  exec: (sql: string) => void;
};

let sqliteDb: SqliteDb | null = null;

function sqlite(): SqliteDb {
  if (!sqliteDb) {
    mkdirSync(DATA_DIR, { recursive: true });
    const dbInst = new sqliteModule!.DatabaseSync!(SQLITE_FILE) as SqliteDb;
    dbInst.exec("PRAGMA journal_mode = WAL;");
    dbInst.exec("PRAGMA synchronous = NORMAL;");
    dbInst.exec(`
      CREATE TABLE IF NOT EXISTS encounters (
        encounter_id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS queue_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL
      );
    `);
    sqliteDb = dbInst;
  }
  return sqliteDb;
}

let queue: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

// Separate mutex for the live-call queue state so setCurrentCall/clear/reset
// serialize against each other without nesting inside the encounter lock
// (getQueueState calls listEncounters, so it must stay lock-free).
let queueStateLock: Promise<unknown> = Promise.resolve();
function withQueueStateLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queueStateLock.then(fn, fn);
  queueStateLock = run.catch(() => {});
  return run;
}

async function ensureFile(file: string): Promise<void> {
  // SQLite creates its own store file — nothing to seed.
  if (ENGINE === "sqlite") return;
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.access(file);
  } catch {
    await fs.writeFile(file, "[]", "utf8");
  }
}

async function jsonReadAll(): Promise<StoredHistory[]> {
  await ensureFile(ENCOUNTERS_FILE);
  const candidates = [ENCOUNTERS_FILE, `${ENCOUNTERS_FILE}.bak`];
  for (let i = 0; i < candidates.length; i++) {
    let raw: string;
    try {
      raw = await fs.readFile(/*turbopackIgnore: true*/ candidates[i], "utf8");
    } catch {
      continue; // main missing/unreadable — try .bak
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      // Encrypted envelope (v:1) — only readable with the matching PHI secret.
      if (typeof parsed === "object" && parsed !== null && (parsed as { v?: number }).v === 1) {
        if (!ENCRYPT_PHI) {
          storeLoadError =
            "Encrypted store found but MEDIKIOSK_ENCRYPT_PHI is off — refusing to read (or overwrite) it. Restart with the original SESSION_SECRET and MEDIKIOSK_ENCRYPT_PHI=1.";
          console.error(`[medikiosk] ${storeLoadError}`);
          return [];
        }
        try {
          const arr = decryptJson<StoredHistory[]>(JSON.stringify(parsed), PHI_SECRET());
          if (!Array.isArray(arr)) throw new Error("decrypted payload is not an array");
          storeLoadError = null;
          return arr;
        } catch (err) {
          storeLoadError = `Encrypted store could not be decrypted (wrong SESSION_SECRET?) — ${err instanceof Error ? err.message : String(err)}. Writes are blocked; the original file is preserved.`;
          console.error(`[medikiosk] ${storeLoadError}`);
          return [];
        }
      }
      // Plain JSON — only valid when PHI encryption is disabled. The empty
      // `[]` placeholder from ensureFile() is allowed (fresh store).
      if (ENCRYPT_PHI) {
        if (Array.isArray(parsed) && parsed.length === 0) {
          storeLoadError = null;
          return [];
        }
        storeLoadError =
          "Plain-JSON store found but MEDIKIOSK_ENCRYPT_PHI=1 is set — refusing to read (or overwrite) it. Set MEDIKIOSK_ENCRYPT_PHI=0 or re-encrypt the data.";
        console.error(`[medikiosk] ${storeLoadError}`);
        return [];
      }
      if (!Array.isArray(parsed)) {
        if (i === candidates.length - 1)
          storeLoadError = "Store is not a valid encounter array — writes are blocked.";
        continue;
      }
      storeLoadError = null;
      return parsed as StoredHistory[];
    } catch {
      /* unreadable candidate — try .bak (or fall through to []) */
    }
  }
  return [];
}

function sqliteReadAll(): StoredHistory[] {
  const rows = sqlite().prepare("SELECT data FROM encounters").all() as { data: string }[];
  const out: StoredHistory[] = [];
  let failed = 0;
  for (const r of rows) {
    try {
      const parsed = ENCRYPT_PHI
        ? decryptJson<StoredHistory>(r.data, PHI_SECRET())
        : (JSON.parse(r.data) as StoredHistory);
      if (parsed && typeof parsed === "object" && parsed.encounterId) out.push(parsed);
      else failed++;
    } catch {
      failed++;
    }
  }
  // Every row failing to read/decrypt means a wrong SESSION_SECRET / toggle —
  // block writes so the store is never silently re-encrypted with the wrong key.
  if (ENCRYPT_PHI && rows.length > 0 && failed === rows.length) {
    storeLoadError =
      "Encrypted SQLite store could not be decrypted (wrong SESSION_SECRET?) — every row failed. Writes are blocked; the original data is preserved.";
    console.error(`[medikiosk] ${storeLoadError}`);
    return [];
  }
  storeLoadError = null;
  return out;
}

async function readAll(): Promise<StoredHistory[]> {
  if (ENGINE === "sqlite") return sqliteReadAll();
  return jsonReadAll();
}

async function jsonWriteAll(list: StoredHistory[]): Promise<void> {
  if (storeLoadError) {
    throw new Error(`Refusing to write over an unreadable store: ${storeLoadError}`);
  }
  await ensureFile(ENCOUNTERS_FILE);
  const content = ENCRYPT_PHI ? encryptJson(list, PHI_SECRET()) : JSON.stringify(list, null, 2);
  // Crash-safe: write a temp file, atomically rename over the live file, then
  // snapshot the previous good copy to .bak so a torn write is recoverable.
  const tmp = `${ENCOUNTERS_FILE}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  try {
    await fs.copyFile(ENCOUNTERS_FILE, `${ENCOUNTERS_FILE}.bak`);
  } catch {
    /* no previous file yet */
  }
  await fs.rename(tmp, ENCOUNTERS_FILE);
}

function sqliteWriteAll(list: StoredHistory[]): void {
  if (storeLoadError) {
    throw new Error(`Refusing to write over an unreadable store: ${storeLoadError}`);
  }
  const db = sqlite();
  db.exec("BEGIN");
  try {
    const del = db.prepare("DELETE FROM encounters");
    const ins = db.prepare("INSERT INTO encounters (encounter_id, data) VALUES (?, ?)");
    del.run();
    for (const rec of list) {
      const data = ENCRYPT_PHI ? encryptJson(rec, PHI_SECRET()) : JSON.stringify(rec);
      ins.run(rec.encounterId, data);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

async function writeAll(list: StoredHistory[]): Promise<void> {
  if (ENGINE === "sqlite") {
    sqliteWriteAll(list);
    return;
  }
  await jsonWriteAll(list);
}

export async function listEncounters(
  limit?: number,
  offset = 0
): Promise<StoredHistory[]> {
  return withLock(async () => {
    const all = await readAll();
    const sorted = [...all].sort(
      (a, b) => new Date(b.enteredAt).getTime() - new Date(a.enteredAt).getTime()
    );
    return limit && limit > 0 ? sorted.slice(offset, offset + limit) : sorted;
  });
}

export async function getEncounter(encounterId: string): Promise<StoredHistory | null> {
  return withLock(async () => {
    const all = await readAll();
    return all.find((e) => e.encounterId === encounterId) ?? null;
  });
}

/**
 * Encounters a treating clinician is allowed to read.
 *
 * This is where granular consent is actually *enforced*: a record whose
 * `clinical_care` scope is revoked (or lapsed) is withheld from the physician,
 * triage and pharmacy screens. Previously consent was a flag that nothing
 * read, so a patient revoking consent still saw no effect on staff views.
 *
 * The public waiting-room feed (/api/queue) deliberately still includes
 * name-initial, urgency and wait time for a revoked record: the patient is
 * physically in the building and calling them is a safety matter. Clinical
 * content stays hidden.
 */
export async function listEncountersForStaff(
  limit?: number,
  offset = 0
): Promise<StoredHistory[]> {
  const all = await listEncounters(limit, offset);
  return all.filter((e) => canStaffView(e));
}

/**
 * Staff list with the emergency exception: while ANY break-glass activation is
 * live, revoked records are included — marked `viaBreakGlass` so the UI badges
 * them and every open is audited as an override on read (see the [id] GET).
 * Without a live activation this is identical to listEncountersForStaff.
 */
export async function listEncountersForStaffOrBreakGlass(
  limit?: number,
  offset = 0
): Promise<{ encounters: StoredHistory[]; breakGlassActive: boolean }> {
  const all = await listEncounters(limit, offset);
  const breakGlassActive = await anyBreakGlassActive();
  if (!breakGlassActive) return { encounters: all.filter((e) => canStaffView(e)), breakGlassActive };
  return {
    encounters: all.map((e) => (canStaffView(e) ? e : { ...e, viaBreakGlass: true })),
    breakGlassActive,
  };
}

/** Single-encounter staff read that respects revoked consent. */
export async function getEncounterForStaff(encounterId: string): Promise<StoredHistory | null> {
  const found = await getEncounter(encounterId);
  if (!found || !canStaffView(found)) return null;
  return found;
}

/**
 * Staff read with the emergency exception: when clinical-care consent was
 * revoked but a live break-glass activation covers the encounter, the record
 * is returned WITH an override marker so callers must audit the access. The
 * marker is what lets routes log `break_glass_override` instead of silently
 * treating an emergency read as a routine one.
 */
export async function getEncounterForStaffOrBreakGlass(
  encounterId: string
): Promise<{ encounter: StoredHistory; viaBreakGlass: boolean } | null> {
  const found = await getEncounter(encounterId);
  if (!found) return null;
  if (canStaffView(found)) return { encounter: found, viaBreakGlass: false };
  if (await breakGlassActiveFor(encounterId)) return { encounter: found, viaBreakGlass: true };
  return null;
}

/**
 * Redact clinical content from a record whose consent was revoked, so a
 * clinician can still see that the patient exists and is queued (clinical
 * safety) without reading data the patient has withdrawn consent for.
 */
export function redactForRevokedConsent(history: StoredHistory): StoredHistory {
  if (canStaffView(history)) return history;
  return {
    ...history,
    summary: "[Withheld — patient revoked consent for clinical care use]",
    history: emptyHistoryForWithheld(),
    documents: [],
    redFlags: [],
    interactions: [],
    doctorNote: undefined,
    doctorDiagnosis: undefined,
    prescription: undefined,
  };
}

function emptyHistoryForWithheld(): StoredHistory["history"] {
  return {
    chiefComplaint: "[withheld]",
    hpi: "[withheld]",
    past: "",
    surgical: "",
    medications: "",
    allergies: "",
    family: "",
    personal: "",
    menstrual: "",
    obstetric: "",
    systems: [],
    investigations: "",
    ayush: [],
  } as unknown as StoredHistory["history"];
}

/**
 * Queue-token → encounter lookup (case-insensitive). Used by the printable
 * 80mm token slip (/slip/[token], Batch C, P4) so a slipped token number
 * re-prints the receipt even after a page reload.
 */
export async function getEncounterByToken(token: string): Promise<StoredHistory | null> {
  return withLock(async () => {
    const all = await readAll();
    const needle = token.trim().toUpperCase();
    return all.find((e) => (e.token ?? "").trim().toUpperCase() === needle) ?? null;
  });
}

/**
 * Storage-backed token mint: builds the taken-set from the store and mints a
 * free token. The re-derivation loop itself lives in `mintUniqueToken`
 * (queue.ts) so it is unit-testable without touching storage.
 */
export async function ensureUniqueToken(encounterId: string, candidate: string): Promise<string> {
  const all = await listEncounters();
  const taken = new Set(
    all.filter((e) => e.encounterId !== encounterId).map((e) => (e.token ?? "").trim().toUpperCase())
  );
  return mintUniqueToken(encounterId, candidate, taken);
}

/** Insert a new encounter or merge a newer resubmission over an existing one. */
export async function upsertEncounter(record: StoredHistory): Promise<StoredHistory> {
  // `viaBreakGlass` is a transient read-time marker (added by the override
  // list) that must never persist: a stale marker on a stored record would
  // outlive the 15-minute window it describes. Strip it at the single choke
  // point every write path funnels through.
  const incoming = { ...record };
  delete incoming.viaBreakGlass;
  return withLock(async () => {
    const all = await readAll();
    const idx = all.findIndex((e) => e.encounterId === incoming.encounterId);
    if (idx === -1) {
      // Brand-new record — no NaN timestamp comparison possible (Date.parse("")
      // is NaN, so "value >= NaN" is always false and would clobber new saves).
      all.push(incoming);
      await writeAll(all);
      return incoming;
    }
    const existing = all[idx];
    const recordTime = Date.parse(incoming.updatedAt) || 0;
    const existingTime = Date.parse(existing.updatedAt ?? "") || 0;
    // Newer record wins, but always MERGE: whatever the resubmission omits
    // (doctorNote, status, referral, dispensedAt…) survives, and audit trails
    // append instead of being clobbered by the full-record replace.
    const next: StoredHistory =
      recordTime >= existingTime
        ? {
            ...existing,
            ...incoming,
            audit: [...(existing.audit ?? []), ...(incoming.audit ?? [])],
          }
        : existing;
    all[idx] = next;
    await writeAll(all);
    return next;
  });
}

/** Merge-base patch (last-write-wins per field). */
export async function patchEncounter(
  encounterId: string,
  patch: Partial<StoredHistory>
): Promise<StoredHistory | null> {
  return withLock(async () => {
    const all = await readAll();
    const idx = all.findIndex((e) => e.encounterId === encounterId);
    if (idx < 0) return null;
    const merged: StoredHistory = { ...all[idx], ...patch, updatedAt: new Date().toISOString() };
    all[idx] = merged;
    await writeAll(all);
    return merged;
  });
}

/** Append audit events inside a single locked read-modify-write. */
export async function appendAuditServer(
  encounterId: string,
  events: AuditEvent[]
): Promise<StoredHistory | null> {
  return withLock(async () => {
    const all = await readAll();
    const idx = all.findIndex((e) => e.encounterId === encounterId);
    if (idx < 0) return null;
    const merged: StoredHistory = {
      ...all[idx],
      audit: [...(all[idx].audit ?? []), ...events],
      updatedAt: new Date().toISOString(),
    };
    all[idx] = merged;
    await writeAll(all);
    return merged;
  });
}

export async function recordAuditServer(
  encounterId: string,
  action: AuditAction,
  detail?: string,
  actor?: string
): Promise<void> {
  await appendAuditServer(encounterId, [
    { action, at: new Date().toISOString(), detail, actor, origin: "server" } as AuditEvent,
  ]);
}

export async function deleteEncounter(encounterId: string): Promise<boolean> {
  return withLock(async () => {
    const all = await readAll();
    const next = all.filter((e) => e.encounterId !== encounterId);
    if (next.length === all.length) return false;
    await writeAll(next);
    return true;
  });
}

/** Seed demo encounters, skipping ids that already exist. */
export async function seedEncounters(records: StoredHistory[]): Promise<number> {
  return withLock(async () => {
    const all = await readAll();
    const existing = new Set(all.map((e) => e.encounterId));
    let added = 0;
    for (const r of records) {
      if (!existing.has(r.encounterId)) {
        // Backfill a queue token for demo records so the token slip / QR
        // position / portal queue lookup work for the demo data too.
        all.push({ ...r, token: r.token || deriveQueueToken(r.encounterId) });
        existing.add(r.encounterId);
        added++;
      }
    }
    if (added > 0) await writeAll(all);
    return added;
  });
}

// ---------------------------------------------------------------- returning-patient lookup

function normalizedAbha(abha: string): string {
  return abha.replace(/[^0-9]/g, "");
}

/** Normalise a person name for lookup comparison (case/whitespace-insensitive). */
function normalizeLookupName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Find the most recent encounter for the same patient (matched by ABHA, or by
 * mobile when no ABHA is on file). Used for one-tap re-registration and
 * duplicate-waiting detection.
 *
 * The mobile-only branch additionally requires `name` to match the stored
 * patient name: a mobile number alone must not open someone else's pre-fill
 * record. Callers pass the name the patient just typed.
 */
export async function findReturningPatient(
  abha?: string,
  mobile?: string,
  name?: string
): Promise<StoredHistory | null> {
  if (!abha && !mobile) return null;
  const all = await listEncounters();
  const abhaKey = abha ? normalizedAbha(abha) : null;
  const mobileKey = mobile ? mobile.replace(/[^0-9]/g, "") : null;
  const nameKey = name ? normalizeLookupName(name) : null;
  return (
    all.find((e) => {
      const encAbha = normalizedAbha(e.patient?.abhaId ?? "");
      const encMobile = (e.patient?.mobile ?? "").replace(/[^0-9]/g, "");
      if (abhaKey && encAbha === abhaKey) return true;
      return (
        isWalkInWithoutAbha(e.patient?.abhaId) &&
        mobileKey &&
        encMobile === mobileKey &&
        !!nameKey &&
        normalizeLookupName(e.patient?.name ?? "") === nameKey
      );
    }) ?? null
  );
}

/**
 * Whether another encounter for this patient is still waiting to be seen.
 * Scans for the MOST RECENT still-open (pending/triage) encounter, so an old
 * discharged record for the same ABHA never masks a live duplicate token.
 * Same two-factor rule as findReturningPatient for the mobile-only branch.
 */
export async function findPendingDuplicate(
  abha?: string,
  mobile?: string,
  name?: string
): Promise<StoredHistory | null> {
  if (!abha && !mobile) return null;
  const all = await listEncounters();
  const abhaKey = abha ? normalizedAbha(abha) : null;
  const mobileKey = mobile ? mobile.replace(/[^0-9]/g, "") : null;
  const nameKey = name ? normalizeLookupName(name) : null;
  const matches = (e: StoredHistory) => {
    const encAbha = normalizedAbha(e.patient?.abhaId ?? "");
    const encMobile = (e.patient?.mobile ?? "").replace(/[^0-9]/g, "");
    if (abhaKey && encAbha === abhaKey) return true;
    return (
      isWalkInWithoutAbha(e.patient?.abhaId) &&
      mobileKey &&
      encMobile === mobileKey &&
      !!nameKey &&
      normalizeLookupName(e.patient?.name ?? "") === nameKey
    );
  };
  const open = all.filter((e) => matches(e) && (e.status === "pending" || e.status === "triage"));
  if (!open.length) return null;
  return open.sort((a, b) => b.enteredAt.localeCompare(a.enteredAt))[0];
}

// ---------------------------------------------------------------- live queue / call-next state

const QUEUE_STATE_FILE = path.join(DATA_DIR, "queue-state.json");

export type QueueCallEvent = { encounterId: string; token: string; at: string; actor?: string };

export type QueueState = {
  currentCall: QueueCallEvent | null;
  recentCalls: QueueCallEvent[];
};

const EMPTY_QUEUE_STATE: QueueState = { currentCall: null, recentCalls: [] };

async function jsonReadQueueState(): Promise<QueueState> {
  try {
    const raw = await fs.readFile(QUEUE_STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as QueueState;
    return { currentCall: parsed.currentCall ?? null, recentCalls: parsed.recentCalls ?? [] };
  } catch {
    return EMPTY_QUEUE_STATE;
  }
}

function sqliteReadQueueState(): QueueState {
  try {
    const row = sqlite().prepare("SELECT data FROM queue_state WHERE id = 1").get() as { data: string } | undefined;
    if (!row) return EMPTY_QUEUE_STATE;
    const parsed = JSON.parse(row.data) as QueueState;
    return { currentCall: parsed.currentCall ?? null, recentCalls: parsed.recentCalls ?? [] };
  } catch {
    return EMPTY_QUEUE_STATE;
  }
}

async function readQueueState(): Promise<QueueState> {
  if (ENGINE === "sqlite") return sqliteReadQueueState();
  return jsonReadQueueState();
}

async function jsonWriteQueueState(state: QueueState): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  // Atomic (tmp + rename) so a crash mid-write never corrupts the live file;
  // failures propagate so a silently-dropped "call next" is impossible.
  const tmp = `${QUEUE_STATE_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(tmp, QUEUE_STATE_FILE);
}

async function writeQueueState(state: QueueState): Promise<void> {
  if (ENGINE === "sqlite") {
    sqlite()
      .prepare("INSERT INTO queue_state (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
      .run(JSON.stringify(state));
    return;
  }
  await jsonWriteQueueState(state);
}

/**
 * Current call + recent history. Self-heals (Batch D, R6): if no call activity
 * was ever recorded (fresh store / crash after patients arrived), derive a
 * synthetic "now serving" from the live priority queue so the waiting-room
 * display and portal never show a blank board after a restart.
 */
export async function getQueueState(): Promise<QueueState> {
  const state = await readQueueState();
  if (state.currentCall || state.recentCalls.length > 0) return state;
  const all = await listEncounters();
  const waiting = sortQueue(all);
  if (waiting.length > 0) {
    const top = waiting[0];
    return {
      currentCall: {
        encounterId: top.encounterId,
        token: top.token ?? top.encounterId.slice(0, 8).toUpperCase(),
        at: top.enteredAt,
        actor: "self-heal",
      },
      recentCalls: state.recentCalls,
    };
  }
  return state;
}

/** Record a "call next" so the waiting-room display and other devices see it. */
export async function setCurrentCall(encounter: StoredHistory, actor?: string): Promise<QueueState> {
  return withQueueStateLock(async () => {
    const state = await readQueueState();
    const evt: QueueCallEvent = {
      encounterId: encounter.encounterId,
      token: encounter.token ?? encounter.encounterId.slice(0, 8).toUpperCase(),
      at: new Date().toISOString(),
      actor,
    };
    const recent = [evt, ...state.recentCalls].slice(0, 20);
    const next: QueueState = { currentCall: evt, recentCalls: recent };
    await writeQueueState(next);
    return next;
  });
}

export async function clearCurrentCall(): Promise<QueueState> {
  return withQueueStateLock(async () => {
    const state = await readQueueState();
    const next: QueueState = { ...state, currentCall: null };
    await writeQueueState(next);
    return next;
  });
}

// ---------------------------------------------------------------- scanned uploads

const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

export type SavedUpload = { id: string; filename: string; mime: string; bytes: number; url: string };

/** Capability links live 30 days: long enough for the care episode, short
 * enough that a leaked URL is not a forever credential. */
const UPLOAD_TTL_MS = 30 * 24 * 3600 * 1000;

type UploadMeta = {
  id: string;
  filename: string;
  mime: string;
  bytes: number;
  uploadedAt: string;
  /** Absent on pre-expiry-era files, which are grandfathered, never expire. */
  expiresAt?: string;
  /** First successful download — the audit stamp for capability-URL access. */
  downloadedAt?: string;
};

async function readUploadMeta(id: string): Promise<UploadMeta | null> {
  try {
    const raw = await fs.readFile(path.join(UPLOADS_DIR, `${id}.json`), "utf8");
    const meta = JSON.parse(raw) as UploadMeta;
    return meta && meta.id === id ? meta : null;
  } catch {
    return null;
  }
}

/** Persist a base64-encoded scan/preset image to disk. Returns its id + public url. */
export async function saveUpload(
  dataBase64: string,
  filename: string,
  mime = "image/jpeg"
): Promise<SavedUpload | null> {
  const buffer = Buffer.from(dataBase64, "base64");
  if (!buffer.length || buffer.length > 12 * 1024 * 1024) return null;
  const id = randomUUID();
  const safeMime = /^image\/(jpeg|png|webp)$/.test(mime) ? mime : "image/jpeg";
  const ext = safeMime === "image/png" ? "png" : safeMime === "image/webp" ? "webp" : "jpg";
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const file = path.join(UPLOADS_DIR, `${id}.${ext}`);
  await fs.writeFile(file, buffer);
  const now = new Date().toISOString();
  const meta: UploadMeta = {
    id,
    filename,
    mime: safeMime,
    bytes: buffer.length,
    uploadedAt: now,
    expiresAt: new Date(Date.now() + UPLOAD_TTL_MS).toISOString(),
  };
  await fs.writeFile(path.join(UPLOADS_DIR, `${id}.json`), JSON.stringify(meta), "utf8").catch(() => {});
  return { id, filename, mime: safeMime, bytes: buffer.length, url: `/api/documents/${id}` };
}

export async function getUpload(id: string): Promise<{ data: Buffer; mime: string } | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const meta = await readUploadMeta(id);
  if (meta?.expiresAt && Date.parse(meta.expiresAt) <= Date.now()) {
    // Expired capability: the URL stops working, and the bytes are reclaimed
    // so dead links do not accumulate disk usage forever.
    await fs.rm(path.join(UPLOADS_DIR, `${id}.json`), { force: true }).catch(() => {});
    for (const ext of ["jpg", "png", "webp"]) {
      await fs.rm(path.join(UPLOADS_DIR, `${id}.${ext}`), { force: true }).catch(() => {});
    }
    return null;
  }
  for (const ext of ["jpg", "png", "webp"]) {
    try {
      const file = path.join(UPLOADS_DIR, `${id}.${ext}`);
      const data = await fs.readFile(file);
      // First-download audit stamp (best-effort, never blocks the bytes).
      if (meta && !meta.downloadedAt) {
        const stamped: UploadMeta = { ...meta, downloadedAt: new Date().toISOString() };
        await fs.writeFile(path.join(UPLOADS_DIR, `${id}.json`), JSON.stringify(stamped), "utf8").catch(() => {});
      }
      return { data, mime: ext === "jpg" ? "image/jpeg" : `image/${ext}` };
    } catch {
      /* try next extension */
    }
  }
  return null;
}

/** List stored upload filenames (admin diagnostics). */
export async function listUploads(): Promise<string[]> {
  try {
    return (await fs.readdir(UPLOADS_DIR)).filter((f) => !f.startsWith("."));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- admin reset / backups

/** Wipe every encounter (admin "reset demo" — the demo re-seeds on demand). */
export async function resetEncounters(): Promise<void> {
  await withLock(async () => {
    await ensureFile(ENCOUNTERS_FILE);
    await writeAll([]);
  });
}

/** Clear queue call-state (current call + recent call history) — engine-aware. */
export async function resetQueueState(): Promise<void> {
  await withQueueStateLock(async () => {
    if (ENGINE === "sqlite") {
      sqlite().prepare("DELETE FROM queue_state WHERE id = 1").run();
      return;
    }
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${QUEUE_STATE_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(EMPTY_QUEUE_STATE, null, 2), "utf8");
    await fs.rename(tmp, QUEUE_STATE_FILE);
  });
}

// ---------------------------------------------------------------- automated backups

const BACKUPS_DIR = path.join(DATA_DIR, "backups");
const BACKUP_RETENTION = 7;

export type BackupFile = { filename: string; bytes: number; sha256: string; at: string };

export type DrillResult = {
  at: string;
  by: string;
  target: string;
  restored: number;
  ok: boolean;
  error?: string;
};

const DRILL_FILE = path.join(DATA_DIR, "last-drill.json");

/** Persist the latest restore-drill outcome so it survives reloads and shows on the admin panel. */
export async function recordDrillResult(result: DrillResult): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DRILL_FILE, JSON.stringify(result, null, 2), "utf8").catch(() => {});
}

/** Latest restore-drill outcome, or null when no drill has ever run. */
export async function readLastDrill(): Promise<DrillResult | null> {
  try {
    const raw = await fs.readFile(DRILL_FILE, "utf8");
    const parsed = JSON.parse(raw) as DrillResult;
    return parsed && typeof parsed.at === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/** Snapshot encounters.json into data/backups with retention (keep last N). */
export async function takeBackup(): Promise<BackupFile> {
  await fs.mkdir(BACKUPS_DIR, { recursive: true });
  const all = await listEncounters();
  // At-rest encryption for archived snapshots when PHI encryption is enabled —
  // verifyBackup / readBackupRecords decrypt with the same key, so the restore
  // drill and restore workflow keep working end-to-end.
  const body = ENCRYPT_PHI ? encryptJson(all, PHI_SECRET()) : JSON.stringify(all, null, 2);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `medikiosk-backup-${stamp}.json`;
  const hash = sha256Hex(body);
  await fs.writeFile(path.join(BACKUPS_DIR, filename), body, "utf8");
  await fs.writeFile(path.join(BACKUPS_DIR, `${filename}.sha256`), hash, "utf8");

  // Retention: keep newest BACKUP_RETENTION files, drop older ones.
  const files = (await fs.readdir(BACKUPS_DIR)).filter((f) => f.endsWith(".json"));
  const drop = files.sort().slice(0, Math.max(0, files.length - BACKUP_RETENTION));
  await Promise.all(
    drop.map(async (f) => {
      await fs.rm(path.join(BACKUPS_DIR, f), { force: true });
      await fs.rm(path.join(BACKUPS_DIR, `${f}.sha256`), { force: true });
    })
  );
  return { filename, bytes: Buffer.byteLength(body), sha256: hash, at: new Date().toISOString() };
}

async function backupTimestamp(filename: string): Promise<string> {
  try {
    return (await fs.stat(path.join(BACKUPS_DIR, filename))).mtime.toISOString();
  } catch {
    return filename.replace("medikiosk-backup-", "").replace(".json", "").replace(/-/g, ":");
  }
}

/** List backups with their integrity hashes (newest first). */
export async function listBackups(): Promise<BackupFile[]> {
  try {
    const files = (await fs.readdir(BACKUPS_DIR)).filter((f) => f.endsWith(".json"));
    const backups = await Promise.all(
      files.map(async (f) => {
        const body = await fs.readFile(path.join(BACKUPS_DIR, f), "utf8");
        let sha: string | null = null;
        try {
          sha = (await fs.readFile(path.join(BACKUPS_DIR, `${f}.sha256`), "utf8")).trim();
        } catch {
          /* legacy backup without sidecar hash */
        }
        return {
          filename: f,
          bytes: Buffer.byteLength(body),
          sha256: sha ?? sha256Hex(body),
          at: await backupTimestamp(f),
        };
      })
    );
    return backups.sort((a, b) => b.at.localeCompare(a.at));
  } catch {
    return [];
  }
}

/**
 * Restore drill (Batch D, R4): prove a backup is restorable WITHOUT clobbering
 * live data. Verifies the SHA-256 sidecar, parses the JSON and schema-checks
 * every record, returning what a real restore would do.
 */
export async function verifyBackup(
  filename: string
): Promise<{ ok: boolean; error?: string; filename?: string; sha256?: string; count?: number; bytes?: number }> {
  const safe = path.basename(filename);
  const body = await fs.readFile(path.join(BACKUPS_DIR, safe), "utf8").catch(() => null);
  if (body === null) return { ok: false, error: "Backup file not found." };

  let sidecar: string | null = null;
  try {
    sidecar = (await fs.readFile(path.join(BACKUPS_DIR, `${safe}.sha256`), "utf8")).trim();
  } catch {
    /* no sidecar — hash-of-body still verifiable */
  }
  const computed = sha256Hex(body);
  if (sidecar && sidecar !== computed) {
    return { ok: false, error: "SHA-256 mismatch — backup is corrupted." };
  }

  let records: unknown;
  try {
    records = JSON.parse(body);
  } catch {
    return { ok: false, error: "Backup is not valid JSON." };
  }
  // Encrypted backups (ENCRYPT_PHI) are stored as a v:1 envelope — decrypt
  // before schema-checking, mirroring how the live store is read.
  if (records && typeof records === "object" && (records as { v?: number }).v === 1) {
    if (!ENCRYPT_PHI) {
      return {
        ok: false,
        error: "Backup is encrypted but MEDIKIOSK_ENCRYPT_PHI is off — cannot verify it with the current configuration.",
      };
    }
    try {
      records = decryptJson<unknown[]>(JSON.stringify(records), PHI_SECRET());
    } catch (err) {
      return {
        ok: false,
        error: `Backup could not be decrypted (wrong SESSION_SECRET?) — ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  if (!Array.isArray(records)) return { ok: false, error: "Backup does not contain an array of encounters." };

  const valid = records.filter(
    (r): r is StoredHistory =>
      Boolean(r) && typeof r === "object" && typeof (r as StoredHistory).encounterId === "string" &&
      Boolean((r as StoredHistory).patient) && Boolean((r as StoredHistory).history)
  );
  if (valid.length !== records.length) {
    return { ok: false, error: `${records.length - valid.length} record(s) failed schema check.` };
  }
  return {
    ok: true,
    filename: safe,
    sha256: computed.slice(0, 16),
    count: valid.length,
    bytes: Buffer.byteLength(body),
  };
}

/**
 * Read a backup file and return its encounter records (decrypting an encrypted
 * envelope when MEDIKIOSK_ENCRYPT_PHI is on). Throws on unreadable/corrupt data.
 */
export async function readBackupRecords(
  filename: string
): Promise<Array<Record<string, unknown>>> {
  const safe = path.basename(filename);
  const body = await fs.readFile(path.join(BACKUPS_DIR, safe), "utf8");
  const parsed = JSON.parse(body) as unknown;
  if (parsed && typeof parsed === "object" && (parsed as { v?: number }).v === 1) {
    if (!ENCRYPT_PHI) {
      throw new Error("Backup is encrypted but MEDIKIOSK_ENCRYPT_PHI is off — cannot restore it.");
    }
    return decryptJson<Array<Record<string, unknown>>>(JSON.stringify(parsed), PHI_SECRET());
  }
  return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
}

// ---------------------------------------------------------------- deep health

export type StorageHealth = {
  dataDir: string;
  engine: StorageEngine;
  /** Path of the live store file (SQLite db or encounters.json). */
  storeFile: string;
  writable: boolean;
  encountersFile: boolean;
  encounterCount: number;
  queueStateFile: boolean;
  appointmentsFile: boolean;
  backupsDir: boolean;
  backupsCount: number;
  freeBytes: number | null;
};

/** Runtime storage probe for the deep health check (#10). */
export async function healthStorage(): Promise<StorageHealth> {
  const probe = path.join(DATA_DIR, ".health-probe");
  let writable = false;
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(probe, "ok", "utf8");
    await fs.rm(probe, { force: true });
    writable = true;
  } catch {
    /* not writable */
  }
  let freeBytes: number | null = null;
  try {
    const st = await fs.statfs(DATA_DIR);
    freeBytes = Number(st.bsize) * Number(st.bavail);
  } catch {
    /* statfs unavailable */
  }
  const counts = await listEncounters();
  const backups = await listBackups();
  const fileExists = async (f: string) => {
    try {
      await fs.access(f);
      return true;
    } catch {
      return false;
    }
  };
  const storeFile = ENGINE === "sqlite" ? SQLITE_FILE : ENCOUNTERS_FILE;
  return {
    dataDir: DATA_DIR,
    engine: ENGINE,
    storeFile,
    writable,
    encountersFile: await fileExists(storeFile),
    encounterCount: counts.length,
    queueStateFile: ENGINE === "sqlite" ? true : await fileExists(QUEUE_STATE_FILE),
    appointmentsFile: await fileExists(path.join(DATA_DIR, "appointments.json")),
    backupsDir: await fileExists(BACKUPS_DIR),
    backupsCount: backups.length,
    freeBytes,
  };
}