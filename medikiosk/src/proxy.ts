import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { sessionCookieName } from "@/lib/cookieName";
import { sessionSecret } from "@/lib/server/secret";

/**
 * Proxy (Next 16: renamed from middleware) — lightweight page-level protection
 * and role-based routing for staff dashboards. The canonical auth check still
 * happens inside each route handler; this redirects unauthenticated page loads
 * to /login and redirects unauthorized roles to their respective dashboard.
 */

const SESSION_COOKIE = sessionCookieName();

const ROUTE_PERMISSIONS: Record<string, string[]> = {
  "/admin": ["admin"],
  "/physician": ["doctor", "admin"],
  "/triage": ["nurse", "doctor", "admin"],
  "/pharmacy": ["pharmacist", "admin"],
  "/camp": ["doctor", "nurse", "admin"],
};

type Payload = { sub?: string; role?: string; exp?: number };

function getRoleHome(role?: string): string {
  switch (role) {
    case "admin":
      return "/admin";
    case "doctor":
      return "/physician";
    case "nurse":
      return "/triage";
    case "pharmacist":
      return "/pharmacy";
    default:
      return "/login";
  }
}

function getPayload(token: string | undefined): Payload | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Payload;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!["doctor", "nurse", "pharmacist", "admin"].includes(payload.role ?? "")) return null;
    return payload;
  } catch {
    return null;
  }
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const matchedRoute = Object.keys(ROUTE_PERMISSIONS).find(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
  if (!matchedRoute) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const payload = getPayload(token);
  if (!payload) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const allowedRoles = ROUTE_PERMISSIONS[matchedRoute] ?? [];
  if (payload.role && allowedRoles.includes(payload.role)) {
    return NextResponse.next();
  }

  // Signed in with another valid role — send to the user's appropriate workspace
  const url = request.nextUrl.clone();
  url.pathname = getRoleHome(payload.role);
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/physician/:path*", "/triage/:path*", "/pharmacy/:path*", "/admin/:path*", "/camp/:path*"],
};