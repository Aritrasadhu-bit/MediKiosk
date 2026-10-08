import { NextResponse } from "next/server";
import {
  verifyCredentials,
  signToken,
  SESSION_COOKIE,
  registerSession,
  clearLoginFailures,
  registerLoginFailure,
  loginLockedSeconds,
} from "@/lib/server/auth";
import { loginRequestSchema, safeParse } from "@/lib/validation";
import { rateLimit, routeRateLimitKey, clientIp } from "@/lib/server/rateLimit";
import { csrfGuard } from "@/lib/server/csrf";
import { bodyTooLarge, payloadTooLarge } from "@/lib/server/bodyLimit";
import { log } from "@/lib/server/log";

export const runtime = "nodejs";

const SESSION_TTL = 60 * 60 * 8; // 8h

export async function POST(req: Request) {
  if (!rateLimit(routeRateLimitKey(req), 10, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many attempts. Try again shortly." }, { status: 429 });
  }
  const csrf = csrfGuard(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, error: csrf.error }, { status: 403 });
  if (bodyTooLarge(req, 64 * 1024)) return payloadTooLarge();
  const body = await req.json().catch(() => ({}));
  const parsed = safeParse(loginRequestSchema, body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }
  const username = parsed.data.username.toLowerCase();
  const ip = clientIp(req);

  // Per-account lockout keyed by (username, IP) — in addition to the per-IP rate limit.
  const locked = await loginLockedSeconds(username, ip);
  if (locked > 0) {
    return NextResponse.json(
      { ok: false, error: `Account temporarily locked. Try again in ${Math.ceil(locked / 60)} min.` },
      { status: 429 }
    );
  }

  const user = await verifyCredentials(username, parsed.data.password);
  if (!user) {
    await registerLoginFailure(username, ip);
    log("warn", "auth", "failed login", { username });
    return NextResponse.json({ ok: false, error: "Invalid username or password." }, { status: 401 });
  }

  await clearLoginFailures(username, ip);
  const token = signToken(user, SESSION_TTL);
  await registerSession(token, user);
  log("info", "auth", "login", { username: user.username, role: user.role });

  const res = NextResponse.json({ ok: true, user });
  // Secure only when explicitly opted in (never inferred from NODE_ENV) so the
  // built-in http demo still signs in; __Host- (HTTPS) mode forces it anyway.
  const hostPrefix = process.env.MEDIKIOSK_HOST_COOKIE_PREFIX === "1";
  res.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL,
    secure: hostPrefix || process.env.MEDIKIOSK_SECURE_COOKIE === "1",
  });
  return res;
}