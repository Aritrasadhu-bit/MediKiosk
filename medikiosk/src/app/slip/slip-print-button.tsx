"use client";

import { Icon } from "@/components/Icon";

/**
 * Print/reprint button for the 80mm thermal slip page (Batch C, P4).
 *
 * The slip page itself is a Server Component (it reads the store directly), and
 * React Server Components cannot pass event handlers down the component tree, so
 * the interactive print control is isolated here in a tiny client component.
 */
export default function SlipPrintButton() {
  return (
    <div className="print:hidden">
      <button onClick={() => window.print()} className="btn btn-primary mt-6 min-h-[56px] text-[16px]">
        <Icon name="printer" size={18} />
        Print or reprint slip · प्रिंट लें
      </button>
      <p className="mt-2 text-[14px] text-ink-2">
        Choose an 80mm thermal printer (or save as PDF) in the print dialog. Slip valid today only · Counter 9–1 · Complaint? 104.
      </p>
    </div>
  );
}