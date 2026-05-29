# Active Roadmap

This roadmap tracks only active and near-term work.

## P0 - Documentation Integrity (Done)

- Consolidated `documents/` into one clean canonical set
- Removed stale deep research dump files
- Updated architecture/optimization docs to match current code (`OCR v210`, translation cache `v45`)

## P1 - OCR Reliability (In Progress)

### Objectives

- Eliminate false drops on dense technical pages
- Keep manga/dialogue recall stable without reintroducing ghost lines
- Keep panel and all-pages OCR behavior consistent

### Next Actions

1. Add fixture-backed tests for technical-row line retention (caption/equation-like lines)
2. Add regression assertions for external anomaly fallback behavior
3. Add diagnostics for dropped-line reason distribution by page type

## P2 - Test Coverage And Fixtures (In Progress)

### Objectives

- Make OCR tuning reproducible
- Reduce screenshot-only debugging loops

### Next Actions

1. Expand fixtures:
   - tall comic sparse balloons
   - dense technical tables/labels
2. Add stable expected-output checks for each OCR engine
3. Add focused tests for translatedByIndex completeness

## P3 - Layer Interactive Manipulation (Completed)

### Objectives

- Enable direct layer editing (position, text, style)
- Protect manual edits from auto-translation overwrite
- Support multi-select operations and undo

### Completed Actions

1. Phase 3 store implementation in `useLayerStore.ts`
2. `userEdited` flag + `editingLayerId` state for edit protection
3. Multi-select with Shift+click toggle
4. Undo stack with MAX_UNDO_DEPTH=20 per page
5. `deletedLineIndexesByPage` tracking for ghost overlay suppression
6. Manual layer creation with auto balloon grouping
7. Translation protection rule in `App.tsx`

## P4 - Performance And Resource Control (Planned)

### Objectives

- Improve perceived panel speed while preserving correctness
- Avoid long-tail timeouts on large pages

### Next Actions

1. Continue profile-aware render constraints and bounded retries
2. Keep cancellation/timeout paths deterministic
3. Instrument per-stage runtime so tuning is evidence-based

## P5 - Translation Quality Flow (Planned)

### Objectives

- Improve mixed-language page handling
- Keep line mapping stable under grouping/redistribution

### Next Actions

1. Strengthen per-group source-language routing checks
2. Add regressions for technical-line preservation in adaptive mode
3. Harden stale-cache prevention in preview mode switching
