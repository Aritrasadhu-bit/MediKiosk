/* Phase-3 smoke: upgrade-batch endpoints — deep health, queue position,
   patient portal (code-gated), consent revoke, FHIR download, ABDM sandbox,
   admin reset + backups + export manifest, AI scribe + differential panel,
   appointments book/lookup/check-in, CSRF guard. */
import { createHmac, createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3000";
function getSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const devFile = path.join(process.cwd(), "data", ".dev-session-secret");
  if (existsSync(devFile)) {
    const s = readFileSync(devFile, "utf8").trim();
    if (s) return s;
  }
  return "medikiosk-dev-secret-change-me";
}
const SECRET = getSecret();
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

const portalCode = (id) => createHmac("sha256", SECRET).update(`portal:${id}`).digest("hex").slice(0, 12);
const sha256Hex = (s) => createHash("sha256").update(s).digest("hex");

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

  // ---- NB: run this AFTER the lockout probe on a fresh server; total login
  // attempts here (2) + smoke1 (2) + smoke2 (3) stay under the 10/min login
  // limiter, and the lockout probe needs its own fresh limiter.

  // ---------------------------------------------------------------- deep health
  await check("deep health storage probe", async () => {
    const r = await fetch(`${BASE}/api/health`);
    const j = await r.json();
    const s = j.storage ?? {};
    return {
      ok: r.ok && j.ok && s.writable === true && typeof s.encounterCount === "number" && j.persistence === "server-file",
      detail: `writable=${s.writable} encounters=${s.encounterCount} backups=${s.backups?.dir}`,
    };
  });

  // ---------------------------------------------------------------- admin reset + re-seed
  const admin = await login("admin", "admin123");
  await check("admin reset re-seeds demo patients", async () => {
    const r = await fetch(`${BASE}/api/admin/reset`, { method: "POST", headers: { Cookie: admin.cookie } });
    const j = await r.json();
    return { ok: r.ok && j.ok && j.seeded >= 3 && j.encounters >= 3, detail: `seeded=${j.seeded} total=${j.encounters}` };
  });

  // ---------------------------------------------------------------- seed custom encounter
  const ENC_ID = "smoke3-enc-" + Date.now();
  const TOKEN = "TK-77-7";
  const ABHA = "22-0000-0000-0017";
  const enteredAt = new Date().toISOString();
  const enc = {
    encounterId: ENC_ID,
    updatedAt: enteredAt,
    token: TOKEN,
    patient: {
      abhaId: ABHA,
      name: "Portal Test Patient",
      age: 41,
      sex: "Female",
      mobile: "9876501234",
      department: "General Medicine",
      vitals: { systolic: 122, diastolic: 80, pulse: 74, spo2: 98, temperature: 36.8 },
    },
    mode: "allopathic",
    enteredAt,
    history: {
      name: "Portal Test Patient", age: 41, sex: "Female",
      chiefComplaint: "cough with cold", hpi: "Dry cough since 2 days.",
      pastMedical: [], pastSurgical: [], medications: [], allergies: [],
      familyHistory: "", personalHistory: "", reviewOfSystems: [], priorInvestigations: [],
    },
    documents: [], redFlags: [], interactions: [],
    summary: "Cough — review.",
    prescription: {
      diagnosis: "Acute upper respiratory infection",
      medications: [{ name: "Paracetamol", dosage: "500mg", frequency: "thrice daily", duration: "5 days" }],
    },
    consentGranted: true,
    status: "pending",
    audit: [{ action: "consent_granted", at: enteredAt }],
  };

  await check("seed custom encounter (public)", async () => {
    const r = await fetch(`${BASE}/api/encounters`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(enc),
    });
    const j = await r.json();
    return { ok: r.ok && j.ok, detail: j.error ?? `saved ${j.encounter?.encounterId} escalation=${j.escalation?.level}` };
  });

  // ---------------------------------------------------------------- queue position
  await check("queue position by token (public)", async () => {
    const r = await fetch(`${BASE}/api/queue/position/${TOKEN}`);
    const j = await r.json();
    return { ok: r.ok && j.found && j.position >= 1 && typeof j.etaMin === "number", detail: `pos=${j.position} eta=${j.etaMin}min waiting=${j.waitingCount}` };
  });
  await check("queue position unknown token → found:false", async () => {
    const r = await fetch(`${BASE}/api/queue/position/NOPE-999`);
    const j = await r.json();
    return { ok: r.ok && j.found === false, detail: `found=${j.found}` };
  });

  // ---------------------------------------------------------------- patient portal (code-gated)
  const code = portalCode(ENC_ID);
  await check("portal record requires code", async () => {
    const r = await fetch(`${BASE}/api/patient/portal/${ENC_ID}`);
    return { ok: r.status === 403, detail: `status=${r.status}` };
  });
  await check("portal record (valid code)", async () => {
    const r = await fetch(`${BASE}/api/patient/portal/${ENC_ID}?code=${code}`);
    const j = await r.json();
    return { ok: r.ok && j.ok && j.record?.encounterId === ENC_ID && j.record.token === TOKEN, detail: `status=${j.record?.status} pos=${j.record?.queuePosition}` };
  });
  await check("portal revoke consent", async () => {
    const r = await fetch(`${BASE}/api/patient/portal/${ENC_ID}/consent`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, consent: false }),
    });
    const j = await r.json();
    return { ok: r.ok && j.ok && j.consentGranted === false, detail: `consent=${j.consentGranted}` };
  });
  await check("portal re-grant consent", async () => {
    const r = await fetch(`${BASE}/api/patient/portal/${ENC_ID}/consent`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, consent: true }),
    });
    const j = await r.json();
    return { ok: r.ok && j.ok && j.consentGranted === true, detail: `consent=${j.consentGranted}` };
  });
  await check("FHIR portal download is a bundle", async () => {
    const r = await fetch(`${BASE}/api/patient/portal/${ENC_ID}/fhir?code=${code}`);
    const j = await r.json();
    return {
      ok: r.ok && (r.headers.get("content-type") ?? "").includes("fhir+json") && j.resourceType === "Bundle",
      detail: `type=${j.resourceType} total=${j.total} ct=${r.headers.get("content-type")}`,
    };
  });

  // ---------------------------------------------------------------- ABDM sandbox
  await check("ABDM sandbox consent (portal code)", async () => {
    const r = await fetch(`${BASE}/api/abdm/consent`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encounterId: ENC_ID, code }),
    });
    const j = await r.json();
    const report = j.healthInformation ?? {};
    return {
      ok: r.ok && j.ok && typeof j.consentId === "string" && report.consent?.id === j.consentId && typeof report.data?.content === "string",
      detail: `consent=${j.consentId} gateway=${j.gateway} fhirTotal=${j.fhir?.total}`,
    };
  });
  await check("ABDM consent rejected without code", async () => {
    const r = await fetch(`${BASE}/api/abdm/consent`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encounterId: ENC_ID }),
    });
    return { ok: r.status === 403, detail: `status=${r.status}` };
  });

  // ---------------------------------------------------------------- AI scribe + differentials
  const doc = await login("doctor", "doctor123");
  await check("AI scribe /api/rx/dictate (auth)", async () => {
    const r = await fetch(`${BASE}/api/rx/dictate`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: doc.cookie },
      body: JSON.stringify({ text: "Tab paracetamol 500mg thrice daily for 5 days; Tab amoxicillin 500mg twice daily for 7 days after meals", encounterId: ENC_ID }),
    });
    const j = await r.json();
    return { ok: r.ok && j.ok && Array.isArray(j.draft) && j.draft.length >= 2, detail: `items=${j.draft?.length} hinted=${j.hinted}` };
  });
  await check("AI scribe rejects empty text", async () => {
    const r = await fetch(`${BASE}/api/rx/dictate`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: doc.cookie },
      body: JSON.stringify({ text: "" }),
    });
    return { ok: r.status === 400, detail: `status=${r.status}` };
  });
  await check("differential panel /api/patient/[id]/ai", async () => {
    const r = await fetch(`${BASE}/api/patient/${ENC_ID}/ai`, { headers: { Cookie: doc.cookie } });
    const j = await r.json();
    return {
      ok: r.ok && j.ok && Array.isArray(j.panel?.differentials) && Array.isArray(j.panel?.suggestedQuestions),
      detail: `diffs=${j.panel?.differentials?.length} qs=${j.panel?.suggestedQuestions?.length} hinted=${j.panel?.hinted}`,
    };
  });

  // ---------------------------------------------------------------- appointments
  const APT = { name: "Portal Test Patient", mobile: "9876501234", department: "General Medicine", date: new Date().toISOString().slice(0, 10), slot: "11:30–12:00" };
  await check("book appointment (public)", async () => {
    const r = await fetch(`${BASE}/api/appointments`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(APT),
    });
    const j = await r.json();
    globalThis.__aptId = j.appointment?.id ?? "";
    return { ok: r.ok && j.ok && !!j.appointment?.id && j.appointment.status === "booked", detail: `id=${j.appointment?.id}` };
  });
  await check("lookup appointment by mobile+today", async () => {
    const r = await fetch(`${BASE}/api/appointments?mobile=9876501234&date=${APT.date}&name=${encodeURIComponent(APT.name)}`);
    const j = await r.json();
    return { ok: r.ok && j.ok && j.appointments.some((a) => a.id === globalThis.__aptId), detail: `found=${j.appointments?.length}` };
  });
  await check("lookup without the booked name is refused", async () => {
    const r = await fetch(`${BASE}/api/appointments?mobile=9876501234&date=${APT.date}`);
    return { ok: r.status === 400, detail: `status=${r.status}` };
  });
  await check("lookup with a wrong name reveals nothing", async () => {
    const r = await fetch(
      `${BASE}/api/appointments?mobile=9876501234&date=${APT.date}&name=${encodeURIComponent("Some Other Person")}`
    );
    const j = await r.json();
    return { ok: r.ok && j.ok && j.appointments.length === 0, detail: `found=${j.appointments?.length}` };
  });
  await check("appointment check-in", async () => {
    const r = await fetch(`${BASE}/api/appointments/checkin`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: globalThis.__aptId, name: APT.name }),
    });
    const j = await r.json();
    return { ok: r.ok && j.ok && j.appointment.status === "checked-in", detail: `status=${j.appointment?.status}` };
  });

  // ---------------------------------------------------------------- admin export manifest + backups
  await check("export manifest sha256 matches payload", async () => {
    const r = await fetch(`${BASE}/api/admin/export?format=json`, { headers: { Cookie: admin.cookie } });
    const j = await r.json();
    const digest = sha256Hex(JSON.stringify(j.encounters));
    return {
      ok: j.manifest?.digest === digest && typeof j.backup?.sha256 === "string",
      detail: `encounters=${j.encounters?.length} backup=${j.backup?.filename ?? j.backup?.sha256 ? "✓" : "?"}`,
    };
  });
  await check("backups list (admin)", async () => {
    const r = await fetch(`${BASE}/api/admin/backups`, { headers: { Cookie: admin.cookie } });
    const j = await r.json();
    return { ok: r.ok && j.ok && Array.isArray(j.backups), detail: `count=${j.backups?.length}` };
  });
  await check("backups forbidden to doctor", async () => {
    const r = await fetch(`${BASE}/api/admin/backups`, { headers: { Cookie: doc.cookie } });
    return { ok: r.status === 403, detail: `status=${r.status}` };
  });

  // ---------------------------------------------------------------- CSRF guard
  await check("CSRF: forged cross-site Origin → 403", async () => {
    const r = await fetch(`${BASE}/api/encounters`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
      body: JSON.stringify(enc),
    });
    return { ok: r.status === 403, detail: `status=${r.status}` };
  });
  await check("CSRF: no Origin (curl/node) is allowed", async () => {
    const r = await fetch(`${BASE}/api/encounters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...enc, encounterId: "smoke3-noorigin-" + Date.now() }),
    });
    const j = await r.json();
    globalThis.__noOriginId = j.encounter?.encounterId ?? "";
    return { ok: r.ok, detail: `status=${r.status}` };
  });

  // ---------------------------------------------------------------- cleanup
  await fetch(`${BASE}/api/encounters/${ENC_ID}`, { method: "DELETE", headers: { Cookie: doc.cookie } }).catch(() => {});
  if (globalThis.__noOriginId) {
    await fetch(`${BASE}/api/encounters/${globalThis.__noOriginId}`, { method: "DELETE", headers: { Cookie: doc.cookie } }).catch(() => {});
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error("PROBE ERROR:", e);
  process.exit(1);
});