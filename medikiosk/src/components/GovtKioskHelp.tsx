"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { speak } from "@/lib/speech";
import { useT } from "@/lib/useT";

/** Shared govt-kiosk helpers: bilingual reassurance, read-back, help video. */

export function ListenButton({ text, lang = "hi-IN", label = "Listen · सुनें" }: { text: string; lang?: string; label?: string }) {
  return (
    <button type="button" onClick={() => speak(text, lang)} aria-label={label} className="icon-btn min-h-[44px] min-w-[44px] border border-line">
      <Icon name="volume" size={16} />
    </button>
  );
}

export function PhotoReassurance() {
  const { t: tr } = useT();
  return (
    <div className="banner banner-info mt-3 text-[14px]">
      <Icon name="camera" size={16} className="mt-0.5 shrink-0" />
      <span>{tr("photoSlipOnly")}</span>
    </div>
  );
}

export function ScanReassurance() {
  return (
    <div className="banner banner-info mt-3 text-[14px]">
      <Icon name="shield" size={16} className="mt-0.5 shrink-0" />
      <span>Originals stay safe with you · <span lang="hi">असल कागज़ आपके पास ही रहेंगे।</span> Max 3 docs · Blurry? Retake · <span lang="hi">धुंधला हो तो दोबारा लें।</span> Low-data mode auto-compresses &lt;300KB.</span>
    </div>
  );
}

export function AbhaSkipNote() {
  const { t: tr } = useT();
  return (
    <div className="banner banner-success mt-3 text-[14px]">
      <Icon name="checkCircle" size={16} className="mt-0.5 shrink-0" />
      <span>{tr("abhaOptionalNote")}</span>
    </div>
  );
}

export function DraftSavedNote() {
  return (
    <p className="mt-2 text-[13px] text-ink-2">
      <Icon name="save" size={13} /> Draft auto-saved every 10s
    </p>
  );
}

export function SimpleWordsNote() {
  return (
    <p className="mt-2 text-[13px] text-ink-2">Simple words used: पुरानी बीमारी (chronic), जांच क्रम (triage), सहायक (helper).</p>
  );
}

export function HelpVideo({ title }: { title?: string }) {
  const [open, setOpen] = useState(false);
  const { t: tr } = useT();
  const label = title ?? tr("howToUse");
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost btn-sm min-h-[44px]" aria-label={label}>
        <Icon name="play" size={15} /> {label}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true">
          <div className="panel w-full max-w-md p-5 text-center">
            <h2 className="text-base font-bold">3 steps</h2>
            <ol className="mt-3 flex flex-col gap-2 text-left text-[15px]">
              <li className="rounded-lg bg-sunken p-3"><strong>1.</strong> Tap your language 👆</li>
              <li className="rounded-lg bg-sunken p-3"><strong>2.</strong> Speak or tap symptoms <Icon name="mic" size={16} className="inline" /></li>
              <li className="rounded-lg bg-sunken p-3"><strong>3.</strong> Take token print 🖨️</li>
            </ol>
            <p className="mt-2 text-[13px] text-ink-2">Silent looping demo — ask helper at counter for assistance.</p>
            <button type="button" onClick={() => setOpen(false)} className="btn btn-primary mt-4 min-h-[56px] w-full">Close</button>
          </div>
        </div>
      )}
    </>
  );
}

export function KioskActionBar({ backHref, backLabel = "Back · पीछे", nextLabel = "Continue · आगे", onNext, step = "" }: { backHref?: string; backLabel?: string; nextLabel?: string; onNext?: () => void; step?: string }) {
  return (
    <div className="kiosk-actionbar mt-6 rounded-t-2xl">
      <div className="mx-auto flex max-w-3xl items-center gap-2">
        {backHref ? (
          <a href={backHref} className="btn btn-secondary min-h-[56px] flex-1 text-[16px] no-underline">← {backLabel}</a>
        ) : null}
        <button type="button" onClick={onNext} className="btn btn-primary min-h-[56px] flex-[2] text-[17px] font-bold">
          {nextLabel} →
        </button>
      </div>
      {step ? <p className="mt-1 text-center text-[13px] text-ink-2">{step}</p> : null}
    </div>
  );
}
