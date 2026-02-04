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

4. **Text Layer**  
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

## Files to Check When Tuning

- `src/services/vision/worker.ts`
- `src/services/pdf/SearchablePDFService.ts`
- `src/components/OCR/OCRTextLayerPanel.tsx`
