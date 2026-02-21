/**
 * OCR Fallback — region recognition, chunking, vertical gap detection
 */

import { CONFIG } from './ocr-config';
import type { BBox, OCRWord, TesseractResult } from './ocr-types';
import { parseTSV, clampBBox, buildLinesFromWordsByY } from './ocr-parsing';
import type { createWorker } from 'tesseract.js';

type TessWorker = Awaited<ReturnType<typeof createWorker>>;

// ============================================
// Vertical gap detection for CJK
// ============================================

export function findVerticalGapRegions(
  lines: Array<{ bbox: BBox }>,
  pageWidth: number,
  pageHeight: number
): BBox[] {
  if (lines.length === 0) return [];
  const sorted = lines.slice().sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const heights = sorted.map(l => Math.max(1, l.bbox.y1 - l.bbox.y0)).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || heights[0] || 1;
  const minGap = Math.max(pageHeight * CONFIG.CJK_VERTICAL_GAP_MIN_RATIO, medianH * CONFIG.CJK_VERTICAL_GAP_MIN_MULT);
  const padY = medianH * CONFIG.CJK_VERTICAL_GAP_PAD_RATIO;
  const padX = medianH * (CONFIG.CJK_VERTICAL_GAP_PAD_RATIO * 1.2);

  const regions: Array<{ bbox: BBox; gap: number }> = [];

  const topGap = sorted[0].bbox.y0;
  if (topGap > minGap) {
    regions.push({
      gap: topGap,
      bbox: {
        x0: sorted[0].bbox.x0 - padX,
        y0: 0,
        x1: sorted[0].bbox.x1 + padX,
        y1: sorted[0].bbox.y0 + padY
      }
    });
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1].bbox.y0 - sorted[i].bbox.y1;
    if (gap > minGap) {
      regions.push({
        gap,
        bbox: {
          x0: Math.min(sorted[i].bbox.x0, sorted[i + 1].bbox.x0) - padX,
          y0: sorted[i].bbox.y1 - padY,
          x1: Math.max(sorted[i].bbox.x1, sorted[i + 1].bbox.x1) + padX,
          y1: sorted[i + 1].bbox.y0 + padY
        }
      });
    }
  }

  regions.sort((a, b) => b.gap - a.gap);
  return regions.slice(0, CONFIG.CJK_VERTICAL_GAP_MAX_PASSES).map(r => r.bbox);
}

// ============================================
// Region recognition (crop + re-OCR)
// ============================================

export async function recognizeRegion(
  worker: TessWorker,
  imageInput: string | Blob,
  bbox: BBox,
  psm: number,
  width: number,
  height: number,
  dpi?: number
): Promise<OCRWord[]> {
  const safe = clampBBox(bbox, width, height);
  const cropW = Math.max(1, Math.round(safe.x1 - safe.x0));
  const cropH = Math.max(1, Math.round(safe.y1 - safe.y0));

  // Skip regions that are too small for useful OCR
  if (cropW < 8 || cropH < 8) return [];

  const blob = typeof imageInput === 'string'
    ? await (await fetch(imageInput)).blob()
    : imageInput;

  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(cropW, cropH);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Failed to create crop canvas context');
  }

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, cropW, cropH);
  ctx.drawImage(bitmap, safe.x0, safe.y0, cropW, cropH, 0, 0, cropW, cropH);
  bitmap.close();

  await worker.setParameters({
    tessedit_pageseg_mode: String(psm),
    tessedit_create_tsv: '1',
    ...(dpi ? { user_defined_dpi: String(Math.round(dpi)) } : {})
  } as Record<string, string>);

  const result = await worker.recognize(canvas as any, undefined, { text: true, tsv: true }) as TesseractResult;
  const parsed = parseTSV(result.data.tsv || '');
  return parsed.words.map(w => ({
    text: w.text,
    confidence: w.confidence,
    bbox: {
      x0: w.bbox.x0 + safe.x0,
      y0: w.bbox.y0 + safe.y0,
      x1: w.bbox.x1 + safe.x0,
      y1: w.bbox.y1 + safe.y0,
    }
  }));
}

// ============================================
// Chunked recognition for large images
// ============================================

export async function recognizeInChunks(
  worker: TessWorker,
  imageInput: string | Blob,
  width: number,
  height: number,
  overlap: number
): Promise<{ words: OCRWord[]; lines: Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }>; text: string; confidence: number }> {
  const blob = typeof imageInput === 'string'
    ? await (await fetch(imageInput)).blob()
    : imageInput;

  const sourceBitmap = await createImageBitmap(blob);

  const chunkHeight = CONFIG.CHUNK_HEIGHT;
  const step = Math.max(1, chunkHeight - overlap);
  const totalChunks = Math.ceil(height / step);

  const allWords: OCRWord[] = [];
  const wordKeySet = new Set<string>();
  let fullText = '';
  let totalConf = 0;
  let confCount = 0;

  for (let i = 0; i < totalChunks; i++) {
    const yStart = i * step;
    const currentHeight = Math.min(chunkHeight, height - yStart);
    if (currentHeight <= 0) break;

    const chunkCanvas = new OffscreenCanvas(width, currentHeight);
    const ctx = chunkCanvas.getContext('2d');
    if (!ctx) throw new Error('Failed to create chunk canvas context');

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, currentHeight);
    ctx.drawImage(sourceBitmap, 0, yStart, width, currentHeight, 0, 0, width, currentHeight);

    const chunkBlob = await chunkCanvas.convertToBlob({ type: 'image/png' });
    const result = await worker.recognize(chunkBlob as any, undefined, { text: true, tsv: true }) as TesseractResult;

    fullText += (result.data.text || '') + '\n';
    if (typeof result.data.confidence === 'number') {
      totalConf += result.data.confidence;
      confCount += 1;
    }

    const { words } = parseTSV(result.data.tsv || '');
    for (const word of words) {
      const adjusted: OCRWord = {
        text: word.text,
        confidence: word.confidence,
        bbox: { x0: word.bbox.x0, x1: word.bbox.x1, y0: word.bbox.y0 + yStart, y1: word.bbox.y1 + yStart }
      };
      const key = `${Math.round(adjusted.bbox.x0 / 2)}_${Math.round(adjusted.bbox.y0 / 2)}_${Math.round(adjusted.bbox.x1 / 2)}_${Math.round(adjusted.bbox.y1 / 2)}_${adjusted.text}`;
      if (wordKeySet.has(key)) continue;
      wordKeySet.add(key);
      allWords.push(adjusted);
    }
  }

  sourceBitmap.close();

  return {
    words: allWords,
    lines: buildLinesFromWordsByY(allWords, height),
    text: fullText.trim(),
    confidence: confCount > 0 ? totalConf / confCount : 0
  };
}
