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
- `src/services/vision/worker.ts`: Layout segmentation worker (Tesseract-free)
- `src/services/vision/worker-boot.ts`: boot entry for layout segmentation
- `src/services/vision/worker-stable.ts`: fallback path for layout segmentation

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

- Version: `v49`
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
4. Run OCR (PaddleOCR or EasyOCR)
4. Apply panel normalization:
   - script gate
   - panel safety dedupe
   - geometry normalization with word-union fallback when line bbox is malformed
5. Save page OCR to store and DB
6. Use OCR result as source for translation mapping and overlay preview

Quality profile resolution (panel):

- PaddleOCR: `fast` or `balanced` (auto-prefer `fast` on large non-CJK pages)
- EasyOCR: `best`
- Raw OCR is used only in benchmark mode and is not a pipeline profile

## 4. External OCR Guardrails

For `paddleocr` panel path, service-level safeguards now include:

- malformed Latin geometry anomaly detection
- technical caption/row protection to avoid dropping valid lines in dense document pages
- fallback/merge behavior with EasyOCR when anomaly severity requires recovery
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

## 10. File-Specific OCR Options Persistence

- **State Sync & Hydration**:
  - `useProjectStore` tracks the currently active file and synchronizes with `useOCRTextLayerStore`'s active options.
  - When loading a project (`loadProject`), the system retrieves the file-specific `language`, `engine`, and `ocrQualityProfile` configuration from `localStorage`.
  - To prevent inconsistencies in production mode (where file path resolution might alter/alias the `filePath` to map compatible databases), the storage retrieval key (`fileKey`) is normalized to evaluate `get().filePath || resolvedPath || file.name`.
  - Any changes to OCR options in `useOCRTextLayerStore` trigger a subscription sync that saves options into `localStorage` using the exact same active `filePath` from `useProjectStore`.

## 11. Split-View & Synchronized Scrolling

- **Viewport Split Mode Layout**: `src/components/Viewer/WorkspaceContainer.tsx` implements a dual-pane viewport layout inside the main React area. When `useUIStore.getState().viewMode === 'split'`, the viewport divides into a 50/50 split (Original OCR on the left, Translated result on the right).
- **Zustand Store Extensions & Sync**:
  - `useUIStore` manages `viewMode` (`'overlay' | 'split'`) and `pageMode` (`'single' | 'scroll'`).
  - To prevent state desynchronization, `useProjectStore`'s `viewMode` (`'single' | 'continuous'`) is synchronized bidirectionally with `useUIStore`'s `pageMode` (`'single' | 'scroll'`) via store subscriptions.
- **Canvas Overrides & Double Loading Prevention**: `PDFCanvas` and `ImageCanvas` support a `previewModeOverride?: 'original' | 'translated'` prop. This allows rendering both the original and translated layers side-by-side using the same layout caches, without re-triggering OCR or translation inferences.
- **Zero-Latency DOM-based Synchronization Hook**:
  - High-frequency wheel/drag event updates bypass React's standard re-rendering flow to maintain smooth 60fps lockstep scroll synchronization.
  - In `syncContentTransform` and mouse-dragging `handleMouseMove`, the calculated CSS translation transform string is immediately written to both elements in the DOM.
  - Once interaction settles down, final coordinates are committed back to Zustand in a single atomic update.
- **Session Isolation & Auto-Reset**: Opening a new file or closing the workspace triggers `useUIStore.getState().resetView()`, which automatically resets the split screen viewMode to `'overlay'`. This prevents the side-by-side mode from persisting across different documents.
