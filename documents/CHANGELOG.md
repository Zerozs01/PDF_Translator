# Documents Changelog

This changelog tracks updates in `documents/` only.

## 2026-06-16

- Fixed OCR Ghost Line filtering for PaddleOCR when word details are missing (preventing valid English text lines like `and was at a` or `all aristocrats` from being dropped as low-signal/no-word boxes).
- Resolved translation carry-over skip issues for short dialogue phrases by mapping direct Thai translations in `ARGOS_SHORT_PHRASE_LOOKUP_TH` (for phrases like `and was at a`, `recapturina`, `all aristocrats`, `kina and`, `an all-out`, and `but in any age`).
- Integrated local debugging tools in electron's main process database handlers (`db:save-ocr` and `db:get-ocr` in `main.ts`) for Doc 3 Page 25 to help audit raw OCR lines.
- Updated `documents/Knowledge.md` to define translation carry-over rules and short phrase bypass guidelines.

## 2026-06-13

- Completed the Tesseract Purge: Removed all Tesseract dependencies, assets, and fallback code from the project. PaddleOCR and EasyOCR are now solidified as the primary local engines.
  - Deleted `public/tessdata/`, `eng.traineddata`, `spa.traineddata`, `scripts/download-tessdata.js`, and `scripts/ocr-tesseract-helper.js`.
  - Uninstalled `tesseract.js` package and removed the `"tessdata:download"` npm script.
  - Refactored `ocr-worker-shared.ts` to remove unused Tesseract lifecycle/pooling functions (`withWorkerInitLock` and `ensureWorkerForLanguage`).
  - Updated `OCRRegressionHarness.tsx` error message to reference EasyOCR instead of Tesseract.
  - Patched `AuthGuard.tsx` to bypass authentication checks during OCR regression benchmark runs (`ocr_harness=1`), preventing browser-side TypeError hangs.
  - Cleaned up Tesseract references and defaults from `run-ocr-regression.mjs`, `ocr-benchmark-matrix.mjs`, and `ocr-table-benchmark.py`.
- Fixed OCR Model Profile Persistence issue: Normalized the local storage key (`fileKey`) between store hydration (`loadProject`) and option changes subscription (`useOCRTextLayerStore.subscribe`) to ensure custom engine and quality profiles are remembered across app restarts, especially in production environments where path aliasing/switching occurs.
- Updated translation cache version from `v47` to `v48` in ARCHITECTURE.md to match implementation.
- Documented background translation queue alignment fixes:
  - Background queue now aggressively runs OCR split and cleaning (`splitAggressiveMergedLines` and `filterGhostOcrData`) to prevent Index Drift and Layout Grouping Mismatch between background processor and active UI canvas.
- Re-integrated EasyOCR in the OCR Benchmark Panel and added support for RAW vs FULL pipeline evaluation for EasyOCR by developing `run_easyocr_raw` on the Python daemon and allowing dynamic IPC routing.
- Fixed an issue in `run_paddleocr_raw` where word and line outputs resolved to 0 due to key mismatches with `ocr.ocr()` output structure, and calculated average confidence values for raw OCR runs (Paddle and Easy) instead of returning 0%.
- Implemented Side-by-Side Split View & Synchronized Scrolling Architecture:
  - Integrated `SplitViewToggle` button in the header and created `WorkspaceContainer` to manage dual-pane viewport rendering.
  - Added bidirectional synchronization subscriptions between `useProjectStore`'s `viewMode` (`'single' | 'continuous'`) and `useUIStore`'s `pageMode` (`'single' | 'scroll'`).
  - Added high-performance real-time DOM-based transform syncing during scrolls and drags in both `PDFCanvas` and `ImageCanvas` for smooth 60fps lockstep movement.
  - Implemented automatic split screen reset (`resetView` resetting `viewMode` to `'overlay'`) on project load and close.

## 2026-06-01

- Updated the OCR/translation docs to reflect current offline hardening:
  - offline all-pages translation now uses any cached OCR page instead of a strict selected-engine gate
  - Korean offline translation prefers the `ko -> en -> th` pivot path more aggressively
  - short mixed-symbol OCR garbage tokens are filtered before translation
  - Korean phrase repair rules were added for common noisy comic lines

## 2026-05-28

- Synced version constants in docs to match code:
  - OCR algorithm version `210`
  - Translation cache version `v45`
- Updated OCR profile list to include `raw` pipeline profile

## 2026-05-31

- Corrected OCR pipeline profile list to `panel | export` (raw is benchmark-only)
- Documented panel quality toggle mapping (Paddle: fast/balanced, others: best)
- Added benchmark notes: Base runs full pipeline, Improve compares raw vs full

## 2026-05-29

- OCR progress UI: right-aligned percent and ETA; page-based estimate with single-page fallback
- Disabled offline translation popup in global loading overlay to reduce UI noise
- Roadmap version note updated to OCR v210 / cache v45
- TODO reorganized into open items vs completed notes
- Added release checklist commands to docs readme

## 2026-05-21

- **Phase 3: Interactive Manipulation (Edit Layer)**
  - Added `userEdited` flag to TextLayer to protect manual edits from auto-translation overwrites
  - Implemented `editingLayerId` state for inline text editing
  - Added multi-select support (`selectedLayerIds` as Set) with Shift+click toggle
  - Implemented undo stack (`undoStackByPage`) with MAX_UNDO_DEPTH=20
  - Added `deletedLineIndexesByPage` tracking to prevent ghost overlay after layer deletion
  - Phase 3 actions: `updateLayerBBox`, `updateLayerText`, `updateLayerRotation`, `updateLayerFontSize`, `updateLayerBackgroundColor`, `updateLayerTextColor`, `updateLayerBold`
  - Multi-select drag via `updateMultiLayerBBoxDelta`
  - Manual layer creation via `addManualLayer` with auto balloon grouping
  - Translation protection rule: if `layer.userEdited`, skip auto-translation (`App.tsx:7720`)

## 2026-05-09

- Optimized Offline (Argos) Translation Pipeline:
  - Implemented unconditional Latin text lowercasing to resolve translation failures on ALL-CAPS and mixed-case OCR noise.
  - Applied early-stage OCR noise repair (`normalizeEnglishOcrNoiseForTranslation`) to line collection.
  - Exempted common short English words ('I', 'A', 'OK', etc.) from ghost and scientific symbol filters.
  - Relaxed balloon grouping thresholds in `shouldHarmonizeOverlayBlock` to prevent top-line clipping.
  - Fixed redistribution fallback to use noise-repaired source text.

## 2026-05-08

- Updated changelog to match main `CHANGELOG.md` for v1.2.15 changes:
  - EasyOCR chunking support with engine-specific chunk parameters
  - Windows process force kill via `taskkill /F /T /PID`
  - Main process `process.on('exit')` last-resort cleanup handler
  - OCR Algorithm version bump **193 → 200**

## 2026-04-08

- Performed full documentation refresh to match current codebase state.
- Updated canonical values:
  - `OCR_ALGORITHM_VERSION = 200`
  - `OCR_TRANSLATION_CACHE_VERSION = v18`
- Rewrote and simplified:
  - `ARCHITECTURE.md`
  - `OCR_OPTIMIZATION.md`
  - `Roadmap.md`
  - `Knowledge.md`
  - `Readme.md`
  - `LOCAL_TESSDATA.md`
- Removed outdated/unstructured research dump files:
  - `deep-research-report.md`
  - `deep-research-report2.md`
- Added explicit notes for latest OCR stability fixes:
  - technical-line retention guards for panel/external paths
  - OCR Result operator UX updates (copy overlay button + in-panel search)

## 2026-04-07

- Last pre-refresh doc snapshot before cleanup.
- Retained as historical anchor only; implementation truth is now in rewritten files above.
