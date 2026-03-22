# Active Roadmap

This roadmap is intentionally short. It reflects the current code path and priority order.

## Current Baseline

- Canonical docs now live in `documents/`
- OCR algorithm version: `93`
- Current OCR runtime:
  - single worker
  - `panel` and `export` pipeline profiles
  - `fast`, `balanced`, `best` quality profiles
- Main blocker for confident Korean work: no dedicated Korean fixtures

## P0. Documentation And Baseline Lock

Status: done

- refreshed docs to match the working tree
- reduced duplicate planning files
- removed obsolete research/archive pointer files after consolidation
- aligned the OCR plan with `worker.ts` instead of older notes

## P1. OCR Core Stabilization

Status: in progress

### Done in v92

- Latin rescue and Latin prune now share a line-quality assessment instead of using fully separate keep/drop heuristics
- anchor probes require a recovered line that passes the shared Latin recovery contract
- post-prune line rescue now emits its own candidate debug stage (`postPruneLine`)
- Latin garbage / isolated / residual prune paths now keep readable sentence-like lines more consistently and drop obvious short ghost profiles earlier

### Done in v93

- trailing lowercase non-lexical tail trim is now constrained so high-confidence readable document tails are not deleted
- worker logging now exposes late Latin tail trimming directly
- sparse probe rescue now uses the shared Latin line assessment before accepting new lines
- anchor-probe protection is stricter for ghost-like Latin fragments

### Next

- validate whether the English ghost-line / missing-line failures now move from acceptance problems to raw-region OCR problems
- if they do, improve bounded Latin region recognition before adding more keep/drop exceptions
- turn the recurring screenshot cases into reproducible fixtures

## P2. Korean Accuracy Stabilization

Status: in progress

### Done in v87

- early protection for short Korean punctuated lines
- safer keep rule for short punctuated Korean speech in weak-line pruning
- stricter neighbor support requirement for weak short Korean fragments without punctuation
- Korean large-gap lines now enter line-rescan more reliably
- Korean line-rescan tries multiple PSMs instead of only one horizontal assumption
- bounded Korean gap-fallback is enabled for missing middle chunks
- panel debug now splits Korean-relevant filter stages more clearly

### Done in v88

- Korean heavy recovery is no longer blocked by generic CJK page caps on moderate speech-heavy pages
- suspicious Korean lines with low-confidence or non-syllable short tokens are prioritized for line-rescan
- suspicious Korean line-rescan uses a wider crop
- Korean line-rescan can replace a worse overlapping line instead of append-only merging
- panel debug now exposes line replacements in the rescan stage summary

### Done in v89

- Korean line-rescan now triggers more often on damaged short speech lines by using a stricter Korean coverage threshold
- short punctuated Korean lines can enter line-rescan even when the base line looks superficially stable
- Korean `lineRescan` and `gapFallback` now accept aligned short Hangul syllables at lower confidence than generic CJK recovery
- Korean recovery budget is larger than the generic CJK budget for these bounded rescue stages

### Done in v90

- Korean line-rescan can retry against a binarized full-page input when the normal region OCR still misses glyphs
- very short Korean lines use a wider rescan crop

### Done in v91

- Korean `lineRescan` now uses a lower source confidence gate than generic CJK
- Korean `gapFallback` also uses a lower source confidence gate
- Korean line-rescan adds a tight `RAW_LINE` + 2x upscale attempt
- Korean line-rescan can inspect more candidate lines per page

### Next

- add reproducible Korean page fixtures or stored debug payloads
- add Korean-specific stage counters
- confirm whether remaining misses come from:
  - early filtering
  - weak-line over-keep
  - true Tesseract miss
- only then evaluate continuity rescue

### Exit Criteria

- fewer short Korean ghost fragments
- no obvious spike in empty-line drops
- no timeout regression in panel mode

## P3. Performance Separation

Status: planned

- turn `fast` into a truly lighter execution path instead of only a smaller budget
- make image/background filtering more conditional on page noise signature
- add clearer per-stage ROI measurements before removing or adding heavy passes

## P4. Testing And Tooling

Status: planned

- add the real regression fixture images expected by `public/fixtures/ocr/manga/expectations.json`
- add Korean fixtures
- add unit tests for core OCR helper/filter modules
- keep report output focused on coverage, suspicious ratio, fragmentation, and runtime

## P5. Product Surface After OCR Stabilizes

Status: later

- stronger manual OCR correction flow
- better translation/editor workflow
- any detector-first or editor-heavy work only after OCR baseline is trustworthy

## Not On The Immediate Critical Path

These older ideas are intentionally de-prioritized until OCR is stable:

- PSD export
- bubble-aware editor mode
- YOLO/layout-model experiments
- RAG/document-retrieval features
