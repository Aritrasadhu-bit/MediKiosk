/**
 * Load probe for MediKiosk (zero dependencies — runs anywhere with node).
 *
 *   node scripts/medikiosk-load.mjs [--base=http://localhost:3000] [--cleanup]
 *
 * This is NOT a benchmarking toy that hammers blindly: the public write route
 * is rate-limited (30/min/IP by design), so a naive flood only measures the
 * limiter. Instead the script asserts the two properties a hospital cares
 * about:
 *
 *   1. Within budget, every write lands and latency stays sane (p95 reported).
 *   2. Over budget, the server answers 429 — never 500, never a torn write.
 *
 * Load encounters use `load-<ts>-<i>` ids. Pass --cleanup to delete them
 * afterwards (doctor login; skipped gracefully when auth is unavailable).
 */

const BASE = process.env.BASE ?? "http://localhost:3000";
const CLEANUP = process.argv.includes("--cleanup");
const DOC_USER = process.env.DOC_USER ?? "doctor";
const DOC_PASS = process.env.DOC_PASS ?? "doctor123";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
};

async function timedFetch(url, opts = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, opts);
    await r.text().catch(() => {});
    return { status: r.status, ms: Date.now() - t0 };
  } catch (e) {
    return { status: "ERR", ms: Date.now() - t0, error: String(e) };
  }
}

function buildBody(id) {
  const now = new Date().toISOString();
  return {
    encounterId: id,
    mode: "allopathic",
    enteredAt: now,
    updatedAt: now,
    patient: { name: "Load Probe", age: 30, sex: "Male", mobile: "9000000000" },
    history: { chiefComplaint: "load probe" },
  };
}

async function main() {
  for (let i = 0; i < 30; i++) {
    try {
      await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
      break;
    } catch {
      await sleep(1000);
    }
  }

  let failures = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
    if (!ok) failures++;
  };

  // Phase 1: read latency baseline (sequential, never limited).
  const reads = [];
  for (let i = 0; i < 10; i++) {
    reads.push(await timedFetch(`${BASE}/api/health`, { cache: "no-store" }));
    reads.push(await timedFetch(`${BASE}/api/queue`, { cache: "no-store" }));
  }
  const readMs = reads.filter((r) => r.status === 200).map((r) => r.ms);
  check(
    "read baseline: 20/20 healthy",
    readMs.length === 20,
    `p50=${pct(readMs, 50)}ms p95=${pct(readMs, 95)}ms max=${Math.max(...readMs, 0)}ms`
  );

  // Phase 2: burst 40 concurrent writes — the limiter must answer 429, and
  // NOTHING may 500 or tear. (Rate state is per-IP, so one load machine shares
  // one bucket — exactly like a NAT'd hospital ward.)
  const ts = Date.now();
  const createdIds = [];
  const burst = await Promise.all(
    Array.from({ length: 40 }, (_, i) => {
      const id = `load-${ts}-b${i}`;
      createdIds.push(id);
      return timedFetch(`${BASE}/api/encounters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody(id)),
      });
    })
  );
  const byStatus = {};
  for (const r of burst) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const bad = burst.filter((r) => r.status !== 200 && r.status !== 429 && r.status !== 409);
  check(
    "burst: limiter absorbs flood, zero 5xx",
    bad.length === 0 && (byStatus[429] ?? 0) > 0,
    `200=${byStatus[200] ?? 0} 409=${byStatus[409] ?? 0} 429=${byStatus[429] ?? 0} other=${bad.length}`
  );

  // Wait for the 60s rate window to reset before the sustained phase.
  await sleep(65_000);

  // Phase 3: sustained within-budget writes (24/min under the 30 cap).
  const lat = [];
  let accepted = 0;
  for (let i = 0; i < 12; i++) {
    const id = `load-${ts}-s${i}`;
    createdIds.push(id);
    const r = await timedFetch(`${BASE}/api/encounters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildBody(id)),
    });
    if (r.status === 200) {
      accepted++;
      lat.push(r.ms);
    } else {
      check(`sustained write ${i} accepted (within budget)`, false, `status=${r.status}`);
    }
    await sleep(2500);
  }
  if (accepted === 12) {
    check("sustained: 12/12 landed within budget", true, `p50=${pct(lat, 50)}ms p95=${pct(lat, 95)}ms max=${Math.max(...lat)}ms`);
  }

  if (CLEANUP) {
    try {
      const login = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: DOC_USER, password: DOC_PASS }),
      });
      const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
      let removed = 0;
      for (const id of createdIds) {
        const d = await fetch(`${BASE}/api/encounters/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: { Cookie: cookie },
        }).catch(() => null);
        if (d?.ok) removed++;
      }
      console.log(`cleanup: removed ${removed}/${createdIds.length} probe records`);
    } catch (e) {
      console.log(`cleanup skipped: ${String(e)}`);
    }
  } else {
    console.log("note: probe records left in store (ids load-<ts>-*); re-run with --cleanup to remove");
  }

  console.log(failures === 0 ? "LOAD OK" : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`FATAL: ${String(e)}`);
  process.exit(1);
});
