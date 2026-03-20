# OCR Optimization Notes

This document focuses on performance and quality tradeoffs in the OCR pipeline.

## Current Baseline Decision (2026-03-21)

- Keep runtime behavior aligned with the existing `Best Quality` profile as default baseline.
- Do not switch users to a new fast profile yet.
- Continue with stability/timeout hardening first, then roll out speed profile as an explicit opt-in optimization phase.

## 2026-03-21 Practical Answer: Are only required steps left?

Short answer: no. The pipeline still contains several accuracy-oriented optional rescue stages that can be reduced or bypassed for a speed profile.

### Step classification (current worker)

Mandatory core (keep for all profiles):
- PDF render to canvas
- One primary Tesseract recognize pass
- TSV parsing and base noise cleanup
- Minimal line reconstruction
- Final text-layer payload assembly

Optional heavy stages (accuracy-first, expensive):
- Line rescan loops
- Anchor probe / neighborhood rescue
- Top-band sparse rescue
- Post-prune line rescue
- Edge-token rescue
- Gap and empty-line fallback retries
- Full image tile + background variance filtering on every page

### What to change for pdf24-like speed while preserving baseline quality

1. Introduce dual runtime profiles in worker entry.
   - Accuracy profile: current behavior.
   - Fast profile: single recognize pass + minimal cleanup + strict micro-rescue cap.

2. Add hard per-page rescue budget by operation count, not only time.
   - Example: max 2 recognizeRegion calls in fast profile.
   - This gives deterministic latency and avoids long-tail pages.

3. Make costly filters conditional.
   - Run image-tile and background-variance filters only when base output is sufficiently dense/noisy.
   - Skip these filters for low-word or already-clean pages.

4. Shrink panel defaults for interactive OCR.
   - Keep export profile for full-quality batch generation.
   - Keep panel profile focused on user-perceived speed and fail-fast.

5. Add telemetry per stage for auto-tuning.
   - Track stage time and token delta.
   - Disable stages that cost high time but rarely improve text on a given document pattern.

### Suggested refactor slices

Slice A (low risk, immediate):
- Add Fast profile toggle and operation-cap gate.
- Disable line-rescan/top-band/post-prune in Fast profile by default.

Slice B (medium risk):
- Convert image-tile/background filters to conditional execution policy.
- Apply based on base-noise signature and confidence distribution.

Slice C (higher value):
- Build adaptive stage scheduler from telemetry (budget-aware stage ordering).
- Run highest ROI stage first; stop when confidence/readability target is reached.

## 2026-03-21 Timeout Follow-up (Page 1 Hostile Texture Case)

### What was observed

- Many pages are now stable and no longer hit the 120s page timeout.
- Page 4-style non-target/no-text pages are now correctly fail-fast skipped with explicit skip reason.
- A residual Page 1 pattern could still run long in some retries because expensive rescue stages were entered before hard-skip criteria were reached in all runs.

### Why Page 1 could still be slow

- The page produces many noisy tokens from texture/watermark-like regions.
- Post-filter lexical signals can fluctuate between runs, so one run may classify as garbage early while another run still qualifies for line-rescan/top-band rescue.
- Budget checks were initially missing on some late rescue branches, allowing additional heavy probes after budget warning.

### Current mitigation in code

- Fail-fast now also uses raw-before-filter metrics (`rawWordCountBeforeNoise`, filtered-out ratio) to catch hostile texture pages earlier.
- Added stricter panel-only texture garbage rules to skip heavy rescue when raw-noise signatures are dominant.
- Recovery budget gate is applied to remaining heavy branches (top-band sparse probe, post-prune line rescue, edge-token rescue) to prevent stage-overrun cascades.
- Timeout hook now tears down worker requests hard (`visionService.cancelAll`) instead of only timing out the wrapper promise.
- UI now shows `skipReason` for fast diagnosis during tuning.

## Pipeline Overview

1. **Render PDF → Canvas**  
   `src/components/OCR/OCRTextLayerPanel.tsx` renders each page at target DPI.

2. **OCR (Tesseract.js)**  
   `src/services/vision/worker.ts` runs OCR and returns TSV, words, lines.

3. **Filtering**  
   - `cleanLineNoise`: remove short/noisy tokens.
   - `filterWordsByImageTiles`: reduce OCR in image-heavy tiles.
   - `filterWordsByBackground`: remove words on photo backgrounds.

4. **Fallback Recovery**  
   - Re-OCR empty line boxes (`PSM.SINGLE_LINE`) to recover missed lines.
   - Re-OCR large gaps in a line (`PSM.SINGLE_WORD`) to recover short missing tokens.
   - Uses grayscale (non-binarized) input when available to avoid losing thin glyphs.
   - Disabled when page has too few words to avoid slowing low-confidence pages.

5. **Text Layer**  
   `src/services/pdf/TextLayerService.ts` injects invisible text.

## Performance Hotspots

- **Image tile mask**: samples the full grayscale image to build a coarse image mask.
- **Background variance**: computes per-word background variance for photo filtering.
- **OCR itself**: Tesseract dominates CPU time (quality vs speed tradeoff).

## Cache & Parallelism

- OCR cache auto-loads on page change when parameters match; Current Page forces re-OCR.
- `VisionService` uses a small worker pool to enable limited parallel OCR work.

## Current Tuning Strategy

- Keep high-confidence, larger text (titles) even on images.
- Only drop short tokens in image tiles when they are small + low-confidence.
- Protect line words when they look like real text (multi-word lines).

## 2026-03-09 Field Validation Notes

Latest tuning pass focused on three goals:
- recover real bubble text more aggressively on sparse Latin manga pages
- reduce dark-border / scan-edge ghost text
- keep thin strokes that were previously lost by global thresholding

### What changed in code

- Added adaptive binarization in [src/services/vision/ocr-preprocessing.ts](../src/services/vision/ocr-preprocessing.ts)
- Added dark border cleanup in [src/services/vision/ocr-preprocessing.ts](../src/services/vision/ocr-preprocessing.ts)
- Added lightweight binary repair to reconnect thin glyph strokes in [src/services/vision/ocr-preprocessing.ts](../src/services/vision/ocr-preprocessing.ts)
- Relaxed high-recall Latin pruning logic in [src/services/vision/worker.ts](../src/services/vision/worker.ts)
- Added new preprocessing / high-recall tuning constants in [src/services/vision/ocr-config.ts](../src/services/vision/ocr-config.ts)

### Observed improvements from manual verification

- **Page 3**: lower line **"TAKE A LOOK!"** is finally detected again. This is a meaningful recovery because it was previously one of the persistent missing-line failures.
- **Overall**: ghost text is reduced while preserving more real bubble content.
- **Overall**: sparse Latin manga bubbles now survive pruning better than before.

### Known issues still open

- **Page 2**: last line still missing: **"Xujia town"**
- **Page 5**:
   - first line incomplete: **"IN THE PAST, I ONLY FOUND THE"** is truncated
   - third line loses **"TH"** in **"WITH"**
   - fourth line **"THIS KIND OF STUFF.."** is still missing
- **Page 10**: last line **"THE PEOPLE HERE?"** is still missing

### Note on extra background boxes

- Some extra background-aligned boxes may still appear around speech regions.
- For now this is considered acceptable if they help OCR recall, segmentation, or later filtering.
- Prefer keeping slightly noisy candidate geometry over prematurely removing useful rescue regions.

### Current interpretation (as of 2026-03-09)

- The system is now **better at recall** on hard manga speech bubbles.
- The main remaining weakness is **line completion at bubble edges / last-line recovery**, not catastrophic ghosting.
- Next tuning should focus on:
   1. region padding for last-line crops
   2. low-coverage line rescans near bubble bottoms
   3. less aggressive post-rescue pruning for short but valid final lines

---

## 2026-03-10 — Ghost Text Reduction & Boot Loader

### Architecture Changes

- **Boot Loader** (`worker-boot.ts`): Primary worker still crashes with opaque "(no message)" in Vite dev-mode. Created a tiny boot loader (~50 lines) that dynamically imports `worker.ts` in try-catch, captures the real error (message, stack, name) via `WORKER_BOOT_ERROR` postMessage, then auto-falls back to `worker-stable.ts`.
- **VisionService** now loads `worker-boot.ts` instead of `worker.ts` for primary mode.
- **Vite config** updated: `worker: { format: 'es' }`, `optimizeDeps: { include: ['tesseract.js'] }`.

### Filtering Pipeline Overhaul (worker-stable.ts)

Replaced the basic 4-rule `filterGarbageWords` with a comprehensive **9-step pipeline**:

| Step | Function | Purpose |
|------|----------|---------|
| 0 | `splitMergedWords` | Dictionary-based word splitting (TAKEA→TAKE+A, NowI→Now+I, MAKEDO→MAKE+DO) |
| 1 | `filterNoiseWords` | Remove garbage words (conf<20, symbols, consonant-heavy, mixed-case 3+ transitions) + watermarks |
| 2 | `buildLines` | Group words into lines by Y proximity (threshold: pageHeight × 0.015) |
| 3a | `pruneEdgeGhostLines` | Lines in top/bottom 16% band must have readability ≥ 0.7 or lexicalHits ≥ 2 |
| 3a | `pruneGarbageLines` | Require proportionate lexical content; zero-lexical catch-all (conf < 90 → drop) |
| 3a | `pruneShortFragments` | Remove single-char lines (except "I"), short non-lexical orphans |
| 3b | `cleanNoiseWordsWithinLines` | Remove lowercase noise words from uppercase-dominant lines |
| 3c | Density check | totalAlpha ≤ 4 + lexHits < 2 + maxConf < 85 → drop |
| 4 | Page quality gate | avgReadability < 0.35 + lexCount < 2 + totalAlpha < 20 → clear all |

### Key Components

- **`LATIN_COMMON`** — ~260 common English words + compound words (prevent false word-splitting)
- **`LATIN_SHORT_KEEP`** — 18 valid short words (I, A, IT, TO, IN, ON, OF, etc.) protected from short-word filters
- **`isLexicalWord(text)`** — strips punctuation before lookup (DON'T → DONT → found)
- **`scoreTokenReadability(word)`** — 0-1 score: vowel ratio, consonant runs, case mixing, length, confidence
- **`countCaseTransitions(text)`** — counts upper↔lower transitions; ≥3 = gibberish
- **`isWatermarkWord(word, pw, ph)`** — detects URLs, manga sites (LikeManga, ACloudMerge, ColaManga), standalone COM/IO/NET near edges
- **`trySplitWord(text)`** — dictionary-based merged-word detection: tries case boundaries first, then all positions
- **`cleanNoiseWordsWithinLines(lines)`** — drops lowercase non-lexical words on uppercase-dominant lines

### Results

| Page | Before (ghost words) | After (total words) | Confidence | Key changes |
|------|---------------------|---------------------|------------|-------------|
| 2 | 59 dropped | 22 words | 68% | Main bubble text detected correctly |
| 3 | 25 dropped | 12 words | 58% | "I'LL OVER AND / TAKEA LOOK" detected |
| 5 | 60 dropped | 25 words | 74% | Core sentences detected with some noise |

### Remaining Bugs (Post-Filtering)

1. **Tesseract misreads** (not fixable by post-filters — the correct text never enters the pipeline):
   - P2 L4: `XUJIA TOWN` → `AVIA TOdl CR En Se` + stray `A`
   - P3: `TAKE A LOOK` may still be merged as `TAKEA LOOK` depending on Tesseract output
   - P5: `NowI CAN ONLY MAKEDO WITH` → now fixed by word-splitting

2. **Ghost fragments now caught**:
   - P3: `CREAweaErSRETHIbe` — caught by `countCaseTransitions ≥ 3` in `isGarbageWord`
   - P5: `vided`, `Wis`, `wraphimills` — caught by zero-lexical catch-all and per-word cleanup
   - P2: `A` standalone — caught by single-char line filter
   - P2: `AVIA TOdl CR En Se` — caught by zero-lexical catch-all (no dictionary words)

3. **Missing text** (Tesseract not detecting at all — needs preprocessing/detection improvements):
   - P5: `THIS KIND OF STUFF` not detected
   - P10: `THE PEOPLE HERE?` still missing

### Next tuning priorities

1. Investigate primary worker crash using boot loader error output
2. Improve Tesseract detection for missing text (P5 `THIS KIND OF STUFF`, P10 `THE PEOPLE HERE?`) — likely needs preprocessing or PSM tuning
3. Consider expanding `LATIN_COMMON` with domain-specific vocabulary as more manga pages are tested

## Suggested Next Optimizations

1. **Adaptive sampling step**  
   Increase sample step on large images to reduce tile-mask cost.

2. **Text-heavy short-circuit**  
   If page is mostly text, skip photo filter or apply it only to low-confidence tokens.

3. **Config profiles**  
   Provide "Speed" vs "Accuracy" profiles by toggling:
   - OCR DPI
   - Photo filters
   - Tile sampling step

4. **Offline language data**  
   Place `.traineddata` in `public/tessdata` and set `LANG_PATH` to `/tessdata`.
   The worker will try local first and fall back to CDN if missing.

5. **Large image chunking**  
   Pages exceeding `MAX_OCR_WIDTH/HEIGHT` are processed in vertical chunks
   (`CHUNK_HEIGHT` with `CHUNK_OVERLAP`) to avoid Tesseract size limits.

6. **DIP-Inspired Preprocessing (Targeted)**  
   - **Adaptive threshold vs. global**: use per-page heuristics to decide when
     Otsu binarization should be skipped (e.g., high anti-aliasing or comic fonts).
   - **CJK safety**: skip binarization for `kor/jpn/chi_*` to preserve stroke detail.
   - **Morphology (lightweight)**: apply small closing/opening after binarization
     to reconnect broken strokes for thin fonts.
   - **Quality scoring**: collect simple metrics (contrast, skew, noise) to
     choose preprocessing paths automatically.

## Files to Check When Tuning

- `src/services/vision/worker.ts`
- `src/services/pdf/SearchablePDFService.ts`
- `src/components/OCR/OCRTextLayerPanel.tsx`
