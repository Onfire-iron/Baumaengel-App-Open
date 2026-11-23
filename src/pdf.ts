// =============================================================
// PDF.js einrichten: wird von der Plan-Ansicht und vom Bericht genutzt
// =============================================================

// "legacy" ist die PDF.js-Ausgabe, die auch auf etwas älteren iPads läuft
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
// "?worker&url" statt "?url": So übersetzt Vite auch den Worker für ältere iPads (build.target)
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&url';

// PDF.js braucht einen "Worker", der im Hintergrund die PDF-Datei liest
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// Hilfsdateien von PDF.js (Schriften, Decoder für Scans), siehe scripts/copy-pdfjs-assets.js
const pdfjsFiles = new URL(`${import.meta.env.BASE_URL}pdfjs/`, location.href).href;

// Achtung: PDF.js verbraucht die übergebenen Daten
export function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  return pdfjsLib.getDocument({
    data,
    cMapUrl: `${pdfjsFiles}cmaps/`,
    standardFontDataUrl: `${pdfjsFiles}standard_fonts/`,
    wasmUrl: `${pdfjsFiles}wasm/`,
    iccUrl: `${pdfjsFiles}iccs/`,
  }).promise;
}
