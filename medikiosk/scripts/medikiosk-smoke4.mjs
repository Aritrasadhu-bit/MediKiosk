/* Phase-4 smoke: Batch C — first-run setup surface, capability config, PWA
   manifest + offline page, 80mm thermal token slip, and the living-hospital
   demo (start → arrivals → auto-advance → stop). Adds ONE admin login. */
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

  // ---------------------------------------------------------------- first-run setup surface (P5)
  await check("setup status endpoint (public)", async () => {
    const r = await fetch(`${BASE}/api/setup/status`, { cache: "no-store" });
    const j = await r.json();
    return { ok: r.ok && j.ok === true && typeof j.configured === "boolean" && !!j.hospitalName, detail: `configured=${j.configured} hospital=${j.hospitalName}` };
  });

  await check("config capabilities + hospital (P5)", async () => {
    const j = await fetch(`${BASE}/api/config`, { cache: "no-store" }).then((r) => r.json());
    const c = j.capabilities ?? {};
    return {
      ok: j.ok && c.livingDemo === true && c.thermalTokenSlip === true && c.pictogramRx === true && c.offlinePwa === true && typeof c.firstRunSetup === "boolean" && !!j.hospital?.name && Array.isArray(j.hospital?.departments),
      detail: `ver=${j.version} firstRunSetup=${c.firstRunSetup} depts=${j.hospital?.departments?.length}`,
    };
  });

  // ---------------------------------------------------------------- PWA hardening (P6)
  await check("web app manifest served at /manifest.webmanifest (P6)", async () => {
    const r = await fetch(`${BASE}/manifest.webmanifest`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok && typeof j.name === "string" && Array.isArray(j.icons) && j.icons.length >= 2, detail: `display=${j.display} icons=${j.icons?.length}` };
  });

  await check("offline fallback page reachable (P6)", async () => {
    const r = await fetch(`${BASE}/offline.html`);
    const text = await r.text();
    return { ok: r.ok && text.includes("offline"), detail: `bytes=${text.length}` };
  });

  // ---------------------------------------------------------------- thermal token slip (P4)
  // Resolve a real token from a live record (tokens are derived deterministically
  // from encounter ids), then verify the 80mm slip renders it.
  const admin = await login("admin", "admin123");
  await check("admin login for demo control", async () => ({
    ok: admin.r.ok && admin.j.ok && !!admin.cookie,
    detail: admin.j.ok ? `role=${admin.j.user?.role}` : (admin.j.error ?? "login failed"),
  }));

  await check("80mm thermal slip renders for a live token (P4)", async () => {
    const j = await fetch(`${BASE}/api/encounters`, { headers: { cookie: admin.cookie } }).then((r) => r.json());
    const withToken = (j.encounters ?? []).find((e) => e?.token);
    if (!withToken) return { ok: false, detail: "no encounter with a token found" };
    const r = await fetch(`${BASE}/slip/${encodeURIComponent(withToken.token)}`);
    const html = await r.text();
    return { ok: r.ok && html.includes(withToken.token) && html.includes("Token"), detail: `token=${withToken.token} bytes=${html.length}` };
  });

  await check("live demo start (interval 2s)", async () => {
    const r = await fetch(`${BASE}/api/demo/live`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: admin.cookie },
      body: JSON.stringify({ intervalSeconds: 2 }),
    });
    const j = await r.json();
    return { ok: r.ok && j.ok && j.status?.running === true, detail: `interval=${j.status?.intervalSeconds}s` };
  });

  await sleep(6500);

  await check("live demo: patients arriving + auto-advancing", async () => {
    const j = await fetch(`${BASE}/api/demo/live`, { headers: { cookie: admin.cookie } }).then((r) => r.json());
    const s = j.status ?? {};
    return {
      ok: s.running === true && s.spawned >= 3 && s.demoEncounters >= 3,
      detail: `spawned=${s.spawned} progressed=${s.progressed} demoRecords=${s.demoEncounters}`,
    };
  });

  await check("live demo stop", async () => {
    const r = await fetch(`${BASE}/api/demo/live`, { method: "DELETE", headers: { cookie: admin.cookie } });
    const j = await r.json();
    return { ok: r.ok && j.ok && j.status?.running === false, detail: `remaining=${j.status?.demoEncounters}` };
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });