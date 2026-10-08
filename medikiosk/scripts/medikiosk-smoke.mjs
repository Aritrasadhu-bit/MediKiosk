/* Runtime smoke test for the MediKiosk API surface. */
const BASE = process.env.BASE ?? "http://localhost:3000";

const results = [];
async function check(name, fn) {
  try {
    const out = await fn();
    results.push({ name, ok: !!out.ok, detail: out.detail ?? "" });
    console.log(`${out.ok ? "PASS" : "FAIL"} ${name}${out.detail ? " — " + out.detail : ""}`);
  } catch (e) {
    results.push({ name, ok: false, detail: String(e) });
    console.log(`FAIL ${name} — ${e}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // wait for server
  for (let i = 0; i < 30; i++) {
    try {
      await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
      break;
    } catch {
      await sleep(1000);
    }
  }

  await check("/api/health", async () => {
    const r = await fetch(`${BASE}/api/health`);
    const j = await r.json();
    return { ok: r.ok && j.ok, detail: `ver=${j.ver} status=${j.status} persistence=${j.persistence ?? "n/a"}` };
  });

  await check("/api/config", async () => {
    const r = await fetch(`${BASE}/api/config`);
    const j = await r.json();
    return { ok: r.ok && typeof j.version === "string", detail: `version=${j.version} persistence=${j.capabilities?.persistence}` };
  });

  await check("login + cookie", async () => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "doctor", password: "doctor123" }),
    });
    const j = await r.json();
    const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
    if (!r.ok || !cookie.startsWith("medikiosk_session=")) return { ok: false, detail: j.error ?? "no cookie" };
    globalThis.__cookie = cookie;
    return { ok: true, detail: `user=${j.user?.name} role=${j.user?.role}` };
  });

  await check("bad login rejected", async () => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "doctor", password: "wrong" }),
    });
    return { ok: r.status === 401, detail: `status=${r.status}` };
  });

  await check("unauth encounters GET → 401", async () => {
    const r = await fetch(`${BASE}/api/encounters`);
    return { ok: r.status === 401, detail: `status=${r.status}` };
  });

  const encounter = {
    encounterId: "smoke-test-encounter",
    updatedAt: new Date().toISOString(),
    patient: {
      abhaId: "98-7654-3210-0001",
      name: "Smoke Test Patient",
      age: 45,
      sex: "Male",
      mobile: "9876543210",
      department: "General Medicine",
      vitals: { systolic: 185, diastolic: 120, pulse: 95, spo2: 96 },
    },
    mode: "allopathic",
    enteredAt: new Date().toISOString(),
    history: {
      name: "Smoke Test Patient",
      age: 45,
      sex: "Male",
      chiefComplaint: "chest pain",
      hpi: "Chest pain with breathlessness since morning",
      pastMedical: [],
      pastSurgical: [],
      medications: [],
      allergies: [],
      familyHistory: "None",
      personalHistory: "No",
      reviewOfSystems: [],
      priorInvestigations: [],
    },
    documents: [],
    redFlags: [{ id: "rf-1", severity: "high", symptom: "Chest Pain", message: "Possible cardiac event", source: "text" }],
    interactions: [],
    summary: "Chest pain — urgent.",
    consentGranted: true,
    status: "pending",
    audit: [{ action: "consent_granted", at: new Date().toISOString() }],
  };

  await check("public POST /api/encounters", async () => {
    const r = await fetch(`${BASE}/api/encounters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(encounter),
    });
    const j = await r.json();
    return { ok: r.ok && j.ok, detail: j.error ?? `saved ${j.encounter?.encounterId}` };
  });

  await check("auth GET /api/encounters", async () => {
    const r = await fetch(`${BASE}/api/encounters`, { headers: { Cookie: globalThis.__cookie } });
    const j = await r.json();
    const list = j.encounters ?? [];
    return { ok: r.ok && list.some((e) => e.encounterId === "smoke-test-encounter"), detail: `count=${list.length}` };
  });

  await check("auth PATCH /api/encounters/[id] (status)", async () => {
    const r = await fetch(`${BASE}/api/encounters/smoke-test-encounter`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: globalThis.__cookie },
      body: JSON.stringify({ status: "confirmed", doctorNote: "Seen in OPD" }),
    });
    const j = await r.json();
    return { ok: r.ok && j.encounter?.status === "confirmed", detail: j.error ?? `status=${j.encounter?.status}` };
  });

  await check("auth DELETE /api/encounters/[id]", async () => {
    const r = await fetch(`${BASE}/api/encounters/smoke-test-encounter`, {
      method: "DELETE",
      headers: { Cookie: globalThis.__cookie },
    });
    const j = await r.json();
    return { ok: r.ok, detail: j.error ?? "deleted" };
  });

  await check("rate limiter rejects burst", async () => {
    // /api/extract is limited to 40/min per client — burst should hit 429.
    let blocked = false;
    for (let i = 0; i < 100; i++) {
      const x = await fetch(`${BASE}/api/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Tab. Metformin 500mg", filename: "burst.txt" }),
      });
      if (x.status === 429) { blocked = true; break; }
    }
    return { ok: blocked, detail: "429 seen" };
  });

  const failed = results.filter((r) => !r.ok);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error("PROBE ERROR:", e);
  process.exit(1);
});