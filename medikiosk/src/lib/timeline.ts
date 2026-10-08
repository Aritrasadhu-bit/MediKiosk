import type { StoredHistory } from "./types";

/**
 * Coherent medical timeline (Module B).
 *
 * A physician opening a record needs one chronological spine — visits,
 * prescriptions started, scanned documents and priority alerts — instead of
 * hunting across the queue card, the documents tab and the audit trail. This
 * module merges every dated artefact from the current encounter plus its
 * longitudinal relatives into a single newest-first event list. Pure, so it is
 * unit-testable without the store.
 */

export type TimelineKind = "visit" | "prescription" | "document" | "alert";

export type TimelineEvent = {
  /** Stable key for React (source + encounter + index). */
  key: string;
  kind: TimelineKind;
  /** ISO timestamp the event sorts on. */
  at: string;
  /** One-line headline. */
  title: string;
  /** Optional second line (diagnosis, values, file type…). */
  detail?: string;
  /** Encounter this event belongs to (visits/prescriptions/alerts). */
  encounterId?: string;
  /** Severity only for alerts. */
  severity?: "high" | "medium";
};

function visitTitle(e: StoredHistory): string {
  const complaint = e.history?.chiefComplaint?.trim() || "Routine consultation";
  const dept = e.patient?.department ? ` · ${e.patient.department}` : "";
  return `${complaint}${dept}`;
}

function visitDetail(e: StoredHistory): string | undefined {
  const dx = e.doctorDiagnosis || e.prescription?.diagnosis;
  const parts: string[] = [];
  if (dx) parts.push(`Dx: ${dx}`);
  parts.push(`Status: ${e.status}`);
  return parts.join(" · ") || undefined;
}

/**
 * Merge the current encounter and its longitudinal relatives into one
 * newest-first timeline. Documents dedupe by id across encounters (the same
 * scan can be attached to several visits); visits, prescriptions and alerts
 * stay per-encounter so repeat history is visible, not collapsed.
 */
export function buildTimeline(current: StoredHistory, related: StoredHistory[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const seenDocs = new Set<string>();

  const addEncounter = (e: StoredHistory, index: number) => {
    const at = e.enteredAt || e.updatedAt;
    events.push({
      key: `visit-${e.encounterId}`,
      kind: "visit",
      at,
      title: visitTitle(e),
      detail: visitDetail(e),
      encounterId: e.encounterId,
    });

    const meds = e.prescription?.medications ?? [];
    if (meds.length) {
      const names = meds
        .slice(0, 4)
        .map((m) => `${m.name}${m.dosage ? ` ${m.dosage}` : ""}`)
        .join("; ");
      events.push({
        key: `rx-${e.encounterId}-${index}`,
        kind: "prescription",
        at,
        title: `Prescribed: ${names}${meds.length > 4 ? ` +${meds.length - 4} more` : ""}`,
        detail: e.prescription?.diagnosis ? `For: ${e.prescription.diagnosis}` : undefined,
        encounterId: e.encounterId,
      });
    }

    for (const [fi, f] of (e.redFlags ?? []).entries()) {
      if (f.severity !== "high" && f.severity !== "medium") continue;
      events.push({
        key: `alert-${e.encounterId}-${fi}`,
        kind: "alert",
        at,
        title: f.symptom,
        detail: f.message,
        encounterId: e.encounterId,
        severity: f.severity,
      });
    }

    for (const d of e.documents ?? []) {
      if (!d || seenDocs.has(d.id)) continue;
      seenDocs.add(d.id);
      const abnormal = (d.abnormalValues ?? []).length;
      events.push({
        key: `doc-${d.id}`,
        kind: "document",
        at: d.date ?? at,
        title: `${d.type ?? "Document"}: ${d.filename}`,
        detail: abnormal ? `${abnormal} abnormal value(s)` : undefined,
        encounterId: e.encounterId,
      });
    }
  };

  addEncounter(current, 0);
  related.forEach((e, i) => {
    if (e.encounterId !== current.encounterId) addEncounter(e, i + 1);
  });

  const kindRank: Record<TimelineKind, number> = { visit: 0, prescription: 1, alert: 2, document: 3 };
  return events.sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at) || kindRank[a.kind] - kindRank[b.kind]
  );
}
