"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useSession } from "@/lib/useSession";
import { useT } from "@/lib/useT";
import { speak } from "@/lib/speech";
import { tokenCalledSpeech, tokenIssuedSpeech } from "@/lib/i18n";
import { recordAudit } from "@/lib/store";
import { subscribeCalls, type CallMessage } from "@/lib/callChannel";
import SyncBanner from "@/components/SyncBanner";
import { Icon } from "@/components/Icon";
import type { PublicHisDelivery } from "@/lib/server/his";

export default function DonePage() {
  const { session, reset } = useSession();
  const { t: tr } = useT();
  const router = useRouter();
  const [hisDelivery, setHisDelivery] = useState<PublicHisDelivery | null>(null);
  const [called, setCalled] = useState(false);
  const [lastCall, setLastCall] = useState<CallMessage | null>(null);
  const [pickedFeedback, setPickedFeedback] = useState<string | null>(null);
  // Printer-failure fallback: a dead printer must degrade to QR + SMS, and
  // the miss is audited so staff know the paper slip never came out.
  const [printFailed, setPrintFailed] = useState(false);
  // Live queue position for the ETA readout (# patients ahead, ~minutes).
  const [queueInfo, setQueueInfo] = useState<{ position: number; etaMin: number } | null>(null);
  // Token-by-SMS state machine: idle → sending → sent / failed / logged-only.
  const [smsState, setSmsState] = useState<"idle" | "sending" | "sent" | "failed" | "logged">("idle");

  useEffect(() => {
    if (!session.token) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/queue/position/${encodeURIComponent(session.token as string)}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (!alive) return;
        if (json?.found) setQueueInfo({ position: json.position, etaMin: json.etaMin });
        else setQueueInfo(null);
      } catch {
        /* offline — keep last known position */
      }
    };
    load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [session.token]);

  const sendTokenSms = async () => {
    if (!session.encounterId || !session.patient?.mobile || smsState === "sending") return;
    setSmsState("sending");
    try {
      const res = await fetch("/api/notify/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encounterId: session.encounterId, mobile: session.patient.mobile }),
      });
      const json = await res.json().catch(() => ({}));
      if (json.ok && json.sent) setSmsState("sent");
      else if (json.ok) setSmsState("logged");
      else setSmsState("failed");
    } catch {
      setSmsState("failed");
    }
  };
  // No fake token: if state was lost (refresh after eviction) guard back to
  // start instead of rendering/scanning a bogus TK-0000.
  useEffect(() => {
    if (!session.encounterId || !session.token) {
      router.replace("/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.encounterId, session.token]);
  const token = session.token ?? "";

  // Poll the real HIS delivery receipt. The old build flipped a green
  // "Pushed to Hospital Information System" dot on a timer, with no push
  // anywhere in the codebase — it told patients their PHI had been shared when
  // it had not. Now the dot reflects the server's actual delivery record.
  useEffect(() => {
    if (!session.encounterId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/his/${session.encounterId}`, { cache: "no-store" });
        const json = await res.json();
        if (!alive) return;
        if (json?.delivery) {
          setHisDelivery(json.delivery);
          // A definitive outcome (delivered or failed) needs no further polling.
          if (["delivered", "failed", "no_consent"].includes(json.delivery.state)) return;
        }
      } catch {
        // Offline — leave the state as "checking" and retry.
      }
      if (alive) timer = setTimeout(poll, 4000);
    };
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [session.encounterId]);

  // Live "Call Next" listener — the physician dashboard announces the token.
  useEffect(() => {
    const unsub = subscribeCalls((msg) => {
      if (msg.action !== "call-next") return;
      setLastCall(msg);
      if (session.encounterId && msg.encounterId === session.encounterId) {
        setCalled(true);
        speak(
          tokenCalledSpeech({
            lang: session.language?.code,
            name: session.patient?.name,
            token: session.token,
          }),
          session.language?.voiceCode ?? "hi-IN"
        );
        if (navigator.vibrate) navigator.vibrate([300, 100, 300]);
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.encounterId]);

  /**
   * Spoken confirmation on arrival. The problem statement requires an audio
   * confirmation in the local language, and this page is the last moment the
   * patient is still at the kiosk — it is read once on mount, then the page
   * goes quiet so it does not talk over the waiting-room announcements.
   */
  useEffect(() => {
    if (!session.encounterId) return;
    // Helper-OFF kiosks stay silent on arrival too. The live "your turn"
    // call-out above still sounds — that is the queue working, and muting it
    // would make patients miss their turn.
    if (!session.attendantMode) return;
    const t = window.setTimeout(() => {
      speak(
        tokenIssuedSpeech({
          lang: session.language?.code,
          name: session.patient?.name,
          token: session.token,
        }),
        session.language?.voiceCode ?? "hi-IN"
      );
    }, 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.encounterId, session.attendantMode]);

  const startNew = () => {
    reset();
    router.push("/");
    // Defensive fallback (same rationale as the welcome-page Start): if the
    // client router fails to move, do a real navigation so the kiosk can loop.
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        if (window.location.pathname !== "/") {
          // Hard fallback when the client router is wedged (see above).
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional resilience fallback
          window.location.href = "/";
        }
      }, 1200);
    }
  };

  // Portal QR for the patient's phone: /p/{encounterId}?code=… (code is bound
  // to the mobile on record, fetched below). Anyone's camera can read a
  // waiting-room screen, so the code — never name/ABHA — is the only secret
  // in it, and the portal itself enforces it. Without a verified mobile there
  // is no identity to bind to, so the QR stays the legacy staff payload
  // (token/department/priority, no PHI), which the physician scanner reads.
  const [portalCode, setPortalCode] = useState<string | null>(null);

  useEffect(() => {
    if (!session.encounterId || !session.patient?.mobile || portalCode) return;
    let alive = true;
    fetch("/api/patient/portal/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encounterId: session.encounterId, mobile: session.patient.mobile }),
    })
      .then((r) => r.json())
      .then((json) => {
        if (alive && json?.ok && typeof json.code === "string") setPortalCode(json.code);
      })
      .catch(() => {
        /* offline — legacy QR below */
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.encounterId, session.patient?.mobile]);

  const legacyQrPayload = JSON.stringify({
    token,
    department: session.patient?.department ?? "",
    priority: session.redFlags.some((r) => r.severity === "high") ? "high" : "normal",
  });
  const qrPayload =
    portalCode && session.encounterId && typeof window !== "undefined"
      ? `${window.location.origin}/p/${encodeURIComponent(session.encounterId)}?code=${encodeURIComponent(portalCode)}`
      : legacyQrPayload;

  const abhaLinked = session.consentPurposes?.includes("abha_linking") ?? false;

  // Honest, state-driven wording: the dot only turns green when the server
  // actually confirmed delivery.
  const HIS_TEXT: Record<
    NonNullable<PublicHisDelivery["state"]>,
    { dot: string; label: string }
  > = {
    delivered: { dot: "bg-success", label: "Sent to the hospital information system" },
    failed: {
      dot: "bg-critical",
      label: "Could not send to the hospital system — your record is safe here and staff can retry",
    },
    not_configured: {
      dot: "bg-warning",
      label: "Saved at this kiosk. No hospital system is connected here to receive it yet.",
    },
    no_consent: { dot: "bg-ink-3", label: "Not sent to hospital systems — you did not consent to that" },
    skipped: { dot: "bg-ink-3", label: "Checking hospital system connection…" },
  };
  const hisState = hisDelivery?.state ?? "skipped";
  const { dot: hisDot, label: hisLabel } = HIS_TEXT[hisState];

  if (!session.encounterId || !session.token) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-8">
        <p className="text-[15px] text-ink-2">Session expired — returning to start…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center px-4 py-8">
      <div className="mb-4 w-full max-w-md">
        <SyncBanner />
      </div>
      {called && (
        <div
          role="status"
          className="mb-4 w-full max-w-md rounded-lg border-2 border-success bg-success px-6 py-6 text-center text-white"
        >
          <p className="flex items-center justify-center gap-2 text-sm font-semibold uppercase tracking-[0.2em]">
            <Icon name="bell" size={18} />
            {tr("yourTurn")}
          </p>
          <p className="mt-1 text-lg">आपकी बारी है — कृपया डॉक्टर के कक्ष में जाइए</p>
          <p className="tabular mt-3 text-4xl font-bold tracking-wider" suppressHydrationWarning>
            {token}
          </p>
        </div>
      )}

      <div id="medikiosk-receipt" className="panel w-full max-w-md overflow-hidden p-0">
        <div className="govt-receipt-head">
          <p className="dept">District Health Society · जिला स्वास्थ्य समिति</p>
          <p className="hosp">District Hospital OPD Slip · ओपीडी पर्ची</p>
          <p className="free">FREE SERVICE · निःशुल्क सेवा · Valid today only · सिर्फ आज</p>
        </div>
        <div className="p-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success-subtle text-success">
            <Icon name="check" size={22} />
          </span>
          <h1 className="text-lg font-bold tracking-tight text-ink">{tr("historyRecorded")} ✓</h1>
        </div>
        <p className="prose-clin mt-2 text-[15px]" suppressHydrationWarning>
          {session.patient?.name
            ? `${session.patient.name}, ${tr("recordedMsg")}`
            : tr("recordedMsg").replace(/^\S/, (c) => c.toUpperCase())}
        </p>

        <div className="mt-5 rounded-xl border-2 border-brand-border bg-brand-subtle p-4 text-center">
          <p className="section-label text-brand">{tr("tokenNumber")}</p>
          <p className="token-huge mt-1 text-brand" suppressHydrationWarning>
            {token}
          </p>
          <p className="mt-1.5 text-[14px] text-ink-2">
            {called
              ? `${tr("yourTurn")} — ${tr("seeDoctor")}`
              : tr("waitingArea")}
          </p>
          {queueInfo && !called && (
            <p className="tabular mt-1 text-[14px] font-semibold text-ink" role="status">
              #{queueInfo.position} in queue · ~{queueInfo.etaMin} min wait
            </p>
          )}
          {session.patient?.mobile && (
            <div className="mt-2">
              <button
                type="button"
                onClick={sendTokenSms}
                disabled={smsState === "sending" || smsState === "sent"}
                className="btn btn-secondary btn-sm min-h-[44px]"
              >
                <Icon name="phone" size={14} />
                {smsState === "sent"
                  ? `Token sent to ${session.patient.mobile}`
                  : smsState === "sending"
                    ? "Sending…"
                    : smsState === "logged"
                      ? "Saved — SMS service offline, keep this slip"
                      : smsState === "failed"
                        ? "SMS failed — tap to retry"
                        : `Send token by SMS (${session.patient.mobile})`}
              </button>
            </div>
          )}
          <div className="banner banner-info mt-3 justify-center text-[14px]">
            <Icon name="mapPin" size={16} className="shrink-0" />
            <span><strong>{tr("roomDir")}</strong></span>
          </div>
        </div>

        <div className="mt-5 flex justify-center">
          <div className="rounded-lg border-2 border-line p-3">
            <QRCodeSVG value={qrPayload} size={164} level="M" fgColor="#12161c" includeMargin />
            <p className="mt-2 max-w-[164px] text-center text-[13px] font-medium text-ink-2">
              {portalCode ? tr("scanPhone") : tr("staffScan")}
            </p>
          </div>
        </div>

        <ul className="mt-5 flex flex-col gap-2 text-[14px]">
          {/* ABHA — state is derived from whether the patient consented to
              linking; the build has no live ABDM gateway, so it says "ready"
              rather than claiming a link that was never made. */}
          <li className="flex items-start gap-2 text-ink-2">
            <span
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${abhaLinked ? "bg-success" : "bg-warning"}`}
              aria-hidden="true"
            />
            {abhaLinked ? tr("abhaReady") : tr("abhaPortal")}
          </li>

          {/* HIS/EMR — reflects the server's actual delivery record. */}
          <li className="flex items-start gap-2 text-ink-2">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${hisDot}`} aria-hidden="true" />
            <span>
              {hisLabel}
              {hisDelivery?.state === "delivered" && (
                <span className="tabular ml-1 text-ink-3">
                  ({new Date(hisDelivery.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })})
                </span>
              )}
            </span>
          </li>

          <li className="flex items-start gap-2 text-ink-2">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-ink-3" aria-hidden="true" />
            {tr("slipValidity")}
          </li>
          <li className="flex items-start gap-2 rounded-md bg-sunken px-3 py-2 text-ink-2">
            <Icon name="phone" size={14} className="mt-0.5 shrink-0" />
            {tr("complaintHelp")}
          </li>
          {lastCall && (
            <li className="flex items-start gap-2 rounded-md bg-info-subtle px-3 py-2 text-[13px] text-info">
              <Icon name="bell" size={14} className="mt-px" />
              Now calling: {lastCall.name} ({lastCall.token ?? "token"})
            </li>
          )}
        </ul>

        <div className="mt-5 rounded-xl border border-line bg-sunken p-3 text-center no-print">
          <p className="text-[14px] font-semibold text-ink">{tr("howEasy")}</p>
          <div className="mt-2 flex justify-center gap-2" role="group" aria-label="Feedback">
            {[
              { face: "😊", label: tr("feedbackGood") },
              { face: "😐", label: tr("feedbackOk") },
              { face: "🙁", label: tr("feedbackHard") },
            ].map((f) => (
              <button key={f.label} type="button" aria-pressed={pickedFeedback === f.label} onClick={() => { setPickedFeedback(f.label); try { recordAudit(session.encounterId ?? "", "exported", `Feedback: ${f.label}`); } catch {} }} className={`btn min-h-[56px] flex-1 text-[15px] ${pickedFeedback === f.label ? "btn-primary" : "btn-secondary"}`}>{f.face} {f.label}</button>
            ))}
          </div>
          <p className="mt-1 text-[12px] text-ink-3">Optional voice note at help desk · Kayakalp / NQAS feedback</p>
        </div>

        <div className="kiosk-actionbar no-print mt-5 flex flex-col gap-2 rounded-xl">
          <button type="button"
            onClick={() => {
              try {
                recordAudit(session.encounterId ?? "", "exported", `Receipt printed for token ${token}`);
              } catch {
                /* audit is best-effort */
              }
              try {
                window.print();
              } catch {
                // A missing/blocked printer must not strand the patient: fall
                // back to the QR slip + SMS path below.
                setPrintFailed(true);
              }
            }}
            className="btn btn-secondary kiosk-touch w-full min-h-[56px] text-[16px]"
          >
            <Icon name="printer" size={18} />
            {tr("printSlip")}
          </button>
          {!printFailed ? (
            <button
              type="button"
              onClick={() => {
                try {
                  recordAudit(session.encounterId ?? "", "exported", `Print reported failed for token ${token}`);
                } catch {
                  /* best-effort */
                }
                setPrintFailed(true);
              }}
              className="mx-auto min-h-[44px] px-2 text-[13px] text-ink-3 underline"
            >
              Printer didn&apos;t print? Use QR slip or SMS instead
            </button>
          ) : (
            <div role="status" className="banner banner-warning justify-center text-center text-[14px]">
              <Icon name="alert" size={16} className="shrink-0" />
              <span>
                No paper slip? Your token <strong className="tabular">{token}</strong> is safe —
                staff can scan the QR above, check the queue board, or send it by SMS below.
              </span>
            </div>
          )}
          <a
            href={`/slip/${encodeURIComponent(token)}?eid=${encodeURIComponent(session.encounterId ?? "")}`}
            className="btn btn-secondary kiosk-touch w-full no-underline min-h-[56px] text-[16px]"
          >
            <Icon name="file" size={18} />
            {tr("thermalSlip")}
            <Icon name="arrowRight" size={15} />
          </a>
          <button type="button" onClick={startNew} className="btn btn-primary kiosk-touch w-full min-h-[56px] text-[16px]">
            <Icon name="refresh" size={18} />
            {tr("thankYouNext")}
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}