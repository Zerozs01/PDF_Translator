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

## Current Tuning Strategy

- Keep high-confidence, larger text (titles) even on images.
- Only drop short tokens in image tiles when they are small + low-confidence.
- Protect line words when they look like real text (multi-word lines).

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
