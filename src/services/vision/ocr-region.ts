/**
 * OCR Region — classification and grouping of words into logical regions
 */

import { CONFIG } from './ocr-config';
import type { BBox, OCRWord, DocumentType } from './ocr-types';
import { joinWordsForLanguage } from './ocr-text-utils';

/**
 * Classify a text region based on size, word count, and confidence.
 */
export function classifyRegion(
  text: string,
  bbox: BBox,
  confidence: number,
  pageWidth: number,
  pageHeight: number,
  documentType: DocumentType
): 'text' | 'balloon' | 'sfx' | 'panel' {
  const width = bbox.x1 - bbox.x0;
  const height = bbox.y1 - bbox.y0;
  const aspectRatio = width / Math.max(height, 1);
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
  const relativeHeight = height / pageHeight;

  if (documentType === 'document') return 'text';

  // SFX: Large text, few words, often lower confidence
  if (wordCount <= CONFIG.SFX_MAX_WORDS && relativeHeight > CONFIG.SFX_MIN_FONT_SIZE_RATIO && confidence < 70) {
    return 'sfx';
  }

  // Balloon: medium-sized regions with reasonable aspect ratio
  if (aspectRatio >= CONFIG.BALLOON_ASPECT_RATIO_MIN && aspectRatio <= CONFIG.BALLOON_ASPECT_RATIO_MAX
    && wordCount >= 1 && confidence >= CONFIG.MIN_CONFIDENCE) {
    return 'balloon';
  }

  return 'text';
}

/**
 * Group words into logical blocks/regions by spatial proximity.
 */
export function groupWordsIntoRegions(
  words: Array<{ text: string; confidence: number; bbox: BBox }>,
  pageWidth: number,
  pageHeight: number,
  documentType: DocumentType
): Array<{
  id: string;
  type: 'text' | 'balloon' | 'sfx' | 'panel';
  box: { x: number; y: number; w: number; h: number };
  originalText: string;
  confidence: number;
}> {
  if (words.length === 0) return [];

  const GAP_THRESHOLD_X = pageWidth * 0.05;
  const GAP_THRESHOLD_Y = pageHeight * 0.02;

  const sortedWords = [...words].sort((a, b) => {
    const yDiff = a.bbox.y0 - b.bbox.y0;
    if (Math.abs(yDiff) > GAP_THRESHOLD_Y) return yDiff;
    return a.bbox.x0 - b.bbox.x0;
  });

  const merged: Array<{ words: typeof words; bbox: BBox }> = [];

  for (const word of sortedWords) {
    let addedToGroup = false;
    for (const group of merged) {
      const xGap = word.bbox.x0 - group.bbox.x1;
      const yOverlap = Math.min(word.bbox.y1, group.bbox.y1) - Math.max(word.bbox.y0, group.bbox.y0);
      const yGap = Math.abs(word.bbox.y0 - group.bbox.y1);

      if (yOverlap > 0 && xGap < GAP_THRESHOLD_X && xGap > -word.bbox.x1) {
        group.words.push(word);
        group.bbox = {
          x0: Math.min(group.bbox.x0, word.bbox.x0),
          y0: Math.min(group.bbox.y0, word.bbox.y0),
          x1: Math.max(group.bbox.x1, word.bbox.x1),
          y1: Math.max(group.bbox.y1, word.bbox.y1),
        };
        addedToGroup = true;
        break;
      }

      if (yGap < GAP_THRESHOLD_Y && yGap >= 0) {
        const xOverlap = Math.min(word.bbox.x1, group.bbox.x1) - Math.max(word.bbox.x0, group.bbox.x0);
        if (xOverlap > 0) {
          group.words.push(word);
          group.bbox = {
            x0: Math.min(group.bbox.x0, word.bbox.x0),
            y0: Math.min(group.bbox.y0, word.bbox.y0),
            x1: Math.max(group.bbox.x1, word.bbox.x1),
            y1: Math.max(group.bbox.y1, word.bbox.y1),
          };
          addedToGroup = true;
          break;
        }
      }
    }

    if (!addedToGroup) {
      merged.push({ words: [word], bbox: { ...word.bbox } });
    }
  }

  return merged.map((group, index) => {
    const text = joinWordsForLanguage(group.words as OCRWord[]);
    const avgConf = group.words.reduce((s, w) => s + w.confidence, 0) / group.words.length;
    const type = classifyRegion(text, group.bbox, avgConf, pageWidth, pageHeight, documentType);
    return {
      id: `region-${index}-${Date.now()}`,
      type,
      box: {
        x: group.bbox.x0,
        y: group.bbox.y0,
        w: group.bbox.x1 - group.bbox.x0,
        h: group.bbox.y1 - group.bbox.y0,
      },
      originalText: text,
      confidence: avgConf / 100,
    };
  }).filter(r => r.originalText.length > 0 && r.confidence >= CONFIG.MIN_CONFIDENCE / 100);
}
