# Project Documentation

`documents/` is the canonical working documentation for the current codebase.
Use this folder as the source of truth before relying on older root-level notes.

## Current Code Snapshot (2026-03-21)

- Runtime: Electron + Vite + React 19 + Zustand
- OCR: Tesseract.js in module workers, local `public/tessdata` first, CDN fallback
- PDF output: `pdf-lib` searchable PDF with invisible text layer
- Cache: SQLite via `better-sqlite3`
- Translation: Gemini call goes through Electron main process IPC
- OCR baseline: `OCR_ALGORITHM_VERSION = 93`
- Default OCR path: single worker, `panel` pipeline, `best` quality profile

## Canonical Docs

- `ARCHITECTURE.md`  
  Current runtime topology, data flow, cache model, and security boundaries.

- `OCR_OPTIMIZATION.md`  
  Current OCR pipeline truth, Korean tuning notes, and what changed from older plans.

- `Roadmap.md`  
  Priority order for the next implementation phases.

- `LOCAL_TESSDATA.md`  
  How local language packs are resolved and downloaded.

- `CHANGELOG.md`  
  Documentation-only changelog for this folder.

## Research

- `Knowledge.md`  
  Consolidated research takeaways that still matter for this repo.
- `deep-research-report.md`
- `deep-research-report2.md`

The two research reports are ad-hoc investigation notes, not canonical implementation docs.
Use them as input when planning deeper OCR changes, but treat `ARCHITECTURE.md`,
`OCR_OPTIMIZATION.md`, and `Roadmap.md` as the working truth for the repo.

## Current Gaps

- Korean tuning still lacks a dedicated reproducible fixture bundle.
- The manga OCR regression harness still needs real fixture images under `public/fixtures/ocr/manga`.
- `fast` / `balanced` / `best` share one core OCR pipeline today; they mostly differ by DPI, rescue caps, and runtime budget, not by a fully separate fast architecture.

## Working Rule

- Need exact code behavior: read `ARCHITECTURE.md` and `OCR_OPTIMIZATION.md`
- Need next tasks: read `Roadmap.md`
- Need theory or future-looking ideas: read `Knowledge.md`
