# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.3] - 2026-03-10

### Fixed — OCR Algorithm v47 (Primary Worker Pipeline)
- **XUJIA TOWN regression**: Added zero-lexical-line re-OCR with unbinarized image. When binarization corrupts text (all words non-lexical), the line is re-OCR'd with the original image and replaced if better lexical matches are found.
- **Case-transition gibberish**: Enhanced `pruneLatinResidualNoiseWords` to detect and drop alternating-case artifacts (e.g. `CREAweaErSRETHIbe`) — 3+ case transitions = garbage.
- **Merged word splitting**: Added `trySplitMergedLatinWord` step to split concatenated words (e.g. `STUDENTSMAY`→`STUDENTS MAY`, `TAKEA`→`TAKE A`, `MAKEDO`→`MAKE DO`).
- **Lowercase noise words**: Added filter to drop non-lexical lowercase artifacts (e.g. `vided`, `wraphimills`) that lack vowels or have long consonant runs.
- **Single-char line drop**: Lines consisting of a single character (except "I") with low confidence are now removed.
- **Dictionary expansion**: Expanded `LATIN_COMMON_WORDS` from ~55 to ~200+ words for better lexical matching. Fixed `XUJITA`→`XUJIA` typo.

## [1.1.0] - 2025-01-29

## [1.2.0] - 2026-02-07

### Added
- Native file open via IPC (`fs:open-file`) to guarantee real file paths for Recent files.
- OCR cache auto-load on page change (no button needed to show cached OCR).
- Limited parallel OCR using a worker pool in `VisionService`.
- OCR metadata now stores `pageSegMode` for cache compatibility checks.

### Changed
- Current Page button now forces re-OCR for the active page (cache is bypassed on purpose).
- PDF rendering prefers in-memory `fileData` for Recent-file opens and avoids detached buffers by cloning per `Document`.
- OCR store resets when loading or closing a file to avoid cross-file leakage.

### Fixed
- Recent file opens that previously failed due to missing path or detached PDF buffers.
- React update-depth loop caused by unstable `Document` file props and OCR cache effects.

### 🔒 Security Improvements

- **API Key Protection**: Moved Gemini API calls from renderer to main process via secure IPC. API keys are no longer exposed in client-side bundle.
- **Electron Security Hardening**: Added explicit security settings (`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`).
- **IPC Whitelist**: Implemented whitelist-based preload API exposure. Only approved channels can be invoked from renderer.
- **Input Validation**: Added validation and sanitization for all IPC handlers to prevent injection attacks.
- **`.gitignore` Update**: Added `.env*` files, database files, and IDE configs to prevent accidental exposure.

### 🐛 Bug Fixes

- **Memory Leak Fix**: Fixed `URL.createObjectURL` leak in `useProjectStore` - now properly revokes old URLs before creating new ones.
- **React Hook Fix**: Removed unused `reset` from `useCallback` dependency array in `OCRTextLayerPanel`.
- **TypeScript Fixes**: Added proper type declarations for Electron APIs, removing all `@ts-ignore` comments.

### ✨ New Features

- **Error Boundary**: Added React Error Boundary component to catch and display errors gracefully instead of crashing the app.
- **Typed Electron API**: New `window.electronAPI` interface with type-safe methods for database and Gemini operations.

### 📝 Documentation

- Updated `ARCHITECTURE.md` with security implementation details
- Created `CHANGELOG.md` (this file)
- Updated `README.md` with current project status
- Updated architecture docs with OCR cache and file source changes (fileData + native open).
- Added `road map.md` and synced documentation index files.

### 🏗️ Technical Improvements

- Created `src/types/electron.d.ts` for proper TypeScript support
- Migrated from raw `ipcRenderer` to typed `electronAPI` with legacy fallback
- Improved code organization in main process with validation helpers

### 🎯 OCR & Segmentation Improvements

- **Smart Region Classification**: Regions are now classified as `text`, `balloon`, or `sfx` based on:
  - Word count and text density
  - Region size relative to page
  - OCR confidence levels
  - Document type (manga vs document)
- **VisionService Stability**:
  - Added request timeout (2 minutes) with auto-retry (up to 2 attempts)
  - Implemented request queue to prevent overlapping OCR requests
  - Added health check and worker crash recovery
- **SearchablePDFService Resilience**:
  - Per-page error handling - failed pages are skipped instead of stopping entire process
  - OCR retry logic with exponential backoff
  - Progress reporting for failed pages
- **TSV Parsing**: Improved word-level bounding box extraction from Tesseract output
- **Document Type Awareness**: Segmentation adapts based on translation mode (manga/official)

## [1.2.2] - 2026-03-10

### Added
- **Worker Boot Loader** (`worker-boot.ts`): tiny ES-module entry that dynamically imports `worker.ts` inside try-catch. On crash it reports the real error via `postMessage(WORKER_BOOT_ERROR)` then auto-falls back to `worker-stable.ts`.
- **7-Layer Filtering Pipeline** in `worker-stable.ts` (expanded from 447→738 lines):
  1. `filterNoiseWords` — garbage word + watermark word removal
  2. `buildLines` — group words into lines by Y proximity
  3. `pruneEdgeGhostLines` — top/bottom 16% band readability gate
  4. `pruneGarbageLines` — lexical ratio + confidence gating per line
  5. `pruneShortFragments` — short non-lexical orphan removal
  6. Density check — totalAlpha ≤ 4 + lexHits < 2 → drop
  7. Page quality gate — avgReadability < 0.35 + lexCount < 2 → clear all
- `LATIN_COMMON` dictionary (~200+ common English words) for lexical classification.
- `LATIN_SHORT_KEEP` set (18 short words: I, A, IT, TO, IN, ON, …) to protect valid short words.
- `isLexicalWord()` strips punctuation before lookup (e.g. DON'T → DONT → found).
- `scoreTokenReadability()` — 0-1 score combining vowel ratio, consonant runs, case mixing, length, confidence.
- Enhanced watermark detection: manga sites (LikeManga, ACloudMerge, ColaManga), standalone COM/IO/NET near edges, URL prefix patterns.
- **Word-Splitting Post-Processor** (`splitMergedWords`): dictionary-based detection of merged OCR words, splits at case boundaries (NowI→Now+I) and dictionary boundaries (TAKEA→TAKE+A, MAKEDO→MAKE+DO, STUDENTSMAY→STUDENTS+MAY).
- **Zero-Lexical Catch-All**: lines with zero dictionary words and confidence < 90 are now dropped (catches `vided`, `Wis`, `wraphimills`, `AVIA TOdl CR En Se`).
- **Mixed-Case Gibberish Detection**: `countCaseTransitions` detects alternating-case garbage (e.g., `CREAweaErSRETHIbe` has 5 case transitions → dropped at word level).
- **Single-Char Line Filter**: standalone single-character lines (except "I") with confidence < 85 are dropped.
- **Per-Word Cleanup**: `cleanNoiseWordsWithinLines` removes fully-lowercase non-lexical words from predominantly-uppercase lines (catches `wraphimills` on mixed lines).
- Expanded `LATIN_COMMON` dictionary to ~260 words: added compound-word prevention (BECOME, FORGET, FOREVER, OVERCOME, etc.) and common words (DONE, GONE, THING, ONE, etc.).

### Changed
- `VisionService.ts` now loads `worker-boot.ts` (not `worker.ts`) as primary entry; handles `WORKER_BOOT` / `WORKER_BOOT_ERROR` messages.
- `vite.config.ts` — added `worker: { format: 'es' }` and `optimizeDeps: { include: ['tesseract.js'] }`.
- OCR Algorithm Version bumped to **46**.

### Improved
- Ghost text ("text ผี") significantly reduced across all pages. Previous stable worker had only a basic 4-rule `filterGarbageWords`; now uses the full 7-layer pipeline.
- Page 2: dropped from 59 ghost words to 22 words total (68% confidence). Main bubble text ("THOSE STUDENTS MAY BE DOING / BAD THINGS TO THE ELDERLY / WEAK WOMEN AND CHILDREN IN") is correctly detected.
- Page 3: dropped from 25 ghost words to 12 words (58% confidence). "I'LL OVER AND / TAKEA LOOK" detected (spacing issue remains: should be "TAKE A LOOK").
- Page 5: dropped from 60 ghost words to 25 words (74% confidence). Core sentences detected but with some noise.

### Known Issues
- **Primary worker crash**: all 3 primary workers still crash with opaque "(no message)" in Vite dev-mode; boot loader captures and falls back to stable worker. Root cause suspected in Vite's module-worker handling of large import trees + tesseract.js CJS pre-bundling.
- **Page 2 line 4**: `XUJIA TOWN` misread as `AVIA TOdl CR En Se` — Tesseract OCR accuracy issue (not fixable by post-filters; the correct text never enters the pipeline).
- **Page 3**: `TAKEA LOOK` now fixed to `TAKE A LOOK` via word-splitting. Ghost `CREAweaErSRETHIbe` now caught by case-transition detection.
- **Page 5**: ghost words `vided`, `Wis`, `wraphimills` now caught by zero-lexical catch-all and per-word cleanup. `NowI`→`Now I`, `MAKEDO`→`MAKE DO` fixed by word-splitting. `THIS KIND OF STUFF` still not detected (Tesseract miss).
- **Page 10**: `THE PEOPLE HERE?` still missing (Tesseract miss).

## [1.2.1] - 2026-03-09

### Changed
- OCR preprocessing now includes adaptive binarization, dark-border cleanup, and lightweight binary repair for thin manga bubble text.
- Latin sparse-page handling is more recall-oriented to reduce over-pruning of valid speech-bubble lines.

### Improved
- Manual validation shows better recovery on sparse manga bubbles, including Page 3 lower-line detection (`TAKE A LOOK!`).

### Known Issues
- Some final / bottom bubble lines are still missed on difficult pages.
- Confirmed follow-up cases:
  - Page 2: missing `Xujia town`
  - Page 5: partial or missing lines including `IN THE PAST, I ONLY FOUND THE`, `WITH`, `THIS KIND OF STUFF..`
  - Page 10: missing `THE PEOPLE HERE?`


---

## [1.0.0] - 2025-01-27

### Initial Release

- Basic PDF/Image loading and viewing
- OCR text layer overlay using Tesseract.js
- Gemini API integration for translation
- SQLite database for OCR caching
- Zero-edge sidebar UI with tools palette
- PDF navigation with thumbnail preview
- Continuous and single-page view modes
