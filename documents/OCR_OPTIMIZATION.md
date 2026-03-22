# OCR Optimization

This file tracks the OCR plan against the current code, not against older experimental docs.

## Current Baseline (2026-03-21)

- Primary OCR logic lives in `src/services/vision/worker.ts`
- Worker entry is `worker-boot.ts`, with `worker-stable.ts` only as fallback
- OCR algorithm baseline is `93`
- Runtime defaults:
  - worker count: `1`
  - panel pipeline: `panel`
  - export pipeline: `export`
  - quality default: `best`

## Review Of The Previous Plan

The earlier plan had several good instincts:

- keep changes deterministic
- do not fabricate text
- add Korean-specific measurement
- avoid broad threshold relaxation

But some parts needed correction when checked against the actual code:

### What stays valid

- Korean work should stay profile-safe and not break Latin/document pages.
- Telemetry is useful, especially for Korean keep/drop analysis.
- A continuity-rescue stage should only merge OCR-detected tokens, never invented text.

### What needed adjustment

- A full dual-architecture fast profile is not the immediate blocker for Korean accuracy.
  The current code already has `fast` / `balanced` / `best`; they are not fully separate pipelines yet, but they already control runtime budget and rescue caps.

- `worker-stable.ts` should not be treated as the main implementation.
  Current behavior must be read from `worker.ts`.

- Korean work should start with keep/drop boundaries before adding more rescans.
  The current pipeline already has multiple recovery paths. Adding another rescue stage too early would raise regression risk and make root-cause analysis harder.

## Current Korean Failure Map

| Area | Current behavior | Main risk |
| --- | --- | --- |
| Image/background filters | Short Korean lines can be filtered early if they are not protected | Valid speech fragments disappear before later stages can help |
| `filterKoreanJamoNoise` | Strong against jamo-only ghosts | Mixed edge cases can still survive or valid short tokens can become fragile |
| `filterWeakIsolatedCjkLines` | Removes weak short CJK lines and rescues by neighbor support | A single nearby strong line can rescue bad Korean fragments too easily; short punctuated speech can also be over-pruned |
| Recovery stages | Current Korean path relies more on cleanup than on dedicated continuity rescue | Missing syllables or damaged short lines are not always recovered |

## v87 Korean Tuning Pass

This pass is intentionally low-risk and focuses on keep/drop boundaries instead of adding another heavy rescue stage.

### Changes

- Protect short Korean lines with strong terminal punctuation earlier in the pipeline so image/background filters are less likely to delete valid speech.
- Keep short punctuated Korean speech during weak-line pruning when the line has real Hangul syllables and minimum confidence.
- Require stronger local neighbor support before weak short Korean syllable fragments without punctuation are rescued.
- Treat large-gap Korean lines as line-rescan candidates even when raw coverage is not obviously low.
- Korean line-rescan now evaluates multiple PSMs (`SINGLE_LINE`, `SINGLE_BLOCK`, `SPARSE_TEXT`) and keeps the best recovered Hangul-heavy result.
- Korean gap-fallback is enabled in a bounded form so missing middle chunks such as dropped short words or syllable groups can be recovered without opening full CJK gap rescue globally.
- Panel debug stage metrics are now split by filter family (`imgTile`, `bgVariance`, `isolatedCjk`, `korJamo`, `weakCjkLine`) instead of being merged into one opaque image-filter bucket.

### Why this order is better

- It fixes the most likely false drops and false keeps without increasing OCR call count.
- It reduces the chance that Korean tuning turns into a hidden performance regression.
- It preserves the "no synthetic text" rule.

## v88 Korean Recovery Gate And Replacement Pass

The next failures showed a different bottleneck:

- some Korean rescues were never running on real manga speech pages because the generic CJK page caps were too strict for pages with many short speech lines
- append-only recovery could add missing words, but it could not replace overlapping bad OCR such as a wrong syllable block that already occupied the same region

### Changes

- Korean heavy recovery is no longer blocked by the generic CJK line-rescan and fallback page caps on moderate speech-heavy pages.
- Korean line-rescan now prioritizes suspicious lines with low-confidence or non-syllable short tokens, not only low-coverage lines.
- Suspicious Korean lines use a wider rescan crop so partial lines such as `뭐지?` / `가으` can pull in nearby missed syllables more reliably.
- When Korean line-rescan returns a materially better line, the worker can replace the overlapping bad line instead of trying to append around it.
- Panel stage metrics now expose replacement count on the rescan stage as `/Nr`, which makes "text changed but word count did not" visible in the debug summary.

### Why this matters for page 2 and page 3

- Page 2 (`잘나왔던데 왜 지워?`) is not only a filter problem. The missing `왔` sits inside a damaged line, so append-only recovery was too weak.
- Page 3 mixes two problems:
  - damaged lines that need Korean rescan and replacement, such as `빨리` / `싫으면`
  - broader speech-line recovery on pages that still have many short OCR tokens, where the old generic CJK caps were shutting off the heavy rescue path too early

## v89 Korean Rescan Acceptance Pass

The next console samples showed that `rescan` was still ending at `+0w/+0l` on the failing pages. That meant the new Korean recovery paths were reaching candidate lines more often, but the recovered short Hangul syllables were still being rejected by generic CJK per-word thresholds.

### Changes

- Korean recovery budget is now larger than the generic CJK budget on speech-heavy manga pages.
- Korean line-rescan uses a stricter coverage trigger than generic CJK, so damaged lines like `잘나 데왜지워?` are more likely to be rescanned.
- Short punctuated Korean lines can also enter line-rescan, which helps cases like `뭐지?` where nearby missing text is still in the same bubble.
- `filterRecoveredCjkWords()` now relaxes short-token acceptance specifically for Korean `lineRescan` and `gapFallback` when the token is a Hangul syllable aligned with the current line.

### Why this is different from v88

- v88 mostly fixed gating and replacement.
- v89 fixes the stronger blocker seen in console traces: recovered short Korean syllables were still being discarded before they could help line repair.

## v90 Korean Binarized Line-Rescan Pass

The next manual checks still showed the same missing glyphs while `rescan` stayed at zero gain. That meant the raw region OCR itself was often failing to see the missing syllables from the normal Korean crop.

### Changes

- Korean line-rescan now retries against a lazily built binarized full-page input when the normal crop still looks weak.
- Short Korean lines use a wider rescan crop, especially punctuated or suspicious lines such as `뭐지?`.
- This is still bounded: the extra binarized rescan path only runs inside Korean line-rescan, not as a repo-wide second OCR pipeline.

## v91 Korean Raw-Line And Min-Conf Pass

The next screenshots still showed identical misses and `rescan:+0w/+0l`, which exposed a more basic blocker:

- Korean `lineRescan` still used a generic CJK `minConf` gate high enough to reject medium-confidence recovered syllables before the Korean-specific relaxations were even reached
- the current rescan set still lacked a tight `RAW_LINE` pass with upscale, which the new research note explicitly calls out as a practical Tesseract lever for line OCR

### Changes

- Korean `lineRescan` now uses its own lower `minConf` threshold instead of the generic CJK value.
- Korean `gapFallback` also uses a lower source threshold than generic CJK.
- Korean `lineRescan` now adds a tight `RAW_LINE` (`psm 13`) pass with 2x upscale.
- Korean line-rescan can inspect more candidate lines per page than before.

### Why this matches the new research note

- `deep-research-report2.md` is directionally right for this failure mode: use the narrowest fitting PSM, keep borders controlled, and spend extra OCR cost only on bounded regions instead of broad page-wide retries.

## v92 Latin Core Line-Quality Pass

The next English failure showed a different class of problem from the Korean work:

- false-positive Latin rescue and Latin prune were not using the same line-quality contract
- anchor / post-prune recovery could still accept a readable-looking ghost fragment such as `Prin Le AT`
- real sentence lines without enough dictionary hits could still be judged too weak by one rescue path while another prune path expected different signals

### Changes

- Added a shared Latin line assessment helper in `ocr-latin-heuristics.ts`.
- The new helper scores:
  - lexical hits
  - meaningful word count
  - readable ratio
  - short-token density
  - mixed/title-case artifact patterns
  - ghost-like short-fragment patterns
- Anchor probes now require at least one recovered line that passes the shared Latin recovery assessment instead of relying only on the older aggregate candidate score.
- Post-prune line rescue now uses the same shared Latin assessment for ranking and acceptance, and emits `postPruneLine` candidate debug entries.
- Latin prune stages now honor the shared assessment earlier so readable sentence-like lines are kept more consistently and obvious short ghost profiles are dropped earlier.

### Why this is phase 1 instead of another sample-specific tweak

- It removes a structural mismatch between rescue and prune instead of hardcoding the current bubble text.
- It makes future Latin tuning measurable because accepted/rejected rescue candidates now carry a more direct reason.
- It reduces the need to keep adding isolated threshold exceptions for each new English sample.

## Current Core OCR Plan

1. Phase 1: shared line-quality contract and candidate telemetry
   - done in v92 for the Latin rescue/prune path
2. Phase 2: bounded region-recognition improvements
   - if misses remain, improve Latin line-box rescans with tighter ROI variants, alternate PSM ordering, and optional upscale on bounded regions only
3. Phase 3: fixture-driven tuning
   - save failing English/Korean pages as reproducible fixtures and tune against measured before/after outputs instead of screenshots alone

## v93 Latin Tail-Trim And Sparse-Probe Gate Pass

The next screenshots showed a second structural issue that v92 did not touch:

- some real English tail words were already present in raw OCR but were deleted later by the Latin tail-cleanup stage
- sparse top-band rescue could still admit short ghost lines because it was token-filtered but not line-assessed

### Changes

- `trimTrailingNonLexicalArtifacts()` no longer drops trailing lowercase non-dictionary words just because they are lowercase.
- trailing-token trim now requires the tail token to be weak and/or low-readability before it can be removed.
- the worker now logs when trailing short-keep or trailing non-lexical tail trimming actually removes words.
- Latin sparse probe additions now pass through the shared Latin line assessment before being merged into the result.
- anchor-probe protection is now stricter so ghost-like accepted fragments are less likely to become protected and survive later cleanup.

### Why this matters

- document lines like `... used to support` or `we will study how` should no longer lose their tail words just because the last words are lowercase and absent from the small lexicon set
- short ghost fragments such as `Prin Le AT` are less likely to be admitted by sparse rescue paths that previously reasoned mostly at token level

## What Is Already Optimized In The Current Worker

### Stability

- shared timeout constants
- hard cancel on per-page timeout
- worker recreation on timeout/crash
- cache invalidation by algorithm version

### Performance

- single active OCR worker
- recovery budget by pipeline profile and quality profile
- skip reasons for hard noisy-page fast-fail
- conditional rescue caps for `fast` and `balanced`

### Accuracy

- adaptive preprocessing with CJK-safe binarization behavior
- image-tile and background variance filtering
- CJK and Korean cleanup stages
- Latin lexical cleanup and rescue stack

## What Is Not Solved Yet

### Korean fixture gap

There is still no reproducible Korean fixture pack in the repo. That means Korean tuning is currently constrained to:

- code-path analysis
- manual validation
- debug overlay/drop-count inspection

That is acceptable for low-risk boundary fixes, but not for aggressive heuristic expansion.

### True fast profile separation

The repo still lacks a genuinely minimal fast OCR architecture. Today the quality profiles are mostly budget and rescue variants of the same worker.

### Stage-level Korean counters

Current debug payload already includes dropped words and drop counts, but not a dedicated Korean stage summary such as:

- words before/after each Korean-specific stage
- short-fragment line counts
- punctuated short-line keeps

## Next Korean Plan

1. Add reproducible Korean pages or saved debug payload fixtures.
2. Add Korean-specific counters to the debug payload.
3. Re-check whether the remaining failures are:
   - early filter over-drop
   - weak-line rescue over-keep
   - true OCR miss from Tesseract
4. Only after that, decide whether a separate continuity-rescue pass is still needed beyond the current bounded replacement repair.

## Verification Checklist

When validating Korean pages in the panel:

- use `best` first
- keep `showDebugOverlay` enabled
- compare `dropCounts` for:
  - `imgTile`
  - `bgVariance`
  - `isolatedCjk`
  - `korJamo`
  - `weakCjkLine`
- inspect `skipReason`
- record runtime and whether the result improved by keeping real short lines while dropping low-value fragments
