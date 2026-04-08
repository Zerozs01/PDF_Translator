# Consolidated Knowledge

Short, durable rules that still apply to this repository.

## 1. Source Truth Priority

1. OCR ingest quality
2. Translation mapping integrity
3. Overlay rendering polish

Do not rely on overlay masking to fix upstream OCR errors.

## 2. Geometry Integrity

OCR text without usable geometry is not production-grade.
Always preserve valid line/word boxes and normalize malformed line boxes with deterministic rules.

## 3. Deterministic Over Heuristic Drift

When tuning:

- prefer narrow deterministic guards
- avoid broad threshold relaxation
- isolate changes by page type (comic vs technical document)

## 4. Cache Discipline

Stale cache can hide fixes and fake regressions.
Keep cache versioning strict and tied to behavior changes.

## 5. Validation Discipline

Every meaningful OCR change must pass both:

- Tall comic page fixture
- Dense technical/document fixture

## 6. Translation Mapping Rule

If source OCR line is visible and valid, it must either:

- have translated text mapped by index, or
- be intentionally preserved source text by explicit rule

Silent index gaps are not acceptable.

## 7. Preferred Debug Order

When text appears in OCR but not in overlay:

1. Check OCR dropped-line reasons
2. Check translation input filtering
3. Check translatedByIndex coverage
4. Check preview cache context/fingerprint

## 8. UI Operator Ergonomics

OCR panel tools (copy/search/info) are part of quality control, not cosmetic features.
Improving review speed directly improves OCR tuning cycle quality.
