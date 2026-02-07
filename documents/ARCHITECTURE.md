# Architecture (Documents Folder)

This file is a short index for the project architecture. The canonical full document
is at `ARCHITECTURE.md` in the repo root.

## OCR & PDF Pipeline (Summary)

1. **PDF render**: `src/components/OCR/OCRTextLayerPanel.tsx` renders each page to a canvas at a target DPI.
2. **OCR worker**: `src/services/vision/worker.ts` runs Tesseract.js, parses TSV, applies noise + photo filters.
3. **Text layer**: `src/services/pdf/TextLayerService.ts` injects invisible text into the PDF.
4. **Download**: `src/services/pdf/SearchablePDFService.ts` produces a searchable PDF.

## Components

- `src/services/vision/VisionService.ts`: Worker orchestration + retries + progress.
- `src/services/vision/worker.ts`: OCR pipeline + filtering.
- `src/components/PDF/PDFCanvas.tsx`: Viewer + overlay debug render.
- `src/services/dbService.ts`: Document + OCR cache persistence.

## Cache & File Source (2026-02-07)

- OCR cache auto-loads on page change when language, DPI, and `pageSegMode` match.
- Current Page button forces re-OCR (cache bypass) for accuracy after code changes.
- PDF rendering prefers in-memory `fileData` and clones buffers per `Document` to avoid detached `ArrayBuffer` errors.
- Native file open via `fs:open-file` guarantees real file paths for Recent files.

For full system architecture, see `ARCHITECTURE.md`.
