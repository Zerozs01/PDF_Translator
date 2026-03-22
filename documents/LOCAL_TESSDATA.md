# Local Tessdata

The OCR worker resolves language data from `public/tessdata` first and falls back to the Tesseract CDN only if a requested file is missing.

## Current Runtime Behavior

- Config source: `src/services/vision/ocr-config.ts`
- `LANG_PATH` is `/tessdata`
- Worker initialization happens in `src/services/vision/worker.ts`
- If local load fails, the worker retries without `langPath` and uses the CDN

## Supported UI Language Codes

Current OCR language codes exposed in the app:

- `eng`
- `jpn`
- `jpn_vert`
- `kor`
- `chi_sim`
- `chi_tra`
- `tha`
- `vie`
- `deu`
- `fra`
- `spa`
- `rus`

## Folder Layout

Put files in:

```text
public/tessdata/
```

Examples:

```text
public/tessdata/eng.traineddata
public/tessdata/jpn.traineddata
public/tessdata/jpn_vert.traineddata
public/tessdata/kor.traineddata
public/tessdata/chi_sim.traineddata
```

Both `.traineddata` and `.traineddata.gz` are usable in the current setup.

## Download Script

Download official language packs:

```bash
npm run tessdata:download
```

Download a specific subset:

```bash
npm run tessdata:download -- --langs=eng,kor,jpn,jpn_vert,chi_sim,chi_tra
```

Force re-download:

```bash
npm run tessdata:download -- --force
```

## Notes

- Restart the dev server after adding or replacing language data.
- The packaged app serves these files from the same `public/tessdata` path.
- Local tessdata is strongly preferred for offline testing and for reproducible OCR behavior across sessions.
