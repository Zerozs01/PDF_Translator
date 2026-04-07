# OCR Optimization

This file tracks the OCR plan against the current code, not against older experimental docs.

## Current Baseline (2026-04-04)

- Primary OCR logic lives in `src/services/vision/worker.ts`
- Worker entry is `worker-boot.ts`, with `worker-stable.ts` only as fallback
- OCR algorithm baseline is `146`
- Runtime defaults:
  - worker count: `1`
  - panel pipeline: `panel`
  - export pipeline: `export`
  - UI OCR engines: `tesseract`, `paddleocr`, `easyocr`
  - OCR quality baseline: `best`

## 2026-04-07 Pre-Rollback Incident Memo (Must Keep)

This memo preserves the practical lessons from the latest user-reported manga regressions before code rollback.

### User-reported symptoms (snapshot)

| ID | Symptom | Practical impact |
| --- | --- | --- |
| R1 | `AYNAR TAKE THIS` split into `S THIS` + `AYNAR TAKES` | translation becomes semantically wrong |
| R2 | Same-row multi-balloon OCR interleaves section order (box2 line1 then box1 line2, etc.) | translation group leaks across balloons |
| R3 | PaddleOCR detects tiny icon/SFX fragments (ghost text) | extra overlay boxes and wrong mask |
| R4 | duplicate text like `SHOE LOCKER` repeated | duplicate translated lines on overlay |
| R5 | must retain `I THINK` handling behavior | dialogue intent degrades if lost |

### Root-cause map (deterministic view)

1. Fragment normalization gap:
   - source text normalization must happen before grouping.
   - if not, fragmented tokens (for example `S THIS`) survive into translation planning.

2. Section clustering ambiguity:
   - same-row bubbles require section-aware ordering, not pure top-to-bottom sort.
   - x-overlap + center continuity must gate whether two lines are in the same balloon section.

3. Ghost token over-recall:
   - icon/effect micro-boxes are legitimate detections for OCR but not useful for translation overlay.
   - panel pipeline needs strict low-signal rejection for tiny singleton tokens.

4. Duplicate collapse split across stages:
   - dedupe must run consistently in panel ingest and overlay translation mapping.
   - if one stage misses, duplicates leak through (`SHOE LOCKER` pattern).

### Memory anchors to keep after rollback

- `AYNAR/S THIS` family normalization lives in translation source normalization rules.
- `I THINK` conversational handling is currently preserved at translation post-process level (Thai glossary mapping for `I THINK`).
- section-aware dense dialogue ordering is required to prevent cross-balloon text blending.
- panel ghost suppression and panel dedupe should remain upstream, before cache save.

### Quick code anchors (for post-rollback recovery)

- `src/App.tsx`
  - `ENGLISH_OCR_NOISE_REPAIRS` keeps `AYNAR TAKE THIS` / `S THIS` normalization patterns.
  - `applyThaiConversationalGlossary` keeps direct `I THINK` conversational mapping.
- `src/components/OCR/OCRTextLayerPanel.tsx`
  - `shouldDropPanelGhostLine` and `applyPanelSafetyLineDedup` are the ghost/duplicate upstream guards.
- `src/App.tsx`
  - `buildSectionAwareDenseDialogueOrder` and `buildTranslationGroups` define section-safe line ordering/grouping.

### Re-introduction order (safe sequence)

1. Source normalization first:
   - restore OCR noise repairs for fragmented phrase families (`S THIS`, `AYNAR TAKES ...`).
   - run before any grouping/translation batching.

2. Section-safe grouping:
   - enable/restore section-aware dense dialogue ordering for same-row multi-bubble pages.
   - reject merges when horizontal overlap is weak and column separation is high.

3. Ghost filter in panel ingest:
   - keep tiny singleton/icon-like text out of OCR line cache.
   - preserve only whitelisted short tokens that are semantically meaningful.

4. Duplicate collapse at two boundaries:
   - panel line dedupe before persistence.
   - translated overlay dedupe before rendering.

5. `I THINK` guard verification:
   - assert the phrase still survives OCR-to-translation pipeline and maps to intended Thai dialogue tone.

### Regression fixtures required before next rollout

- Tall comic page with sparse balloons (long vertical scroll).
- Same-row dual/multi-bubble manga page (section separation stress).
- Icon/SFX-heavy manga page (ghost-token stress).
- Repeated signage page (`SHOE LOCKER`-style duplicate stress).
- Dense technical/document page with labels and numerics.

### Acceptance metrics (must pass)

- section crossing rate: `0` for manually labeled dual-bubble fixture.
- duplicate translated line count per page: `<= 1` for repeated-sign fixture.
- ghost token drop precision: no meaningful dialogue loss in sampled manga pages.
- `I THINK` recall: phrase detected and translated with intended conversational meaning.

## 2026-04-06 Rollback Postmortem (Why The Latest Pass Failed)

This section captures why the latest tuning wave did not produce stable behavior and why rollback to a known stable version is justified.

### Observed failures

- Duplicate OCR lines still appeared in manga multi-section rows (example pattern: same short phrase duplicated in the same visual band).
- Border/mask placement remained unstable on both manga and technical document pages.
- Some pages still showed long stretched overlay boxes caused by malformed line-level bbox propagation.

### Why the fixes were not enough

1. Dedup was not applied consistently across all ingest paths.
   - Current-page OCR path was deduped.
   - Batch/all-pages and benchmark-related store/cache write paths could still persist non-normalized OCR results.
   - Result: duplicate lines re-entered from cache and looked like "fix did not work".

2. Duplicate checks depended too much on line-level bbox quality.
   - In hard pages, line bboxes can be inflated or shifted after chunk merge / line matching.
   - Even exact repeated text can bypass spatial dedup if geometry is noisy.

3. Renderer-side border guards only reduced symptoms.
   - Mask/source bbox outlier guards helped visual containment.
   - But they cannot eliminate duplicated OCR lines already present in upstream OCR data.

4. Recall-oriented parser relaxations increased ambiguity.
   - Relaxing line-box matching thresholds improved recall in some pages.
   - Side effect: more ambiguous assignments and occasional oversized line boxes.
   - This amplified downstream mask drift in mixed-layout pages.

5. Cache invalidation happened, but behavioral parity across paths was still incomplete.
   - Version bumps alone do not guarantee stability if logic differs between current-page and batch pipelines.

### Lessons locked for the next attempt

- Enforce one canonical dedup/normalization pipeline before ANY `setPageOCR` or `saveOCR` call.
- Treat word-union geometry as the default anchor for duplicate decisions when line bbox is suspicious.
- Keep parser-threshold changes profile-scoped and evidence-scoped (manga/document split), not global.
- Validate parity explicitly: current-page vs all-pages must produce equivalent dedup behavior.
- Use fixture-based regression before rollout:
  - tall manga page with sparse balloons
  - dense technical/document page with repeated labels and numeric fragments

### Rollback guidance

- Recommended rollback anchor for this cycle: `1.2.14` behavior baseline (`OCR_ALGORITHM_VERSION = 146`) before the latest unstable tuning wave.
- If user-facing OCR quality is the top priority, rollback to the last known stable checkpoint first.
- Re-apply improvements only in small slices with measurable acceptance checks:
  - duplicate count per page
  - dropped-word reason distribution
  - border/mask outlier incidence

## 2026-04-04 Translation Overlay Checkpoint

This checkpoint captures the current renderer-side translation overlay state after the recent document / manga tuning passes.

### Current behavior now in code

- Translation cache keys are versioned (`v4`) and include:
  - OCR engine
  - OCR language
  - source / target language
  - translation mode (`manga`, `manhwa`, `official`)
  - translator engine (`offline`, `ai`)
- Translation cache hydration now has document-alias fallback similar to OCR cache hydration, so reopening a file can recover translation cache rows from a compatible document alias.
- Overlay rendering now separates:
  - `maskRect`: the background layer used to cover original OCR text
  - `textRect`: the translated text placement layer
- `maskRect` and `textRect` are no longer forced to use the same geometry.
- Manga / manhwa merged bubble rendering now keeps per-line mask coverage while allowing one merged translated text block above it.
- Overlay source geometry now distinguishes:
  - tighter word-union text geometry for translated text sizing
  - broader line-aware mask geometry for hiding original text
- Effective overlay profile is no longer driven only by the UI mode:
  - document-like OCR source blocks can auto-fallback to `official` overlay rules even if the active translation mode is still `manga`

### What is working better than before

- Ordinary manga and long-page manga overlays now usually land much closer to the original source scale than the earlier tiny-text passes.
- Document pages no longer blow up as aggressively as the earlier over-expanded heading/body regressions.
- Offline Argos translation coverage is better than the earlier partial-translation state where many uppercase lines were incorrectly skipped.
- Reopened files are less likely to lose translation cache purely because the file resolved to a sibling document alias.

### Known issues at this checkpoint

- Thai diacritics and lower descenders can still clip on some document lines when the fitted font is close to the OCR box height limit.
- Document heading hierarchy is still imperfect:
  - some headings that should stay clearly larger than body text collapse too close to the paragraph size
  - some document blocks still depend too heavily on OCR line height quality from `PaddleOCR`
- Manga bubbles with several balloons aligned on the same row can still size inconsistently or feel unstable from balloon to balloon.
- Some merged manga bubble masks still need per-balloon tuning:
  - certain headers or upper lines may not fully cover the original text
  - some bubbles can still leave small background artifacts near the border
- Translation cache persistence should now save and hydrate correctly in the normal flow, but reopen behavior still needs more real-user verification before declaring it fully stable.

### Immediate next renderer priorities

- preserve heading-vs-body size hierarchy on document pages without reintroducing oversized paragraph regressions
- improve Thai ascender / descender safety for document text without inflating mask size too much
- stabilize font sizing for manga pages that have multiple balloons or multi-block dialogue on the same row
- keep mask coverage complete on merged manga bubbles while avoiding oversized white rectangles

### 2026-04-04 Working checkpoint before the next tuning pass

The current practical checkpoint is:

- ordinary document pages are much closer to the original OCR source scale than the earlier oversized regression
- ordinary manga and long-page manga are also much closer to the original source size than the earlier tiny-text state
- however the renderer is not yet "locked"

The main issues still open right now are:

- document headings can still collapse too close to body text or fail to preserve the original visual hierarchy
- Thai diacritics and descenders can still clip on fitted document text
- some manga pages with several balloons on the same row still produce unstable sizing from balloon to balloon
- merged manga bubble masks can still miss parts of the original line or leave visible white artifacts at the edge

This section exists as a revert/checkpoint marker before the next renderer iteration so future passes can compare against the current "mostly usable but not yet stable" behavior instead of against older tiny-text or oversized-text regressions.

## v146 External Panel Cleanup And Residual Guard

This pass documents the current external OCR behavior used by manga page tuning in the live code path:

- `PaddleOCR` panel cleanup in the bridge now restores spacing from compact merged Latin tokens by splitting high-confidence lexical runs (`mergedLatinSplit`).
- Panel watermark suppression is now deterministic and color-agnostic:
  - geometry and edge placement
  - lexical/domain pattern evidence
  - confidence and compact-token heuristics
- `VisionService` applies a second external pass after bridge cleanup:
  - Latin ghost-line suppression (`externalLatinGhostLine`)
  - residual panel singleton suppression (`externalResidualSingleton`) for numeric / CJK / punctuation one-token noise on non-CJK pages
- External model warm-up in `OCRTextLayerPanel` now starts preferred engine quickly after file open (`160ms`, non-idle) and warms secondary engine later (`2200ms`, idle-aware).

Known note from current traces:

- Most watermark/corner ghosts are now suppressed, but rare numeric singleton leakage (for example `15`) can still appear on specific pages and should be tuned with per-page debug evidence.

## v96 External Paddle CPU Tuning

This pass documents the current external OCR behavior after the UI moved from quality presets to model selection:

- external engine prewarm is session-scoped in `OCRTextLayerPanel.tsx`, so `PaddleOCR` / `EasyOCR` are warmed once per language instead of being rechecked per document
- the slow `CHECK` probe step was removed from the normal warm path; the app now prewarms directly through the Electron bridge
- `PaddleOCR` now keeps one shared CPU instance per language and uses a lighter `PP-OCRv5_mobile_det` detector on that shared bridge instance
- per-request Paddle settings now vary by pipeline profile:
  - `panel` uses tighter detection-side limits and moderate recognition batching to keep ordinary manga pages from stalling late in inference
  - `export` keeps a larger detection-side limit for denser document pages while still bounding CPU cost
- renderer-side render constraints remain separate from Paddle's own internal detection limits; both are now part of the live behavior and should be considered together when tuning speed vs recall
- external OCR cleanup now reflows words back into lines after engine detection, instead of trusting raw engine line grouping as-is
- `export` cleanup now drops more isolated uppercase/image-label fragments before line reflow, targeting cases like ship labels and one-letter detector ghosts
- external OCR debug now records `runtimeMs` in the same key family the UI already uses for `Tesseract`, so engine runtime comparison no longer depends on a separate debug shape

## Review Of The Previous Plan

The earlier plan had several good instincts:

- keep changes deterministic
- do not fabricate text
- add Korean-specific measurement
- avoid broad threshold relaxation

But some parts needed correction when checked against the actual code:

## v103 Tall-Page And Document-Clear Guard

This pass fixes two active regressions seen on the live samples:

- chunked long-form manga pages at roughly `2916x28779` were still missing `I THINK` / `EH?!` / `ME?!!` because the "very tall" gate never activated, so the focused tall-page probe path did not run
- some document pages were incorrectly entering high-recall Latin speech cleanup and then hitting the late page-level low-readability clear, producing `0 words`

Changes in code:

- lowered the `isVeryTallPage` gate so the current long manga fixture actually enters the tall-page fast path
- disabled high-recall Latin speech cleanup when the page already qualifies for document cleanup mode
- disabled the late page-level low-readability clear on document-cleanup pages so sparse but legitimate document text is not wiped out

## v104 Recovery-Budget Reset And Stable Document Mode

This pass fixes the next two regressions seen immediately after `v103`:

- recovery budget for very tall manga pages was still being consumed by preprocessing and chunk OCR before focused probes even started
- document-like pages could still fall out of document cleanup mode mid-pipeline after earlier filters reduced the remaining word count

Changes in code:

- recovery-budget timing now effectively starts after base OCR setup instead of charging the whole chunk-recognition time against later rescue stages
- base-layout document detection is retained for the rest of the pipeline, so late cleanup and page-clear logic do not flip back to speech-mode behavior
- high-recall Latin speech cleanup is disabled on the tall-manga fast path
- raw-text fallback is more permissive on document-like pages to avoid blank-page regressions

## v105 Manga Base Retry For Weak Full-Page OCR

This pass targets the remaining normal-manga failure case where the first full-page Latin OCR pass returns only numeric garbage such as `4(0)` and the later pipeline has nothing usable left to rescue.

Changes in code:

- when a non-CJK manga page produces almost no meaningful base words, the worker now retries full-page OCR on the original image with manga-friendly PSMs before any later cleanup stages
- the retry compares candidates by meaningful-word count, candidate quality score, and text length, and only replaces the base result when it is clearly better
- this path is limited to weak manga pages so the stabilized document flow from `v104` is left alone

## v106 Document-Like Page Fail-Fast Guard

This pass addresses the next regression after `v105`: some document pages with tables, diagrams, or sparse technical annotations were being treated as garbage/noise pages and cleared out entirely.

Changes in code:

- base-layout document-like pages are now protected from the Latin fail-fast / hostile-noise classifiers
- panel noisy-page shortcuts no longer activate on document-like pages discovered from the base OCR layout
- this keeps table-heavy and diagram-heavy document pages on the normal document path instead of wiping them to `0 words`

## v107 Weak Document Base Retry

This pass addresses the remaining document regression where some pages still fail at the very first OCR pass and return only numeric garbage such as `0 / 51 / 514`.

Changes in code:

- weak Latin base retry is now available to document pages as well as manga pages
- document retries prefer the original image with `AUTO`, `SPARSE_TEXT`, and `SINGLE_BLOCK` before falling back to the processed image
- the retry only replaces the base pass when it is clearly better by lexical evidence, candidate score, or recovered word count

## v108 Manga Speech Over-Prune Rollback

This pass addresses the remaining oscillation where document fixes were stable, but ordinary manga speech bubbles could still collapse to `0 words` after the early noise filter.

Changes in code:

- the worker now records whether the base OCR already looked like a readable manga speech page before early cleanup
- if the early noise filter wipes out that page or shrinks it to a tiny fraction of the base words, the worker rolls back to the base manga snapshot instead of continuing into garbage fallback paths
- this rollback is limited to strong manga-speech pages and does not affect document cleanup

## v109 Late Speech Rollback And Weak Document Chunk Retry

This pass addresses the next oscillation seen after `v108`:

- ordinary manga speech pages could still survive the early noise filter, then get wiped out later by line-prune / ghost cleanup and end at `0 words`
- weak document pages with small text could still fail the initial full-page OCR pass even when document cleanup itself was otherwise stable

Changes in code:

- the worker now captures a speech-safe manga snapshot after the early noise stage and can restore it later if line-prune, late Latin cleanup, or page-level low-readability clear wipes the page out
- weak document base retry now includes a chunked `AUTO` candidate on the original image, so sparse small-text pages are not forced to rely only on one weak full-page pass
- both changes stay bounded: the speech rollback only applies to strong manga speech pages, and the chunk retry only applies to weak document base passes

## v110 Mode-Agnostic Weak Latin Retry

This pass addresses the next root cause revealed by the `v109` logs:

- weak document pages could still fall into manga-style cleanup when the UI mode was not enough to identify them and the base OCR was too weak to trigger document heuristics
- the pipeline was still making a mode-first decision too early instead of letting OCR evidence choose between document-style and speech-style retries

Changes in code:

- weak non-CJK pages now try both speech-friendly and document-friendly Latin base-retry candidates, instead of restricting the retry set to the current UI mode
- numeric-garbage weak pages can now try a chunked `AUTO` candidate even when they were opened under manga mode
- the best retry result now carries a cleanup hint, so later cleanup can lock into document mode or speech mode based on the winning OCR evidence rather than the initial mode assumption alone

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

## v100 Stabilization Pass

This pass intentionally resets focus back to the stable `v93` line-structure baseline and fixes the highest-priority structural gaps before adding more OCR heuristics.

### Phase 1: Tall manga timeout mitigation

- OCR text-layer now carries `documentType` through both current-page OCR and `Re-OCR All`.
- Very tall chunked manga pages now switch chunk OCR to `SPARSE_TEXT` instead of reusing generic Latin `AUTO`.
- Very tall chunked manga pages now prefer focused detect-only speech probes and skip the older wide sparse rescue bands that were expensive and often destabilized line layout.
- The generic top-band sparse probe is skipped on that tall-manga fast path to avoid spending runtime on oversized broad rescues.

### Phase 2: Document-only cleanup

- Document OCR now gets its own cache compatibility boundary through `documentType`.
- Added a document-only leading-artifact trim for lines such as `I To ...`, `| To ...`, and `me To ...` when they precede a strong lexical tail.
- Added a document-only late numeric restore for heading suffixes such as `Chapter 5` using raw OCR numeric candidates aligned to the surviving heading line.

### Why this pass is narrower

- It does not reintroduce the later region-rebuild logic that previously caused extra line breaks on manga pages.
- It keeps the `Current` and `Re-OCR All` worker path aligned instead of adding a second OCR architecture.

## v101 Focused Recovery Pass

This pass keeps the `v100` line-layout baseline but removes wasteful rescue work and patches two late-cleanup regressions that still showed up in real user traces.

### Phase 1: Tall manga latency and timeout control

- Empty TSV word boxes are now dropped during parse instead of entering the OCR pipeline as fake `(95)` tokens.
- Very tall chunked manga pages now tighten the recovery budget instead of inheriting the full generic best-quality Latin budget.
- The tall-manga fast path now skips the later heavy Latin rescue stages that were still burning time after base OCR:
  - local neighborhood rescue
  - top-balloon block rescue
  - empty-line / gap fallback
  - post-prune line-box rescue
  - edge-token rescue
- Focused detect-only tall-bubble probes remain enabled so missing `I THINK` / `EH?! ME?!!` style speech still has a bounded recovery path.

### Phase 2: Late Latin cleanup hardening

- Readable short speech heads such as `HOPE` are no longer stripped just because they are not present in the small shared lexicon.
- The shared Latin lexicon now includes a few high-frequency speech/document words that repeatedly showed up in failures but were being treated as non-lexical.

### Phase 3: Document cleanup without mode dependency

- Document-only late cleanup now also auto-activates on dense document-like Latin pages even when the UI translation mode was not manually switched away from manga.
- Heading numeric restore now checks raw numeric tokens instead of normalized short-digit aliases, which was blocking `Chapter 5` recovery when the digit survived OCR but was later normalized to a letter-like form.

## v102 Layout And Heading Refinement Pass

This pass targets the remaining user-facing gaps after `v101`: accepted-but-lost tall-bubble text, over-merged short bubble lines, and wrong heading digits on document pages.

### Changes

- Tall detect-only manga probes now score candidate text quality instead of picking the result with the most tokens.
- When a tall detect-only probe finds a better overlapping line, it can replace the existing ghost line instead of failing with `noUniqueWords`.
- Detect-only tall-bubble probes now upscale their crop before OCR to improve small text such as `I THINK`.
- Latin fragmented-line normalization now avoids merging short vertically stacked bubble lines, which should preserve layouts such as:
  - `I KNEW IT` / `NYAH`
  - `HOW MUCH` / `FOR IT`
- Document heading numerics now get a dedicated digit-only rescan pass near top `CHAPTER` headings so recovered suffixes are not limited to whatever raw OCR guessed first.

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

## v94 OCR Text-Layer Document Separation Pass

The next round exposed a broader architecture gap:

- OCR text-layer requests still did not carry `documentType`, so document pages were being post-processed by manga-biased Latin heuristics
- that let document pages pick up speech-only synthetic fixes such as stray `I` insertions
- numeric tails like `Chapter 5` were still fragile because late residual cleanup treated short numbers as generic noise
- manga punctuation such as `?!` and `...` was still easy to lose even when the raw line text contained it

### Changes

- OCR text-layer and export OCR now send `documentType` (`manga` vs `document`) through the worker path.
- OCR cache compatibility now includes `documentType`, preventing cross-mode cache reuse.
- Manga-only deterministic Latin speech fixes are now gated to manga OCR only.
- Aggressive manga-only late ghost filters are no longer applied to document OCR.
- Residual numeric cleanup now preserves short numeric tokens on document pages when they have aligned lexical context.
- Manga finalization can restore terminal punctuation from matching raw TSV line text when the alphanumeric content matches.
- Added a deterministic reorder/fix for the `AYNAR TAKES THIS ESSENCE` line family after the new line-quality changes exposed a word-order regression.

### Why this matters

- document OCR should stop receiving manga speech hallucinations like `I To`
- `Chapter 5`-style headings have a path to keep their contextual page number instead of dropping the digit as generic noise
- manga punctuation is restored in a bounded way from real raw OCR line text instead of globally relaxing punctuation filtering

## v95 Core OCR Pass

### Why v94 still failed

- raw TSV parsing still admitted empty level-5 "words", which polluted the Latin word graph with dozens of blank high-confidence boxes on tall manga pages
- chunked OCR flattened all words from every chunk and rebuilt lines only from Y proximity, so tall-page bubble ordering could drift even when chunk-local OCR was reasonable
- late Latin finalization reseeded lines from flat words again, throwing away any better line structure collected earlier
- document cleanup still had no document-specific trim for weak leading bullet ghosts like `I To`

### What changed

- `parseTSV()` now skips empty level-5 words entirely
- `recognizeInChunks()` now carries forward chunk-derived line seeds and line boxes instead of returning only a flat word list
- the worker now preserves existing line structure when refreshing final lines, rather than always rebuilding from a fresh Y-only seed
- document late line prune now keeps strong singleton numeric lines
- document late cleanup adds a bounded leading-artifact trim for weak singleton ghosts in front of otherwise strong lines

### Expected impact

- fewer bogus blank OCR words consuming budget on very tall manga pages
- better line separation/order retention for chunked manga OCR, especially when multiple balloons stack vertically
- `Chapter 5`-style singleton digits have a path to survive the late line prune
- document bullets and decorative markers should be less likely to become leading `I` / `me` ghosts

## v96 Direct Follow-up

### Why v95 could still look unchanged

- `Chapter 5` was still vulnerable one stage earlier than expected: late tail trimming could remove the numeric heading tail before residual line prune had any chance to keep it
- tall manga pages still used generic non-CJK chunk OCR settings, so chunk recognition itself could stay weak even after the line-assembly refactor
- some speech lines were already collapsed into one seed line by the time deterministic fixes ran, so preserving chunk line structure alone was not enough

### What changed

- chunked manga OCR now runs chunk recognition with `SPARSE_TEXT`
- late Latin trailing-artifact trim now preserves short numeric tails on document headings when they have lexical context
- document leading-artifact trim is stricter for `I To` / `me To` style ghosts
- late manga Latin cleanup now splits vertically staggered words back into separate lines when geometry shows the seed line actually contains multiple stacked rows

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

## v97 Structural Recovery

### Why v96 still looked unchanged

The remaining failures were not all simple keep/drop threshold misses.
Two structural issues were still active:

- stage_budget_exceeded was counting from before preprocess/base OCR, so very tall chunked pages could spend most or all rescue budget before tall-page speech probes ever ran
- late Latin vertical-flow splitting was still too eager, so stacked manga speech could be over-split into results like AYNAR / TAKES THIS ESSENCE or I KNEW / IT NYAH

Document failures also still had two path-level gaps:

- short numeric heading suffixes such as Chapter 5 were not always reintroduced when the numeric token had nearby lexical context but no stable original line seed
- pipe-like leading bullet ghosts such as | To could bypass the existing I To-style trim because the first token normalized to empty text instead of I

### What changed

- recovery budget now arms after base OCR and keeps only a bounded tail-budget for rescue, so tall pages can still run a few targeted probes without reopening the full runtime explosion that caused timeouts earlier
- punctuated short manga lines from raw line boxes are protected before late Latin prune, which should help preserve detected shout/speech fragments like I THINK..., EH?!, ME?!!, and FOR IT?
- vertical-flow Latin splitting now requires stronger geometry evidence before splitting inline text, but still allows centered lower lines like ESSENCE or NYAH to break onto their own rows
- document numeric reintroduction now accepts nearby lexical support instead of only same-line support, and document cleanup can merge lexical heading lines with short numeric suffix lines
- document leading-artifact trim now also handles pipe-like bullet ghosts such as | To

### Validation focus after v97

Re-test the same pages first and check for these signals:

- OCR pipeline version: 97
- tall manga pages should no longer hit stage_budget_exceeded before speech probes have a chance to run
- document heading lines should recover Chapter 5 instead of dropping the numeric suffix
- document body lines should stop keeping | To / I To ghosts at the head of strong lines
- tall manga line order should move closer to the original visual flow instead of over-splitting into dense single-word rows

## v98 Tall Region Reconstruction

### Why v97 was still not enough

Even after delaying recovery-budget accounting, the tall manga path was still fundamentally page-level first.
That meant:

- chunk OCR still created fragmented line seeds that later fixes had to guess how to reorder
- broad sparse probes still added tokens into a noisy global pool instead of rebuilding bubble-local reading order
- very long document pages could still spend extra time in cleanup/rescue stages even when the chunked base OCR was already strong enough

### What changed

- very tall manga pages now build speech-like regions from raw line boxes and re-OCR those regions directly
- each tall speech region tries bounded SINGLE_BLOCK / SPARSE_TEXT recognition and is accepted by line-level quality, punctuation, and lexical evidence instead of token-only rescue rules
- if the rebuilt region result has better structure than the global page result, it replaces the fragmented tall-page output before later normalization
- chunked document pages with already-strong evidence now use conservative cleanup to reduce both over-pruning and wasted rescue time

### Validation focus after v98

- OCR pipeline version: 98
- tall manga pages should log region reconstruction instead of only broad sparse probes
- page 1 of the long manga should move closer to bubble-local ordering like I THINK..., EH?!, ME?!!, I KNEW IT, NYAH, HOW MUCH, FOR IT?
- long document pages should be less likely to drift into timeout when the chunked base OCR is already readable

## v99 Tall Region Execution Pass

### Why v98 could still look unchanged

- the tall speech-region reconstruction path still sat after earlier Latin rescue stages, so very tall manga pages could spend budget before the new region path ran
- short punctuated shout lines such as EH?! still failed region acceptance because they had little or no lexical support
- document headings like Chapter 5 could still lose the numeric suffix after later cleanup because the earlier contextual numeric reintroduction was not the last numeric checkpoint
- document ghost heads like | To / I To still needed a stronger final trim path

### What changed

- very tall manga pages now prefer the bounded speech-region recovery path before the older empty-line / gap / top-band rescue stages consume budget
- tall-region acceptance now keeps short punctuated shout lines with bounded confidence instead of requiring lexical support only
- accepted tall regions now replace overlapping bad page lines instead of requiring a whole-page rebuild to win before being used
- late manga vertical-flow splitting is skipped once tall-region reconstruction has already produced the kept line structure
- document finalization now performs a last heading-numeric restore pass from base OCR words before the result is emitted
- leading document TO artifacts now trim more aggressively when the tail remains readable
