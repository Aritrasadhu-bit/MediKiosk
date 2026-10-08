/**
 * Offsite backup push/pull for MediKiosk (zero dependencies — plain node).
 *
 * Local snapshots (data/backups, SHA-256 sidecars, 7-file retention) die with
 * the disk they sit on. This script copies them somewhere else and verifies
 * the copy hash-for-hash:
 *
 *   node scripts/medikiosk-offsite.mjs push [--data-dir=./data] [--dest=...]
 *   node scripts/medikiosk-offsite.mjs verify [--data-dir=./data] [--dest=...]
 *   node scripts/medikiosk-offsite.mjs pull [--data-dir=./data] [--dest=...]
 *
 * --dest (or OFFSITE_DEST env) may be:
 *   - a local path   → USB stick / mounted share (recursive copy)
 *   - user@host:path  → rsync over SSH when `rsync` exists, else fails loudly
 *   - s3://bucket/prefix → `aws s3 sync` when the AWS CLI exists, else fails loudly
 *
 * pull restores into <data-dir>/backups-restored/ (NEVER over live data —
 * re-import through Admin → Backups → restore, which merges safely).
 * verify compares every local snapshot hash against the offsite copy and
 * exits non-zero on the first mismatch. See docs/RUNBOOK.md.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const args = Object.fromEntries(
  process.argv.slice(3).map((a) => {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  })
);
const CMD = process.argv[2];
const DATA_DIR = path.resolve(args["data-dir"] ?? process.env.MEDIKIOSK_DATA_DIR ?? "data");
const DEST = args.dest ?? process.env.OFFSITE_DEST ?? "";
const SRC = path.join(DATA_DIR, "backups");

const sha256File = async (file) => {
  const h = createHash("sha256");
  const fh = await fs.open(file, "r");
  try {
    for await (const chunk of fh.createReadStream()) h.update(chunk);
  } finally {
    await fh.close();
  }
  return h.digest("hex");
};

const commandExists = async (cmd) => {
  try {
    await execFileAsync(process.platform === "win32" ? "where" : "which", [cmd]);
    return true;
  } catch {
    return false;
  }
};

async function snapshots() {
  const files = await fs.readdir(SRC).catch(() => []);
  return files.filter((f) => f.endsWith(".json")).sort();
}

async function pushLocal(dest) {
  await fs.mkdir(dest, { recursive: true });
  const files = await snapshots();
  if (!files.length) {
    console.log("No local snapshots to push (run a backup first).");
    return;
  }
  for (const f of files) {
    await fs.copyFile(path.join(SRC, f), path.join(dest, f));
    try {
      await fs.copyFile(path.join(SRC, `${f}.sha256`), path.join(dest, `${f}.sha256`));
    } catch {
      /* legacy snapshot without sidecar */
    }
  }
  console.log(`Pushed ${files.length} snapshot(s) to ${dest}.`);
}

async function pushRsync(dest) {
  if (!(await commandExists("rsync"))) {
    throw new Error("rsync not found — install rsync or use a local-path OFFSITE_DEST.");
  }
  const files = await snapshots();
  if (!files.length) {
    console.log("No local snapshots to push (run a backup first).");
    return;
  }
  await execFileAsync("rsync", ["-az", "--include=*.json", "--include=*.sha256", "--exclude=*", `${SRC}/`, dest]);
  console.log(`Pushed ${files.length} snapshot(s) to ${dest} via rsync.`);
}

async function pushS3(dest) {
  if (!(await commandExists("aws"))) {
    throw new Error("AWS CLI not found — install it or use a local-path OFFSITE_DEST.");
  }
  await execFileAsync("aws", ["s3", "sync", SRC, dest, "--exclude", "*", "--include", "*.json", "--include", "*.sha256"]);
  console.log(`Synced snapshots to ${dest} via AWS CLI.`);
}

async function verifyLocal(dest) {
  const files = await snapshots();
  if (!files.length) throw new Error("No local snapshots — nothing to verify against.");
  for (const f of files) {
    const [a, b] = await Promise.all([sha256File(path.join(SRC, f)), sha256File(path.join(dest, f))]);
    if (a !== b) throw new Error(`HASH MISMATCH on ${f} — offsite copy is corrupt.`);
  }
  console.log(`Verified ${files.length} snapshot(s) hash-for-hash against ${dest}. Offsite copy is good.`);
}

async function pullLocal(dest, restoreDir) {
  await fs.mkdir(restoreDir, { recursive: true });
  const files = (await fs.readdir(dest).catch(() => [])).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) throw new Error(`No snapshots found at ${dest}.`);
  for (const f of files) {
    await fs.copyFile(path.join(dest, f), path.join(restoreDir, f));
    try {
      await fs.copyFile(path.join(dest, `${f}.sha256`), path.join(restoreDir, `${f}.sha256`));
    } catch {
      /* no sidecar */
    }
  }
  console.log(`Pulled ${files.length} snapshot(s) into ${restoreDir}.`);
  console.log("Re-import through the app (Admin → Backups → restore) — never copy over live data files.");
}

async function main() {
  if (!["push", "verify", "pull"].includes(CMD)) {
    console.error("Usage: node scripts/medikiosk-offsite.mjs <push|verify|pull> [--data-dir=./data] [--dest=...]");
    process.exit(2);
  }
  if (!DEST) throw new Error("Set --dest or OFFSITE_DEST (local path, user@host:path, or s3://bucket/prefix).");
  const isS3 = DEST.startsWith("s3://");
  const isRemote = /@.+:/.test(DEST) && !isS3;

  if (CMD === "push") {
    if (isS3) await pushS3(DEST);
    else if (isRemote) await pushRsync(DEST);
    else await pushLocal(path.resolve(DEST));
  } else if (CMD === "verify") {
    if (isS3 || isRemote) throw new Error("verify supports local-path destinations only (download first, then verify).");
    await verifyLocal(path.resolve(DEST));
  } else {
    if (isS3 || isRemote) throw new Error("pull supports local-path destinations only (rsync/aws the files down first).");
    await pullLocal(path.resolve(DEST), path.join(DATA_DIR, "backups-restored"));
  }
}

main().catch((e) => {
  console.error(`Offsite ${CMD} failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
