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

For full system architecture, see `ARCHITECTURE.md`.
