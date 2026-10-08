import { NextResponse } from "next/server";
import { getEncounter, listEncounters } from "@/lib/server/db";
import { validPortalCode } from "@/lib/server/portal";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";
import { queuePositionByToken } from "@/lib/queue";
import { canStaffView } from "@/lib/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Public patient portal record view. Access is gated by an unguessable HMAC
 * code (from the printed QR slip), so /p/{encounterId} can't be enumerated.
 * Returns a PHI-minimised view of the patient's OWN record.
 */
export async function GET(req: Request, ctx: Ctx) {
  if (!rateLimit(routeRateLimitKey(req), 30, 60_000)) {
    return NextResponse.json({ ok: false, error: "Rate limit" }, { status: 429 });
  }
  const { id } = await ctx.params;
  const code = new URL(req.url).searchParams.get("code");
  if (!validPortalCode(id, code)) {
    return NextResponse.json({ ok: false, error: "Invalid portal access code." }, { status: 403 });
  }
  const enc = await getEncounter(id);
  if (!enc) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const waiting = (await listEncounters()).filter((e) => e.status === "pending" || e.status === "triage");
  const position = queuePositionByToken(waiting, enc.token ?? "");

  return NextResponse.json({
    ok: true,
    record: {
      encounterId: enc.encounterId,
      name: enc.patient.name,
      age: enc.patient.age,
      sex: enc.patient.sex,
      department: enc.patient.department,
      abhaId: enc.patient.abhaId,
      token: enc.token ?? enc.encounterId.slice(0, 8).toUpperCase(),
      status: enc.status,
      enteredAt: enc.enteredAt,
      summary: (enc.summary ?? "").slice(0, 4000),
      vitals: enc.patient.vitals ?? {},
      redFlags: enc.redFlags.map((f) => ({ symptom: f.symptom, severity: f.severity, message: f.message })),
      prescription: enc.prescription ?? null,
      consentGranted: enc.consentGranted,
      consent: enc.consent ?? null,
      // Drives the portal's honest wording: the patient can see whether their
      // record is currently on the clinician's screen.
      visibleToClinicians: canStaffView(enc),
      dispensedAt: enc.dispensedAt ?? null,
      queuePosition: position,
      historySections: {
        chiefComplaint: (enc.history as { chiefComplaint?: string })?.chiefComplaint ?? "",
        hpi: (enc.history as { hpi?: string })?.hpi ?? "",
      },
      mode: enc.mode,
      ayush: enc.history?.ayush ?? null,
    },
  });
}