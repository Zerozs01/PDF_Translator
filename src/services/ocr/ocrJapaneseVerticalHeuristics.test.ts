import { describe, it, expect } from 'vitest';
import { processJapaneseVerticalPipeline, isValidOcrBoxJapanese, isVerticalJapaneseLayout } from './ocrJapaneseVerticalHeuristics';
import { OcrBox } from './ocrManhwaHeuristics';
import { OCRPageResult, OCRLine } from '../../types';

describe('ocrJapaneseVerticalHeuristics', () => {
  describe('isValidOcrBoxJapanese', () => {
    it('allows Japanese text', () => {
      const box: OcrBox = {
        bbox: { x0: 0, y0: 0, x1: 100, y1: 20 },
        text: 'こんにちは',
        score: 0.95,
        originalLine: {} as OCRLine
      };
      expect(isValidOcrBoxJapanese(box)).toBe(true);
    });

    it('rejects screen-tone noise or garbage without Japanese characters', () => {
      const box: OcrBox = {
        bbox: { x0: 0, y0: 0, x1: 100, y1: 20 },
        text: 'Hello World',
        score: 0.9,
        originalLine: {} as OCRLine
      };
      expect(isValidOcrBoxJapanese(box, { minJapaneseRatio: 0.3 })).toBe(false);
    });
  });

  describe('isVerticalJapaneseLayout', () => {
    it('returns true when columns are vertically oriented', () => {
      const lines: OCRLine[] = [
        {
          text: 'これは縦書きです',
          confidence: 90,
          bbox: { x0: 100, y0: 100, x1: 130, y1: 400 },
          words: []
        },
        {
          text: '右から左に読みます',
          confidence: 90,
          bbox: { x0: 50, y0: 100, x1: 80, y1: 450 },
          words: []
        }
      ];
      expect(isVerticalJapaneseLayout(lines)).toBe(true);
    });

    it('returns false when text is horizontally laid out', () => {
      const lines: OCRLine[] = [
        {
          text: 'これは横書きです',
          confidence: 90,
          bbox: { x0: 100, y0: 100, x1: 400, y1: 130 },
          words: []
        }
      ];
      expect(isVerticalJapaneseLayout(lines)).toBe(false);
    });
  });

  describe('processJapaneseVerticalPipeline', () => {
    it('merges vertical Japanese columns correctly and orders them RTL-TTB', () => {
      const pageResult: OCRPageResult = {
        pageNumber: 1,
        width: 1000,
        height: 1200,
        dpi: 300,
        language: 'jpn',
        algorithmVersion: 1,
        lines: [
          // Left column (should be read second in RTL)
          {
            text: 'これは二番目',
            confidence: 90,
            bbox: { x0: 200, y0: 100, x1: 230, y1: 300 },
            words: []
          },
          {
            text: 'の列です',
            confidence: 88,
            bbox: { x0: 200, y0: 310, x1: 230, y1: 450 },
            words: []
          },
          // Right column (should be read first in RTL)
          {
            text: 'こちらは最初',
            confidence: 95,
            bbox: { x0: 500, y0: 100, x1: 530, y1: 300 },
            words: []
          },
          {
            text: 'の列です',
            confidence: 92,
            bbox: { x0: 500, y0: 310, x1: 530, y1: 450 },
            words: []
          }
        ],
        words: [],
        text: '',
        confidence: 0
      };

      const processed = processJapaneseVerticalPipeline(pageResult, {
        merge: {
          maxVerticalGap: 25,
          maxHorizontalGap: 18,
          minColumnOverlapRatio: 0.35,
          maxGroupHeightRatio: 0.45,
          pageHeight: 1200,
          readingDirection: 'rtl-ttb'
        }
      });

      // We expect 2 merged text blocks (left column merged, right column merged)
      expect(processed.lines.length).toBe(2);

      // The right-side column should be first in the sorted array (RTL order)
      const firstLine = processed.lines[0];
      const secondLine = processed.lines[1];

      expect(firstLine.text).toBe('こちらは最初\nの列です');
      expect(secondLine.text).toBe('これは二番目\nの列です');
    });
  });
});
