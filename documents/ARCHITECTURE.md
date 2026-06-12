# Current Architecture

This document describes the architecture as implemented in the current working tree.

## 1. Runtime Topology

### Renderer

- `src/App.tsx`: application shell, translation orchestration, grouping/dedup logic
- `src/components/OCR/OCRTextLayerPanel.tsx`: OCR operator panel, cache load/save flow, benchmark, OCR Result preview/search
- Zustand stores:
  - `useProjectStore`: file/project/session state
  - `useOCRTextLayerStore`: OCR options, OCR page cache, translation cache per page/model
  - `useUIStore`: UI state

### Electron Main Process

- `electron/main.ts`: IPC handlers and orchestration
- `electron/preload.ts`: whitelisted secure API to renderer
- `electron/db.ts`: SQLite access layer

### OCR Runtime

- `src/services/vision/VisionService.ts`
  - queue + timeout + retry + worker lifecycle
  - external OCR bridge orchestration
  - chunk merge + post-cleanup for external engines
- `src/services/vision/worker.ts`: main Tesseract OCR pipeline
- `src/services/vision/worker-boot.ts`: boot entry
- `src/services/vision/worker-stable.ts`: fallback path

## 2. Cache And Identity

### OCR Cache

- Persisted per `document_id + page_number + engine`
- Compatibility checks include:
  - language
  - dpi
  - pageSegMode
  - algorithmVersion (`214`)
  - pipelineProfile
  - ocrEngine
  - ocrQualityProfile

### Translation Cache

- Version: `v48`
- Key dimensions include:
  - OCR engine + OCR language
  - source language + target language
  - translation mode
  - translator engine (`offline` / `ai`)
- Stores `translatedByIndex` mapping and `sourceFingerprint` to prevent stale overlay mapping.

## 3. OCR Flow (Panel)

1. Render page to canvas
2. Attempt in-memory cache, then DB cache
3. Resolve OCR quality profile (panel toggle + engine heuristics)
4. Run OCR (Tesseract or external engine)
4. Apply panel normalization:
   - script gate
   - panel safety dedupe
   - geometry normalization with word-union fallback when line bbox is malformed
5. Save page OCR to store and DB
6. Use OCR result as source for translation mapping and overlay preview

Quality profile resolution (panel):

- PaddleOCR: `fast` or `balanced` (auto-prefer `fast` on large non-CJK pages)
- Tesseract/EasyOCR: `best`
- Raw OCR is used only in benchmark mode and is not a pipeline profile

## 4. External OCR Guardrails

For `paddleocr` panel path, service-level safeguards now include:

- malformed Latin geometry anomaly detection
- technical caption/row protection to avoid dropping valid lines in dense document pages
- fallback/merge behavior with Tesseract when anomaly severity requires recovery
- minor-anomaly drop only for non-critical lines

This reduces false drops for lines such as technical sentence fragments and numbered caption rows.

## 5. Translation Flow

1. **OCR Pre-processing & Alignment (UI & Background):** Before building groups or starting translation, the raw OCR results are normalized. Both the foreground UI and background queue (`BackgroundQueueProcessor`) run identical pre-processing via `splitAggressiveMergedLines` and `filterGhostOcrData` to ensure 100% layout and line index alignment (preventing Index Drift).
2. **Collect & Synchronize Layers:** Collect translatable lines from OCR lines. In the UI, the Zustand layer store is checked for staleness and synchronously rebuilt using `buildLayerGroupsFromOCR` before proceeding.
3. **Ghost Line Filtering:** Skip ghost lines, but allow technical bypass for valid technical lines.
4. **Group Building:** Build groups (`line-by-line`, `dense-dialogue`, or `default`).
5. **Batch Translation:** Translate by source-language buckets (`offline` or `ai`).
6. **Redistribution:** Redistribute translated group text back to sequential line indices (`lineIdx`).
7. **Persistence:** Persist `translatedByIndex` and preview from cache aligned with the OCR fingerprint.

## 6. Layer Store (Phase 3: Interactive Manipulation)

`src/stores/useLayerStore.ts` manages position layers with full interactive manipulation:

- **Data structures:**
  - `layersByPage: Map<number, TextLayer[]>` — per-page layer list
  - `groupsByPage: Map<number, TextLayerGroup[]>` — balloon/paragraph grouping
  - `deletedLineIndexesByPage: Map<number, Set<number>>` — track deleted lines to suppress ghost overlays

- **Selection:** `selectedLayerIds: Set<string>` supports multi-select (Shift+click toggle)
- **Editing state:** `editingLayerId` for inline text editing mode
- **Undo stack:** `undoStackByPage` with MAX_UNDO_DEPTH=20 per page

- **Phase 3 actions:**
  - `updateLayerBBox` — drag/resize
  - `updateLayerText` — inline edit (sets `userEdited: true` on translation layer)
  - `updateLayerRotation` / `updateLayerFontSize` / `updateLayerBold`
  - `updateLayerBackgroundColor` / `updateLayerTextColor`
  - `updateMultiLayerBBoxDelta` — multi-select drag
  - `synchronizeGroupBBox` — recalculate balloon bbox after child moves
  - `addManualLayer` — creates manual text layer with auto balloon group

- **Manual Edit Protection:** `App.tsx` Rule 1 (line ~7720) skips auto-translation when `layer.userEdited === true`

## 7. UI Notes (OCR Result)

`OCRTextLayerPanel` now provides:

- runtime/process info popup
- overlay copy button at top-right of OCR Result area
- OCR Result search with:
  - keyword highlight
  - match count
  - Prev/Next navigation
  - active-line emphasis

## 8. Custom Glossary System

- **Glossary State Store:** `src/stores/useGlossaryStore.ts` tracks user glossary terms and sound effects (SFX) with localStorage persistence.
- **Glossary Sidebar UI:** `src/components/Layout/GlossarySidebarPanel.tsx` is embedded within the `LeftSidebar.tsx` views, allowing users to:
  - Add new terms or SFX translation overrides (Korean/English source to Thai target).
  - Search and filter by entry types (`TERM` or `SFX`).
  - Toggle items active/inactive in real-time or delete them.
- **Dictionary Service Integration:** `src/services/translation/sfxDictionaryService.ts` integrates with `useGlossaryStore` to intercept raw source text and replace it with glossary terms during translation post-processing.

## 9. Security Boundary

- Renderer uses only preload-exposed API
- DB/file/bridge execution stays in Electron main process
- No direct Node API in renderer
