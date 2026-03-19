# Changelog (Documents Folder)

This file mirrors key updates that affect documentation in `documents/`.
For full project history, see `CHANGELOG.md` in the repo root.

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
