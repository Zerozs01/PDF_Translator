# Active Roadmap

This roadmap is intentionally short. It reflects the current code path and priority order.

## Current Baseline

- Canonical docs now live in `documents/`
- OCR algorithm version: `96`
- Current OCR runtime:
  - single Tesseract worker plus external OCR bridges
  - OCR engines: `tesseract`, `paddleocr`, `easyocr`
  - `panel` and `export` pipeline profiles
  - UI defaults to the best-quality OCR path for each engine
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

### Done in v94

- OCR text-layer now carries `documentType`, so document OCR no longer runs through the full manga-biased late Latin cleanup path
- OCR cache compatibility includes `documentType`
- document numeric tails such as `Chapter 5` have contextual short-number preservation in late cleanup
- manga terminal punctuation can be restored from matching raw TSV line text
- deterministic reorder/fix added for the `AYNAR TAKES THIS ESSENCE` line family

### Done in v95

- TSV parsing now drops empty level-5 words instead of letting blank high-confidence boxes pollute the OCR word graph
- chunked OCR now keeps chunk-derived line seeds and chunk line boxes instead of rebuilding the whole tall page only from flat words
- final Latin line rebuilding preserves existing line structure when available instead of always reseeding from a naive Y-only grouping pass
- document OCR can keep strong singleton numeric lines during late residual line prune
- document OCR trims weak leading singleton artifacts on otherwise strong lines, targeting `I To` / `me To` style bullet ghosts without touching manga speech

### Done in v96

- chunked manga OCR now forces `SPARSE_TEXT` per chunk instead of inheriting the generic dense-page Latin PSM
- late document tail trimming no longer strips short numeric heading tails such as `Chapter 5`
- document leading-artifact trim is stricter for `I To`-style ghosts
- manga late Latin cleanup now splits vertically staggered words back into multiple lines when Tesseract collapses stacked speech lines into one seed line

### Done in v97

- recovery budget now arms after base OCR instead of being consumed by tall-page chunk OCR before rescue starts, while keeping a bounded tail-budget for panel/export stability
- punctuated short manga lines from raw line boxes are protected before late Latin prune, so detected I THINK..., EH?!, ME?!!, and similar shout/speech fragments are harder to drop accidentally
- vertical-flow Latin line splitting is more conservative, reducing over-splitting such as AYNAR being separated from TAKES THIS or HOW being split from MUCH FOR
- document OCR now looks for nearby lexical heading context when reintroducing short numeric tokens and can merge numeric suffix lines such as Chapter + 5
- document leading-artifact trim now handles pipe-like bullet ghosts such as | To
### Done in v98

- very tall manga pages no longer rely only on broad top/mid/side sparse probes; they now have a bounded speech-region OCR reconstruction path that groups raw line boxes into bubble-like regions and re-OCRs those regions directly
- chunked document pages with already-strong evidence now use conservative cleanup, reducing over-pruning risk and avoiding extra rescue work that can push long pages toward timeout
- the tall-page reconstruction path chooses between SINGLE_BLOCK and SPARSE_TEXT per region and accepts region output by line-level quality instead of only token-level rescue acceptance
### Done in v99

- very tall manga pages now prefer bounded speech-region reconstruction before older Latin rescue stages can consume the recovery budget
- short punctuated shout lines like `EH?!` are accepted by tall-region OCR without requiring lexical hits
- accepted tall regions can replace only the overlapping bad lines instead of needing a whole-page rebuild to win outright
- late manga vertical-flow split is skipped after a tall-region rebuild to preserve the recovered bubble structure
- document OCR performs a final heading-numeric restore from base OCR words and trims stronger `| To` / `I To` style leading artifacts

### Done in v96 external-engine tuning

- OCR model selection is now first-class in the UI, with `Tesseract`, `PaddleOCR`, and `EasyOCR`
- external engines prewarm once per language/session instead of rechecking on every document
- `PaddleOCR` CPU runtime now uses one shared bridge instance per language, a lighter detector, and per-profile detection limits to reduce late-page stalls on ordinary manga pages while keeping document recall high
- current-page export/download remains page-scoped instead of rebuilding the full document
- external OCR now reflows detected words back into lines after cleanup, instead of trusting raw engine grouping directly
- `export` cleanup now drops more isolated uppercase/image-label fragments before line reflow, targeting document image ghosts such as ship labels and stray one-letter boxes
- external engine runtimes are now written into `debug.runtimeMs`, so the OCR panel can compare model speed without special-casing bridge debug output

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







