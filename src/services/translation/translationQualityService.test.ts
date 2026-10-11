import { describe, it, expect } from 'vitest';
import { isCachedUntranslated } from './translationQualityService';

describe('isCachedUntranslated', () => {
  it('returns false for non-Thai target languages', () => {
    expect(isCachedUntranslated('Hello', 'Hello', 'en', 'es')).toBe(false);
  });

  it('detects untranslated Latin text when target is Thai', () => {
    expect(isCachedUntranslated('Hello world', 'Hello world', 'th', 'en')).toBe(true);
  });

  it('detects Korean residual characters in Thai translation', () => {
    expect(isCachedUntranslated('สวัสดี 안녕', '안녕하세요', 'th', 'ko')).toBe(true);
  });

  it('detects boilerplate hallucination on CJK source', () => {
    expect(isCachedUntranslated('นโยบายความเป็นส่วนตัว', '배경', 'th', 'ko')).toBe(true);
  });

  it('accepts genuine Thai translation', () => {
    expect(isCachedUntranslated('สวัสดีตอนเช้า', 'Good morning', 'th', 'en')).toBe(false);
  });
});
