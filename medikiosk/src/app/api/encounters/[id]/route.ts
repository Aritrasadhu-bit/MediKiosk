import { NextResponse } from "next/server";
import { getEncounter, getEncounterForStaffOrBreakGlass, patchEncounter, deleteEncounter, recordAuditServer } from "@/lib/server/db";
import { currentUser, type SessionUser } from "@/lib/server/auth";
import { patchEncounterSchema, safeParse } from "@/lib/validation";
import { csrfGuard } from "@/lib/server/csrf";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";
import { log } from "@/lib/server/log";
import { canStaffView } from "@/lib/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Authenticated staff reads/writes: bounded per client like every other route. */
function staffRateLimit(req: Request) {
  if (!rateLimit(routeRateLimitKey(req), 60, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests. Try again shortly." }, { status: 429 });
  }
  return null;
}

export async function GET(req: Request, ctx: Ctx) {
  const limited = staffRateLimit(req);
  if (limited) return limited;
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  const { id } = await ctx.params;
  const enc = await getEncounter(id);
  if (!enc) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  // Consent enforcement: a record whose clinical-care consent is revoked is
  // withheld from clinician reads rather than silently returned — unless a
  // live break-glass activation covers it (resuscitation exception). Override
  // reads are audit-logged as overrides, never as routine reads.
  if (!canStaffView(enc)) {
    const emergency = await getEncounterForStaffOrBreakGlass(id);
    if (!emergency?.viaBreakGlass) {
      return NextResponse.json(
        {
          ok: false,
          error: "Consent withdrawn — the patient has revoked clinical-care consent for this record.",
          code: "consent_revoked",
        },
        { status: 403 }
      );
    }
    await recordAuditServer(
      id,
      "break_glass_override",
      `Emergency read by ${user.username} (${user.role}) under active break-glass`,
      user.username
    );
    return NextResponse.json({ ok: true, encounter: emergency.encounter, viaBreakGlass: true });
  }
  return NextResponse.json({ ok: true, encounter: enc });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const csrf = csrfGuard(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, error: csrf.error }, { status: 403 });
  const limited = staffRateLimit(req);
  if (limited) return limited;

  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  const { id } = await ctx.params;
  // `history`/`summary` are open strings up to 200KB — reject on the declared
  // length before JSON.parse allocates.
  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (declaredLength > 4 * 1024 * 1024) {
    return NextResponse.json({ ok: false, error: "Payload too large." }, { status: 413 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = safeParse(patchEncounterSchema, body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  const existing = await getEncounter(id);
  if (!existing) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  // Block all mutation of a record the patient has withdrawn consent for,
  // including status changes — the consent gate must not be bypassable by
  // writing to a record the read path already refuses to return.
  if (!canStaffView(existing)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Consent withdrawn — this record is read-only until the patient re-grants clinical-care consent.",
        code: "consent_revoked",
      },
      { status: 403 }
    );
  }

  const patch: Record<string, unknown> = {};
  for (const key of [
    "status",
    "summary",
    "doctorNote",
    "doctorDiagnosis",
    "prescription",
    "history",
    "audit",
    "updatedAt",
    "dispensedAt",
  ] as const) {
    if (key in parsed.data) patch[key] = parsed.data[key];
  }

  // Role matrix: clinical fields are doctor/admin-only; dispensing is
  // pharmacist/admin-only. Status/history/vitals/summary stay open to all staff.
  if (["doctorNote", "doctorDiagnosis", "prescription"].some((k) => k in patch) && !["doctor", "admin"].includes(user.role)) {
    return NextResponse.json({ ok: false, error: "Only doctors and admins can write clinical notes or prescriptions." }, { status: 403 });
  }
  if ("dispensedAt" in patch && !["pharmacist", "admin"].includes(user.role)) {
    return NextResponse.json({ ok: false, error: "Only pharmacists and admins can mark a prescription dispensed." }, { status: 403 });
  }
  // Nurse triage: merge vitals into the patient object without clobbering fields.
  if (parsed.data.patient?.vitals) {
    patch.patient = {
      ...existing.patient,
      vitals: { ...(existing.patient.vitals ?? {}), ...parsed.data.patient.vitals },
    };
  }
  // Merge audit arrays rather than replacing.
  if (Array.isArray(patch.audit) && patch.audit.length) {
    patch.audit = [...(existing.audit ?? []), ...patch.audit];
  }
  const updated = await patchEncounter(id, patch as never);
  if (!updated) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  // Server-authoritative audit with actor identity (Part 3: truthful trail).
  await recordAuditServer(id, "record_edited", `Patched by ${user.username}`, user.username);
  log("info", "encounter", "encounter patched", { id, by: user.username });
  return NextResponse.json({ ok: true, encounter: updated });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const csrf = csrfGuard(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, error: csrf.error }, { status: 403 });
  const limited = staffRateLimit(req);
  if (limited) return limited;

  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  if (!["doctor", "admin"].includes(user.role)) {
    return NextResponse.json({ ok: false, error: "Only doctors and admins can delete encounters." }, { status: 403 });
  }
  const { id } = await ctx.params;
  const deleted = await deleteEncounter(id);
  if (!deleted) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  log("info", "encounter", "encounter deleted", { id, by: user.username });
  return NextResponse.json({ ok: true });
}

export type { SessionUser };