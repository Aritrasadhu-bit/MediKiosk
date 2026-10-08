/**
 * One-time migration: JSON file store -> SQLite (node:sqlite, WAL).
 *
 *   node scripts/medikiosk-migrate-json-sqlite.mjs [--data-dir=./data] [--dry-run]
 *
 * Merge semantics mirror upsertEncounter: every JSON record lands in SQLite;
 * on encounter_id conflict the NEWER updatedAt wins. Nothing is deleted — the
 * JSON files stay in place as a fallback until the operator removes them.
 * Encrypted stores (MEDIKIOSK_ENCRYPT_PHI=1) are decrypted with SESSION_SECRET
 * from the environment and re-encrypted row-by-row exactly as the server
 * would store them, so a migrated store is immediately live under the same
 * env. (Storing migrated rows unencrypted under an encryption flag would make
 * every row fail to decrypt on next boot — the script must never do that.)
 *
 * STOP THE SERVER before migrating (or accept that writes landing mid-run
 * are picked up by the app's own merge on next write — the script never
 * deletes source data, so re-running is always safe).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  })
);

const DATA_DIR = path.resolve(args["data-dir"] ?? process.env.MEDIKIOSK_DATA_DIR ?? "data");
const DRY_RUN = Boolean(args["dry-run"]);
const ENCRYPT_PHI = process.env.MEDIKIOSK_ENCRYPT_PHI === "1";

function decryptJson(payload, secret) {
  const envelope = JSON.parse(payload);
  if (envelope?.v !== 1) throw new Error("Unsupported ciphertext envelope");
  const key = scryptSync(secret, "medikiosk-phi-v1", 32);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]);
  return JSON.parse(plain.toString("utf8"));
}

async function main() {
  const jsonFile = path.join(DATA_DIR, "encounters.json");
  let records;
  try {
    const raw = await fs.readFile(jsonFile, "utf8");
    const parsed = ENCRYPT_PHI ? decryptJson(raw, process.env.SESSION_SECRET ?? "") : JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("encounters.json is not an array");
    records = parsed;
  } catch (e) {
    if (e.code === "ENOENT") {
      console.log(`No ${jsonFile} — nothing to migrate.`);
      return;
    }
    throw e;
  }
  console.log(`Read ${records.length} record(s) from encounters.json${ENCRYPT_PHI ? " (decrypted)" : ""}.`);

  if (DRY_RUN) {
    console.log(`--dry-run: would merge ${records.length} record(s) into ${path.join(DATA_DIR, "medikiosk.db")}. No writes performed.`);
    return;
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(path.join(DATA_DIR, "medikiosk.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`CREATE TABLE IF NOT EXISTS encounters (encounter_id TEXT PRIMARY KEY, data TEXT NOT NULL);`);

  const get = db.prepare("SELECT data FROM encounters WHERE encounter_id = ?");
  const put = db.prepare("INSERT INTO encounters (encounter_id, data) VALUES (?, ?) ON CONFLICT(encounter_id) DO UPDATE SET data = excluded.data");
  // Row encoding must match src/lib/server/db.ts sqliteWriteAll exactly:
  // encrypted envelope per row when the flag is on, plain JSON otherwise.
  const encodeRow = (rec) => {
    if (!ENCRYPT_PHI) return JSON.stringify(rec);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", scryptSync(process.env.SESSION_SECRET ?? "", "medikiosk-phi-v1", 32), iv);
    const enc = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(rec), "utf8")), cipher.final()]);
    return JSON.stringify({
      v: 1,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: enc.toString("base64"),
    });
  };
  let inserted = 0;
  let kept = 0;
  let skipped = 0;
  for (const rec of records) {
    if (!rec || typeof rec !== "object" || !rec.encounterId) {
      skipped++;
      continue;
    }
    const row = get.get(rec.encounterId);
    if (!row) {
      put.run(rec.encounterId, encodeRow(rec));
      inserted++;
      continue;
    }
    let existingTime = 0;
    try {
      // Rows created by the server are encrypted envelopes when the flag is
      // on — compare against the decrypted record, not the envelope.
      const existing = ENCRYPT_PHI
        ? decryptJson(row.data, process.env.SESSION_SECRET ?? "")
        : JSON.parse(row.data);
      existingTime = Date.parse(existing.updatedAt ?? "") || 0;
    } catch {
      /* torn row loses to the backup copy */
    }
    if ((Date.parse(rec.updatedAt ?? "") || 0) >= existingTime) {
      put.run(rec.encounterId, encodeRow(rec));
      inserted++;
    } else {
      kept++;
    }
  }
  db.close();
  console.log(`Done: ${inserted} upserted, ${kept} kept (sqlite copy newer), ${skipped} skipped (no id).`);
  console.log("Verify with: MEDIKIOSK_DB=sqlite node scripts/medikiosk-smoke.mjs  (then restart normally)");
}

main().catch((e) => {
  console.error(`Migration failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
