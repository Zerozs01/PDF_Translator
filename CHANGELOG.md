# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2025-01-29

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

### 🏗️ Technical Improvements

- Created `src/types/electron.d.ts` for proper TypeScript support
- Migrated from raw `ipcRenderer` to typed `electronAPI` with legacy fallback
- Improved code organization in main process with validation helpers

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
