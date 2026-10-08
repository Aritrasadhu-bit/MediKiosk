/**
 * Storage engine selection (Batch D, R1).
 *
 * Pure decision helper so the SQLite opt-in path is unit-testable without
 * pulling in server-only code. `resolveStorageEngine` returns "sqlite" ONLY
 * when the operator explicitly requests it (MEDIKIOSK_DB=sqlite) AND the
 * runtime actually provides node:sqlite — otherwise it degrades to "json".
 */

export type StorageEngine = "json" | "sqlite";

export function resolveStorageEngine(
  requested: string | undefined,
  sqliteAvailable: boolean
): StorageEngine {
  if (requested === "sqlite" && sqliteAvailable) return "sqlite";
  return "json";
}

/**
 * Default engine when MEDIKIOSK_DB is unset.
 *
 * Fresh data directories get SQLite (WAL, indexed primary key, no full-file
 * rewrite per write — the JSON store degrades past roughly dozens of daily
 * patients across concurrent kiosks). An EXISTING JSON store keeps working
 * untouched: silently switching engines would orphan live data, so migration
 * is always explicit (`npm run migrate:json-sqlite`).
 */
export function selectDefaultEngine(sqliteAvailable: boolean, jsonStoreExists: boolean): StorageEngine {
  if (sqliteAvailable && !jsonStoreExists) return "sqlite";
  return "json";
}