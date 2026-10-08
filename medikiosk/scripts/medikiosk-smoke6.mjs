/* Phase-6 smoke: Batch D — R7 concurrency integrity.
   Fire parallel kiosk arrivals at the public /api/encounters endpoint and prove
   the storage layer is concurrency-safe: every concurrent write lands (no lost
   updates), deterministic tokens resolve in the public queue, a stale re-submit
   of the same id is deduped instead of clobbering the newer record, and the
   newest write wins. All assertions run over PUBLIC endpoints — no extra login,
   so the smoke chain's aggregate login count stays under the 10/min limiter. */
const BASE = process.env.BASE ?? "http://localhost:3000";
const results = [];

async function check(name, fn) {
  try {
    const out = await fn();
    results.push({ name, ok: !!out.ok });
    console.log(`${out.ok ? "PASS" : "FAIL"} ${name}${out.detail ? " — " + out.detail : ""}`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`FAIL ${name} — ${e}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Deterministic queue token — must mirror src/lib/queue.ts deriveQueueToken. */
function deriveQueueToken(encounterId) {
  let h = 0;
  for (let i = 0; i < encounterId.length; i++) {
    h = (h * 31 + encounterId.charCodeAt(i)) >>> 0;
  }
  return `TK-${1000 + (h % 9000)}`;
}

function buildBody(id, updatedAt, name) {
  return {
    encounterId: id,
    updatedAt,
    patient: {
      name,
      age: 39,
      sex: "Female",
      mobile: "9876543210",
      department: "General Medicine",
      vitals: { systolic: 122, diastolic: 80, pulse: 74, spo2: 98, temperature: 36.8 },
    },
    mode: "allopathic",
    enteredAt: updatedAt,
    history: {
      name, age: 39, sex: "Female",
      chiefComplaint: "fever", hpi: "Low-grade fever since yesterday.",
      pastMedical: [], pastSurgical: [], medications: [], allergies: [],
      familyHistory: "", personalHistory: "", reviewOfSystems: [], priorInvestigations: [],
    },
    documents: [], redFlags: [], interactions: [],
    summary: "Fever — review.",
    consentGranted: true,
    status: "pending",
    audit: [{ action: "consent_granted", at: updatedAt }],
  };
}

async function postEncounter(body) {
  const r = await fetch(`${BASE}/api/encounters`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { r, j: await r.json().catch(() => ({})) };
}

async function login(username, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const j = await r.json().catch(() => ({}));
  return { r, j, cookie: (r.headers.get("set-cookie") ?? "").split(";")[0] };
}

/**
 * POST /api/encounters is public and deliberately returns only identifiers,
 * status and escalation — it never echoes the stored clinical record. The
 * last-write-wins guarantee is therefore verified through the authenticated
 * staff route, which is the only place the full record may be read.
 */
async function readAsDoctor(cookie, encounterId) {
  const r = await fetch(`${BASE}/api/encounters/${encodeURIComponent(encounterId)}`, {
    headers: { Cookie: cookie },
    cache: "no-store",
  });
  return { r, j: await r.json().catch(() => ({})) };
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

  const count = async () => (await fetch(`${BASE}/api/health`, { cache: "no-store" }).then((r) => r.json())).storage?.encounterCount;

  const before = await count();
  const ts = Date.now();
  const doc = await login(process.env.DOC_USER ?? "doctor", process.env.DOC_PASS ?? "doctor123");
  if (!doc.cookie) {
    console.log("FATAL: staff login failed — cannot verify stored-record assertions.", doc.j);
    process.exit(1);
  }

  // ---------------------------------------------------------------- A: parallel arrivals — no lost writes
  const N = 8;
  const ids = Array.from({ length: N }, (_, i) => `r7-${ts}-${i}`);
  await check(`parallel arrivals: ${N} concurrent fresh writes all land`, async () => {
    const outs = await Promise.all(
      ids.map((id, i) => postEncounter(buildBody(id, new Date(ts + i).toISOString(), `Concurrent ${i}`)))
    );
    const okAll = outs.every(({ r, j }, i) => r.ok && j.ok === true && !j.duplicate && j.encounterId === ids[i]);
    return { ok: okAll, detail: `${outs.filter(({ r }) => r.ok).length}/${N} accepted` };
  });

  await check("health count reflects every parallel write (exactly +N)", async () => {
    const after = await count();
    return { ok: after === before + N, detail: `before=${before} after=${after}` };
  });

  await check("every concurrent token resolves in the public queue", async () => {
    const out = [];
    for (const id of ids) {
      const token = deriveQueueToken(id);
      const j = await fetch(`${BASE}/api/queue/position/${token}`).then((r) => r.json());
      out.push(j.found === true && j.position >= 1);
    }
    return { ok: out.every(Boolean), detail: `${out.filter(Boolean).length}/${N} found` };
  });

  // ---------------------------------------------------------------- B: duplicate guard + last-write-wins
  const dupeId = `r7-dupe-${ts}`;
  const t0 = new Date(ts).toISOString();

  await check("public POST never echoes the stored clinical record", async () => {
    const { r, j } = await postEncounter(buildBody(dupeId, t0, "Original"));
    const stored = await readAsDoctor(doc.cookie, dupeId);
    return {
      ok:
        r.ok &&
        j.ok === true &&
        !j.duplicate &&
        j.encounterId === dupeId &&
        !j.encounter &&
        !j.patient &&
        stored.j?.encounter?.history?.name === "Original",
      detail: `public encounter=${j.encounter === undefined ? "absent" : "LEAKED"} stored=${stored.j?.encounter?.history?.name}`,
    };
  });

  await check("5 parallel STALE re-submits are all deduped (no clobber)", async () => {
    const stale = new Date(ts - 3_600_000).toISOString();
    const rs = await Promise.all(
      Array.from({ length: 5 }, () => postEncounter(buildBody(dupeId, stale, "Stale")))
    );
    const stored = await readAsDoctor(doc.cookie, dupeId);
    const okAll =
      rs.every(({ r, j }) => r.ok && j.duplicate === true && !j.encounter) && stored.j?.encounter?.history?.name === "Original";
    return {
      ok: okAll,
      detail: `${rs.filter(({ j }) => j.duplicate === true).length}/5 deduped → kept=${stored.j?.encounter?.history?.name}`,
    };
  });

  await check("count unchanged across the stale wave", async () => {
    const after = await count();
    return { ok: after === before + N + 1, detail: `count=${after}` };
  });

  await check("newer write wins (last-write-wins, single record)", async () => {
    const newer = new Date(ts + 7_200_000).toISOString();
    const { r, j } = await postEncounter(buildBody(dupeId, newer, "Newer"));
    const stored = await readAsDoctor(doc.cookie, dupeId);
    return {
      ok: r.ok && j.ok === true && !j.duplicate && !j.encounter && stored.j?.encounter?.history?.name === "Newer",
      detail: `name=${stored.j?.encounter?.history?.name}`,
    };
  });

  await check("final store count: 8 arrivals + 1 dupe id, no extras", async () => {
    const after = await count();
    return { ok: after === before + N + 1, detail: `before=${before} after=${after} expected=${before + N + 1}` };
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });