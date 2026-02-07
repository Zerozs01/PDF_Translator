# Road Map

Active cross-machine plan. Last updated: 2026-02-07.

## Principles

- Use `tessdata_best` for quality. Speed improvements must not reduce accuracy.
- Prefer deterministic OCR output and cache compatibility (language, DPI, `pageSegMode`, preprocessing version).
- Avoid blocking UI. Heavy work should run in workers.

## Current State (Done - 2026-02-07)

- OCR cache auto-load on page change and Current Page forces re-OCR.
- Native file open + `fileData` PDF source to support Recent files.
- Vision worker pool for limited parallel OCR.
- Buffer cloning to avoid `ArrayBuffer` detach errors.

## Phase 1: Stability & Data (Next)

- Guarantee `document_id` for all entry points (open, recent, drag/drop).
- Add OCR cache schema versioning for parameter changes.
- Add clear UI state for "Loaded from cache" vs "Re-OCR".
- Add cancel/abort for OCR jobs and report failures clearly.
- Add file-open error telemetry and recovery hints.

## Phase 2: OCR Accuracy (tessdata_best)

- Add hybrid text extraction for searchable PDFs (skip OCR when text layer exists).
- Add skew/rotation detection before OCR.
- Add confidence-based re-pass for low-confidence lines.
- Add preprocessing profiles for text-heavy vs image-heavy pages.

## Phase 3: Performance

- Add adaptive tile sampling to reduce CPU on high-res pages.
- Prioritize current page in the OCR queue with background prefetch.
- Warm up workers and tessdata on idle to reduce first-run latency.

## Phase 4: Library & UX

- Build library view with persistent metadata and reliable Recent list.
- Show per-page OCR status, timing, and confidence summary.
- Add export presets for searchable PDF output.

## Phase 5: Translation

- Add translation pipeline with chunking, glossary, and QA checks.
- Track translation revisions per page and per version.
