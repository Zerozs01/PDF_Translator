# Offline OCR Language Data

This project can load Tesseract language data from local files to support
offline OCR testing.

## How It Works

The worker uses `LANG_PATH` in `src/services/vision/worker.ts`:

- Default: `/tessdata`
- If local files are missing, it falls back to CDN automatically.

## Setup

1. Create folder (or use the script below):
   - `public/tessdata`

2. Place language files inside:
   - `public/tessdata/eng.traineddata`
   - `public/tessdata/jpn.traineddata`
   - `public/tessdata/kor.traineddata`
   - `public/tessdata/chi_sim.traineddata`
   - `public/tessdata/chi_tra.traineddata`

3. Restart the dev server.

## Auto Download Script

Use the built-in script to fetch official Tesseract.js language data:

```bash
npm run tessdata:download
```

Download only specific languages:

```bash
npm run tessdata:download -- --langs=eng,kor,chi_sim
```

Force re-download:

```bash
npm run tessdata:download -- --force
```

## Notes

- File names must match language code exactly.
- Files can be `.traineddata` or `.traineddata.gz`.
- The worker logs which path was used during initialization.
