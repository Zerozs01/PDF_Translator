# Consolidated Research Notes

This file keeps the research takeaways that still matter for the repo.
It is not the place for exact thresholds or current file-level behavior. For that, use `ARCHITECTURE.md` and `OCR_OPTIMIZATION.md`.

## 1. Durable Principles

### Text-layer-first beats OCR

If a PDF page already contains real text, extracting that text is more accurate and cheaper than OCR. The current repo already follows this in the export path through `SearchablePDFService`.

### Detection-first OCR is still the highest-upside future upgrade

The current repo mostly performs full-page OCR plus heuristic filtering and rescue. Research still supports region-first OCR as the strongest long-term way to reduce ghost text, especially on manga, textured pages, and mixed layouts.

### Geometry must stay first-class

Useful OCR output is not only text. It must keep:

- word and line boxes
- confidence
- page dimensions
- stable cache identity

That principle already exists in the repo and should not be weakened during tuning.

### Preprocessing should be evidence-based, not globally relaxed

Earlier experiments already showed that broad threshold relaxation can increase ghost text. Research and project history point in the same direction:

- improve the exact failing stage
- keep changes narrow
- measure the before/after effect

### Confidence and language-aware cleanup are mandatory

Tesseract will often return something even when the visual evidence is weak. The current code correctly treats OCR as a noisy candidate stream that needs:

- image/text-background filtering
- lexical or script-aware cleanup
- line-level pruning
- bounded rescue

### Translation, RAG, and editor workflows are downstream concerns

Better OCR quality should happen before translation, LLM polishing, or search/retrieval. Garbage text passed downstream becomes harder and more expensive to fix later.

## 2. What The Current Repo Already Implements

- PDF text-layer skip in export mode
- local tessdata path with CDN fallback
- OCR quality profiles: `fast`, `balanced`, `best`
- two runtime contexts: `panel` and `export`
- cache persistence in SQLite
- cache compatibility checks using language, DPI, `pageSegMode`, algorithm version, pipeline profile, and quality profile
- debug payloads with drop counts, stage metrics, candidate traces, runtime, and skip reason
- Korean-specific filtering for:
  - isolated CJK noise
  - jamo-heavy artifacts
  - weak isolated CJK lines

## 3. What The Repo Does Not Implement Yet

- detector-first region OCR
- local deskew per text region
- explicit per-region angle in OCR output
- reproducible Korean fixture suite
- unit-test coverage for the OCR heuristic modules
- true editor/data model for bubble-aware replacement or PSD export

Those older ideas are not wrong, but they are not the current critical path.

## 4. Research-Backed Next Upgrades After The Korean Baseline Stabilizes

1. Add Korean fixtures and saved debug payloads so tuning stops depending on memory and screenshots.
2. Add Korean-specific stage counters so keep/drop changes can be measured, not guessed.
3. Evaluate limited detector-first OCR only for hard pages, not as an immediate repo-wide rewrite.
4. Add local deskew only where debug evidence shows slanted speech or rotated regions are a real failure mode.
5. Add unit tests for the filter stages before doing deeper heuristic expansion.

## 5. De-Scoped For Now

These ideas remain valid but are intentionally not active work right now:

- PSD export architecture
- full manga editor workflow
- RAG integration
- YOLO / layout-model experiments

The repo needs a stable OCR baseline first, especially for Korean pages.
