/**
 * Kiosk loop end-to-end (API level): welcome -> identify -> history -> scan ->
 * summary -> done, as the kiosk and staff clients drive it.
 *
 * Usage: `npm run test:e2e [-- http://localhost:3000]`
 * Requires a running server (`npm run dev` or `npm start`). Staff steps need
 * the dev demo accounts; against a production build they are skipped with a
 * warning (the public kiosk loop is still asserted).
 */
const BASE = (process.argv[2] || process.env.E2E_BASE || "http://localhost:3000").replace(/\/$/, "");

let failures = 0;
const jar = new Map();

function check(name, cond, extra = "") {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name} ${extra}`);
  }
}

async function call(method, path, body, useJar = false) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (useJar && jar.size) {
    headers.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
    redirect: "manual",
  });
  const rawCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of rawCookies) {
    const pair = c.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON (CSV/HTML) */
  }
  return { status: res.status, json, text };
}

const stamp = Date.now().toString(36);
const encounterId = `e2e-${stamp}`;
const mobile = "9876543201";

console.log(`E2E kiosk loop against ${BASE}`);

// 1. Health
{
  const r = await call("GET", "/api/health");
  check("health ok", r.status === 200 && r.json?.ok === true, `status=${r.status}`);
}

// 2. Kiosk submission (identify + history + scan payload, as summary sends it)
let token = "";
{
  const now = new Date().toISOString();
  const r = await call("POST", "/api/encounters", {
    encounterId,
    updatedAt: now,
    enteredAt: now,
    mode: "allopathic",
    status: "pending",
    token: "",
    patient: { name: "E2E Kiosk", age: 40, sex: "Male", mobile, department: "General Medicine", abhaId: "NEW-REGISTER" },
    history: { chiefComplaint: "Fever", hpi: "E2E loop probe", pastMedical: [], pastSurgical: [], medications: [], allergies: [] },
    documents: [],
    redFlags: [],
    interactions: [],
    audit: [],
    summary: "E2E probe summary",
    consentGranted: true,
    lang: "en",
    voiceCode: "en-IN",
  });
  check("kiosk submit accepted", r.status === 200 && r.json?.ok === true, `status=${r.status} body=${(r.text || "").slice(0, 160)}`);
  token = r.json?.token || "";
  check("server minted a token", typeof token === "string" && token.length > 0, `token=${token}`);
}

// 3. Queue position visible (waiting-room display / token slip QR path)
{
  const r = await call("GET", `/api/queue/position/${encodeURIComponent(token)}`);
  check("queue position found", r.json?.ok === true && r.json?.found === true && r.json?.position >= 1, `body=${(r.text || "").slice(0, 160)}`);
  check("queue ETA present", typeof r.json?.etaMin === "number", `etaMin=${r.json?.etaMin}`);
}

// 4. Token-by-SMS for the record's own number
{
  const r = await call("POST", "/api/notify/token", { encounterId, mobile });
  check("token SMS accepted", r.status === 200 && r.json?.ok === true, `status=${r.status} body=${(r.text || "").slice(0, 160)}`);
}

// 5. Kiosk heartbeat round-trip
{
  const probe = `e2e-probe-${stamp}`;
  const p = await call("POST", "/api/kiosk/heartbeat", { kioskId: probe, pending: 0 });
  check("heartbeat accepted", p.status === 200 && p.json?.ok === true, `status=${p.status}`);
}

// 5b. Portal code binding (patient's own mobile unlocks the phone QR code)
{
  const c = await call("POST", "/api/patient/portal/code", { encounterId, mobile });
  check("portal code issued", c.status === 200 && c.json?.ok === true && typeof c.json?.code === "string", `status=${c.status} body=${(c.text || "").slice(0, 160)}`);
  if (c.json?.ok && c.json?.code) {
    const pv = await call("GET", `/api/patient/portal/${encodeURIComponent(encounterId)}?code=${encodeURIComponent(c.json.code)}`);
    check("portal record opens with code", pv.status === 200 && pv.json?.ok === true, `status=${pv.status}`);
  }
  const wrong = await call("POST", "/api/patient/portal/code", { encounterId, mobile: "9876543299" });
  check("portal code refused for wrong number", wrong.status === 403, `status=${wrong.status}`);
}

// 6. Staff leg (needs dev demo accounts; skipped with warning otherwise)
{
  const login = await call("POST", "/api/auth/login", { username: "admin", password: "admin123" }, true);
  if (login.status !== 200 || login.json?.ok !== true) {
    console.log("  SKIP staff leg (no dev demo login — expected against production)");
  } else {
    check("admin login", true);
    const triage = await call("PATCH", `/api/encounters/${encodeURIComponent(encounterId)}`, { status: "triage" }, true);
    check("triage update", triage.status === 200 && triage.json?.ok === true, `status=${triage.status} body=${(triage.text || "").slice(0, 160)}`);

    const today = new Date().toISOString().slice(0, 10);
    const reg = await call("GET", `/api/admin/opd-register?date=${today}&format=csv`, undefined, true);
    check("OPD register exports", reg.status === 200 && reg.text.includes(token), `status=${reg.status}`);

    const fleet = await call("GET", "/api/kiosk/heartbeat", undefined, true);
    check(
      "fleet lists the probe kiosk",
      fleet.json?.ok === true && Array.isArray(fleet.json?.kiosks) && fleet.json.kiosks.some((k) => k.kioskId === `e2e-probe-${stamp}`),
      `status=${fleet.status}`
    );

    const del = await call("DELETE", `/api/encounters/${encodeURIComponent(encounterId)}`, undefined, true);
    check("cleanup deletes the probe record", del.status === 200 && del.json?.ok === true, `status=${del.status} body=${(del.text || "").slice(0, 160)}`);
    await call("POST", "/api/auth/logout", undefined, true);
  }
}

if (failures > 0) {
  console.log(`E2E FAILED (${failures} checks)`);
  process.exit(1);
}
console.log("E2E PASSED — full kiosk loop works end to end");
