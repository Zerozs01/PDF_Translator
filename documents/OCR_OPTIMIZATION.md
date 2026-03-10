# OCR Optimization Notes

This document focuses on performance and quality tradeoffs in the OCR pipeline.

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

### Current interpretation

- The system is now **better at recall** on hard manga speech bubbles.
- The main remaining weakness is **line completion at bubble edges / last-line recovery**, not catastrophic ghosting.
- Next tuning should focus on:
   1. region padding for last-line crops
   2. low-coverage line rescans near bubble bottoms
   3. less aggressive post-rescue pruning for short but valid final lines

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
