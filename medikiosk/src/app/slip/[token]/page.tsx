import { notFound } from "next/navigation";
import { getEncounter, getEncounterByToken, listEncounters } from "@/lib/server/db";
import { readSettings } from "@/lib/server/settings";
import { queuePositionByToken } from "@/lib/queue";
import { portalCode } from "@/lib/server/portal";
import { lookupDualCoding } from "@/lib/clinical";
import { QRCodeSVG } from "qrcode.react";
import SlipPrintButton from "../slip-print-button";

/**
 * Printable 80mm thermal token slip (Batch C, P4).
 *
 * Public by design — the token number is the receipt key (same trust model as
 * the printed slip at the kiosk, no PHI beyond what the slip already shows).
 * Resolves by token, with an optional `eid` hint so slips re-print reliably
 * even when the kiosk minted a local token (done-page link passes both).
 */
type PageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ eid?: string }>;
};

export default async function SlipPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const { eid } = await searchParams;

  const record =
    (eid && (await getEncounter(eid))) ||
    (await getEncounterByToken(decodeURIComponent(token)));

  if (!record) notFound();
  // The ?eid= hint must resolve to the SAME token shown in the URL — otherwise
  // anyone holding a printed token could walk the slip URL and pull up a
  // different patient's record. (The done-page link passes the matching pair.)
  if (record.token && record.token.toUpperCase() !== decodeURIComponent(token).toUpperCase()) {
    notFound();
  }

  const settings = await readSettings();
  const all = await listEncounters();
  const position = queuePositionByToken(all, record.token ?? token.toUpperCase());
  const issued = new Date(record.enteredAt).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  const slipToken = record.token ?? token.toUpperCase();
  const code = portalCode(record.encounterId);
  const dual = lookupDualCoding(record.history.chiefComplaint ?? "");

  return (
    <div className="flex flex-col items-center bg-sunken px-4 py-10 print:bg-white print:p-0">
      {/* Thermal receipt width 80mm. In the print dialog choose "Thermal / 80mm". */}
      <div className="slip w-[80mm] bg-white px-2 py-4 font-mono text-[11px] leading-snug text-black shadow-xl print:shadow-none">
        <div className="text-center">
          <div className="text-sm font-bold tracking-wide">{settings.hospitalName}</div>
          <div className="text-[9px] uppercase tracking-widest text-ink-2">OPD Token Slip - FREE - Valid today only</div>
          <div className="mt-1 border-b border-dashed border-slate-400" />
        </div>

        <div className="mt-2 text-center">
          <div className="text-[9px] uppercase tracking-widest text-ink-2">Token</div>
          <div className="text-4xl font-black tracking-[0.2em]">{slipToken}</div>
        </div>

        <div className="mt-2 border-b border-dashed border-slate-400" />
        <div className="mt-2 flex flex-col gap-1">
          <Row label="Patient" value={record.history.name || record.patient.name} />
          <Row label="Age / Sex" value={`${record.history.age || record.patient.age}y / ${record.history.sex || record.patient.sex}`} />
          {record.patient.abhaId && <Row label="ABHA ID" value={maskId(record.patient.abhaId)} />}
          <Row label="Dept" value={record.patient.department} />
          <Row label="System" value={record.mode === "ayush" ? "AYUSH (Ayurveda)" : "Allopathic"} />
          <Row label="Date" value={issued} />
          <Row label="Queue pos" value={position > 0 ? `#${position}` : "—"} />
          {record.history.chiefComplaint && (
            <Row label="Complaint" value={record.history.chiefComplaint.slice(0, 80)} />
          )}
          {dual && (
            <Row label="Coding" value={`${dual.icd10} / ${dual.namasteCode}`} />
          )}
        </div>

        <div className="my-3 flex flex-col items-center justify-center">
          <QRCodeSVG
            value={`/p/${record.encounterId}?code=${code}`}
            size={84}
            level="M"
            includeMargin={false}
          />
          <span className="mt-1 text-[8px] text-slate-500 uppercase tracking-wider">
            Scan for live queue &amp; health record
          </span>
        </div>

        <div className="mt-1 border-b border-dashed border-slate-400" />
        <div className="mt-2 text-center text-[10px]">
          Please wait for your number to be called. Counter 9-1. Complaint? Call 104.
          <br />
          Do not leave the waiting area.
        </div>
        <div className="mt-2 text-center text-[9px] text-ink-2">
          {settings.hospitalName} · MediKiosk SIH-26047
        </div>
      </div>

      <SlipPrintButton />
    </div>
  );
}

/** Mask an identifier on the printed slip: all but the last 4 digits hidden,
 *  so a lost thermal receipt cannot leak a full ABHA/Aadhaar number. */
function maskId(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length <= 4) return "XXXX";
  return `XXXX-XXXX-${digits.slice(-4)}`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="shrink-0 text-ink-2">{label}:</span>
      <span className="text-right font-semibold">{value || "—"}</span>
    </div>
  );
}