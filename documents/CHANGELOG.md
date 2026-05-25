# Documents Changelog

This changelog tracks updates in `documents/` only.

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
