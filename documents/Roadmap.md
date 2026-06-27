# Active Roadmap

This roadmap tracks only active and near-term work.

## P0 - Documentation Integrity (Done)

- Consolidated `documents/` into one clean canonical set
- Removed stale deep research dump files
- Updated architecture/optimization docs to match current code (`OCR v215`, translation cache `v51`, and custom glossary)

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

## P4 - Performance And Resource Control (Completed)

### Objectives

- Improve perceived panel speed while preserving correctness
- Avoid long-tail timeouts on large pages

### Completed Actions

1. **Python OCR Daemon:** Developed a background Python OCR daemon (`external_ocr_bridge.py`) that bypasses cold-start initialization times for PaddleOCR and EasyOCR models.
2. **Zero-copy IPC:** Optimized large file transfers using a zero-copy direct file access path in `documentFileAccess.ts`.
3. **Virtualization & Timeout Controls:** Bounded processing times with customizable timeout handles and automated recovery mechanisms.

## P5 - Translation Quality Flow (Completed)

### Objectives

- Improve mixed-language page handling
- Keep line mapping stable under grouping/redistribution

### Completed Actions

1. **Custom Glossary UI sidebar:** Integrated a new sidebar panel (`GlossarySidebarPanel.tsx`) in LeftSidebar to allow custom dictionary rule management.
2. **Glossary Service Hook:** Bound `useGlossaryStore` dictionary items directly into `sfxDictionaryService.ts` to hook translation pipelines and force correct custom translation outputs.
