# Project Documentation

`documents/` is the canonical working documentation for this repository.

All content here is kept in sync with the current codebase and should be preferred over older ad-hoc notes.

## Current Snapshot (2026-05-29)

- OCR algorithm version: `210`
- Translation cache version: `v45`
- OCR engines in UI: `tesseract`, `paddleocr`, `easyocr`
- OCR profiles: `pipelineProfile = panel | export | raw`, `ocrQualityProfile = fast | balanced | best`
- Translation modes: `adaptive | manga | manhwa | official`
- OCR panel now includes:
  - panel script-gate + panel safety dedupe before cache write
  - technical-line guards to prevent false drop on dense document pages
  - OCR Result tools: overlay copy button + in-panel search (highlight + Prev/Next)
  - progress UI: right-aligned percent + ETA (page-based with single-page fallback)

## Canonical Files

- `ARCHITECTURE.md`: runtime topology, data flow, OCR/translation cache flow
- `OCR_OPTIMIZATION.md`: active OCR tuning rules and validation policy
- `Roadmap.md`: prioritized implementation plan
- `LOCAL_TESSDATA.md`: local language pack setup and troubleshooting
- `Knowledge.md`: compact operating principles and lessons that still apply
- `CHANGELOG.md`: documentation change history in this folder

## Commands Most Used

- `npm run dev`
- `npm run test`
- `npm run ocr:regression`
- `npm run ocr:regression:paddle`
- `npm run ocr:regression:easy`
- `npm run ocr:benchmark`
- `npm run tessdata:download`

## Before Release

- `npm run ocr:gate`
- `npm run test`
- `npm run test:e2e`
- `npm run build`

## Cleanup Notes

- Removed stale deep research dump files that were no longer actionable in daily development.
- Consolidated active knowledge into `Knowledge.md` and implementation-specific truth into `ARCHITECTURE.md` and `OCR_OPTIMIZATION.md`.
