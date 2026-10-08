import type { StoredHistory } from "./types";
import { plausibleTemp } from "./redflags";

/**
 * Syndromic surveillance (Batch B, U1).
 *
 * Turns routine kiosk histories into anonymous, IDSP-style syndromic buckets:
 * "how many fever / diarrhoea / rash visits in the last N hours, by department?"
 * and fires a simple cluster alert when a syndrome spikes within a rolling
 * window — an early-warning signal for local outbreak detection in the
 * district/PHC context.
 *
 * Pure functions: no I/O, no timestamps injected at call time (callers pass
 * `now`), so this is fully unit-testable.
 */

export const SYNDROMES = [
  { key: "fever", label: "Fever", match: /fever|pyrexia|hyperthermia/i },
  { key: "respiratory", label: "Cough / Cold / Breathlessness", match: /cough|cold|breathless|shortness of breath|sputum|throat|rhinitis/i },
  { key: "gi", label: "Diarrhoea / Vomiting / GI", match: /diarrh|vomit|nausea|abdominal|stomach|loose|dysentery|dyspepsi/i },
  { key: "cardiac", label: "Chest Pain / Palpitation", match: /chest pain|palpitation|angina|tightness|cardiac/i },
  { key: "neuro", label: "Headache / Neurology", match: /headache|vertigo|dizziness|seizure|fits|numbness|stroke|migraine/i },
  { key: "rash", label: "Rash / Skin", match: /rash|skin|itch|urticaria|boil|lesion|scabies/i },
  { key: "arthralgia", label: "Joint / Body Ache", match: /joint|body ache|myalgia|arthritis|back pain|muscle/i },
  { key: "weakness", label: "Weakness / Fatigue", match: /weak(ness)?|fatigue|tired|drowsy|lethargy/i },
] as const;

export type SyndromeKey = (typeof SYNDROMES)[number]["key"];

/** Complaints → syndrome keys (an encounter can map to several). */
export function syndromesOf(encounter: StoredHistory): SyndromeKey[] {
  const text = [
    encounter.history?.chiefComplaint ?? "",
    encounter.history?.hpi ?? "",
    (encounter.redFlags ?? []).map((r) => `${r.symptom} ${r.message}`).join(" "),
    encounter.doctorDiagnosis ?? "",
  ].join(" ");

  const found: SyndromeKey[] = [];
  for (const s of SYNDROMES) {
    if (s.key === "fever") {
      // Fever can also be inferred from temperature even when not typed — but
      // only from a plausible °C reading. A °F value typed as °C (e.g. 98.4)
      // would otherwise count as fever and poison the outbreak signal; the
      // triage engine applies this same guard (see plausibleTemp).
      const t = encounter.patient?.vitals?.temperature;
      if ((t !== undefined && plausibleTemp(t) && t >= 38) || s.match.test(text)) found.push(s.key);
    } else if (s.match.test(text)) {
      found.push(s.key);
    }
  }
  return found;
}

export type SyndromeBucket = {
  key: SyndromeKey;
  label: string;
  count: number;
  byDepartment: Record<string, number>;
};

export type ClusterAlert = {
  key: SyndromeKey;
  label: string;
  department: string;
  count: number;
  windowStart: string;
  windowEnd: string;
  /** watch = first concern, warning = stronger signal. */
  level: "watch" | "warning";
};

export type SurveillanceReport = {
  generatedAt: string;
  since: string;
  totalEncounters: number;
  buckets: SyndromeBucket[];
  alerts: ClusterAlert[];
};

/**
 * Aggregate encounters into syndrome buckets over a trailing window.
 * `now` defaults to Date.now() but is injectable for tests.
 */
export function buildSurveillance(
  encounters: StoredHistory[],
  windowHours = 72,
  now = Date.now()
): SurveillanceReport {
  const sinceMs = now - windowHours * 60 * 60 * 1000;
  const recent = encounters.filter((e) => new Date(e.enteredAt).getTime() >= sinceMs);

  const counts = new Map<SyndromeKey, { count: number; byDept: Record<string, number> }>();
  for (const e of recent) {
    for (const key of syndromesOf(e)) {
      const bucket = counts.get(key) ?? { count: 0, byDept: {} };
      bucket.count += 1;
      const dept = e.patient?.department || "Unknown";
      bucket.byDept[dept] = (bucket.byDept[dept] ?? 0) + 1;
      counts.set(key, bucket);
    }
  }

  const buckets: SyndromeBucket[] = SYNDROMES.filter((s) => counts.has(s.key)).map((s) => {
    const c = counts.get(s.key)!;
    return { key: s.key, label: s.label, count: c.count, byDepartment: c.byDept };
  });

  const alerts = findClusterAlerts(recent);

  return {
    generatedAt: new Date(now).toISOString(),
    since: new Date(sinceMs).toISOString(),
    totalEncounters: recent.length,
    buckets,
    alerts,
  };
}

/**
 * Cluster detection: ≥3 same-syndrome encounters in the same department within
 * a 3-hour rolling window → watch; ≥6 → warning. This is deliberately simple
 * (matching the SIH rural-outbreak story); swap for a real IDSP algorithm in
 * production.
 */
export function findClusterAlerts(
  encounters: StoredHistory[],
  windowMs = 3 * 60 * 60 * 1000
): ClusterAlert[] {
  const alerts: ClusterAlert[] = [];
  for (const s of SYNDROMES) {
    for (const department of new Set(encounters.map((e) => e.patient?.department || "Unknown"))) {
      const hits = encounters
        .filter((e) => (e.patient?.department || "Unknown") === department && syndromesOf(e).includes(s.key))
        .map((e) => new Date(e.enteredAt).getTime())
        .sort((a, b) => a - b);
      // Slide a window: for each hit, count how many fall within windowMs.
      let best = 0;
      let bestStart = 0;
      for (let i = 0; i < hits.length; i++) {
        let j = i;
        while (j < hits.length && hits[j] - hits[i] <= windowMs) j++;
        if (j - i > best) {
          best = j - i;
          bestStart = hits[i];
        }
      }
      if (best >= 3) {
        alerts.push({
          key: s.key,
          label: s.label,
          department,
          count: best,
          windowStart: new Date(bestStart).toISOString(),
          windowEnd: new Date(bestStart + windowMs).toISOString(),
          level: best >= 6 ? "warning" : "watch",
        });
      }
    }
  }
  return alerts.sort((a, b) => b.level.localeCompare(a.level) || b.count - a.count);
}

/** Azure-ish display list for the admin dashboard CSV export. */
export function surveillanceToCsv(report: SurveillanceReport): string {
  const header = ["syndrome", "count", "department", "count_in_dept"];
  const rows: string[] = [header.join(",")];
  for (const b of report.buckets) {
    const depts = Object.entries(b.byDepartment).sort((a, b2) => b2[1] - a[1]);
    if (!depts.length) rows.push(`${csvCell(b.label)},${b.count},,`);
    for (const [dept, n] of depts) rows.push(`${csvCell(b.label)},${b.count},${csvCell(dept)},${n}`);
  }
  return rows.join("\n");
}

function csvCell(value: string): string {
  // Same formula-injection guard as the OPD register: quote-prefix any cell a
  // spreadsheet would otherwise interpret as a formula.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}