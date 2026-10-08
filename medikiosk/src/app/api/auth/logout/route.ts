import { NextResponse } from "next/server";
import { SESSION_COOKIE, revokeUserSessions, verifyToken } from "@/lib/server/auth";
import { csrfGuard } from "@/lib/server/csrf";
import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const csrf = csrfGuard(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, error: csrf.error }, { status: 403 });
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    // Server-side revocation covering EVERY session of this user, not just the
    // presented token: on a shared terminal, sign-out must end the user's
    // sessions on all stations, or a forgotten tab stays authenticated.
    const user = verifyToken(token);
    if (user) await revokeUserSessions(user.username);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set({ name: SESSION_COOKIE, value: "", httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}