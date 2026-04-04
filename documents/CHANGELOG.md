# Documents Changelog

This file tracks documentation changes inside `documents/` only.

## 2026-04-04

- Added a renderer-side translation overlay checkpoint to `OCR_OPTIMIZATION.md` covering the current split-mask/split-text architecture, translation cache hydration behavior, and effective profile fallback between `official` and `manga` style rendering.
- Updated the canonical OCR/document baseline to match live code:
  - `OCR_ALGORITHM_VERSION = 146`
  - translation cache version is `v4`
  - translation cache keys include translation mode and translator engine
- Recorded the current known overlay issues instead of treating the latest renderer tuning as finished:
  - document heading/body hierarchy is still not stable enough
  - Thai upper/lower diacritics can still clip on fitted document text
  - manga pages with multiple balloons on the same row can still produce inconsistent text sizing or partial mask coverage
- Refreshed roadmap priorities so the next OCR/product work is anchored to the current document/manga overlay state instead of the older v96 baseline notes.

## 2026-03-29

- Updated the canonical docs to match the current external OCR architecture:
  - OCR algorithm version is now `96`
  - OCR runtime now includes `Tesseract`, `PaddleOCR`, and `EasyOCR`
  - external OCR prewarm is session/language scoped instead of per-document
  - `PaddleOCR` CPU tuning now uses a shared bridge instance plus per-profile detection limits
- Added a new optimization note describing why external render constraints and Paddle's own detection limits must be tuned together.
- Recorded the first external OCR cleanup/reflow pass:
  - external OCR now reflows words into lines after cleanup
  - document-oriented cleanup drops more isolated image-label ghosts before reflow
  - external engine runtime is now exposed via `debug.runtimeMs` for UI comparison

## 2026-03-21


## 2026-03-31

- Updated canonical docs to match current OCR baseline: `OCR_ALGORITHM_VERSION = 146`.
- Documented external OCR panel cleanup behavior now active in code:
  - bridge-side merged Latin spacing recovery (`mergedLatinSplit`)
  - bridge-side deterministic panel watermark suppression (geometry + lexical evidence, no text-color dependency)
  - service-side residual singleton suppression (`externalResidualSingleton`) for panel non-CJK pages
- Updated architecture notes to reflect cache compatibility keys including `ocrEngine`.
- Updated warm-up notes for external models: preferred engine warm starts almost immediately after open, secondary engine remains deferred/idle-aware.
- Declared `documents/` as the canonical working documentation folder.
  - single-worker OCR runtime
  - `worker-boot.ts` primary entry with `worker-stable.ts` fallback
  - cache aliasing by filename
  - `panel` / `export` pipeline profiles
  - `fast` / `balanced` / `best` quality profiles
  - secure Gemini IPC flow
- Replaced duplicate planning/history in `OCR_OPTIMIZATION.md` and `Roadmap.md` with current priorities.
- Consolidated the older research documents into one active summary file: `Knowledge.md`.
- Removed the obsolete archive-pointer files `Knowledge2.md` and `Knowledge3.md` after their content was fully consolidated.
- Kept `deep-research-report.md` as a research note because it contains active external OCR investigation, not just a stale redirect.
- Recorded the first Korean-focused v87 tuning pass and the current blocker: no reproducible Korean fixture bundle yet.
- Recorded the v88 follow-up that removes the generic CJK gate bottleneck for Korean heavy recovery and adds Korean line replacement during rescan.
- Recorded the v89 follow-up that relaxes Korean short-syllable acceptance in `lineRescan` / `gapFallback` after console traces showed recovered syllables were still being filtered out.
- Recorded the v90 follow-up that adds a binarized Korean line-rescan input and wider short-line crops after raw OCR still missed glyphs such as `왔` and `싫`.
- Recorded the v91 follow-up that lowers Korean source thresholds for bounded recovery and adds a tight `RAW_LINE` + upscale pass based on `deep-research-report2.md`.
- Recorded the v92 Latin core pass that introduces a shared line-quality assessment for Latin rescue/prune, adds `postPruneLine` candidate debug output, and shifts the next OCR work toward bounded region-recognition improvements instead of sample-specific threshold tweaks.
- Recorded the v93 Latin follow-up that fixes over-aggressive trailing non-lexical tail trimming, gates sparse probe additions with the shared Latin line assessment, and adds direct logging for late Latin tail cleanup.
- Recorded the v94 OCR text-layer follow-up that passes `documentType` into OCR worker requests, separates document OCR from manga-specific late Latin heuristics, preserves contextual short numbers on document pages, restores bounded manga terminal punctuation from raw TSV line text, and fixes the `AYNAR TAKES THIS ESSENCE` ordering regression.
- Recorded the v95 OCR core pass that drops empty TSV word boxes, preserves chunk-derived line structure for very tall pages, keeps strong document singleton numerics through late line prune, and trims leading document bullet ghosts such as `I To`.
- Recorded the v96 OCR follow-up that targets the actual unchanged v94/v95 failure paths: chunked manga OCR now uses sparse-text chunk recognition, document tail trim preserves short numeric heading tails, document `I To` ghosts are trimmed more aggressively, and vertically staggered Latin words can split back into separate lines.
- Recorded the v97 structural follow-up that delays recovery-budget accounting until after base OCR, protects punctuated short manga lines before late prune, makes vertical-flow line splitting more conservative, merges document heading numeric suffixes such as `Chapter 5`, and expands document leading-artifact trimming for `| To`-style ghosts.
- Recorded the v98 region-first follow-up that replaces very tall manga broad sparse probes with bounded speech-region OCR reconstruction and makes chunked document cleanup more conservative on strong pages to reduce timeout and over-pruning risk.
- Recorded the v99 execution follow-up that prioritizes tall-region OCR before older rescue stages consume budget, accepts short punctuated shout lines in region OCR, replaces only overlapping bad manga lines with accepted tall-region results, restores document heading numerics in the final pass, and trims stronger | To / I To leading artifacts.
- Recorded the v100 stabilization pass after reverting to the v93 baseline: OCR text-layer now threads `documentType` through both current-page and batch OCR, very tall chunked manga pages use a focused fast path that skips wide sparse rescue bands, and document pages get late cleanup for `I To` / `| To` artifacts plus heading numeric restoration such as `Chapter 5`.
- Recorded the v101 focused recovery pass: empty TSV ghost words are dropped at parse time, tall chunked manga pages tighten recovery budget and skip the later heavy rescue stages that were still causing slowdown/timeouts, readable speech heads such as `HOPE` are preserved during late Latin cleanup, and document cleanup can auto-activate on dense document-like pages even if the UI mode was left on manga.
- Recorded the v102 refinement pass: tall detect-only probes now score and replace overlapping ghost lines instead of failing on duplicate boxes, short vertically stacked manga bubble lines are no longer merged as aggressively, and top `CHAPTER` headings get a digit-only numeric rescan to improve cases such as `Chapter 5`.
- Recorded the v103 guard pass: the long manga fixture now qualifies for the tall-page fast path instead of missing that gate entirely, while document-cleanup pages are excluded from high-recall speech cleanup and from the final low-readability page clear that was wiping some document pages to `0 words`.
- Recorded the v104 follow-up: recovery budget is reset after base OCR so tall chunked manga pages do not exhaust rescue time before focused probes run, base-layout document detection is kept stable through the rest of the pipeline, tall fast-path no longer enters high-recall speech cleanup, and document-like raw-text fallback is more permissive to avoid new blank-page regressions.
- Recorded the v105 manga follow-up: weak non-CJK manga pages that initially return only numeric garbage now get a constrained full-page base retry on the original image with speech-friendly PSMs, and the retry only replaces the base OCR when it produces clearly better lexical evidence.
- Recorded the v106 document guard: table-heavy and diagram-heavy document pages discovered from the base OCR layout are now excluded from the hostile-noise / fail-fast Latin classifiers, preventing those pages from being wiped to `0 words`.
- Recorded the v107 retry expansion: weak document pages that initially return only numeric garbage now get the same constrained base-retry treatment as weak manga pages, using the original image with document-friendly PSMs before later cleanup runs.
- Recorded the v108 rollback pass: when a page already looked like readable manga speech before early cleanup, but the noise filter then wiped most or all of it out, the worker now restores the base manga snapshot instead of falling through to garbage fallback and ending at `0 words`.
- Recorded the v109 follow-up: strong manga speech pages now keep a post-noise speech-safe snapshot that can be restored after late line-prune / ghost cleanup or page-level clear, and weak document pages now get a chunked `AUTO` base-retry candidate so sparse small-text pages are not forced to rely on one weak full-page OCR pass.
- Recorded the v110 weak-page unification pass: weak non-CJK pages now try both document-style and speech-style base-retry candidates, numeric-garbage pages can try chunked `AUTO` even when opened under manga mode, and the winning retry can force later cleanup toward document mode or speech mode based on OCR evidence instead of the initial UI assumption alone.

## 2026-03-20

- Added notes for OCR regression harness preflight checks and partial-run mode.
- Documented timeout hardening and shared timeout constants.

## Historical Note

Older release-by-release OCR notes still exist in the root `CHANGELOG.md`, but this folder now keeps only the documentation view needed to work against the current codebase.


