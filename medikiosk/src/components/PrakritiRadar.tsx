"use client";

import React from "react";
import { computePrakritiScores, type PrakritiAnalysis } from "@/lib/clinical";
import type { StoredHistory } from "@/lib/types";
import { Icon } from "./Icon";

interface Props {
  ayush?: StoredHistory["history"]["ayush"];
  analysis?: PrakritiAnalysis;
  compact?: boolean;
}

export default function PrakritiRadar({ ayush, analysis: customAnalysis, compact = false }: Props) {
  // No assessment, no chart: rendering a "dominant Prakriti" from nothing
  // would present fabricated constitution/diet guidance as clinical output.
  if (!customAnalysis && !ayush) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-canvas p-4 text-center text-[13px] text-ink-3">
        No AYUSH assessment recorded for this patient.
      </div>
    );
  }
  const data = customAnalysis ?? computePrakritiScores(ayush);

  // SVG Radar coordinates for 3 axes (Vata top, Pitta bottom-right, Kapha bottom-left)
  const size = compact ? 180 : 240;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;

  // Angles: Vata (top: -90 deg), Pitta (bottom-right: 30 deg), Kapha (bottom-left: 150 deg)
  const angleV = -Math.PI / 2;
  const angleP = Math.PI / 6;
  const angleK = (5 * Math.PI) / 6;

  // Axis ends
  const vx = cx + r * Math.cos(angleV);
  const vy = cy + r * Math.sin(angleV);
  const px = cx + r * Math.cos(angleP);
  const py = cy + r * Math.sin(angleP);
  const kx = cx + r * Math.cos(angleK);
  const ky = cy + r * Math.sin(angleK);

  // Data polygon points based on percentages (scaled from 0 to 100)
  const vScale = Math.min(1, Math.max(0.15, data.vata / 70));
  const pScale = Math.min(1, Math.max(0.15, data.pitta / 70));
  const kScale = Math.min(1, Math.max(0.15, data.kapha / 70));

  const dvx = cx + r * vScale * Math.cos(angleV);
  const dvy = cy + r * vScale * Math.sin(angleV);
  const dpx = cx + r * pScale * Math.cos(angleP);
  const dpy = cy + r * pScale * Math.sin(angleP);
  const dkx = cx + r * kScale * Math.cos(angleK);
  const dky = cy + r * kScale * Math.sin(angleK);

  const polyPoints = `${dvx},${dvy} ${dpx},${dpy} ${dkx},${dky}`;

  if (compact) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-line bg-canvas p-3">
        <svg width={size} height={size} className="overflow-visible">
          {/* Background grid levels */}
          {[0.33, 0.66, 1].map((lvl, idx) => (
            <polygon
              key={idx}
              points={`${cx + r * lvl * Math.cos(angleV)},${cy + r * lvl * Math.sin(angleV)} ${cx + r * lvl * Math.cos(angleP)},${cy + r * lvl * Math.sin(angleP)} ${cx + r * lvl * Math.cos(angleK)},${cy + r * lvl * Math.sin(angleK)}`}
              fill="none"
              stroke="var(--line)"
              strokeDasharray={idx < 2 ? "2,2" : undefined}
              strokeWidth="1"
            />
          ))}
          {/* Axis lines */}
          <line x1={cx} y1={cy} x2={vx} y2={vy} stroke="var(--line)" strokeWidth="1" />
          <line x1={cx} y1={cy} x2={px} y2={py} stroke="var(--line)" strokeWidth="1" />
          <line x1={cx} y1={cy} x2={kx} y2={ky} stroke="var(--line)" strokeWidth="1" />
          {/* Data fill */}
          <polygon points={polyPoints} fill="rgba(37, 99, 235, 0.25)" stroke="#2563eb" strokeWidth="2" />
          {/* Axis labels */}
          <text x={vx} y={vy - 8} textAnchor="middle" className="text-[10px] font-bold fill-indigo-600">Vata {data.vata}%</text>
          <text x={px + 8} y={py + 4} textAnchor="start" className="text-[10px] font-bold fill-red-600">Pitta {data.pitta}%</text>
          <text x={kx - 8} y={ky + 4} textAnchor="end" className="text-[10px] font-bold fill-amber-600">Kapha {data.kapha}%</text>
        </svg>
        <div className="flex-1 text-xs">
          <p className="font-semibold text-ink">Prakriti: <span className="text-brand">{data.dominant}</span></p>
          <p className="text-ink-3 mt-0.5 text-[11px]">{data.characteristics[0]}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-canvas p-4">
      <div className="flex items-center justify-between border-b border-line pb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
            <Icon name="leaf" size={16} />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-ink">AYUSH Tridosha / Prakriti Assessment</h3>
            <p className="text-[11px] text-ink-3">Computed via Dashavidha Pariksha & Ahara-Vihara</p>
          </div>
        </div>
        <span className="chip border-emerald-500/30 bg-emerald-500/10 font-semibold text-emerald-700 dark:text-emerald-400">
          {data.dominant}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 items-center gap-6 sm:grid-cols-12">
        {/* Radar Chart SVG */}
        <div className="flex justify-center sm:col-span-5">
          <svg width={size} height={size} className="overflow-visible">
            {/* Background grid concentric triangles */}
            {[0.33, 0.66, 1].map((lvl, idx) => (
              <polygon
                key={idx}
                points={`${cx + r * lvl * Math.cos(angleV)},${cy + r * lvl * Math.sin(angleV)} ${cx + r * lvl * Math.cos(angleP)},${cy + r * lvl * Math.sin(angleP)} ${cx + r * lvl * Math.cos(angleK)},${cy + r * lvl * Math.sin(angleK)}`}
                fill={idx === 2 ? "var(--canvas-sunken)" : "none"}
                stroke="var(--line)"
                strokeDasharray={idx < 2 ? "3,3" : undefined}
                strokeWidth="1"
              />
            ))}
            {/* Axis lines */}
            <line x1={cx} y1={cy} x2={vx} y2={vy} stroke="var(--line)" strokeWidth="1.5" />
            <line x1={cx} y1={cy} x2={px} y2={py} stroke="var(--line)" strokeWidth="1.5" />
            <line x1={cx} y1={cy} x2={kx} y2={ky} stroke="var(--line)" strokeWidth="1.5" />
            {/* Center dot */}
            <circle cx={cx} cy={cy} r={3} fill="var(--line-strong)" />

            {/* Data filled polygon */}
            <polygon points={polyPoints} fill="rgba(16, 185, 129, 0.25)" stroke="#10b981" strokeWidth="2.5" />

            {/* Data vertices */}
            <circle cx={dvx} cy={dvy} r={4} fill="#6366f1" />
            <circle cx={dpx} cy={dpy} r={4} fill="#ef4444" />
            <circle cx={dkx} cy={dky} r={4} fill="#f59e0b" />

            {/* Axis labels */}
            <text x={vx} y={vy - 10} textAnchor="middle" className="text-xs font-bold fill-indigo-600 dark:fill-indigo-400">
              Vata ({data.vata}%)
            </text>
            <text x={px + 10} y={py + 6} textAnchor="start" className="text-xs font-bold fill-red-600 dark:fill-red-400">
              Pitta ({data.pitta}%)
            </text>
            <text x={kx - 10} y={ky + 6} textAnchor="end" className="text-xs font-bold fill-amber-600 dark:fill-amber-400">
              Kapha ({data.kapha}%)
            </text>
          </svg>
        </div>

        {/* Clinical breakdown & dietary guide */}
        <div className="flex flex-col gap-3 sm:col-span-7 text-xs">
          <div>
            <span className="font-semibold text-ink">Constitutional Characteristics (लक्षण):</span>
            <ul className="mt-1 list-disc list-inside space-y-0.5 text-ink-2">
              {data.characteristics.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg bg-sunken p-2.5">
            <span className="font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
              <Icon name="check" size={13} />
              Ahara & Vihara Guidance (पथ्य-अपथ्य):
            </span>
            <ul className="mt-1 list-disc list-inside space-y-0.5 text-ink-2 text-[11px]">
              {data.dietaryRecommendations.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
