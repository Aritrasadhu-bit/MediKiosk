// Next.js `?url` asset import for the pdfjs-dist Web Worker.
declare module "pdfjs-dist/build/pdf.worker.mjs?url" {
  const workerUrl: string;
  export default workerUrl;
}