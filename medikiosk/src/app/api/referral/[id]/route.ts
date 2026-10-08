import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { getEncounterForStaff, getEncounterForStaffOrBreakGlass, recordAuditServer } from "@/lib/server/db";
import { buildReferralSlip, referralToText } from "@/lib/referral";
import { escalationPolicy } from "@/lib/escalation";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Referral slip (Batch B, U7).
 *
 * GET  /api/referral/[id]?format=html → printable HTML slip (opens the print dialog)
 * GET  /api/referral/[id]?format=text  → compact ESC/POS-friendly plain text
 *
 * The slip is auto-built when the escalation engine flags ER; staff can also
 * request one on demand (e.g. when handing a patient to a higher facility).
 */
export async function GET(req: Request, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  if (!["doctor", "admin"].includes(user.role)) {
    return NextResponse.json({ ok: false, error: "Doctors and admins only." }, { status: 403 });
  }

  const { id } = await ctx.params;
  // Must be the consent-aware read, not the raw one. `getEncounter` bypasses
  // `canStaffView`, so this route handed a doctor the ABHA, mobile, vitals,
  // MEWS score and clinical summary of any record whose `clinical_care`
  // consent the patient had revoked — precisely what the portal consent
  // toggle exists to prevent. Same gate as GET /api/encounters/[id].
  const enc = await getEncounterForStaff(id);
  let slip;
  if (!enc) {
    // Resuscitation exception: a live break-glass activation opens revoked
    // records for the handoff, audited as an override.
    const emergency = await getEncounterForStaffOrBreakGlass(id);
    if (!emergency?.viaBreakGlass) {
      return NextResponse.json(
        { ok: false, error: "Encounter not found or consent withdrawn.", code: "not_available" },
        { status: 404 }
      );
    }
    await recordAuditServer(
      id,
      "break_glass_override",
      `Emergency referral read by ${user.username} (${user.role}) under active break-glass`,
      user.username
    );
    slip = emergency.encounter.referral ?? buildReferralSlip(emergency.encounter, escalationPolicy(emergency.encounter));
  } else {
    slip = enc.referral ?? buildReferralSlip(enc, escalationPolicy(enc));
  }
  const format = new URL(req.url).searchParams.get("format") || "html";

  if (format === "text") {
    return new Response(referralToText(slip), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const vitals = slip.vitals ?? {};
  const esc = (v: unknown): string =>
    String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Referral — ${esc(slip.patientName)}</title>
<style>
  body { font-family: ui-monospace, monospace; max-width: 640px; margin: 24px auto; font-size: 14px; color: #111827; }
  .head { border-bottom: 3px solid #b91c1c; padding-bottom: 12px; margin-bottom: 16px; }
  h1 { margin: 0; font-size: 20px; color: #b91c1c; }
  .sub { color: #6b7280; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; }
  td:first-child { width: 40%; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; }
  .box { border: 2px solid #b91c1c; border-radius: 8px; padding: 12px; margin: 12px 0; background: #fef2f2; }
  .print-btn { position: fixed; top: 12px; right: 12px; background: #b91c1c; color: white; border: 0; border-radius: 8px; padding: 10px 16px; font-size: 14px; cursor: pointer; }
  @media print { .print-btn { display: none; } body { margin: 0; } }
</style></head><body>
  <button class="print-btn" onclick="window.print()">🖨 Print</button>
  <div class="head">
    <h1>⚕️ MediKiosk — Referral Slip</h1>
    <div class="sub">Ref ${esc(slip.id)} · issued ${esc(new Date(slip.issuedAt).toLocaleString("en-IN"))}</div>
  </div>
  <table>
    <tr><td>Patient</td><td><strong>${esc(slip.patientName)}</strong>, ${esc(slip.patientAge)} yrs, ${esc(slip.patientSex)}</td></tr>
    ${slip.abhaId ? `<tr><td>ABHA</td><td>${esc(slip.abhaId)}</td></tr>` : ""}
    ${slip.mobile ? `<tr><td>Mobile</td><td>${esc(slip.mobile)}</td></tr>` : ""}
    <tr><td>From</td><td>${esc(slip.fromDepartment)}</td></tr>
    <tr><td>Refer to</td><td><strong>${esc(slip.to)}</strong></td></tr>
    <tr><td>Reason</td><td>${esc(slip.reason)}</td></tr>
    ${slip.score !== undefined ? `<tr><td>MEWS score</td><td><strong>${esc(slip.score)}</strong></td></tr>` : ""}
    <tr><td>Vitals</td><td>${vitals.systolic ? `BP ${esc(vitals.systolic)}/${esc(vitals.diastolic ?? "—")}` : "BP —"} · Pulse ${esc(vitals.pulse ?? "—")} · SpO2 ${esc(vitals.spo2 ?? "—")}% · Temp ${esc(vitals.temperature ?? "—")}°C</td></tr>
    <tr><td>Decision reasons</td><td>${esc(slip.reasons.join("; ")) || "—"}</td></tr>
  </table>
  ${slip.summary ? `<div class="box"><strong>Clinical summary</strong><p style="margin:6px 0 0">${esc(slip.summary)}</p></div>` : ""}
  <p style="color:#6b7280; font-size:12px">This slip travels with the patient. Please review the clinical summary and vitals at the receiving facility. Generated by MediKiosk (SIH-26047).</p>
</body></html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}