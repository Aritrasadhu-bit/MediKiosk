/* Phase-2 smoke: new batch endpoints (queue feed, lookup, documents, admin
   export/restore, session revocation, lockout, /display, security headers). */
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

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function login(username, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const j = await r.json().catch(() => ({}));
  const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  return { r, j, cookie };
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

  // ---------------------------------------------------------------- pre-seed a pending encounter
  const ENC_ID = "smoke2-enc-" + Date.now();
  const ABHA = "11-0000-0000-0002";
  const enteredAt = new Date().toISOString();
  const enc = {
    encounterId: ENC_ID,
    updatedAt: enteredAt,
    patient: {
      abhaId: ABHA,
      name: "Renuka Yadav",
      age: 34,
      sex: "Female",
      mobile: "9867534210",
      department: "General Medicine",
      vitals: { systolic: 158, diastolic: 96, pulse: 112, temperature: 38.4, spo2: 97 },
    },
    mode: "allopathic",
    enteredAt,
    history: {
      name: "Renuka Yadav",
      age: 34,
      sex: "Female",
      chiefComplaint: "fever with body ache",
      hpi: "Low grade fever since 3 days.",
      pastMedical: [],
      pastSurgical: [],
      medications: [],
      allergies: [],
      familyHistory: "",
      personalHistory: "",
      reviewOfSystems: [],
      priorInvestigations: [],
    },
    documents: [],
    redFlags: [],
    interactions: [],
    summary: "Fever — review.",
    consentGranted: true,
    status: "pending",
    audit: [{ action: "consent_granted", at: enteredAt }],
  };

  await check("seed pending encounter (public)", async () => {
    const r = await fetch(`${BASE}/api/encounters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(enc),
    });
    const j = await r.json();
    return { ok: r.ok && j.ok, detail: j.error ?? ENC_ID };
  });

  // ---------------------------------------------------------------- returning-patient lookup + duplicate
  await check("/api/patient/lookup returns returning + pending duplicate", async () => {
    const r = await fetch(`${BASE}/api/patient/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ abha: ABHA }),
    });
    const j = await r.json();
    return {
      ok: r.ok && j.ok && j.returning === true && !!j.pendingEncounter?.encounterId,
      detail: `returning=${j.returning} pending=${j.pendingEncounter?.token ?? "none"}`,
    };
  });

  await check("/api/patient/lookup 400 when empty", async () => {
    const r = await fetch(`${BASE}/api/patient/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    return { ok: r.status === 400, detail: `status=${r.status}` };
  });

  // ---------------------------------------------------------------- queue feed + call/clear
  const doc1 = await login("doctor", "doctor123");
  await check("doctor login (phase 2)", async () => {
    return { ok: doc1.r.ok && doc1.cookie.startsWith("medikiosk_session="), detail: `${doc1.j.user?.name} role=${doc1.j.user?.role}` };
  });

  await check("GET /api/queue is public + PHI-minimised", async () => {
    const r = await fetch(`${BASE}/api/queue`);
    const j = await r.json();
    const row = Array.isArray(j.queue) ? j.queue.find((x) => x.encounterId === ENC_ID) : null;
    return {
      ok: r.ok && j.ok && !!row && !row.name && typeof row.nameInitial === "string" && typeof row.etaMin === "number",
      detail: `rows=${Array.isArray(j.queue) ? j.queue.length : "?"} etaMin=${row?.etaMin}`,
    };
  });

  await check("POST /api/queue call (auth) sets currentCall", async () => {
    const r = await fetch(`${BASE}/api/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: doc1.cookie },
      body: JSON.stringify({ encounterId: ENC_ID, action: "call", notify: false }),
    });
    const j = await r.json();
    return { ok: r.ok && j.currentCall?.encounterId === ENC_ID, detail: j.currentCall ? `token=${j.currentCall.token}` : j.error };
  });

  await check("GET /api/queue reflects currentCall", async () => {
    const r = await fetch(`${BASE}/api/queue`);
    const j = await r.json();
    return { ok: r.ok && j.currentCall?.encounterId === ENC_ID, detail: `currentCall=${j.currentCall?.token ?? "null"}` };
  });

  await check("POST /api/queue clear (auth)", async () => {
    const r = await fetch(`${BASE}/api/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: doc1.cookie },
      body: JSON.stringify({ encounterId: ENC_ID, action: "clear" }),
    });
    const j = await r.json();
    return { ok: r.ok && j.ok, detail: j.error ?? "cleared" };
  });

  await check("unauth POST /api/queue → 401", async () => {
    const r = await fetch(`${BASE}/api/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encounterId: ENC_ID, action: "call" }),
    });
    return { ok: r.status === 401, detail: `status=${r.status}` };
  });

  // ---------------------------------------------------------------- documents upload + serve
  let docUrl = "";
  await check("POST /api/documents stores scan", async () => {
    const r = await fetch(`${BASE}/api/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataBase64: PNG_B64, filename: "rx-small.png", mime: "image/png" }),
    });
    const j = await r.json();
    docUrl = j.document?.url ?? "";
    return { ok: r.ok && !!docUrl, detail: j.document?.filename ?? j.error };
  });

  await check("GET /api/documents/[id] serves image", async () => {
    if (!docUrl) return { ok: false, detail: "no url from upload" };
    const r = await fetch(`${BASE}${docUrl.startsWith("http") ? new URL(docUrl).pathname : docUrl}`);
    const buf = new Uint8Array(await r.arrayBuffer());
    return { ok: r.ok && buf.length > 0, detail: `bytes=${buf.length} type=${r.headers.get("content-type")}` };
  });

  // ---------------------------------------------------------------- admin export + restore
  const admin = await login("admin", "admin123");
  await check("admin login", async () => {
    return { ok: admin.r.ok && admin.j.user?.role === "admin", detail: admin.j.error ?? `user=${admin.j.user?.name}` };
  });

  await check("GET /api/admin/export?format=json", async () => {
    const r = await fetch(`${BASE}/api/admin/export?format=json`, { headers: { Cookie: admin.cookie } });
    const j = await r.json();
    return { ok: r.ok && Array.isArray(j.encounters), detail: `encounters=${Array.isArray(j.encounters) ? j.encounters.length : "?"}` };
  });

  await check("GET /api/admin/export?format=csv (BOM bytes EF BB BF)", async () => {
    const r = await fetch(`${BASE}/api/admin/export?format=csv`, { headers: { Cookie: admin.cookie } });
    const buf = new Uint8Array(await r.arrayBuffer());
    const hasBom = buf.length > 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    const text = new TextDecoder().decode(buf);
    return { ok: r.ok && hasBom && text.includes("encounterId"), detail: `bytes=${buf.length} BOM=${hasBom}` };
  });

  await check("admin export forbidden to non-admin", async () => {
    const r = await fetch(`${BASE}/api/admin/export?format=json`, { headers: { Cookie: doc1.cookie } });
    return { ok: r.status === 403, detail: `status=${r.status}` };
  });

  await check("POST /api/admin/restore (round-trip)", async () => {
    const r = await fetch(`${BASE}/api/admin/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: admin.cookie },
      body: JSON.stringify({ encounters: [enc] }),
    });
    const j = await r.json();
    return { ok: r.ok && j.ok && j.restored >= 1, detail: `restored=${j.restored}` };
  });

  // ---------------------------------------------------------------- session revocation + lockout
  await check("logout revokes session → /api/auth/me 401", async () => {
    await fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: { Cookie: doc1.cookie } });
    const r = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: doc1.cookie }, cache: "no-store" });
    return { ok: r.status === 401, detail: `status=${r.status}` };
  });

  const doc2 = await login("doctor", "doctor123");
  await check("re-login creates a fresh valid session", async () => {
    const r = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: doc2.cookie }, cache: "no-store" });
    return { ok: r.ok && (await r.json()).ok === true, detail: `status=${r.status}` };
  });

  // (Account lockout is probed separately in medikiosk-lockout.mjs on a fresh
  // server, so the probe's 6 login attempts can't collide with this run's
  // logins against the shared per-IP 10/min login rate limiter.)

  // ---------------------------------------------------------------- display page + security headers
  await check("/display renders", async () => {
    const r = await fetch(`${BASE}/display`);
    const text = await r.text();
    return { ok: r.ok && (text.includes("OPD Queue") || text.includes("MediKiosk")), detail: `status=${r.status}` };
  });

  await check("security headers present", async () => {
    const r = await fetch(`${BASE}/`);
    const csp = r.headers.get("content-security-policy") ?? "";
    return {
      ok:
        r.headers.get("x-frame-options") === "DENY" &&
        r.headers.get("x-content-type-options") === "nosniff" &&
        csp.includes("frame-ancestors 'none'") &&
        csp.includes("object-src 'none'"),
      detail: `CSP=${csp ? "yes" : "no"} XFO=${r.headers.get("x-frame-options") ?? "none"} nosniff=${r.headers.get("x-content-type-options") ?? "none"}`,
    };
  });

  // cleanup
  await fetch(`${BASE}/api/encounters/${ENC_ID}`, { method: "DELETE", headers: { Cookie: doc2.cookie } }).catch(() => {});

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error("PROBE ERROR:", e);
  process.exit(1);
});