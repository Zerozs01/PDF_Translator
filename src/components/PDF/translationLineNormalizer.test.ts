import { describe, it, expect } from 'vitest';
import {
  normalizeTranslatedLineItem,
  type RawTranslatedInput,
} from './translationLineNormalizer';

describe('PDFPageContainer normalizeTranslatedLineItem', () => {
  it('correctly normalizes valid translated items with provided index', () => {
    const raw: RawTranslatedInput = {
      index: 3,
      sourceText: 'Hello',
      text: 'สวัสดี',
      bbox: { x0: 10, y0: 20, x1: 100, y1: 50 },
    };
    const result = normalizeTranslatedLineItem(raw, 0);
    expect(result.index).toBe(3);
    expect(result.text).toBe('สวัสดี');
    expect(result.sourceText).toBe('Hello');
    expect(result.bbox).toEqual({ x0: 10, y0: 20, x1: 100, y1: 50 });
  });

  it('falls back to lineIndex if index is missing', () => {
    const raw: RawTranslatedInput = {
      lineIndex: 7,
      sourceText: 'Goodbye',
      text: 'ลาก่อน',
    };
    const result = normalizeTranslatedLineItem(raw, 0);
    expect(result.index).toBe(7);
    expect(result.text).toBe('ลาก่อน');
  });

  it('falls back to fallbackIndex if neither index nor lineIndex is available', () => {
    const raw: RawTranslatedInput = {
      sourceText: 'Thank you',
      text: 'ขอบคุณ',
    };
    const result = normalizeTranslatedLineItem(raw, 42);
    expect(result.index).toBe(42);
    expect(result.text).toBe('ขอบคุณ');
  });

  it('translates untranslated/identical Latin text using local glossary match', () => {
    const raw: RawTranslatedInput = {
      index: 1,
      sourceText: 'WHAT?!',
      text: 'WHAT?!',
    };
    const result = normalizeTranslatedLineItem(raw, 1);
    expect(/[\u0E00-\u0E7F]/.test(result.text)).toBe(true);
  });

  it('translates multi-word phrases using word-by-word glossary fallback', () => {
    const raw: RawTranslatedInput = {
      index: 2,
      sourceText: 'COME ON!',
      text: 'COME ON!',
    };
    const result = normalizeTranslatedLineItem(raw, 2);
    expect(/[\u0E00-\u0E7F]/.test(result.text)).toBe(true);
  });

  it('handles empty text by falling back to glossary match of sourceText', () => {
    const raw: RawTranslatedInput = {
      index: 5,
      sourceText: 'WHY?',
      text: '',
    };
    const result = normalizeTranslatedLineItem(raw, 5);
    expect(/[\u0E00-\u0E7F]/.test(result.text)).toBe(true);
  });
});
