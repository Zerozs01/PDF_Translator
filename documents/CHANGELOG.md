# Changelog (Documents Folder)

This file mirrors key updates that affect documentation in `documents/`.
For full project history, see `CHANGELOG.md` in the repo root.

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
