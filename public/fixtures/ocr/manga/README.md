# Manga OCR Fixtures

Fixture images referenced by `expectations.json` are intentionally not stubbed with fake content.

This folder is only for OCR regression fixtures (test artifacts), not for normal app import.
The app can still OCR PDF/JPEG/PNG from user documents as usual.

Add these real OCR regression images before running `npm run ocr:regression`:

- `page-02-students.png`
- `page-03-take-a-look.png`
- `page-05-tianhai.png`

The harness will fail fast with a clear fixture asset missing error until those files exist.

Fixture case format now supports both image and PDF assets:

- Image fixture: `image`: `fixtures/ocr/manga/xxx.png`
- PDF fixture: `pdf`: `fixtures/ocr/manga/xxx.pdf`, `pdfPage`: page number to render for OCR (1-based)

Current `expectations.json` still points to PNG paths, so either add those PNG files or switch each case to the PDF fields above.

Recommended one-shot commands:

- Strict quality gate (fixtures required): `npm run ocr:gate`
- Strict quality gate + require Korean fixtures: `npm run ocr:gate:kor`
- Partial local smoke test (allows missing fixtures): `npm run ocr:benchmark:partial`
