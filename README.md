# PDF Translator

Local-first OCR + translation for PDFs and images (manga-focused).

## Quick Start (Windows)

### Requirements

- Node.js (LTS)
- Python 3.x (required for PaddleOCR/EasyOCR and Argos)

### Install

```bash
npm install
```

Notes:

- `npm install` installs Node dependencies only. It does not install Python runtimes, OCR models, or Argos language packs.
- The commands below are required once per machine to enable PaddleOCR/EasyOCR and Argos as the default engines.

### OCR Setup (Required for default experience)

Tesseract language data:

```bash
npm run tessdata:download
```

PaddleOCR/EasyOCR runtime:

```bash
npm run ocr:bootstrap
```

Notes:

- Dev mode expects `.venv-ocr\Scripts\python.exe` (set by `ocr:bootstrap`).
- PaddleOCR models auto-download on first use. You can prefetch Thai models with:
	`python scripts/download-paddle-thai-models.py --mirror`

### Argos Offline Translation (Required for default experience)

```bash
npm run translate:argos:install
npm run translate:argos:install-model
```

### Run (Dev)

```bash
npm run dev
```

### Test

```bash
npm run test
npm run test:e2e
```

### Build

```bash
npm run build
```

## What This App Does

- OCR engines: Tesseract (WASM), PaddleOCR, EasyOCR
- Translation engines: Argos (offline) + Gemini (online, optional)
- OCR panel: benchmarking, result preview, per-page cache

## Docs (Canonical)

- documents/Readme.md
- documents/ARCHITECTURE.md
- documents/OCR_OPTIMIZATION.md
- documents/Roadmap.md
- documents/CHANGELOG.md
