import { describe, expect, test } from 'vitest';
import { findBestLineBoxForLine, findBestLineForBox } from './ocr-parsing';

describe('ocr-parsing line-box matching thresholds', () => {
  test('keeps borderline line-to-box match when vertical overlap is moderate', () => {
    const line = {
      text: 'IN THE PAST, I ONLY FOUND THE',
      confidence: 92,
      bbox: { x0: 120, y0: 100, x1: 520, y1: 132 },
      words: [],
    };
    const box = { x0: 112, y0: 122, x1: 536, y1: 154 };

    const matched = findBestLineForBox([line], box);
    expect(matched).toBe(line);
  });

  test('keeps borderline box-to-line match when vertical overlap is moderate', () => {
    const line = { bbox: { x0: 88, y0: 200, x1: 488, y1: 230 } };
    const candidateBox = { key: 'line-1', bbox: { x0: 84, y0: 220, x1: 500, y1: 250 } };

    const matched = findBestLineBoxForLine([candidateBox], line);
    expect(matched).toEqual(candidateBox.bbox);
  });
});
