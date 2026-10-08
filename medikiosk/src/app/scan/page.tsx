"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/lib/useSession";
import { useT } from "@/lib/useT";
import { speakGuidance } from "@/lib/speech";
import { preprocessCanvas, fileToImage, OCR_LANGS, tesseractForLang } from "@/lib/imageProcess";
import { buildKioskConsent } from "@/lib/consent";
import type { MedicalDocument, DocType, Medication, Investigation } from "@/lib/types";
import { Icon } from "@/components/Icon";
import { KioskShell } from "@/components/AppShell";

const DOC_TYPES: DocType[] =["Prescription", "Lab Report", "Discharge Summary", "Imaging Report", "Other"];

/** Downscale an image file to a base64 JPEG (max ~1200px, q0.8) for server storage. */
async function fileToDataUrl(file: File, maxDim = 1200): Promise<string | null> {
  try {
    const img = await fileToImage(file);
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch {
    return null;
  }
}

/** Maximum documents per visit (matches the "Max 3" promise in the UI). */
const MAX_DOCS = 3;
/** Single files above this are rejected before OCR — phone photos and long
 *  PDFs blow past localStorage quota and wedge the whole kiosk. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Upload an image scan to the server (fire-and-forget with offline tolerance). */
async function uploadScan(file: File): Promise<string | undefined> {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return undefined;
  const dataUrl = await fileToDataUrl(file);
  if (!dataUrl) return undefined;
  try {
    const res = await fetch("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dataBase64: dataUrl.split(",")[1],
        filename: file.name,
        mime: "image/jpeg",
      }),
    });
    if (!res.ok) return undefined; // server rejected/rate-limited — OCR text still travels
    const json = (await res.json()) as { document?: { url?: string } };
    return json.document?.url;
  } catch {
    return undefined; // offline — the OCR text still travels in the encounter
  }
}

export default function ScanPage() {
  const { session, update } = useSession();
  const { t: tr } = useT();
  const router = useRouter();

  const [docs, setDocs] = useState<MedicalDocument[]>(session.documents ?? []);
  const [processing, setProcessing] = useState(false);
  const [ocrText, setOcrText] = useState<string | null>(null);
  const [ocrLang, setOcrLang] = useState<string>(() => tesseractForLang(session.language?.code));
  const [editDocId, setEditDocId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!session.patient) {
      router.replace("/identify");
    } else if (session.attendantMode && session.language?.code) {
      // Attendant-assisted kiosks narrate; helper-OFF kiosks stay silent.
      speakGuidance("scan", session.language.code, session.language.voiceCode);
    }
  }, [session.patient, session.language, session.attendantMode, router]);

  const runOcr = useCallback(
    async (file: File): Promise<{ text: string; pages: number }> => {
      const { createWorker } = await import("tesseract.js");
      // Combine English with the selected language for mixed script docs.
      const langs = ocrLang === "eng" ? "eng" : `eng+${ocrLang}`;
      const worker = await createWorker(langs);
      try {
        if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
          const pdfjs = await import("pdfjs-dist");
          const mod = (await import("pdfjs-dist/build/pdf.worker.mjs?url")) as { default: string };
          pdfjs.GlobalWorkerOptions.workerSrc = mod.default;
          const data = await file.arrayBuffer();
          const pdf = await pdfjs.getDocument({ data }).promise;
          const pages = Math.min(pdf.numPages, 6);
          const chunks: string[] = [];
          for (let i = 1; i <= pages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 1.6 });
            const canvas = document.createElement("canvas");
            canvas.width = Math.min(viewport.width, 2200);
            canvas.height = Math.round((canvas.width / viewport.width) * viewport.height);
            const vp = page.getViewport({ scale: canvas.width / viewport.width });
            // pdfjs v6 render API: the canvas element is required (context resolved internally).
            await page.render({ canvas, viewport: vp }).promise;
            const processed = preprocessCanvas(canvas);
            const { data: ocr } = await worker.recognize(processed);
            chunks.push(ocr.text || "");
          }
          return { text: chunks.join("\n\n--- PAGE BREAK ---\n\n"), pages };
        }
        // Image: preprocess then OCR (handles rotation, low contrast, small text).
        const img = await fileToImage(file);
        const processed = preprocessCanvas(img);
        const { data } = await worker.recognize(processed);
        return { text: data.text || "", pages: 1 };
      } finally {
        await worker.terminate();
      }
    },
    [ocrLang]
  );

  // The UI promises "Max 3" — enforce it here so runaway selections can't
  // flood localStorage (quota failure) or the encounter payload. Rejected
  // files are never even previewed, so no blob URLs leak.
  const [docMsg, setDocMsg] = useState<string | null>(null);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      const room = Math.max(0, MAX_DOCS - docs.length);
      const capped = Array.from(files).slice(0, room);
      const accepted = capped.filter((f) => f.size <= MAX_FILE_BYTES);
      const skippedCount = files.length - accepted.length;
      if (skippedCount > 0) {
        const oversized = capped.filter((f) => f.size > MAX_FILE_BYTES).map((f) => f.name);
        setDocMsg(
          oversized.length
            ? `${oversized.length} file(s) over 10MB were skipped (${oversized.slice(0, 2).join(", ")}${oversized.length > 2 ? "…" : ""}) — retake as a smaller photo or shorter PDF.`
            : `Only ${MAX_DOCS} documents per visit — ${skippedCount} extra file(s) skipped. Remove one below to add another.`
        );
      } else {
        setDocMsg(null);
      }
      if (!accepted.length) return;
      setProcessing(true);
      try {
        for (const file of accepted) {
          const id = crypto.randomUUID();
          const previewUrl = file.type !== "application/pdf" ? URL.createObjectURL(file) : undefined;
          const doc: MedicalDocument = {
            id,
            filename: file.name,
            type: "Other",
            text: "",
            entities: { diagnoses: [], medications: [], investigations: [], procedures: [] },
            abnormalValues: [],
            previewUrl,
            ocrLang,
          };
          setDocs((prev) => [...prev, doc]);

          try {
            const { text, pages } = await runOcr(file);
            const res = await fetch("/api/extract", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              // Pre-save ai_processing tick: without it the route runs the
              // offline heuristic engine only and the text never leaves the
              // hospital.
              body: JSON.stringify({ text, filename: file.name, language: ocrLang, consent: buildKioskConsent(session.consentPurposes ?? []) }),
            });
            // A failed extract must not kill the scan — the OCR text and
            // document are kept, entity extraction just stays empty.
            const json = res.ok ? await res.json() : { entities: {} };

            const finalDoc: MedicalDocument = {
              ...doc,
              type: (json.entities?.type as DocType) ?? "Other",
              date: json.entities?.date,
              text,
              serverUrl: await uploadScan(file),
              entities: {
                diagnoses: json.entities?.diagnoses ?? [],
                medications: json.entities?.medications ?? [],
                investigations: json.entities?.investigations ?? [],
                procedures: json.entities?.procedures ?? [],
              },
              abnormalValues: json.entities?.abnormalValues ?? [],
              pages,
            };
            setDocs((prev) => prev.map((d) => (d.id === id ? finalDoc : d)));
            setOcrText(finalDoc.text);
          } catch (e) {
            console.error("OCR failed", e);
          }
        }
      } finally {
        setProcessing(false);
      }
    },
    [runOcr, ocrLang, session.consentPurposes, docs.length]
  );

  const removeDoc = (id: string) => {
    setDocs((prev) => {
      const doomed = prev.find((d) => d.id === id);
      if (doomed?.previewUrl?.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(doomed.previewUrl);
        } catch {
          /* ignore */
        }
      }
      return prev.filter((d) => d.id !== id);
    });
    if (editDocId === id) setEditDocId(null);
    setDocMsg(null);
  };

  const continueToSummary = () => {
    update({ step: "scan", documents: docs });
    if (session.attendantMode) speakGuidance("summary", session.language?.code, session.language?.voiceCode);
    router.push("/summary");
  };

  const docTypeColor: Record<DocType, string> = {
    Prescription: "bg-info-subtle text-info",
    "Lab Report": "bg-sunken text-ink-2",
    "Discharge Summary": "bg-warning-subtle text-warning",
    "Imaging Report": "bg-sunken text-ink-2",
    Other: "bg-sunken text-ink-2",
  };

  return (
    <KioskShell>
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5">
      <div>
        <div className="flex items-center gap-2 text-sm text-ink-3">
          <span className="chip border-brand-border bg-brand-subtle text-brand">{tr("scanStep")}</span>
          <span>{tr("scanDocTitle")}</span>
        </div>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">{tr("uploadDocs")}</h1>
        <p className="text-[15px] text-ink-2">{tr("scanHint")}</p>
        <div className="banner banner-info mt-2 text-[14px]"><span>{tr("scanOcrNote")}</span></div>
      </div>

      {/* OCR language */}
      <div className="flex flex-wrap items-center gap-3 panel p-4">
        <label className="text-sm font-medium text-ink-2" htmlFor="ocr-lang">
          <span className="field-label">Document language</span>
        </label>
        <select
          id="ocr-lang"
          value={ocrLang}
          onChange={(e) => setOcrLang(e.target.value)}
          disabled={processing}
          className="rounded-xl border border-line-strong px-3 py-2 text-sm text-ink outline-none focus:border-[var(--border-focus)] disabled:opacity-50"
        >
          {OCR_LANGS.map((l) => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>
        <p className="text-[12px] text-ink-3">OCR runs offline in your browser; printed Hindi/regional documents are auto-combined with English.</p>
      </div>

      {/* Upload area */}
      <input
        ref={fileInput}
        type="file"
        multiple
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <button type="button"
        onClick={() => fileInput.current?.click()}
        disabled={processing}
        className="flex min-h-[9rem] flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-line-strong bg-sunken px-4 py-10 text-center transition-colors hover:border-brand hover:bg-brand-subtle disabled:opacity-50"
      >
        {processing ? (
          <span className="spinner h-7 w-7" aria-hidden="true" />
        ) : (
          <Icon name="camera" size={26} className="text-ink-3" />
        )}
        <span className="mt-1.5 text-[15px] font-semibold text-ink">
          {processing ? "Processing and reading documents…" : "Tap to scan or upload documents"}
        </span>
        <span className="text-[13px] text-ink-2">JPG, PNG or PDF &middot; several files at once</span>
      </button>
      {docMsg && (
        <div role="status" className="banner banner-warning text-[14px]">
          <Icon name="alert" size={15} className="mt-px shrink-0" />
          <span>{docMsg}</span>
        </div>
      )}

      {/* Processed docs */}
      {docs.length > 0 && (
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-ink">Processed documents ({docs.length})</h2>
          {docs.map((doc) => (
            <div key={doc.id} className="panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {doc.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={doc.previewUrl} alt={doc.filename} className="h-16 w-14 shrink-0 rounded-lg object-cover shadow" />
                  ) : (
                    <div className="flex h-16 w-14 shrink-0 items-center justify-center rounded-lg bg-sunken text-2xl">
                      <Icon name={doc.pages ? "clipboard" : "file"} size={15} className="text-ink-3" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="min-w-0 break-all font-semibold text-ink">{doc.filename}</p>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${docTypeColor[doc.type]}`}>{doc.type}</span>
                      {doc.serverUrl && <span className="chip chip-info">Stored on server</span>}
                      {doc.date && <span className="text-[12px] text-ink-3">{doc.date}</span>}
                      {doc.pages && doc.pages > 1 && <span className="text-[12px] text-ink-3">{doc.pages} pages</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1 text-xs">
                      {doc.entities.diagnoses.slice(0, 3).map((d) => (
                        <span key={d} className="chip chip-critical">{d}</span>
                      ))}
                      {doc.entities.medications.slice(0, 4).map((m) => (
                        <span key={m.name} className="chip chip-info">{m.name}{m.dosage ? ` ${m.dosage}` : ""}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button type="button" onClick={() => setEditDocId(editDocId === doc.id ? null : doc.id)} className="rounded-lg px-3 py-1 min-h-[44px] text-sm text-ink-2 hover:bg-sunken">
                    {editDocId === doc.id ? "Done" : "Edit"}
                  </button>
                  <button type="button" onClick={() => removeDoc(doc.id)} className="icon-btn min-h-[44px] min-w-[44px]" aria-label="Remove document"><Icon name="close" size={14} /></button>
                </div>
              </div>

              {editDocId === doc.id && <DocEditor doc={doc} onChange={(updated) => setDocs((prev) => prev.map((d) => (d.id === doc.id ? updated : d)))} />}

              {doc.entities.investigations.length > 0 && editDocId !== doc.id && (
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {doc.entities.investigations.map((i) => (
                    <div key={i.test} className={`rounded-lg px-3 py-2 text-xs ${
                      i.flag === "high" ? "bg-critical-subtle text-critical" : i.flag === "low" ? "bg-warning-subtle text-warning" : "bg-sunken text-ink-2"
                    }`}>
                      <span className="font-semibold">{i.test}</span>: {i.value}{i.unit && ` ${i.unit}`}
                      {i.flag && i.flag !== "normal" && <span className="ml-1 font-bold">▲ {i.flag.toUpperCase()}</span>}
                      <div className="text-[10px] text-ink-3">Ref: {i.referenceRange}</div>
                    </div>
                  ))}
                </div>
              )}

              {doc.abnormalValues.length > 0 && editDocId !== doc.id && (
                <div className="mt-2 rounded-lg bg-critical-subtle border border-critical-border px-3 py-2 text-xs font-medium text-critical">
                  <strong>Abnormal values detected:</strong> {doc.abnormalValues.map((v) => `${v.test} (${v.value} ${v.unit ?? ""})`).join(", ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* OCR raw text debug (small, collapsible) */}
      {ocrText && (
        <details className="rounded-lg border border-line bg-sunken p-3 text-[13px] text-ink-2">
          <summary className="cursor-pointer font-medium">View raw OCR text</summary>
          <p className="mt-2 whitespace-pre-wrap max-h-40 overflow-y-auto">{ocrText}</p>
        </details>
      )}

      <div className="flex items-center justify-between">
        <button type="button"
          onClick={() => router.push("/history")}
          className="btn btn-secondary btn-lg"
        >
          <Icon name="arrowLeft" size={15} /> {tr("backToHistory")}
        </button>
        <button type="button"
          onClick={continueToSummary}
          className="btn btn-primary btn-lg"
        >
          {tr("generateSummary")}
          <Icon name="arrowRight" size={16} />
        </button>
      </div>
    </div>
    </KioskShell>
  );
}

/** Inline editor for AI-extracted entities (verification before send to physician). */
function DocEditor({ doc, onChange }: { doc: MedicalDocument; onChange: (d: MedicalDocument) => void }) {
  const addDiag = (v: string) => {
    const vv = v.trim();
    if (!vv || doc.entities.diagnoses.includes(vv)) return;
    onChange({ ...doc, entities: { ...doc.entities, diagnoses: [...doc.entities.diagnoses, vv] } });
  };
  const addMed = (m: Medication) => {
    if (!m.name.trim()) return;
    onChange({ ...doc, entities: { ...doc.entities, medications: [...doc.entities.medications, m] } });
  };
  const addInv = (i: Investigation) => {
    if (!i.test.trim()) return;
    onChange({
      ...doc,
      entities: { ...doc.entities, investigations: [...doc.entities.investigations, i] },
      abnormalValues: [...doc.entities.investigations, i].filter((x) => x.flag && x.flag !== "normal"),
    });
  };
  return (
    <div className="mt-3 rounded-xl border border-warning-border bg-warning-subtle/50 p-4 fade-up">
      <p className="mb-3 text-[13px] font-semibold text-ink">Verify the extracted details — correct anything wrong before continuing.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-ink-2">Document type</span>
          <select
            value={doc.type}
            onChange={(e) => onChange({ ...doc, type: e.target.value as DocType })}
            className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-sm"
          >
            {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-ink-2">Date (YYYY-MM-DD)</span>
          <input
            value={doc.date ?? ""}
            onChange={(e) => onChange({ ...doc, date: e.target.value || undefined })}
            placeholder="2026-09-20"
            className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-sm"
          />
        </label>
      </div>

      <TagEditor label="Diagnoses" items={doc.entities.diagnoses} onAdd={addDiag}
        onRemove={(v) => onChange({ ...doc, entities: { ...doc.entities, diagnoses: doc.entities.diagnoses.filter((x) => x !== v) } })} />

      <div className="mt-3 text-sm">
        <p className="text-ink-2 mb-1">Medications</p>
        <div className="flex flex-col gap-1">
          {doc.entities.medications.map((m, i) => (
            <div key={`${m.name}-${i}`} className="flex items-center gap-2 rounded-md border border-line bg-sunken px-2 py-1 text-xs">
              <span>{m.name} {m.dosage ?? ""}</span>
              <button type="button"
                onClick={() => onChange({ ...doc, entities: { ...doc.entities, medications: doc.entities.medications.filter((_, j) => j !== i) } })}
                className="ml-auto text-ink-3 hover:text-critical"
                aria-label={`Remove ${m.name}`}
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          ))}
        </div>
        <AddRow placeholder="Medicine name (e.g. Metformin)" onAdd={(v) => addMed({ name: v })} />
      </div>

      <div className="mt-3 text-sm">
        <p className="text-ink-2 mb-1">Investigations</p>
        <div className="flex flex-col gap-1">
          {doc.entities.investigations.map((i, idx) => (
            <div key={`${i.test}-${idx}`} className="flex items-center gap-2 rounded-md border border-line bg-sunken px-2 py-1 text-xs">
              <span>{i.test}: {i.value}{i.unit ? ` ${i.unit}` : ""}{i.flag && i.flag !== "normal" ? ` (${i.flag})` : ""}</span>
              <button type="button"
                onClick={() => onChange({ ...doc, entities: { ...doc.entities, investigations: doc.entities.investigations.filter((_, j) => j !== idx) } })}
                className="ml-auto text-ink-3 hover:text-critical"
                aria-label={`Remove ${i.test}`}
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          ))}
        </div>
        <AddRow placeholder="test:value:unit:flag (e.g. Hemoglobin:11:g/dL:low)" onAdd={(raw) => {
          const [test, value, unit = "", flag = "normal"] = raw.split(":").map((s) => s.trim());
          addInv({ test, value: value ?? "", unit, flag: (flag as Investigation["flag"]) ?? "normal" });
        }} />
      </div>
    </div>
  );
}

function TagEditor({ label, items, onAdd, onRemove }: { label: string; items: string[]; onAdd: (v: string) => void; onRemove: (v: string) => void }) {
  return (
    <div className="mt-3 text-sm">
      <p className="text-ink-2 mb-1">{label}</p>
      <div className="flex flex-wrap gap-1">
        {items.map((v) => (
          <span key={v} className="flex items-center gap-1 rounded-md border border-line bg-sunken px-2 py-1 text-xs">
            {v}
            <button type="button" className="text-ink-3 hover:text-red-500" onClick={() => onRemove(v)} aria-label="Remove value"><Icon name="close" size={13} /></button>
          </span>
        ))}
      </div>
      <AddRow placeholder={`Add ${label.toLowerCase()}...`} onAdd={onAdd} />
    </div>
  );
}

function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (v: string) => void }) {
  const [value, setValue] = useState("");
  const inputId = `addrow-${placeholder.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  return (
    <div className="mt-2 flex gap-2">
      <label htmlFor={inputId} className="sr-only">{placeholder}</label>
      <input
        id={inputId}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            onAdd(value.replace(/,\s*$/, ""));
            setValue("");
          }
        }}
        placeholder={placeholder}
        className="min-h-[44px] flex-1 rounded-lg border border-line-strong px-3 py-1.5 text-xs outline-none focus:border-[var(--border-focus)]"
      />
      <button type="button"
        onClick={() => {
          onAdd(value.replace(/,\s*$/, ""));
          setValue("");
        }}
        className="min-h-[44px] rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-hover"
      >
        Add
      </button>
    </div>
  );
}