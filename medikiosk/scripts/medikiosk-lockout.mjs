/* Lockout probe — run on a FRESH server so the per-IP login rate limit
   (10/min) cannot mask the per-account lockout. Uses a dummy username so no
   real staff account gets locked. 6 login attempts total, well under 10. */
const BASE = process.env.BASE ?? "http://localhost:3000";

async function main() {
  for (let i = 0; i < 30; i++) {
    try {
      await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  let last = null;
  for (let i = 0; i < 6; i++) {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "lockout-probe-user", password: "nope" }),
    });
    const j = await r.json().catch(() => ({}));
    last = { status: r.status, error: j.error };
  }
  const locked = last.status === 429 && /lock/i.test(last.error ?? "");
  console.log(`${locked ? "PASS" : "FAIL"} account lockout after 5 bad logins — 6th attempt status=${last.status} "${last.error}"`);
  process.exit(locked ? 0 : 1);
}
main().catch((e) => {
  console.error("PROBE ERROR:", e);
  process.exit(1);
});