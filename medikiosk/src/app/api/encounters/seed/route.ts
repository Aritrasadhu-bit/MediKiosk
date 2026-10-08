import { NextResponse } from "next/server";
import { seedEncounters } from "@/lib/server/db";
import { currentUser } from "@/lib/server/auth";
import { buildDemoPatients } from "@/lib/demoData";
import { csrfGuard } from "@/lib/server/csrf";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!rateLimit(routeRateLimitKey(req), 10, 60_000)) {
    return NextResponse.json({ ok: false, error: "Rate limit" }, { status: 429 });
  }
  const csrf = csrfGuard(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, error: csrf.error }, { status: 403 });

  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  // Seeding injects fabricated patients into the live clinical store, the OPD
  // register and the surveillance feed. Any signed-in nurse or pharmacist could
  // do that; /api/admin/reset already restricts this shape of action to admin.
  if (user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Admins only." }, { status: 403 });
  }
  const added = await seedEncounters(buildDemoPatients());
  return NextResponse.json({ ok: true, added });
}