# OCR Optimization (Active)

This is the active OCR optimization playbook. Historical version-by-version logs were intentionally trimmed.

## 1. Baseline

- OCR algorithm version: `210`
- Translation cache version: `v45`
- Engines: `paddleocr`, `easyocr`
- Pipeline profiles: `panel`, `export`
- Quality profiles: `fast`, `balanced`, `best`

Notes:
- "Raw" is a benchmark-only path (raw OCR vs full pipeline), not a pipeline profile.
- OCR quality toggle in the panel maps to:
   - PaddleOCR (panel): `fast` or `balanced` (auto-downgrade to `fast` on large/non-CJK pages)
   - EasyOCR: `best`

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
## 7. Pipeline Stabilization (2026-05-09)

Recent fixes focused on the **Offline Argos Translation** pipeline and **Comic Balloon** detection:

### 7.1 Core Normalization Strategy
Instead of complex heuristics for casing, we now:
- **Unconditionally lowercase** Latin text before translation (Argos performs much better on lowercase).
- This eliminates failures caused by "mixed-case" OCR noise (e.g., "FAiR" blocking the lowercasing of a whole sentence).
- Sentiment and sentence structure are preserved by capitalizing the first letter of sentences post-lowercasing.

### 7.2 Early Noise Repair
Noise repair (removing trailing underscores, fixing split possessives) is now applied **at the point of line collection**. This ensures all downstream consumers (grouping, cache, translation) see clean text.

### 7.3 Semantic Filter Exemptions
Specific short English words are now protected from aggressive filters:
- **`isScientificSymbolLikeLine`**: No longer swallows "I" or "A" as diagram labels.
- **`isLikelyGhostTranslatableLine`**: No longer drops "I" or "OK" as OCR artifacts.

### 7.4 Balloon Harmonization
Grouping tolerances were relaxed to allow higher vertical gaps and height ratios. This prevents the top line of a speech bubble from being excluded from the merged mask/border.

## 8. Offline Translation Hardening (2026-06-01)

The offline pipeline now includes a few targeted protections to keep Korean comic dialogue closer to the quality expected from English routes:

- **All-pages cache selection**: translation batch jobs no longer skip pages just because the selected OCR engine is different from the cached engine already present for that page.
- **Korean source cleanup**: `ko` source text is normalized with Korean OCR spacing/noise cleanup before Argos receives it.
- **Pivot bias**: Korean `ko -> th` routes prefer the `ko -> en -> th` pivot path more aggressively when direct output still looks weak or untranslated.
- **Garbage token filter**: short OCR artifacts with mixed brackets/symbols and digits are dropped before translation.
- **Phrase repair**: a small local fallback glossary handles a few recurring noisy comic lines so they do not degrade the final Thai output.

## 9. PaddleOCR Cold Start & Memory Optimization (2026-06-13)

To optimize memory usage and keep the startup footprint minimal, a series of lazy loading and process recycling policies were implemented:

- **Zero Startup Footprint**: Delayed/automatic boot-time prewarming in `src/App.tsx` has been disabled. Python/PaddleOCR subprocesses are only spawned when a document is actually opened or OCR is explicitly requested.
- **Aggressive Memory Cleanup**: Post-processing now runs `cleanup_memory()` in `external_ocr_bridge.py` which forces Python garbage collection (`gc.collect()`) and releases CUDA cache for both PyTorch and PaddlePaddle immediately.
- **5-Minute Idle Timeout**: A timer-based lifecycle is enforced. Subprocesses are automatically terminated and released after 5 minutes of total inactivity.
- **Workspace Close Teardown**: Closing a document/workspace triggers an immediate `cancelExternal` call to forcefully terminate all running OCR processes.
- **Memory & Stability Verification Gate**: Added `--benchmark-memory-leak` main process startup flag and `"benchmark:memory-leak"` npm script to audit and guarantee initial main process RSS < 120MB (achieved `109.82 MB`).
