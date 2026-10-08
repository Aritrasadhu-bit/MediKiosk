/* Phase-5 smoke: Batch D — SQLite engine reporting, queue-state self-heal (R6),
   maintenance-mode write guard (R5), and the backup restore drill (R4).
   Adds ONE admin login and reuses its cookie for every admin call. */
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

  const admin = await login("admin", "admin123");
  await check("admin login for batch-D control", async () => ({
    ok: admin.r.ok && admin.j.ok && !!admin.cookie,
    detail: admin.j.ok ? `role=${admin.j.user?.role}` : (admin.j.error ?? "login failed"),
  }));

  // ---------------------------------------------------------------- storage engine (R1)
  await check("health reports storage engine (json default / sqlite opt-in)", async () => {
    const j = await fetch(`${BASE}/api/health`, { cache: "no-store" }).then((r) => r.json());
    return { ok: j.engine === "json" || j.engine === "sqlite", detail: `engine=${j.engine} persistence=${j.persistence}` };
  });

  // ---------------------------------------------------------------- queue self-heal (R6)
  // Fresh admin reset clears queue-state and seeds 3 pending patients. With no
  // call activity recorded, getQueueState() must derive a synthetic current
  // call from the live queue instead of showing a blank board.
  await check("admin reset (fresh queue state + seeded patients)", async () => {
    const r = await fetch(`${BASE}/api/admin/reset`, { method: "POST", headers: { cookie: admin.cookie } });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok && j.ok && j.seeded >= 1, detail: `seeded=${j.seeded} encounters=${j.encounters}` };
  });

  await check("queue self-heals a synthetic now-serving from waiting patients (R6)", async () => {
    const j = await fetch(`${BASE}/api/health`, { cache: "no-store" }).then((r) => r.json());
    const cc = j.queue?.currentCall;
    return { ok: !!cc && !!cc.token && cc.actor === "self-heal", detail: `current=${cc?.token} actor=${cc?.actor}` };
  });

  // ---------------------------------------------------------------- maintenance mode (R5)
  await check("maintenance on → kiosk camp write rejected 503", async () => {
    const r = await fetch(`${BASE}/api/admin/maintenance`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: admin.cookie },
      body: JSON.stringify({ active: true, reason: "smoke test window" }),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok && j.ok && j.maintenance?.active === true, detail: `reason=${j.maintenance?.reason}` };
  });

  await check("maintenance blocks camp screening write (retryable 503)", async () => {
    const r = await fetch(`${BASE}/api/camp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campId: "smoke-camp", name: "Smoke Test Patient", age: 34, symptoms: "cough", consentGranted: true }),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.status === 503 && j.retryable === true, detail: `status=${r.status} retryable=${j.retryable}` };
  });

  await check("health reflects maintenance mode", async () => {
    const j = await fetch(`${BASE}/api/health`, { cache: "no-store" }).then((r) => r.json());
    return { ok: j.mode === "maintenance" && j.status === "maintenance", detail: `mode=${j.mode}` };
  });

  await check("maintenance off → write accepted again", async () => {
    const r = await fetch(`${BASE}/api/admin/maintenance`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: admin.cookie },
      body: JSON.stringify({ active: false }),
    });
    const j = await r.json().catch(() => ({}));
    const camp = await fetch(`${BASE}/api/camp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campId: "smoke-camp", name: "Smoke Test Patient", age: 34, symptoms: "cough", consentGranted: true }),
    });
    const cj = await camp.json().catch(() => ({}));
    return { ok: r.ok && j.maintenance?.active === false && camp.ok && cj.ok, detail: `accepted=${cj.ok}` };
  });

  // ---------------------------------------------------------------- backup restore drill (R4)
  await check("restore drill: backup → verify SHA-256 → re-import", async () => {
    const r = await fetch(`${BASE}/api/admin/backup-drill`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: admin.cookie },
      body: JSON.stringify({}),
    });
    const j = await r.json().catch(() => ({}));
    return {
      ok: r.ok && j.ok && j.drilled === true && typeof j.restored === "number" && j.restored >= 1 && !!j.backup?.sha256,
      detail: `file=${j.backup?.filename} verified=${j.backup?.verifiedCount} restored=${j.restored} engine=${j.engine}`,
    };
  });

  await check("backups list shows the fresh snapshot + hash", async () => {
    const j = await fetch(`${BASE}/api/admin/backups`, { headers: { cookie: admin.cookie } }).then((r) => r.json());
    const b = j.backups?.[0];
    return { ok: j.ok && Array.isArray(j.backups) && j.backups.length >= 1 && b?.sha256?.length === 64, detail: `count=${j.backups.length} newest=${b?.filename}` };
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });