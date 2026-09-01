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

      // We expect 4 distinct lines preserved and sorted RTL-TTB (right column top->bottom, then left column top->bottom)
      expect(processed.lines.length).toBe(4);

      // Right-side bubble lines should come first in RTL order
      expect(processed.lines[0].text).toBe('오른쪽');
      expect(processed.lines[1].text).toBe('글상자');
      expect(processed.lines[2].text).toBe('가장 먼저');
      expect(processed.lines[3].text).toBe('시작한다');

      expect(processed.lines[0].bbox).toEqual({ x0: 600, y0: 100, x1: 750, y1: 130 });
      expect(processed.lines[1].bbox).toEqual({ x0: 600, y0: 140, x1: 750, y1: 170 });
      expect(processed.lines[2].bbox).toEqual({ x0: 100, y0: 100, x1: 250, y1: 130 });
      expect(processed.lines[3].bbox).toEqual({ x0: 100, y0: 140, x1: 250, y1: 170 });
    });
  });
});
