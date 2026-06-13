# Documents Changelog

This changelog tracks updates in `documents/` only.

## 2026-06-13

- Fixed OCR Model Profile Persistence issue: Normalized the local storage key (`fileKey`) between store hydration (`loadProject`) and option changes subscription (`useOCRTextLayerStore.subscribe`) to ensure custom engine and quality profiles are remembered across app restarts, especially in production environments where path aliasing/switching occurs.
- Updated translation cache version from `v47` to `v48` in ARCHITECTURE.md to match implementation.
- Documented background translation queue alignment fixes:
  - Background queue now aggressively runs OCR split and cleaning (`splitAggressiveMergedLines` and `filterGhostOcrData`) to prevent Index Drift and Layout Grouping Mismatch between background processor and active UI canvas.

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
