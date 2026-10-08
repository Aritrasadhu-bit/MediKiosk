"use client";

import { useState } from "react";
import { Icon } from "./Icon";
import { localizeBodyRegion, localizePainScale, localizeComplaint } from "@/lib/translations";

export type BodyRegion =
  | "head"
  | "eyes_ent"
  | "chest"
  | "abdomen"
  | "pelvis_urinary"
  | "back"
  | "arms"
  | "legs_joints"
  | "skin";

export type BodyMapSelection = {
  region: BodyRegion;
  label: string;
  complaintSuggestion: string;
  severity: number;
};

export const BODY_REGIONS: {
  id: BodyRegion;
  label: string;
  complaint: string;
  description: string;
  color: string;
  viewBoxArea: { x: number; y: number; width: number; height: number };
  /**
   * Departments (exact names from DEPARTMENTS in lib/data.ts) that treat
   * this organ. Shown on the map so the patient sees where their problem
   * belongs. A validity test pins every entry to the website list.
   */
  departments: string[];
}[] = [
  {
    id: "head",
    label: "Head & Brain",
    complaint: "Headache",
    description: "Headache, dizziness, migraine, scalp pain, mental health",
    color: "#6366f1",
    viewBoxArea: { x: 80, y: 15, width: 40, height: 35 },
    departments: ["Neurology", "Psychiatry", "General Medicine"],
  },
  {
    id: "eyes_ent",
    label: "Eyes, Nose, Throat & Dental",
    complaint: "Cough",
    description: "Throat pain, cough, eye redness, earache, toothache",
    color: "#06b6d4",
    viewBoxArea: { x: 80, y: 48, width: 40, height: 22 },
    departments: ["ENT", "Ophthalmology", "Dentistry"],
  },
  {
    id: "chest",
    label: "Chest & Lungs",
    complaint: "Chest Pain",
    description: "Chest tightness, breathlessness, cough, palpitations",
    color: "#ef4444",
    viewBoxArea: { x: 65, y: 72, width: 70, height: 42 },
    departments: ["Cardiology", "Pulmonology"],
  },
  {
    id: "abdomen",
    label: "Stomach, Liver & Digestion",
    complaint: "Abdominal Pain",
    description: "Stomach ache, acidity, nausea, vomiting, gas, hernia",
    color: "#f59e0b",
    viewBoxArea: { x: 70, y: 116, width: 60, height: 38 },
    departments: ["Gastroenterology", "Surgery", "General Medicine"],
  },
  {
    id: "pelvis_urinary",
    label: "Lower Abdomen, Kidneys & Pelvis",
    complaint: "Urinary Problem",
    description: "Burning urination, kidney pain, pelvic cramps, menstrual issues",
    color: "#8b5cf6",
    viewBoxArea: { x: 72, y: 156, width: 56, height: 32 },
    departments: ["Nephrology", "Gynaecology & Obstetrics", "Surgery"],
  },
  {
    id: "back",
    label: "Back & Spine",
    complaint: "Joint / Body Pain",
    description: "Lower back pain, spine stiffness, neck spasm",
    color: "#10b981",
    viewBoxArea: { x: 72, y: 80, width: 56, height: 90 },
    departments: ["Orthopaedics", "AYUSH - Panchakarma"],
  },
  {
    id: "arms",
    label: "Shoulders, Arms & Hands",
    complaint: "Joint / Body Pain",
    description: "Shoulder pain, elbow/wrist pain, numbness, tingling, tremors",
    color: "#3b82f6",
    viewBoxArea: { x: 28, y: 75, width: 144, height: 95 },
    departments: ["Orthopaedics", "Neurology"],
  },
  {
    id: "legs_joints",
    label: "Hips, Knees & Feet",
    complaint: "Joint / Body Pain",
    description: "Knee arthritis, ankle swelling, leg cramps, foot pain",
    color: "#ec4899",
    viewBoxArea: { x: 62, y: 190, width: 76, height: 140 },
    departments: ["Orthopaedics", "AYUSH - Yoga & Naturopathy"],
  },
  {
    id: "skin",
    label: "Skin, Endocrine & General",
    complaint: "Skin Rash",
    description: "Skin rashes, itching, boils, thyroid swelling, sugar disturbances, pediatric care",
    color: "#84cc16",
    viewBoxArea: { x: 20, y: 10, width: 160, height: 320 },
    departments: ["Dermatology", "Endocrinology", "Paediatrics", "AYUSH - Ayurveda (General)"],
  },
];

const DEFAULT_SEVERITY_SCALE = [
  { val: 0, label: "0 - None", emoji: "😊", desc: "No pain", color: "text-success" },
  { val: 2, label: "1-3 - Mild", emoji: "🙂", desc: "Noticeable, doesn't interfere", color: "text-info" },
  { val: 5, label: "4-6 - Moderate", emoji: "😐", desc: "Interferes with tasks", color: "text-warning" },
  { val: 8, label: "7-8 - Severe", emoji: "😣", desc: "Hard to concentrate", color: "text-critical" },
  { val: 10, label: "9-10 - Worst", emoji: "😫", desc: "Unbearable pain", color: "text-critical font-bold" },
];

const UI_TEXT: Record<string, { title: string; subtitle: string; front: string; back: string; quick: string; selectedArea: string; suggested: string; severityTitle: string; tapHint: string; departments: string }> = {
  en: {
    title: "Tap Where It Hurts (Interactive Body Map)",
    departments: "Departments",
    subtitle: "Tap any body region below to identify your symptom and set pain severity.",
    front: "Front View",
    back: "Back View",
    quick: "Or Choose Body Region:",
    selectedArea: "Selected Area",
    suggested: "Suggested Complaint",
    severityTitle: "Pain Severity Level (0 - 10):",
    tapHint: "Click directly on the body illustration",
  },
  hi: {
    title: "शरीर पर दर्द या समस्या की जगह चुनें",
    departments: "विभाग",
    subtitle: "चित्र में दर्द वाले हिस्से पर टैप करें और नीचे दर्द की तीव्रता चुनें।",
    front: "सामने का भाग (Front)",
    back: "पीछे का भाग (Back)",
    quick: "त्वरित अंग चयन:",
    selectedArea: "चयनित अंग",
    suggested: "सुझाई गई शिकायत",
    severityTitle: "दर्द की तीव्रता (0 - 10):",
    tapHint: "चित्र में किसी भी अंग पर टैप करें",
  },
  bn: {
    title: "শরীরে ব্যথার স্থান নির্বাচন করুন (বডি ম্যাপ)",
    departments: "বিভাগ",
    subtitle: "শরীরের যে অংশে সমস্যা সেখানে স্পর্শ করুন এবং ব্যথার মাত্রা নির্ধারণ করুন।",
    front: "সামনের দিক (Front)",
    back: "পেছনের দিক (Back)",
    quick: "শরীরের অঙ্গ নির্বাচন:",
    selectedArea: "নির্বাচিত স্থান",
    suggested: "সম্ভাব্য সমস্যা",
    severityTitle: "ব্যথার তীব্রতা (০ - ১০):",
    tapHint: "শরীরের চিত্রে সরাসরি স্পর্শ করুন",
  },
  ta: {
    title: "வலி உள்ள இடத்தை தேர்வு செய்யவும்",
    departments: "துறை",
    subtitle: "உடல் வரைபடத்தில் வலி உள்ள பகுதியைத் தொட்டு வலியின் அளவை அமைக்கவும்.",
    front: "முன்புறம் (Front)",
    back: "பின்புறம் (Back)",
    quick: "உடல் பகுதி தேர்வு:",
    selectedArea: "தேர்ந்தெடுக்கப்பட்ட பகுதி",
    suggested: "பரிந்துரைக்கப்பட்ட பிரச்சனை",
    severityTitle: "வலியின் தீவிரம் (0 - 10):",
    tapHint: "உடல் வரைபடத்தில் நேரடியாகத் தொடவும்",
  },
  te: {
    title: "శరీరంలో నొప్పి ఉన్న భాగాన్ని ఎంచుకోండి",
    departments: "విభాగం",
    subtitle: "నొప్పి ఉన్న శరీర భాగాన్ని ట్యాప్ చేసి తీవ్రతను ఎంచుకోండి.",
    front: "ముందు భాగం (Front)",
    back: "వెనుక భాగం (Back)",
    quick: "శరీర భాగం ఎంపిక:",
    selectedArea: "ఎంచుకున్న భాగం",
    suggested: "సూచించిన సమస్య",
    severityTitle: "నొప్పి తీవ్రత (0 - 10):",
    tapHint: "శరీర చిత్రంపై నేరుగా ట్యాప్ చేయండి",
  },
  mr: {
    title: "शरीरावर दुखत असलेला भाग निवडा",
    departments: "विभाग",
    subtitle: "चित्रावर दुखणाऱ्या भागावर टॅप करा आणि तीव्रतेची पातळी निवडा.",
    front: "पुढचा भाग (Front)",
    back: "मागचा भाग (Back)",
    quick: "अंग निवडा:",
    selectedArea: "निवडलेला भाग",
    suggested: "संभाव्य तक्रार",
    severityTitle: "वेदनांची तीव्रता (० - १०):",
    tapHint: "चित्रातील भागावर थेट टॅप करा",
  },
  gu: {
    title: "શરીરમાં દુખાવાની જગ્યા પસંદ કરો",
    departments: "વિભાગ",
    subtitle: "ચિત્રમાં દુખાવાના ભાગ પર ટૅપ કરો અને દુખાવાની તીવ્રતા નક્કી કરો.",
    front: "આગળનો ભાગ (Front)",
    back: "પાછળનો ભાગ (Back)",
    quick: "શરીરનો ભાગ પસંદ કરો:",
    selectedArea: "પસંદ કરેલ ભાગ",
    suggested: "સૂચવેલી સમસ્યા",
    severityTitle: "દુખાવાની તીવ્રતા (૦ - ૧૦):",
    tapHint: "શરીરના ચિત્ર પર સીધા ટૅપ કરો",
  },
};

type Props = {
  lang?: string;
  onSelect: (selection: BodyMapSelection) => void;
  selectedComplaint?: string;
};

export default function BodyMap({ lang = "en", onSelect, selectedComplaint }: Props) {
  // Nothing is pre-selected: the patient must tap their own region. A passed
  // complaint (returning visitor) still restores its region.
  const [selectedRegion, setSelectedRegion] = useState<BodyRegion | null>(() => {
    if (selectedComplaint) {
      const match = BODY_REGIONS.find((r) => r.complaint.toLowerCase() === selectedComplaint.toLowerCase());
      if (match) return match.id;
    }
    return null;
  });
  const [severity, setSeverity] = useState<number>(5);
  const [view, setView] = useState<"front" | "back">("front");

  const currentRegion = selectedRegion ? BODY_REGIONS.find((r) => r.id === selectedRegion) ?? null : null;
  const ui = UI_TEXT[lang] ?? UI_TEXT.en;

  const getRegionLabel = (id: string, fallback: string) => {
    return localizeBodyRegion(id, lang)?.label ?? fallback;
  };

  const getRegionDesc = (id: string, fallback: string) => {
    return localizeBodyRegion(id, lang)?.desc ?? fallback;
  };

  const localizedScale = localizePainScale(lang);
  const severityScale = DEFAULT_SEVERITY_SCALE.map((s, idx) => {
    const loc = localizedScale?.[idx];
    return {
      ...s,
      label: loc?.label ?? s.label,
      desc: loc?.desc ?? s.desc,
    };
  });

  const handleRegionClick = (region: BodyRegion) => {
    setSelectedRegion(region);
    const reg = BODY_REGIONS.find((r) => r.id === region);
    if (reg) {
      onSelect({
        region,
        label: getRegionLabel(reg.id, reg.label),
        complaintSuggestion: reg.complaint,
        severity,
      });
    }
  };

  const handleSeverityChange = (val: number) => {
    setSeverity(val);
    if (currentRegion) {
      onSelect({
        region: currentRegion.id,
        label: getRegionLabel(currentRegion.id, currentRegion.label),
        complaintSuggestion: currentRegion.complaint,
        severity: val,
      });
    }
  };

  // Keyboard access for SVG hotspots (click-only <g> locks out keyboard and
  // screen-reader users). Selecting a front-only region from the back view
  // also flips the illustration so abdomen/pelvis are never unreachable.
  const regionA11yProps = (region: BodyRegion) => ({
    onKeyDown: (e: { key: string; preventDefault: () => void }) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if ((region === "abdomen" || region === "pelvis_urinary" || region === "eyes_ent") && view !== "front") {
          setView("front");
        }
        handleRegionClick(region);
      }
    },
    "aria-label": getRegionLabel(region, region),
    "aria-pressed": selectedRegion === region,
  });

  return (
    <div className="panel overflow-hidden p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div>
          <h3 className="text-base font-semibold text-ink flex items-center gap-2">
            <Icon name="activity" size={18} className="text-brand" />
            {ui.title}
          </h3>
          <p className="text-[12px] text-ink-3">
            {ui.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-line bg-sunken p-1">
          <button
            type="button"
            onClick={() => setView("front")}
            className={`rounded px-3 py-1 text-[12px] font-medium transition-colors ${
              view === "front" ? "bg-canvas text-brand shadow-sm" : "text-ink-3 hover:text-ink"
            }`}
          >
            {ui.front}
          </button>
          <button
            type="button"
            onClick={() => setView("back")}
            className={`rounded px-3 py-1 text-[12px] font-medium transition-colors ${
              view === "back" ? "bg-canvas text-brand shadow-sm" : "text-ink-3 hover:text-ink"
            }`}
          >
            {ui.back}
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 items-center gap-6 lg:grid-cols-12">
        {/* Left: Interactive Anatomical Avatar */}
        <div className="relative flex flex-col items-center justify-center rounded-xl border border-line bg-surface/80 p-4 lg:col-span-5">
          <svg
            viewBox="0 0 200 340"
            className="h-[310px] w-auto max-w-full drop-shadow-sm select-none"
            aria-label="Human body map illustration"
          >
            {/* Body Outline Base Silhouette */}
            <g fill="none" stroke="currentColor" strokeWidth="1.5" className="text-slate-300 dark:text-slate-700">
              {/* Head */}
              <ellipse cx="100" cy="32" rx="20" ry="24" className="fill-slate-100 dark:fill-slate-800" />
              {/* Neck */}
              <rect x="94" y="54" width="12" height="15" rx="2" className="fill-slate-100 dark:fill-slate-800" />
              {/* Torso */}
              <path
                d="M 68 70 Q 100 66 132 70 L 136 150 Q 100 155 64 150 Z"
                className="fill-slate-100 dark:fill-slate-800"
              />
              {/* Pelvis */}
              <path
                d="M 64 150 Q 100 155 136 150 L 132 188 Q 100 196 68 188 Z"
                className="fill-slate-100 dark:fill-slate-800"
              />
              {/* Left Arm */}
              <path
                d="M 66 72 L 40 120 L 28 165 L 36 168 L 48 126 L 68 84 Z"
                className="fill-slate-100 dark:fill-slate-800"
              />
              {/* Right Arm */}
              <path
                d="M 134 72 L 160 120 L 172 165 L 164 168 L 152 126 L 132 84 Z"
                className="fill-slate-100 dark:fill-slate-800"
              />
              {/* Left Leg */}
              <path
                d="M 72 188 L 70 250 L 68 318 L 84 318 L 88 250 L 96 193 Z"
                className="fill-slate-100 dark:fill-slate-800"
              />
              {/* Right Leg */}
              <path
                d="M 128 188 L 130 250 L 132 318 L 116 318 L 112 250 L 104 193 Z"
                className="fill-slate-100 dark:fill-slate-800"
              />
            </g>

            {/* Interactive Clickable Hotspots */}
            {/* 1. Head */}
            <g
              onClick={() => handleRegionClick("head")}
              className="cursor-pointer transition-all hover:opacity-90"
              role="button"
              tabIndex={0}
              {...regionA11yProps("head")}
            >
              <circle
                cx="100"
                cy="30"
                r="18"
                className={selectedRegion === "head" ? "fill-indigo-500/80 stroke-indigo-600 stroke-2" : "fill-indigo-400/20 hover:fill-indigo-400/50"}
              />
              <text x="100" y="34" textAnchor="middle" fontSize="9" fontWeight="bold" fill={selectedRegion === "head" ? "#fff" : "#4338ca"}>
                Head
              </text>
            </g>

            {/* 2. ENT / Neck (Front only) */}
            {view === "front" && (
              <g
                onClick={() => handleRegionClick("eyes_ent")}
              className="cursor-pointer transition-all hover:opacity-90"
              role="button"
              tabIndex={0}
              {...regionA11yProps("eyes_ent")}
            >
                <rect
                  x="84"
                  y="50"
                  width="32"
                  height="18"
                  rx="4"
                  className={selectedRegion === "eyes_ent" ? "fill-cyan-500/80 stroke-cyan-600 stroke-2" : "fill-cyan-400/20 hover:fill-cyan-400/50"}
                />
                <text x="100" y="62" textAnchor="middle" fontSize="7.5" fontWeight="bold" fill={selectedRegion === "eyes_ent" ? "#fff" : "#0e7490"}>
                  ENT/Throat
                </text>
              </g>
            )}

            {/* 3. Chest (Front) or Upper Back (Back) */}
            {view === "front" ? (
              <g
                onClick={() => handleRegionClick("chest")}
              className="cursor-pointer transition-all hover:opacity-90"
              role="button"
              tabIndex={0}
              {...regionA11yProps("chest")}
            >
                <path
                  d="M 72 74 Q 100 70 128 74 L 130 112 Q 100 115 70 112 Z"
                  className={selectedRegion === "chest" ? "fill-red-500/80 stroke-red-600 stroke-2" : "fill-red-400/25 hover:fill-red-400/50"}
                />
                <text x="100" y="96" textAnchor="middle" fontSize="9" fontWeight="bold" fill={selectedRegion === "chest" ? "#fff" : "#b91c1c"}>
                  Chest / Heart
                </text>
              </g>
            ) : (
              <g
                onClick={() => handleRegionClick("back")}
              className="cursor-pointer transition-all hover:opacity-90"
              role="button"
              tabIndex={0}
              {...regionA11yProps("back")}
            >
                <path
                  d="M 72 74 Q 100 70 128 74 L 130 150 Q 100 155 70 150 Z"
                  className={selectedRegion === "back" ? "fill-emerald-500/80 stroke-emerald-600 stroke-2" : "fill-emerald-400/25 hover:fill-emerald-400/50"}
                />
                <text x="100" y="112" textAnchor="middle" fontSize="9" fontWeight="bold" fill={selectedRegion === "back" ? "#fff" : "#047857"}>
                  Spine / Back
                </text>
              </g>
            )}

            {/* 4. Abdomen (Front) */}
            {view === "front" && (
              <g
                onClick={() => handleRegionClick("abdomen")}
              className="cursor-pointer transition-all hover:opacity-90"
              role="button"
              tabIndex={0}
              {...regionA11yProps("abdomen")}
            >
                <path
                  d="M 70 114 Q 100 116 130 114 L 133 150 Q 100 154 67 150 Z"
                  className={selectedRegion === "abdomen" ? "fill-amber-500/80 stroke-amber-600 stroke-2" : "fill-amber-400/25 hover:fill-amber-400/50"}
                />
                <text x="100" y="135" textAnchor="middle" fontSize="8.5" fontWeight="bold" fill={selectedRegion === "abdomen" ? "#fff" : "#b45309"}>
                  Stomach / Belly
                </text>
              </g>
            )}

            {/* 5. Pelvis / Urinary (Front) or Lower Back (Back) */}
            {view === "front" && (
              <g
                onClick={() => handleRegionClick("pelvis_urinary")}
              className="cursor-pointer transition-all hover:opacity-90"
              role="button"
              tabIndex={0}
              {...regionA11yProps("pelvis_urinary")}
            >
                <path
                  d="M 67 152 Q 100 155 133 152 L 129 184 Q 100 190 71 184 Z"
                  className={selectedRegion === "pelvis_urinary" ? "fill-purple-500/80 stroke-purple-600 stroke-2" : "fill-purple-400/25 hover:fill-purple-400/50"}
                />
                <text x="100" y="172" textAnchor="middle" fontSize="8" fontWeight="bold" fill={selectedRegion === "pelvis_urinary" ? "#fff" : "#6b21a8"}>
                  Pelvis / Urinary
                </text>
              </g>
            )}

            {/* 6. Arms & Shoulders */}
            <g
              onClick={() => handleRegionClick("arms")}
              className="cursor-pointer transition-all hover:opacity-90"
              role="button"
              tabIndex={0}
              {...regionA11yProps("arms")}
            >
              {/* Left arm hotspot */}
              <rect
                x="30"
                y="85"
                width="28"
                height="80"
                rx="6"
                className={selectedRegion === "arms" ? "fill-blue-500/80 stroke-blue-600 stroke-2" : "fill-blue-400/20 hover:fill-blue-400/50"}
              />
              {/* Right arm hotspot */}
              <rect
                x="142"
                y="85"
                width="28"
                height="80"
                rx="6"
                className={selectedRegion === "arms" ? "fill-blue-500/80 stroke-blue-600 stroke-2" : "fill-blue-400/20 hover:fill-blue-400/50"}
              />
              <text x="44" y="130" textAnchor="middle" fontSize="7.5" fontWeight="bold" fill={selectedRegion === "arms" ? "#fff" : "#1d4ed8"}>
                Arm
              </text>
              <text x="156" y="130" textAnchor="middle" fontSize="7.5" fontWeight="bold" fill={selectedRegion === "arms" ? "#fff" : "#1d4ed8"}>
                Arm
              </text>
            </g>

            {/* 7. Legs / Knees / Feet */}
            <g
              onClick={() => handleRegionClick("legs_joints")}
              className="cursor-pointer transition-all hover:opacity-90"
              role="button"
              tabIndex={0}
              {...regionA11yProps("legs_joints")}
            >
              {/* Left leg */}
              <rect
                x="66"
                y="190"
                width="28"
                height="125"
                rx="6"
                className={selectedRegion === "legs_joints" ? "fill-pink-500/80 stroke-pink-600 stroke-2" : "fill-pink-400/20 hover:fill-pink-400/50"}
              />
              {/* Right leg */}
              <rect
                x="106"
                y="190"
                width="28"
                height="125"
                rx="6"
                className={selectedRegion === "legs_joints" ? "fill-pink-500/80 stroke-pink-600 stroke-2" : "fill-pink-400/20 hover:fill-pink-400/50"}
              />
              <text x="80" y="250" textAnchor="middle" fontSize="7.5" fontWeight="bold" fill={selectedRegion === "legs_joints" ? "#fff" : "#be185d"}>
                Knee / Leg
              </text>
              <text x="120" y="250" textAnchor="middle" fontSize="7.5" fontWeight="bold" fill={selectedRegion === "legs_joints" ? "#fff" : "#be185d"}>
                Knee / Leg
              </text>
            </g>

            {/* 8. Skin / General / Whole Body Badge Hotspot */}
            <g
              onClick={() => handleRegionClick("skin")}
              className="cursor-pointer transition-all hover:opacity-90"
              role="button"
              tabIndex={0}
              {...regionA11yProps("skin")}
            >
              <rect
                x="8"
                y="10"
                width="64"
                height="22"
                rx="6"
                className={selectedRegion === "skin" ? "fill-lime-500/80 stroke-lime-600 stroke-2" : "fill-lime-400/20 hover:fill-lime-400/50 stroke-lime-500/40 stroke-1"}
              />
              <text x="40" y="24" textAnchor="middle" fontSize="7.5" fontWeight="bold" fill={selectedRegion === "skin" ? "#fff" : "#4d7c0f"}>
                Skin / General
              </text>
            </g>
          </svg>
          <span className="mt-2 text-[11px] font-medium text-ink-3">
            {ui.tapHint}
          </span>
        </div>

        {/* Right: Quick Region Selector + Pain Scale */}
        <div className="flex flex-col gap-4 lg:col-span-7">
          {/* Quick Body Part Chips */}
          <div>
            <label className="field-label mb-2 block">
              {ui.quick}
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {BODY_REGIONS.map((r) => {
                const active = selectedRegion === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      if ((r.id === "abdomen" || r.id === "pelvis_urinary" || r.id === "eyes_ent") && view !== "front") {
                        setView("front");
                      }
                      handleRegionClick(r.id);
                    }}
                    aria-pressed={active}
                    className={`flex flex-col items-start rounded-lg border p-2 text-left transition-all ${
                      active
                        ? "border-brand bg-brand ring-1 ring-brand font-semibold text-white shadow-sm"
                        : "border-line bg-canvas hover:border-line-strong text-ink-2"
                    }`}
                  >
                    <span className={`text-[12px] font-semibold ${active ? "text-white" : "text-ink"}`}>
                      {getRegionLabel(r.id, r.label)}
                    </span>
                    <span className={`mt-0.5 text-[10px] truncate w-full ${active ? "text-white/80" : "text-ink-3"}`}>
                      {localizeComplaint(r.complaint, lang)}
                    </span>
                    <span className={`mt-0.5 text-[10px] truncate w-full font-medium ${active ? "text-white/80" : "text-ink-3"}`}>
                      {r.departments.join(" · ")}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Selection Details Card */}
          <div className="rounded-xl border border-line bg-sunken p-3.5">
            {currentRegion ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="chip chip-info font-medium">
                    {ui.selectedArea}: {getRegionLabel(currentRegion.id, currentRegion.label)}
                  </span>
                  <span className="text-[12px] font-semibold text-brand">
                    {ui.suggested}: {localizeComplaint(currentRegion.complaint, lang)}
                  </span>
                </div>
                <p className="mt-2 text-[12px] text-ink-2">
                  {getRegionDesc(currentRegion.id, currentRegion.description)}
                </p>
                <p className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[12px] font-semibold text-ink-2">{ui.departments}:</span>
                  {currentRegion.departments.map((d) => (
                    <span key={d} className="chip chip-neutral">{d}</span>
                  ))}
                </p>
              </>
            ) : (
              <p className="py-2 text-center text-[13px] text-ink-2">{ui.tapHint}</p>
            )}
          </div>

          {/* Pain Severity Rating (0 - 10 Visual Analog Scale with expressive faces).
              Shown only after a region is tapped — rating pain for nothing
              selected yet would attach a score to no complaint. */}
          {currentRegion && (
          <div className="rounded-xl border border-line bg-canvas p-4">
            <div className="flex items-center justify-between">
              <label className="field-label font-semibold text-ink flex items-center gap-1.5">
                <Icon name="trending" size={15} className="text-warning" />
                {ui.severityTitle}
              </label>
              <span className="text-sm font-bold text-ink">
                Score: {severity} / 10
              </span>
            </div>

            {/* Visual Emotion Faces Selector */}
            <div className="mt-3 grid grid-cols-5 gap-1.5">
              {severityScale.map((s) => {
                const active =
                  (s.val === 0 && severity === 0) ||
                  (s.val === 2 && severity >= 1 && severity <= 3) ||
                  (s.val === 5 && severity >= 4 && severity <= 6) ||
                  (s.val === 8 && severity >= 7 && severity <= 8) ||
                  (s.val === 10 && severity >= 9);

                return (
                  <button
                    key={s.val}
                    type="button"
                    onClick={() => handleSeverityChange(s.val)}
                    className={`flex flex-col items-center justify-center rounded-lg border py-2 px-1 text-center transition-all ${
                      active
                        ? "border-warning bg-warning-subtle ring-1 ring-warning text-ink shadow-sm"
                        : "border-line bg-sunken hover:border-line-strong text-ink-3"
                    }`}
                  >
                    <span className="text-2xl" role="img" aria-label={s.label}>
                      {s.emoji}
                    </span>
                    <span className="mt-1 text-[11px] font-semibold text-ink">
                      {s.val}
                    </span>
                    <span className="text-[9px] text-ink-3 leading-tight hidden sm:block">
                      {s.desc}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Range Slider for granular control */}
            <div className="mt-3">
              <input
                type="range"
                min="0"
                max="10"
                step="1"
                value={severity}
                onChange={(e) => handleSeverityChange(Number(e.target.value))}
                className="w-full accent-brand h-2 bg-slate-200 rounded-lg cursor-pointer dark:bg-slate-700"
                aria-label="Pain severity slider"
              />
              <div className="flex justify-between text-[10px] text-ink-3 mt-1">
                <span>0</span>
                <span>5</span>
                <span>10</span>
              </div>
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
