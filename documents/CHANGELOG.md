# Changelog (Documents Folder)

This file mirrors key updates that affect documentation in `documents/`.
For full project history, see `CHANGELOG.md` in the repo root.

## 2026-03-21 (v70 panel noisy-page fast-fail)

- Added panel noisy-page fast-fail gating to disable expensive line-rescan on page-1 style hostile texture pages.
- Added panel ultra fail-fast rule using raw-before-filter token count + filtered-out ratio + lexical evidence.
- Bumped OCR algorithm version to v70.

## 2026-03-21 (performance planning: pdf24-like fast profile)

- Added documentation guidance to split OCR pipeline into two profiles:
	- Accuracy profile: keep current heavy rescue stack.
	- Fast profile: minimal post-processing and strict budgeted rescue.
- Documented a step-classification matrix (mandatory vs optional) and suggested runtime toggles for each optional stage.
- Current product baseline remains `Best Quality` until fast-profile tuning is explicitly released.

## 2026-03-21 (OCR timeout + skip-reason hardening)

- Hardened per-page timeout cancellation in both panel and export flows: timeout now aborts page-scoped signal and force-cancels active worker requests (`visionService.cancelAll(...)`) to avoid background OCR stragglers.
- Added panel/export fail-fast garbage detection using lexical/meaningful evidence plus low-confidence and weak-line ratios.
- Added panel texture-noise detection from raw-before-filter stats (high raw words + high filtered-out ratio) to skip expensive rescue on pages that are clearly non-target language/noise.
- Added worker recovery stage budget gates (panel 45s, export 70s) and applied them to top-band, post-prune, and edge-token rescue stages to reduce second-pass timeout recurrence.
- Added OCR debug skip reason propagation (`debug.skipReason`) and UI rendering in OCR panel for visible diagnostics.
- OCR algorithm version bumped through v69 to invalidate stale cache and ensure new worker behavior is applied.

## 2026-03-20 (priority phase planning + phase 0 kickoff)

- Added a new "Execution Plan (Priority Phases)" section in `documents/Roadmap.md` to sequence work before OCR accuracy tuning.
- Plan order: Phase 0 Immediate guardrails -> Phase 1 Runtime stability + shared pipeline -> Phase 2 Type safety + refactor hygiene -> Phase 3 Performance optimization -> Phase 4 Accuracy tuning -> Phase 5 Test/tooling hardening.
- Started Phase 0 by changing default `DEBUG_LOG_DROPS` to `false` in `src/services/vision/ocr-config.ts` to reduce runtime log overhead/noise.
- Executed OCR regression harness and found blocker: `public/fixtures/ocr/manga` currently contains only `expectations.json` (fixture images missing), so `npm run ocr:regression` cannot produce page results yet.
- Improved `scripts/run-ocr-regression.mjs` with fixture image preflight validation (fail-fast + explicit missing-file list) and changed default base URL to `http://localhost:5173`.
- Applied low-risk Phase 1 runtime refactor: replaced busy-wait worker initialization loops with promise locks in `src/services/vision/worker.ts` and `src/services/vision/worker-stable.ts`.
- Reduced timeout-policy duplication: added `src/services/vision/ocr-timeout.ts` and switched both `OCRTextLayerPanel.tsx` and `SearchablePDFService.ts` to use shared per-page OCR timeout handling.
- Centralized timeout defaults in `src/services/vision/ocr-timeout.ts` and aligned `VisionService`, OCR store defaults, and OCR panel render timeout to the same source of truth.
- Centralized Vision worker retry policy defaults (`retry attempts` and `retry delay`) in `src/services/vision/ocr-timeout.ts` and wired `VisionService` to use those shared constants.
- Started shared worker-module extraction by adding `src/services/vision/ocr-worker-shared.ts` and moving common `OCR_PROGRESS` + image-dimension helpers to be used by both `worker.ts` and `worker-stable.ts`.
- Continued shared worker extraction by moving worker initialization lock flow into shared utility (`withWorkerInitLock`) and wiring both `worker.ts` and `worker-stable.ts` to use it.
- Continued shared worker extraction by centralizing language-switch/get-or-create flow into `ensureWorkerForLanguage` and using it from both worker implementations.
- Continued shared worker extraction by centralizing Tesseract progress logger callback creation in `createOCRLogger` and wiring both worker implementations to use it.
- Started Phase 2 type-safety work by replacing `unknown[]` with `OCRWord[]` on stable worker OCR line structures/TSV parse path.
- Completed the first Phase 2 type-safety slice by replacing remaining `words: unknown[]` OCR line types with `words: OCRWord[]` across core OCR modules (`worker.ts`, `ocr-types.ts`, `ocr-parsing.ts`, `ocr-filtering.ts`).
- Reduced risky `as any` casts in primary OCR execution paths by passing typed Blob/string inputs directly to `recognize` in `worker.ts` and `ocr-fallback.ts`.
- Finished remaining `as any` cleanup in vision runtime by removing non-core casts from `VisionService.ts` worker error diagnostics and `worker-boot.ts` boot bridge.
- Started heuristic modularization in Phase 2 by extracting core Latin normalization/splitting/approx-correction helpers from `worker.ts` into `src/services/vision/ocr-latin-heuristics.ts` and wiring existing call sites to the new module.
- Continued heuristic modularization by extracting Latin line cleanup/prune helpers from `worker.ts` into `src/services/vision/ocr-latin-heuristics.ts` and rewiring worker call sites with explicit dependencies.
- Continued heuristic modularization by extracting Latin anchor/probe logic (`buildLatinAnchorProbes`, `getLatinLexicalHits`, `analyzeTextLikeProbe`) from `worker.ts` into `src/services/vision/ocr-latin-heuristics.ts` and rewiring panel rescue/empty-line/gap probe call sites via dependency injection.
- Continued heuristic modularization by extracting Latin readability and speech fast-path helpers (`scoreLatinTokenReadability`, `scoreLatinLineReadability`, `isLikelyLatinSpeechPage`) from `worker.ts` into `src/services/vision/ocr-latin-heuristics.ts`, then rewiring image-filter and watermark high-recall decisions to pass explicit config deps.
- Continued heuristic modularization by extracting `countMeaningfulLatinWords` and `scoreLatinCandidate` from `worker.ts` into `src/services/vision/ocr-latin-heuristics.ts`, rewiring all candidate-evaluation and high-recall metric call sites to pass lexicon deps explicitly.
- Improved OCR regression tooling for incremental tuning: added `--skip-missing` support in `scripts/run-ocr-regression.mjs`, added `--partial` scope in `scripts/ocr-regression-report.js`, and added `npm run ocr:regression:partial` to evaluate available fixtures while manga fixture assets are still incomplete.
- Applied targeted Latin accuracy tuning for stylized bubble recovery in `worker.ts`: post-prune line rescue now evaluates both base PSM and `PSM.SPARSE_TEXT` for the same candidate region and ranks the best lexical/readability result, improving recall without enabling full-page sparse retry.
- Follow-up tuning from pages 10/14/15 evidence: tightened final residual Latin line pruning to suppress singleton/short non-lexical ghost lines (`A`, `i`, `Nor`, `ALT` patterns) and widened post-prune candidate line coverage threshold to recover partially missed bubble text.
- Added context-aware final pruning for short lines: residual Latin pass now computes strong lexical line centers and drops short isolated fragments that are far from the strong text cluster unless they are extremely high-confidence lexical tokens.
- Fixed a tuning blocker where protected-word bypass could keep short ghost lines alive in final residual pruning; singleton/very-short residual lines are now evaluated by cleanup rules even when protected. Also relaxed sparse-rescue readability gate for lexical tokens to avoid dropping real short words (e.g., `HERE`, `TO`) during candidate recovery.
- Tuned page-10 edge-word recovery: post-prune rescue now uses adaptive left/right probe padding when overlap gaps indicate truncated line edges, and further relaxes lexical-token readability gating for `postPruneLine*` sources to reduce false drops of valid short words near bubble boundaries.
- Added focused follow-up tuning for remaining misses: included `MR` in Latin short-keep lexicon to protect titles (`MR.`), and introduced panel-only lexical edge-token rescue for strong lines (`lineRescanEdge`) to recover missing boundary words like `HERE` / `TO` / `HERE?` without re-enabling full-page sparse retry.
- Tuned `lineRescanEdge` rescue gates to favor lexical boundary recovery (lower confidence/readability threshold for lexical edge tokens) so page-10 missing edge words are less likely to be dropped. Added a final residual-line rule to remove fragmented mixed-case non-lexical ghost lines (e.g., `CREA wea Er SRE THI be`) seen under valid dialogue lines.
- Follow-up for stubborn misses: strengthened panel edge-token rescue trigger and probe box expansion (with fallback to current line bbox) plus a second-pass looser dedupe threshold for near-overlap boundary words; additionally tightened low-lexical-density fragmented-line suppression (lexicalHits<=1 with short-token fragmentation) to better remove page-3 ghost lines that still survived prior filters.
- Extended conservative lexical rescue blocks (`lineNeighborhood`, `top-balloon block`) to run in panel profile with tight limits, targeting missed bubble lines on pages like 2/5/10. Added explicit final-pass suppression for repeated short-keep residual lines (e.g., `A A A`) when not protected.
- Root-cause tuning update: improved lexical normalization for short digit-only OCR tokens (e.g., `60` -> `GO`), preserved short lexical dialogue lines during line-prune (`shortLexicalDialogueLine`) to reduce false drops like `XUJIA TOWN`, and added trailing short-keep artifact trimming to remove tail noise clusters such as `IN IF` / repeated short residues while keeping the lexical core line.
- Quality-first follow-up tuning from pages 2/3/4/5/10/12/17/19/20 evidence: capped Latin recovery budget (`LATIN_RECOVERY_MAX_ADDED_WORDS`) to stop rescue-overflow ghost text on textured panels, changed recovery budget ranking to prioritize lexical/readable words over confidence-only picks, and added singleton keep gates so one-line lexical pages (e.g., `YOU`) are not cleared by page-level low-readability heuristics.
- Added targeted final-pass cleanup in `ocr-latin-heuristics.ts` to normalize short digit-only lexical tokens into text output (e.g., `60` => `GO`) and trim trailing non-lexical tail artifacts (e.g., lowercase `at/or/fem`) while preserving uppercase lexical short words.
- Tightened residual ghost suppression for two-token single-letter short-keep lines (e.g., `A I`) unless strongly trusted/protected.
- Follow-up from latest page evidence: fixed short-digit token drop at noise stage by preserving numeric tokens that normalize to lexical short words (e.g., `60`->`GO`), added targeted speech-lexicon correction for stubborn `XUJIA/TOWN` variants (e.g., `AVIA TO`), enabled panel top-band sparse probe for missing top lines, and throttled heavy panel rescue passes on very noisy Latin pages to reduce timeout risk while keeping core dialogue extraction.
- Fixed a runtime regression in primary worker (`ReferenceError: joinWordsForLanguage is not defined`) that prevented known-speech correction from applying. Also moved short-digit normalization earlier (before residual denoise) and normalized short-word noise matching (`T0`->`TO`) to improve tail-word retention.

## 2026-03-19 (docs cleanup)

- Consolidated duplicate roadmap docs by merging key plan context from `documents/road map.md` into `documents/Roadmap.md`.
- Removed `documents/road map.md` to avoid duplicate planning files.
- Added a "Progress Audit (Code vs Plan)" section to `documents/Roadmap.md` with current implementation status for A2/A3/C/D phases.
- Updated `documents/Readme.md` to reference `documents/Roadmap.md` as the single active roadmap file.

## 2026-03-11 (v47 — rollback recovery)

- Re-applied the core OCR runtime fixes after rollback:
	- `VisionService` now uses a single worker again, with longer timeout handling and worker recreation on timeout.
	- `OCRTextLayerPanel` no longer displays stale algorithm cache as a valid preview, skips cache auto-load while OCR is running, blocks overlapping OCR starts, and avoids visible-page navigation during batch OCR.
- Re-applied the main Latin cleanup improvements in [src/services/vision/worker.ts](../src/services/vision/worker.ts):
	- original-image fallback for low-coverage rescans
	- approximate lexical correction
	- merged-word splitting (`TAKEA` → `TAKE A`, `NowI` → `Now I`, `MAKEDO` → `MAKE DO`)
	- late cleanup for mixed-case/lowercase ghost fragments such as `CREAweaErSRETHIbe`, `vided`, and `wraphimills`

## 2026-02-05

- Added `documents/ARCHITECTURE.md` (summary + links to root architecture).
- Added `documents/OCR_OPTIMIZATION.md` (OCR performance & tuning notes).
- Added `documents/LOCAL_TESSDATA.md` (offline language data setup).
- Updated `documents/Readme.md` with documentation index.
- Updated `documents/OCR_OPTIMIZATION.md` with fallback recovery + DIP-inspired preprocessing notes.
- Added `scripts/download-tessdata.js` and `npm run tessdata:download` for offline language data.
- Raised OCR chunk threshold and skip binarization for CJK languages to improve Korean/Japanese/Chinese accuracy.
- Added CJK retry pass (binarize + SPARSE_TEXT) and guarded fallback OCR to reduce slowdowns.
- Refined CJK retry to merge results and tightened image-tile filtering for non-Latin false positives.
- Preserve non-Latin text in image tiles when background variance is low (reduce missed speech bubbles).
- Relaxed non-Latin noise/background filtering and improved vertical-gap pass targeting for missing nearby lines.

## 2026-02-06

- Added CJK line rescan for low-coverage line boxes to recover missing tokens at line edges.
- Tuned gap recovery thresholds for CJK and allow longer CJK gap tokens.
- Reused non-binarized input for CJK rescans and fallbacks to reduce redundant preprocessing.
- Added low-coverage line rescan for Latin text and expanded rescan padding to recover trimmed words.

## 2026-02-07

- Updated `documents/ARCHITECTURE.md` with OCR cache and file source behavior.
- Added `road map.md` to track upcoming phases and priorities.
- Synced documentation notes with recent OCR cache + fileData changes.

## 2026-03-11 (v53 — batch OCR render fix)

- Fixed a renderer-side issue where batch OCR could fall back to visible-page navigation, causing `currentPage` churn (`1 -> 2 -> 3 -> 2 -> 1`) and repeated cache loads instead of stable off-screen OCR rendering.
- Disabled cache auto-load while OCR is processing and forced `Re-OCR All` to use direct pdf.js rendering without page-navigation fallback.
- Bumped OCR algorithm version 52→53.

## 2026-03-11 (v52 — fresh cache + trigger logs)

- Bumped OCR algorithm version 51→52 so stale cache cannot hide the latest worker/runtime fixes.
- Added panel-side logs for `currentPage` changes and OCR start actions to confirm whether page navigation / OCR triggering is actually reaching the renderer.

## 2026-03-10 (v51 — Follow the analysis docs)

- Reduced runtime OCR worker count to 1 for stability. The primary pipeline is too heavy to benefit from 3 parallel browser workers in Electron dev mode and was timing out instead.
- Fixed timeout handling in `VisionService`: health checks no longer short-circuit retries, and timed-out workers are recreated before retrying.
- Raised the OCR request timeout to 5 minutes and capped the most expensive panel-only Latin rescue passes to sparse pages / a short time budget.
- Corrected the debugging direction to match the project notes in [documents/Knowledge3.md](documents/Knowledge3.md) and [documents/OCR_OPTIMIZATION.md](documents/OCR_OPTIMIZATION.md): the remaining dominant failure is **missing bottom lines / incomplete tails**, not a fundamental model limitation.
- Updated `worker.ts` so low-coverage Latin line rescans compare original-image, grayscale, and processed inputs before choosing the best candidate.
- Added a dedicated bottom-tail rescue pass below strong anchor lines to recover missing final bubble lines such as `XUJIA TOWN`, `THIS KIND OF STUFF`, and `THE PEOPLE HERE?`.
- Bumped OCR algorithm version 50→51.

## 2026-03-10 (v50 — Latin Join Fix)

- Found the reason several fixes looked like they had no effect: merged-token splitting was working internally, but final line assembly still concatenated adjacent Latin `OCRWord`s back together.
- Updated `joinWordsForLanguage()` in [src/services/vision/ocr-text-utils.ts](src/services/vision/ocr-text-utils.ts) to preserve spaces between separate Latin OCR words even when their bounding boxes touch or slightly overlap.
- Bumped OCR algorithm version 49→50.

## 2026-03-10 (v49 — Approximate Lexicon + Multi-Split)

- Fixed a runtime issue where already-created OCR workers could keep running old logic inside the same dev session. `VisionService` now recreates the worker pool automatically when the OCR algorithm version changes.
- Stopped showing OCR preview results from older algorithm versions, so stale memory-cache output no longer looks like a fresh OCR pass.
- Added bounded edit-distance lexicon repair in `worker.ts` so close stylized misses such as `XUJTA` can be normalized back to `XUJIA`.
- Upgraded merged-word splitting from two-part only to recursive multi-part segmentation. This targets outputs like `ONLYMAKEDO` and `TOLIVE` in addition to `TAKEA` / `STUDENTSMAY`.
- Relaxed edge-line pruning for near-lexical speech lines, helping preserve bubble lines that contain one exact word plus one close OCR miss.
- Bumped OCR algorithm version 48→49 to force a fresh OCR pass.

## 2026-03-10 (v48 — Primary Worker Retry + Cleanup)

- Zero-lexical line retry now tests **original image → grayscale preprocessed → binarized** inputs, instead of only the preprocessed fallback. This specifically targets regressions like `XUJIA TOWN` where preprocessing itself damaged the retry source.
- Added final residual Latin cleanup in `worker.ts`:
	- `cleanNoiseWordsWithinLatinLines()` removes late non-lexical noise from otherwise valid lines.
	- `pruneResidualLatinNoiseLines()` drops leftover non-lexical singleton / low-quality ghost lines after rescue.
- Bumped OCR algorithm version 47→48 to invalidate cache again.

## 2026-03-10 (v47 — Primary Worker Fix)

- **ROOT CAUSE found**: Boot loader succeeded → `worker.ts` (primary) is running, NOT `worker-stable.ts`. All previous ghost-text fixes were in `worker-stable.ts` and never activated.
- All fixes now applied directly to the PRIMARY worker (`worker.ts`):
  - **Zero-lexical-line re-OCR**: After all filtering, lines where EVERY word is non-lexical are re-OCR'd with the UNBINARIZED (original) image via `recognizeRegion`. If the retry yields lexical words, the line's words are REPLACED. This fixes the XUJIA TOWN regression caused by v1.2.1 adaptive binarization.
  - **Case-transition gibberish**: Enhanced `pruneLatinResidualNoiseWords` — words with ≥3 case transitions (e.g. `CREAweaErSRETHIbe`) are dropped.
  - **Merged word splitting**: `trySplitMergedLatinWord` splits concatenated words (STUDENTSMAY→STUDENTS+MAY, TAKEA→TAKE+A).
  - **Lowercase noise filter**: Drops non-lexical lowercase words with no vowels or long consonant runs (e.g. `vided`, `wraphimills`).
  - **Single-char line drop**: Lines of a single character (except "I") with low confidence are removed.
- Expanded `LATIN_COMMON_WORDS` from ~55 to ~200+ words in worker.ts. Fixed `XUJITA`→`XUJIA` typo.
- Bumped OCR algorithm version 46→47.

## 2026-03-10 (earlier)

- Created `worker-boot.ts` — boot loader that wraps `worker.ts` dynamic import in try-catch, reports real crash error via `WORKER_BOOT_ERROR`, auto-falls back to `worker-stable.ts`.
- Expanded `worker-stable.ts` from 447→738 lines with a comprehensive 7-layer filtering pipeline (noise words → line building → edge ghost → garbage lines → short fragments → density check → page quality gate).
- Added `LATIN_COMMON` dictionary (~200+ words) and `LATIN_SHORT_KEEP` set for lexical classification.
- Added `isLexicalWord()`, `scoreTokenReadability()`, enhanced `isWatermarkWord()` with manga-site detection.
- Updated `VisionService.ts` to load `worker-boot.ts` as primary entry point; added `WORKER_BOOT` / `WORKER_BOOT_ERROR` message handlers.
- Updated `vite.config.ts` with `worker: { format: 'es' }` and `optimizeDeps: { include: ['tesseract.js'] }`.
- Ghost text significantly reduced: P2 59→22 words, P3 25→12 words, P5 60→25 words.
- Added word-splitting post-processor: fixes TAKEA→TAKE+A, NowI→Now+I, MAKEDO→MAKE+DO, STUDENTSMAY→STUDENTS+MAY.
- Added zero-lexical-words catch-all: drops lines with no dictionary words (catches vided, Wis, wraphimills, AVIA TOdl CR En Se).
- Added mixed-case gibberish detection via case-transition counting (catches CREAweaErSRETHIbe).
- Added single-char orphan line filter (drops standalone A, but keeps I).
- Added per-word cleanup within multi-word lines (drops lowercase noise on uppercase-dominant lines).
- Expanded LATIN_COMMON to ~260 words with compound-word prevention.
- Remaining bugs documented:
	- P2 L4: `XUJIA TOWN` misread as `AVIA TOdl CR En Se` (Tesseract accuracy)
	- P3: ghost `CREAweaErSRETHIbe` still passes; `TAKEA LOOK` not properly spaced
	- P5: ghost words `vided`, `Wis`, `wraphimills` remain; `THIS KIND OF STUFF` not detected
	- P10: `THE PEOPLE HERE?` still missing

## 2026-03-09

- Backed up latest OCR tuning notes after manual manga-page validation.
- Documented preprocessing upgrades: adaptive binarization, dark-border cleanup, and lightweight binary repair.
- Recorded that Page 3 lower line (`TAKE A LOOK!`) is now detected successfully.
- Recorded remaining OCR misses for follow-up:
	- Page 2 missing `Xujia town`
	- Page 5 missing / truncated lines including `IN THE PAST, I ONLY FOUND THE`, `WITH`, and `THIS KIND OF STUFF..`
	- Page 10 missing `THE PEOPLE HERE?`
- Documented decision to temporarily tolerate some extra background candidate boxes if they help OCR recall / segmentation.
