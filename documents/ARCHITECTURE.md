# Current Architecture

This file describes the architecture that exists in the working tree now.
It replaces older speculative notes that no longer match the code.

## 1. Runtime Topology

### Renderer

- `src/App.tsx` builds the shell and lazy-loads the main canvases and sidebars.
- Zustand stores keep project state, OCR options/results, and UI state.
- `src/components/OCR/OCRTextLayerPanel.tsx` is the main OCR operator surface.
- `src/components/Layout/RightSidebar.tsx` exposes OCR quality profiles and Gemini translation controls.

### Electron Main Process

- `electron/main.ts` owns file IO, SQLite access, and Gemini HTTP calls.
- `electron/preload.ts` exposes a whitelist-based `window.electronAPI`.
- `electron/db.ts` stores documents, tags, projects, and OCR cache rows.

### OCR Runtime

- `src/services/vision/VisionService.ts` manages a single active worker slot, queueing, retries, timeout recovery, and worker recreation when the OCR algorithm version changes.
- Primary worker entry is `src/services/vision/worker-boot.ts`.
- `worker-boot.ts` loads `worker.ts`; if that import fails it falls back to `worker-stable.ts`.
- `worker-stable.ts` is a fallback path, not the primary source of OCR behavior.

## 2. File And Cache Flow

1. User opens a file from disk or imports via drag/drop.
2. `useProjectStore.loadProject()` tries to create a canonical imported filepath through `fs:import-file`.
3. The store keeps both runtime `File` data and the canonical path used for DB lookup.
4. `ensureDocumentId()` creates or reuses a `documents` row in SQLite.
5. OCR results are cached in `ocr_cache` by `document_id + page_number`.
6. If a newly imported hash-path document has no OCR yet, the app can fall back to an older document with the same filename and existing OCR cache via `findDocumentsByFilename()` / `getLatestOCR()`.

That alias fallback is important: it keeps older OCR cache usable across source-path and imported-path openings.

## 3. OCR And Searchable PDF Flow

### Panel OCR

- `OCRTextLayerPanel` renders the current page or image to canvas.
- It tries memory cache first, then SQLite cache.
- Cache compatibility currently checks:
  - language
  - DPI
  - `pageSegMode`
  - `algorithmVersion`
  - `pipelineProfile`
  - `ocrQualityProfile`
- Current-page OCR runs through `visionService.ocrForTextLayer(..., 'panel', profile)`.

### Export OCR

- `SearchablePDFService.createSearchablePDF()` runs the batch/export path.
- It optionally skips OCR when a PDF page already has a text layer.
- It renders each page off-screen, performs OCR, persists cache, then injects invisible text through `TextLayerService`.
- Export uses the `export` pipeline profile and the selected quality profile.

## 4. Worker Pipeline Truth

The current OCR behavior in `src/services/vision/worker.ts` is:

1. Preprocess image
   - local-first tessdata path
   - binarization is skipped for CJK and Thai
   - grayscale is kept when needed for later filters/rescans
2. Run one primary Tesseract recognize pass
3. Parse TSV into words and lines
4. Apply early cleanup
   - generic noise cleanup
   - language-specific low-value token cleanup
5. Run bounded rescue stages when budget allows
   - vertical-gap / line-rescan / empty-line / gap recovery for CJK and Korean
   - multiple Latin rescue paths for sparse dialogue pages
6. Apply later filter passes
   - image-tile filtering
   - background-variance filtering
   - isolated CJK noise filtering
   - Korean jamo filtering
   - weak isolated CJK line pruning
   - Latin watermark / line-prune passes
7. Normalize final lines and emit debug payload

Profiles in current code:

- `pipelineProfile`
  - `panel`
  - `export`
- `ocrQualityProfile`
  - `fast`
  - `balanced`
  - `best`

Today these profiles mainly change DPI, stage caps, and recovery budget. They do not yet represent two completely separate OCR architectures.

## 5. Timeouts, Cancellation, And Debug

- Worker request timeout, retry defaults, and per-page OCR timeout live in `src/services/vision/ocr-timeout.ts`.
- Both panel and export paths abort page-scoped OCR and also call `visionService.cancelAll(...)` to tear down in-flight work on timeout/cancel.
- The worker emits debug data:
  - dropped words
  - drop counts by filter
  - stage metrics
  - candidate debug
  - `skipReason`
  - runtime
  - quality profile

## 6. Security Boundaries

- Renderer cannot call arbitrary Node APIs.
- File access and DB access are mediated through preload IPC methods.
- Gemini API key remains in the main process and is never exposed to the renderer bundle.
- Main-process handlers perform basic input validation and path sanitization.

## 7. Known Architecture Debt

- Korean accuracy is still tuned by heuristics without a dedicated fixture pack.
- The regression harness is wired, but the repo still lacks the real manga fixture images it expects.
- `worker.ts` still contains a large amount of heuristic logic, even after modular extraction.
- A true fast OCR architecture is still planned work, not current behavior.
