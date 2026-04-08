# Local Tessdata

The app resolves OCR language data from local `public/tessdata` first, then falls back to remote only when required files are missing.

## Local Path

- `public/tessdata`

Examples:

- `public/tessdata/eng.traineddata`
- `public/tessdata/kor.traineddata`
- `public/tessdata/jpn.traineddata`
- `public/tessdata/jpn_vert.traineddata`

## Supported OCR Language Codes (UI)

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

## Commands

Download default language packs:

- `npm run tessdata:download`

Download specific packs:

- `npm run tessdata:download -- --langs=eng,kor,jpn,jpn_vert,chi_sim,chi_tra`

Force refresh:

- `npm run tessdata:download -- --force`

## Troubleshooting

- Restart dev server after adding/replacing traineddata files.
- Verify filenames exactly match language codes used in OCR options.
- If local file missing, the OCR worker may fallback to remote fetch path and change startup latency.
