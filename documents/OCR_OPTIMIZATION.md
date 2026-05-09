# OCR Optimization (Active)

This is the active OCR optimization playbook. Historical version-by-version logs were intentionally trimmed.

## 1. Baseline

- OCR algorithm version: `200`
- Translation cache version: `v18`
- Engines: `tesseract`, `paddleocr`, `easyocr`
- Pipeline profiles: `panel`, `export`
- Quality profiles: `fast`, `balanced`, `best`

## 2. Current Stability Strategy

### Upstream First

Always fix errors as early as possible in OCR ingest instead of relying on downstream overlay masking.

### Deterministic Cleanup

Use deterministic line/geometry rules before cache write:

- panel script gate
- panel safety dedupe
- word-union geometry fallback when line bbox is suspicious
- external engine anomaly handling in `VisionService`

### Cache Integrity

After OCR logic changes, keep versioning strict so stale data cannot mask behavior changes.

## 3. Recent Critical Fix (2026-04-08)

Target page issue: OCR detected lines existed but translated overlays were missing for technical rows.

Implemented safeguards:

1. `VisionService` now treats technical caption-like anomaly lines as critical:
   - avoid minor-drop for those lines
   - force fallback path when necessary
2. Panel safety dedupe skips low-signal ghost drop for technical document-like lines.
3. Translation ghost filter can keep valid technical lines via a dedicated bypass guard.
4. OCR Result usability improved for manual verification:
   - copy button moved to OCR Result overlay corner
   - in-panel search added for long OCR text inspection

## 4. Validation Rules

Every important OCR logic change must be validated on both fixtures:

- Tall comic page: sparse balloons, long scroll, mixed line heights
- Dense technical/document page: labels, numbers, equations, table rows

Minimum checks per change:

- no new false line drops on technical rows
- no duplicate explosion on manga speech
- no translatedByIndex gaps for visible source lines
- no cache mismatch due to stale version keys

## 5. Tuning Order Policy

When regressions appear, tune in this order:

1. Detect whether source line is dropped before cache write
2. Detect whether line is filtered in translation input stage
3. Detect whether line exists in `translatedByIndex`
4. Detect whether preview mode is reading stale translation cache
5. Adjust thresholds only in the narrowest stage that caused the failure

## 6. Versioning Policy

Bump OCR algorithm version whenever core OCR/cleanup/geometry behavior changes.

Bump translation cache version whenever redistribution/grouping/index mapping logic changes.
