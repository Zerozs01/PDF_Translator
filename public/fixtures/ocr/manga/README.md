Fixture images referenced by `expectations.json` are intentionally not stubbed with fake content.

Add these real OCR regression images before running `npm run ocr:regression`:

- `page-02-students.png`
- `page-03-take-a-look.png`
- `page-05-tianhai.png`

The harness will fail fast with a clear `Fixture image missing` error until those files exist.
