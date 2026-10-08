"use client";

import { useMemo, useState } from "react";
import { Icon } from "./Icon";
import type { StoredHistory, Investigation } from "@/lib/types";

type Props = {
  currentEncounter: StoredHistory;
  relatedEncounters?: StoredHistory[];
};

type TrendPoint = {
  date: string;
  value: number;
  unit: string;
  flag?: string;
  source: string;
};

export default function LabTrends({ currentEncounter, relatedEncounters = [] }: Props) {
  // Aggregate all investigations across current documents, priorInvestigations, and related visits
  const allTests = useMemo(() => {
    const map = new Map<string, TrendPoint[]>();

    const addPoint = (testName: string, inv: Investigation, sourceDate: string, srcLabel: string) => {
      const cleanName = testName.trim();
      const numVal = parseFloat(inv.value);
      if (isNaN(numVal)) return;

      const rawDate = inv.date || sourceDate;
      const dateStr = Number.isNaN(new Date(rawDate).getTime()) ? sourceDate : rawDate;
      const point: TrendPoint = {
        date: dateStr,
        value: numVal,
        unit: inv.unit || "",
        flag: inv.flag,
        source: srcLabel,
      };

      const existing = map.get(cleanName) ?? [];
      // avoid exact duplicate points
      if (!existing.some((p) => p.date === point.date && p.value === point.value)) {
        existing.push(point);
      }
      map.set(cleanName, existing);
    };

    // 1. Current encounter prior investigations
    currentEncounter.history?.priorInvestigations?.forEach((inv) => {
      if (!inv || typeof inv.test !== "string" || !inv.test.trim()) return;
      addPoint(inv.test, inv, currentEncounter.enteredAt, "Current Visit");
    });

    // 2. Current encounter scanned documents
    currentEncounter.documents?.forEach((doc) => {
      doc.entities?.investigations?.forEach((inv) => {
        addPoint(inv.test, inv, doc.date || currentEncounter.enteredAt, doc.filename || "Scan");
      });
    });

    // 3. Related encounters
    relatedEncounters.forEach((rel) => {
      rel.history?.priorInvestigations?.forEach((inv) => {
        if (!inv || typeof inv.test !== "string" || !inv.test.trim()) return;
        addPoint(inv.test, inv, rel.enteredAt, "Past Visit");
      });
      rel.documents?.forEach((doc) => {
        doc.entities?.investigations?.forEach((inv) => {
          addPoint(inv.test, inv, doc.date || rel.enteredAt, "Past Scan");
        });
      });
    });

    // Sort points chronologically
    for (const pts of map.values()) {
      pts.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }

    return map;
  }, [currentEncounter, relatedEncounters]);

  const testNames = Array.from(allTests.keys());
  const [selectedTest, setSelectedTest] = useState<string>(testNames[0] ?? "Hemoglobin");
  const [lastEncounterId, setLastEncounterId] = useState(currentEncounter?.encounterId);

  // Reset the selection when the patient changes: otherwise a test picked for
  // patient A stays selected for patient B with zero points ("0 observations").
  // Adjusted during render (not in an effect) per React docs for derived state.
  if (lastEncounterId !== currentEncounter?.encounterId) {
    setLastEncounterId(currentEncounter?.encounterId);
    setSelectedTest(testNames[0] ?? "Hemoglobin");
  }

  if (testNames.length === 0) return null;

  const currentPts = allTests.get(selectedTest) ?? allTests.get(testNames[0]) ?? [];
  const W = 280;
  const H = 70;

  const numericVals = currentPts.map((p) => p.value);
  const minVal = Math.min(...numericVals);
  const maxVal = Math.max(...numericVals);
  const range = maxVal - minVal || 1;

  const xCoord = (idx: number) =>
    currentPts.length === 1 ? W / 2 : (idx / (currentPts.length - 1)) * (W - 30) + 15;
  const yCoord = (val: number) =>
    H - ((val - minVal) / range) * (H - 24) - 12;

  const pathLine = currentPts
    .map((p, i) => `${i === 0 ? "M" : "L"}${xCoord(i).toFixed(1)},${yCoord(p.value).toFixed(1)}`)
    .join(" ");

  return (
    <div className="panel overflow-hidden p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
        <p className="panel-title flex items-center gap-1.5 text-sm font-semibold">
          <Icon name="activity" size={15} className="text-brand" />
          Longitudinal Lab Trends &amp; Biomarkers
        </p>
        <span className="chip chip-neutral text-[11px]">
          {currentPts.length} observation(s)
        </span>
      </div>

      {/* Test Selector Pills */}
      <div className="mt-2.5 flex flex-wrap gap-1.5 overflow-x-auto pb-1">
        {testNames.map((name) => {
          const isSelected = name === selectedTest;
          const count = allTests.get(name)?.length ?? 0;
          return (
            <button
              key={name}
              type="button"
              onClick={() => setSelectedTest(name)}
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-all ${
                isSelected
                  ? "bg-brand text-white shadow-sm"
                  : "border border-line bg-canvas text-ink-2 hover:bg-sunken hover:text-ink"
              }`}
            >
              <span>{name}</span>
              <span className={`text-[10px] ${isSelected ? "text-white/80" : "text-ink-3"}`}>
                ({count})
              </span>
            </button>
          );
        })}
      </div>

      {/* Selected Test Visual Trend Graph */}
      <div className="mt-3 rounded-lg border border-line bg-sunken p-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-bold text-ink">{selectedTest}</span>
            <span className="ml-2 text-xs text-ink-3">
              Unit: {currentPts[0]?.unit || "standard"}
            </span>
          </div>
          {currentPts.length > 0 && (
            <div className="flex items-center gap-1 text-xs font-semibold">
              <span>Latest:</span>
              <span
                className={`rounded px-1.5 py-0.5 ${
                  currentPts[currentPts.length - 1]?.flag === "high"
                    ? "bg-critical-subtle text-critical font-bold"
                    : currentPts[currentPts.length - 1]?.flag === "low"
                    ? "bg-warning-subtle text-warning font-bold"
                    : "bg-success-subtle text-success"
                }`}
              >
                {currentPts[currentPts.length - 1]?.value} {currentPts[0]?.unit}
                {currentPts[currentPts.length - 1]?.flag ? ` (${currentPts[currentPts.length - 1]?.flag})` : ""}
              </span>
            </div>
          )}
        </div>

        {/* SVG Sparkline / Multi-point Graph */}
        {currentPts.length >= 2 ? (
          <div className="mt-2">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20" role="img" aria-label={`${selectedTest} trend: ${currentPts.map((p) => `${p.value} on ${new Date(p.date).toLocaleDateString()}`).join(", ")}`}>
              {/* Baseline grid lines */}
              <line x1="10" y1="12" x2={W - 10} y2="12" stroke="currentColor" strokeDasharray="2,2" className="text-line" />
              <line x1="10" y1={H - 12} x2={W - 10} y2={H - 12} stroke="currentColor" strokeDasharray="2,2" className="text-line" />

              {/* Trend Polyline */}
              <path d={pathLine} fill="none" stroke="var(--brand)" strokeWidth="2.5" strokeLinecap="round" />

              {/* Data points */}
              {currentPts.map((p, i) => {
                const cx = xCoord(i);
                const cy = yCoord(p.value);
                const isAbnormal = p.flag === "high" || p.flag === "low" || p.flag === "critical";
                return (
                  <g key={i}>
                    <circle
                      cx={cx}
                      cy={cy}
                      r={isAbnormal ? 4.5 : 3.5}
                      fill={isAbnormal ? "#ef4444" : "var(--brand)"}
                      stroke="#ffffff"
                      strokeWidth="1.5"
                    >
                      <title>{`${p.value} ${p.unit} (${new Date(p.date).toLocaleDateString()})`}</title>
                    </circle>
                    <text
                      x={cx}
                      y={cy - 7}
                      textAnchor="middle"
                      fontSize="9"
                      fontWeight="bold"
                      className="fill-ink"
                    >
                      {p.value}
                    </text>
                  </g>
                );
              })}
            </svg>
            <div className="flex justify-between text-[10px] text-ink-3 px-2">
              <span>{new Date(currentPts[0]?.date).toLocaleDateString()}</span>
              <span>{new Date(currentPts[currentPts.length - 1]?.date).toLocaleDateString()}</span>
            </div>
          </div>
        ) : (
          <div className="mt-2 py-2 text-center text-xs text-ink-3">
            Single recording on record: {currentPts[0]?.value} {currentPts[0]?.unit} on{" "}
            {new Date(currentPts[0]?.date).toLocaleDateString()} ({currentPts[0]?.source})
          </div>
        )}
      </div>
    </div>
  );
}
