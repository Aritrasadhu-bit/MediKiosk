import type { StoredHistory } from "./types";

/**
 * OPD register export (Batch A, P3).
 *
 * Builds the paper-era OPD register (serial no., time, patient, OPD no.,
 * village, department, complaint, diagnosis, medicines, doctor) that PHC/CHC
 * staff are trained on, as printable CSV or HTML. DHIS/RCH-style reporting and
 * local "weekly reports to the MO" both consume this same shape.
 *
 * Pure functions — no I/O — so they are unit-testable.
 */

export type OpdRegisterRow = {
  serial: number;
  time: string;
  token: string;
  name: string;
  age: string;
  sex: string;
  opdNo: string; // ABHA / mobile / encounter id
  village: string;
  department: string;
  complaint: string;
  diagnosis: string;
  medicines: string;
  doctor: string;
  status: string;
};

/** Medicare-style date filter key used by the register (server-local date). */
export function registerDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function buildOpdRegister(
  encounters: StoredHistory[],
  dateKey: string
): OpdRegisterRow[] {
  // Bucket by the server's LOCAL calendar date of each encounter timestamp —
  // Date's local getters already apply the offset, so no manual shift (shifting
  // here used to double-convert and mis-bucket in non-UTC timezones).
  const filtered = encounters
    .filter((e) => registerDateKey(new Date(e.enteredAt)) === dateKey)
    .sort((a, b) => new Date(a.enteredAt).getTime() - new Date(b.enteredAt).getTime());

  return filtered.map((e, i) => ({
    serial: i + 1,
    time: new Date(e.enteredAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
    token: e.token ?? "",
    name: e.patient?.name ?? "",
    age: e.patient?.age != null ? String(e.patient.age) : "",
    sex: e.patient?.sex ?? "",
    opdNo: e.patient?.abhaId || e.patient?.mobile || e.encounterId,
    village: e.camp?.village ?? "",
    department: e.patient?.department ?? "",
    complaint: e.history?.chiefComplaint ?? "",
    diagnosis: e.doctorDiagnosis ?? "",
    medicines: (e.prescription?.medications ?? []).map((m) => m.name).join("; "),
    doctor: e.prescription?.prescribedBy ?? e.audit?.find((a) => a.action === "prescription_written")?.actor ?? "",
    status: e.status,
  }));
}

export const OPD_HEADER: (keyof OpdRegisterRow)[] = [
  "serial",
  "time",
  "token",
  "name",
  "age",
  "sex",
  "opdNo",
  "village",
  "department",
  "complaint",
  "diagnosis",
  "medicines",
  "doctor",
  "status",
];

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Formula injection: a patient-controlled field starting with = + - @ (e.g.
  // a name like `=HYPERLINK(...)`) executes when the admin opens the CSV in a
  // spreadsheet. Prefixing with a single quote forces text interpretation.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function opdRegisterToCsv(rows: OpdRegisterRow[]): string {
  const head = OPD_HEADER.map((h) => csvCell(h)).join(",");
  const body = rows.map((r) => OPD_HEADER.map((h) => csvCell(r[h])).join(","));
  return [head, ...body].join("\n");
}

export function opdRegisterToHtml(rows: OpdRegisterRow[], hospital = "MediKiosk Hospital", dateKey = ""): string {
  const esc = (v: string): string =>
    String(v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  const label = (h: keyof OpdRegisterRow) => h.charAt(0).toUpperCase() + h.slice(1).replace(/([A-Z])/g, " $1");
  const headRow = OPD_HEADER.map((h) => `<th>${label(h)}</th>`).join("");
  const bodyRows = rows
    .map(
      (r) =>
        `<tr>${OPD_HEADER.map((h) => `<td>${esc(String(r[h] ?? ""))}</td>`).join("")}</tr>`
    )
    .join("");
  const safeHospital = esc(hospital);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>OPD Register — ${safeHospital}</title>
<style>
  body { font-family: ui-monospace, monospace; font-size: 12px; margin: 24px; }
  h1 { margin: 0 0 2px; } h2 { margin: 0 0 16px; font-weight: 400; color: #444; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; }
  th { background: #eef2ff; position: sticky; top: 0; }
  @media print { body { margin: 0; } }
</style></head><body>
  <h1>${safeHospital} — Daily OPD Register</h1>
  <h2>${esc(dateKey || "All dates")} · ${rows.length} patient(s)</h2>
  <table><thead><tr>${headRow}</tr></thead><tbody>${bodyRows}</tbody></table>
</body></html>`;
}