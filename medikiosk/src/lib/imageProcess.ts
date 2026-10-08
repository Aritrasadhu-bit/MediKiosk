// Client-side image preprocessing for OCR reliability.
// Pure browser helpers — no framework imports.

/** Scales + grayscales + contrast-stretches an image to maximize Tesseract accuracy. */
export function preprocessCanvas(src: HTMLCanvasElement | HTMLImageElement | ImageBitmap, maxDim = 2200): HTMLCanvasElement {
  const scale = Math.min(1, maxDim / Math.max(src.width, src.height));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(src.width * scale));
  out.height = Math.max(1, Math.round(src.height * scale));
  const ctx = out.getContext("2d", { willReadFrequently: true });
  if (!ctx) return out;
  ctx.drawImage(src, 0, 0, out.width, out.height);

  // Grayscale + adaptive contrast stretch
  const imageData = ctx.getImageData(0, 0, out.width, out.height);
  const data = imageData.data;
  const gray = new Float32Array(out.width * out.height);
  let min = 255;
  let max = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[p] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(max - min, 1);
  const lo = min + range * 0.02;
  const hi = max - range * 0.02;
  const spread = Math.max(hi - lo, 1);
  let idx = 0;
  for (let p = 0; p < gray.length; p++, idx += 4) {
    const v = ((gray[p] - lo) / spread) * 255;
    const c = v < 0 ? 0 : v > 255 ? 255 : v;
    data[idx] = c;
    data[idx + 1] = c;
    data[idx + 2] = c;
  }
  ctx.putImageData(imageData, 0, 0);
  return out;
}

export async function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode image file."));
    img.src = url;
  });
}

/** Tesseract.js language codes supported by our 10-language dictionary. */
export const OCR_LANGS: { code: string; label: string }[] = [
  { code: "eng", label: "English" },
  { code: "hin", label: "Hindi (हिन्दी)" },
  { code: "ben", label: "Bengali (বাংলা)" },
  { code: "tam", label: "Tamil (தமிழ்)" },
  { code: "tel", label: "Telugu (తెలుగు)" },
  { code: "mar", label: "Marathi (मराठी)" },
  { code: "guj", label: "Gujarati (ગુજરાતી)" },
  { code: "kan", label: "Kannada (ಕನ್ನಡ)" },
  { code: "mal", label: "Malayalam (മലയാളം)" },
  { code: "pan", label: "Punjabi (ਪੰਜਾਬੀ)" },
];

/** Map a MediKiosk UI language code to a Tesseract code (fallback English). */
export function tesseractForLang(langCode?: string): string {
  const map: Record<string, string> = {
    hi: "hin",
    bn: "ben",
    ta: "tam",
    te: "tel",
    mr: "mar",
    gu: "guj",
    kn: "kan",
    ml: "mal",
    pa: "pan",
    en: "eng",
  };
  return map[langCode ?? ""] ?? "eng";
}