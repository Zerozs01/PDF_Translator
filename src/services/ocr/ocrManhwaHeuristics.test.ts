import { describe, it, expect } from 'vitest';
import { processKoreanManhwaPipeline, isValidOcrBox, OcrBox } from './ocrManhwaHeuristics';
import { OCRPageResult, OCRLine } from '../../types';

describe('ocrManhwaHeuristics', () => {
  describe('isValidOcrBox', () => {
    it('allows lone punctuation (ellipsis, exclamation marks)', () => {
      const box: OcrBox = {
        bbox: { x0: 0, y0: 0, x1: 50, y1: 20 },
        text: '...?!',
        score: 0.9,
        originalLine: {} as OCRLine
      };
      expect(isValidOcrBox(box)).toBe(true);
    });

    it('allows Korean text', () => {
      const box: OcrBox = {
        bbox: { x0: 0, y0: 0, x1: 100, y1: 20 },
        text: '안녕하세요',
        score: 0.95,
        originalLine: {} as OCRLine
      };
      expect(isValidOcrBox(box)).toBe(true);
    });

    it('rejects empty or whitespace-only boxes', () => {
      const box: OcrBox = {
        bbox: { x0: 0, y0: 0, x1: 50, y1: 20 },
        text: '   ',
        score: 0.8,
        originalLine: {} as OCRLine
      };
      expect(isValidOcrBox(box)).toBe(false);
    });

    it('rejects screen-tone noise symbols like ○|○|', () => {
      const box: OcrBox = {
        bbox: { x0: 0, y0: 0, x1: 50, y1: 20 },
        text: '○|○|',
        score: 0.4,
        originalLine: {} as OCRLine
      };
      expect(isValidOcrBox(box, { maxSymbolRatio: 0.6 })).toBe(false);
    });

    it('rejects English text with no CJK/Hangul when doing Korean manhwa filtering', () => {
      const box: OcrBox = {
        bbox: { x0: 0, y0: 0, x1: 100, y1: 20 },
        text: 'Hello World',
        score: 0.9,
        originalLine: {} as OCRLine
      };
      expect(isValidOcrBox(box, { minHangulRatio: 0.25 })).toBe(false);
    });
  });

  describe('processKoreanManhwaPipeline', () => {
    it('merges vertically adjacent text boxes and sorts them RTL-TTB', () => {
      const pageResult: OCRPageResult = {
        pageNumber: 1,
        width: 1000,
        height: 1200,
        dpi: 300,
        language: 'kor',
        algorithmVersion: 1,
        lines: [
          // Left-side bubble (should be read second in RTL)
          {
            text: '가장 먼저',
            confidence: 90,
            bbox: { x0: 100, y0: 100, x1: 250, y1: 130 },
            words: [{ text: '가장', confidence: 90, bbox: { x0: 100, y0: 100, x1: 170, y1: 130 } }, { text: '먼저', confidence: 90, bbox: { x0: 180, y0: 100, x1: 250, y1: 130 } }]
          },
          {
            text: '시작한다',
            confidence: 88,
            bbox: { x0: 100, y0: 140, x1: 250, y1: 170 },
            words: [{ text: '시작한다', confidence: 88, bbox: { x0: 100, y0: 140, x1: 250, y1: 170 } }]
          },
          // Right-side bubble (should be read first in RTL)
          {
            text: '오른쪽',
            confidence: 95,
            bbox: { x0: 600, y0: 100, x1: 750, y1: 130 },
            words: [{ text: '오른쪽', confidence: 95, bbox: { x0: 600, y0: 100, x1: 750, y1: 130 } }]
          },
          {
            text: '글상자',
            confidence: 92,
            bbox: { x0: 600, y0: 140, x1: 750, y1: 170 },
            words: [{ text: '글상자', confidence: 92, bbox: { x0: 600, y0: 140, x1: 750, y1: 170 } }]
          }
        ],
        words: [],
        text: '',
        confidence: 0
      };

      const processed = processKoreanManhwaPipeline(pageResult, {
        merge: {
          maxVerticalGap: 25,
          maxHorizontalGap: 35,
          minColumnOverlapRatio: 0.3,
          maxGroupHeightRatio: 0.3,
          pageHeight: 1200,
          readingDirection: 'rtl-ttb'
        }
      });

      // We expect 2 merged text blocks (left one merged, right one merged)
      expect(processed.lines.length).toBe(2);

      // The right-side block should be first in the sorted array (RTL order)
      const firstLine = processed.lines[0];
      const secondLine = processed.lines[1];

      expect(firstLine.text).toBe('오른쪽\n글상자');
      expect(secondLine.text).toBe('가장 먼저\n시작한다');

      // The bounding box of the merged lines should be the union of the parts
      expect(firstLine.bbox).toEqual({ x0: 600, y0: 100, x1: 750, y1: 170 });
      expect(secondLine.bbox).toEqual({ x0: 100, y0: 100, x1: 250, y1: 170 });

      // Constituent words should be preserved
      expect(firstLine.words.length).toBe(2); // "오른쪽" and "글상자"
      expect(secondLine.words.length).toBe(3); // "가장", "먼저", "시작한다"
    });
  });
});
