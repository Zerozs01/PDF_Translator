import { describe, expect, test } from 'vitest';
import type { OCRPageResult } from '../types';
import { buildOCRSourceFingerprint } from './ocrSourceFingerprint';

const createResult = (): OCRPageResult => ({
  pageNumber: 1,
  width: 1200,
  height: 1800,
  dpi: 300,
  language: 'eng',
  pageSegMode: 6,
  algorithmVersion: 1,
  pipelineProfile: 'panel',
  ocrEngine: 'easyocr',
  ocrQualityProfile: 'best',
  confidence: 92,
  text: 'Line A\nLine B',
  words: [],
  lines: [
    {
      text: 'Line A',
      confidence: 95,
      bbox: { x0: 10, y0: 20, x1: 200, y1: 50 },
      words: [],
    },
    {
      text: 'Line B',
      confidence: 91,
      bbox: { x0: 10, y0: 60, x1: 240, y1: 92 },
      words: [],
    },
  ],
});

describe('ocrSourceFingerprint', () => {
  test('changes when OCR line order changes', () => {
    const original = createResult();
    const reordered = {
      ...createResult(),
      lines: [...createResult().lines].reverse(),
      text: 'Line B\nLine A',
    };

    expect(buildOCRSourceFingerprint(original, 'easyocr')).not.toBe(
      buildOCRSourceFingerprint(reordered, 'easyocr')
    );
  });

  test('changes when OCR geometry changes with same counts', () => {
    const original = createResult();
    const shifted = createResult();
    shifted.lines = shifted.lines.map((line, index) => (
      index === 1
        ? {
            ...line,
            bbox: { ...line.bbox, y0: line.bbox.y0 + 120, y1: line.bbox.y1 + 120 },
          }
        : line
    ));

    expect(buildOCRSourceFingerprint(original, 'easyocr')).not.toBe(
      buildOCRSourceFingerprint(shifted, 'easyocr')
    );
  });
});
