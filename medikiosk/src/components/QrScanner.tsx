"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

type Props = {
  onResult: (code: string) => void;
  onClose: () => void;
};

export default function QrScanner({ onResult, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<"unsupported" | "denied" | null>(null);
  const doneRef = useRef(false);

  // Escape closes the dialog; focus starts on the close button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelled = false;
    // @ts-expect-error BarcodeDetector may not exist in all browsers
    const Detector = window.BarcodeDetector;
    (async () => {
      if (!Detector) {
        setError("unsupported");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        // The permission prompt can outlive the scanner: if the user closed it
        // while deciding, the granted stream would otherwise stay live (camera
        // light on) with no owner to stop it.
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          stream = null;
          return;
        }
        const supportsFormat = await Detector.getSupportedFormats?.();
        if (supportsFormat && !supportsFormat.includes("qr_code")) throw new Error("QR format unsupported");
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const detector = new Detector();
        const tick = async () => {
          if (doneRef.current) return;
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (video && canvas && video.readyState >= 2) {
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            try {
              const codes = await detector.detect(canvas);
              if (codes.length && !doneRef.current) {
                doneRef.current = true;
                onResult(String(codes[0].rawValue));
                return;
              }
            } catch {
              /* frame skipped */
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        setError("denied");
      }
    })();
    return () => {
      cancelled = true;
      doneRef.current = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="qr-title" className="w-full max-w-md rounded-xl border border-line bg-canvas p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 id="qr-title" className="flex items-center gap-2 text-base font-semibold text-ink">
            <Icon name="qr" size={18} className="text-ink-3" />
            Scan ABHA QR code · <span lang="hi">ABHA QR स्कैन करें</span>
          </h3>
          <button onClick={onClose} autoFocus className="icon-btn min-h-[44px] min-w-[44px]" aria-label="Close scanner">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="relative mt-3 overflow-hidden rounded-lg bg-ink">
          <video ref={videoRef} className="h-64 w-full object-cover" muted playsInline />
          <canvas ref={canvasRef} className="hidden" width={480} height={420} />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-44 w-44 rounded-lg border-2 border-brand opacity-80" />
          </div>
        </div>
        {error && (
          <p className="banner banner-critical mt-3" role="alert">
            <Icon name="alert" size={15} className="mt-px" />
            {error === "unsupported"
              ? "QR camera scanning not supported in this browser — please enter the ABHA ID manually. · इस ब्राउज़र में QR स्कैन नहीं होगा, ABHA ID लिखें।"
              : "Could not access the camera. Enable camera permission or enter the ABHA ID manually. · कैमरा नहीं खुला, अनुमति दें या ABHA ID लिखें।"}
          </p>
        )}
        <p className="mt-2 text-[13px] text-ink-2">
          Point the camera at the ABHA QR code on the patient&apos;s health card.
        </p>
        <button onClick={onClose} className="btn btn-secondary mt-3 min-h-[48px] w-full">
          Enter manually instead
        </button>
      </div>
    </div>
  );
}