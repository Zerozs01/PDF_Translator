# Project Documentation

`documents/` is the canonical working documentation for the current codebase.
Use this folder as the source of truth before relying on older root-level notes.

## Current Code Snapshot (2026-03-31)

- Runtime: Electron + Vite + React 19 + Zustand
- OCR: Tesseract.js in module workers, local `public/tessdata` first, CDN fallback
- PDF output: `pdf-lib` searchable PDF with invisible text layer
- Cache: SQLite via `better-sqlite3`
- Translation: offline-first Argos Translate via Electron main process IPC, with Gemini fallback when offline translation is unavailable
- OCR baseline: `OCR_ALGORITHM_VERSION = 146`
- Default OCR path: single worker, `panel` pipeline, `best` quality profile
- External OCR panel hygiene now includes bridge-side merged Latin spacing recovery, deterministic watermark suppression, and service-side residual singleton cleanup (`externalResidualSingleton`)

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

## OCR Validation Commands

- `npm run ocr:regression`
  - Runs harness with default engine (`tesseract`) and writes `.tmp-ocr-report.json`.
- `npm run ocr:regression:paddle`
  - Runs panel regression for `paddleocr` and writes `.tmp-ocr-report-paddle.json`.
- `npm run ocr:regression:easy`
  - Runs panel regression for `easyocr` and writes `.tmp-ocr-report-easy.json`.
- `npm run ocr:benchmark`
  - Runs matrix benchmark across `tesseract`, `paddleocr`, `easyocr` and emits:
    - `.tmp-ocr-benchmark.json`
    - `.tmp-ocr-benchmark.md`
- `npm run ocr:benchmark:ci`
  - Same matrix run, exits non-zero when risky pages or expectation failures are present.

## Translation Commands

- `npm run translate:argos:install`
  - Installs the Argos Translate Python package into the active Python environment.
- `npm run translate:argos:doctor`
  - Prints installed Argos language codes visible to the active Python executable.
- `npm run translate:argos:install-model`
  - Installs the default Argos model pair `en -> th`.
- `npm run translate:argos:install-model:ko-th`
  - Installs `ko -> en` for Korean OCR translation via pivot (with `en -> th` already installed).
- `npm run translate:argos:install-model:es-th`
  - Installs `es -> en` for Spanish OCR translation via pivot (with `en -> th` already installed).

Argos model packages for each language pair must still be installed in that same Python environment.
Some language pairs (for example `es -> th`) are not published as direct Argos packages, so a pivot chain is required.

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
- A rare panel residual singleton (for example `15`) can still leak on some watermark-heavy pages; use dropped-word debug reasons to tune thresholds case-by-case.

## Working Rule

- Need exact code behavior: read `ARCHITECTURE.md` and `OCR_OPTIMIZATION.md`
- Need next tasks: read `Roadmap.md`
- Need theory or future-looking ideas: read `Knowledge.md`
