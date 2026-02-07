# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
