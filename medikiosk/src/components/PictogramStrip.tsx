"use client";

import type { Medication } from "@/lib/types";
import { pictogramFor, pictogramSteps } from "@/lib/pictograms";
import { Icon } from "@/components/Icon";

/**
 * Pictogram medicine instructions (Batch B, U3).
 *
 * Displays each prescribed medicine as a low-literacy icon strip: the form icon
 * (tablet/syrup/injection), one clock icon per dose time, a before/after-food
 * marker and a water reminder, plus the bilingual caption. Used on the pharmacy
 * screen, the physician dashboard and the patient handout.
 */
export default function PictogramStrip({ medications }: { medications: Medication[] }) {
  if (!medications.length) return null;
  const rows = medications.map((m) => ({ med: m, row: pictogramFor(m) }));
  return (
    <ul className="flex flex-col gap-2">
      {rows.map(({ med, row }, i) => (
        <li key={`${med.name}-${i}`} className="flex items-start gap-3 rounded-xl border-2 border-line bg-sunken p-3">
          <span
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-ink-2"
            aria-hidden="true"
          >
            <Icon name={row.formIcon} size={26} />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-ink">
              {row.medName}
              {row.dosage ? <span className="ml-1 text-[13px] font-normal text-ink-3">{row.dosage}</span> : null}
            </p>
            <ol className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              {pictogramSteps(row).map((s, idx) => (
                <li key={`${s.label}-${idx}`} className="flex min-h-[44px] items-center gap-1.5 text-ink-2">
                  <Icon name={s.icon} size={20} className="text-ink" />
                  <span className="text-[14px] font-medium">{s.label}</span>
                </li>
              ))}
            </ol>
            <p className="mt-0.5 text-[12px] text-ink-2">
              <span className="font-medium text-ink">{row.captionEn}</span>
              <span className="mx-1 text-ink-3" aria-hidden="true">
                &middot;
              </span>
              <span lang="hi">{row.captionHi}</span>
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
