import { NextResponse } from "next/server";
import {
  listEncounters,
  getEncounter,
  recordAuditServer,
  getQueueState,
  setCurrentCall,
  clearCurrentCall,
} from "@/lib/server/db";
import { currentUser } from "@/lib/server/auth";
import { queueCallSchema, safeParse } from "@/lib/validation";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";
import { notifyPatient } from "@/lib/server/notify";
import { csrfGuard } from "@/lib/server/csrf";
import { bodyTooLarge, payloadTooLarge } from "@/lib/server/bodyLimit";
import { severityOfRedFlags, severityRank, waitMinutes, etaMinutes, smoothedConsultMinutes, type ConsultSample } from "@/lib/queue";

export const runtime = "nodejs";

type PublicQueueRow = {
  encounterId: string;
  token: string;
  department: string;
  enteredAt: string;
  age: number;
  sex: string;
  severity: "high" | "medium" | "normal";
  urgencyRank: number;
  waitingMin: number;
  /** First name + initial — the display shows no more PHI than necessary. */
  nameInitial: string;
  status: string;
  /** Kiosk UI language for call-outs in the patient's own language. */
  lang: string;
  voiceCode: string;
};

/** Public read feed for the waiting-room display — sanitised, PHI-minimised. */
export async function GET(req: Request) {
  if (!rateLimit(routeRateLimitKey(req), 60, 60_000)) return NextResponse.json({ ok: false, error: "Rate limit" }, { status: 429 });
  const [encounters, state] = await Promise.all([listEncounters(), getQueueState()]);

  // EWMA-smoothed actual consult duration per department (smart wait-time).
  const deptSamples: Record<string, ConsultSample[]> = {};
  for (const e of encounters) {
    if (e.status === "confirmed") {
      (deptSamples[e.patient.department] ??= []).push({ enteredAt: e.enteredAt, confirmedAt: e.updatedAt });
    }
  }
  const deptAvg: Record<string, number> = {};
  for (const [dept, samples] of Object.entries(deptSamples)) {
    deptAvg[dept] = smoothedConsultMinutes(samples);
  }

  const waiting = encounters
    .filter((e) => e.status === "pending" || e.status === "triage")
    .map<PublicQueueRow>((e) => {
      const severity = severityOfRedFlags(e.redFlags);
      return {
        encounterId: e.encounterId,
        token: e.token ?? e.encounterId.slice(0, 8).toUpperCase(),
        department: e.patient.department,
        enteredAt: e.enteredAt,
        age: e.patient.age,
        sex: e.patient.sex,
        severity,
        urgencyRank: severityRank(severity),
        waitingMin: waitMinutes(e.enteredAt),
        nameInitial: `${e.history?.name ?? e.patient.name ?? ""}`.slice(0, 1).toUpperCase(),
        status: e.status,
        lang: e.lang ?? "hi",
        voiceCode: e.voiceCode ?? "hi-IN",
      };
    })
    .sort((a, b) => b.urgencyRank - a.urgencyRank || a.enteredAt.localeCompare(b.enteredAt));

  const current = state.currentCall;
  // The called patient may already have left "waiting" (seen/confirmed), so
  // resolve their language from the encounter itself for the call-out.
  const calledEncounter = current ? await getEncounter(current.encounterId) : null;
  const currentRow = current
    ? waiting.find((r) => r.encounterId === current.encounterId) ?? {
        encounterId: current.encounterId,
        token: current.token,
        department: calledEncounter?.patient.department ?? "",
        enteredAt: current.at,
        age: 0,
        sex: "",
        severity: "normal" as const,
        urgencyRank: 1,
        waitingMin: 0,
        nameInitial: "",
        status: "calling",
        lang: calledEncounter?.lang ?? "hi",
        voiceCode: calledEncounter?.voiceCode ?? "hi-IN",
      }
    : null;

  const withEta = waiting.map((r, i) => ({
    ...r,
    etaMin: etaMinutes(i + 1, deptAvg[r.department] ?? 7),
  }));
  return NextResponse.json({
    ok: true,
    now: new Date().toISOString(),
    currentCall: current,
    currentRow,
    queue: withEta,
    recentCalls: state.recentCalls,
  });
}

/** Authenticated: "Call next" a token or clear the current call. */
export async function POST(req: Request) {
  const csrf = csrfGuard(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, error: csrf.error }, { status: 403 });
  if (bodyTooLarge(req, 64 * 1024)) return payloadTooLarge();

  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const parsed = safeParse(queueCallSchema, body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  if (parsed.data.action === "clear") {
    await clearCurrentCall();
    return NextResponse.json({ ok: true });
  }

  const encounter = await getEncounter(parsed.data.encounterId);
  if (!encounter) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const state = await setCurrentCall(encounter, user.username);
  await recordAuditServer(encounter.encounterId, "called_next", `Token ${state.currentCall?.token} called by ${user.username}`, user.username);

  if (parsed.data.notify !== false && encounter.patient?.mobile) {
    await notifyPatient({
      mobile: encounter.patient.mobile,
      template: "you_are_called",
      vars: { token: state.currentCall?.token ?? encounter.token ?? encounter.encounterId },
    });
  }

  return NextResponse.json({ ok: true, currentCall: state.currentCall });
}