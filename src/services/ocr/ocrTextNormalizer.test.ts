// src/services/ocr/ocrTextNormalizer.test.ts
import { describe, expect, test } from 'vitest';
import {
  normalizeTranslationLanguage,
  cleanJapaneseOcrSpacing,
  cleanKoreanOcrSpacing,
  normalizeJapaneseOcrNoiseForTranslation,
  normalizeKoreanOcrNoiseForTranslation,
  normalizeSpanishOcrNoiseForTranslation,
  normalizeSourceForTranslation,
  normalizeWhitespace,
} from './ocrTextNormalizer';

describe('normalizeTranslationLanguage', () => {
  test('resolves standard languages and aliases correctly', () => {
    expect(normalizeTranslationLanguage('eng', 'en')).toBe('en');
    expect(normalizeTranslationLanguage('english', 'en')).toBe('en');
    expect(normalizeTranslationLanguage('tha', 'th')).toBe('th');
    expect(normalizeTranslationLanguage('thai', 'th')).toBe('th');
    expect(normalizeTranslationLanguage('jpn', 'ja')).toBe('ja');
    expect(normalizeTranslationLanguage('jpn_vert', 'ja')).toBe('ja');
    expect(normalizeTranslationLanguage('kor', 'ko')).toBe('ko');
    expect(normalizeTranslationLanguage('spa', 'es')).toBe('es');
  });

  test('falls back to default when input is empty or invalid', () => {
    expect(normalizeTranslationLanguage('', 'en')).toBe('en');
    expect(normalizeTranslationLanguage('unknown_lang', 'en')).toBe('unknown_lang');
  });
});

describe('cleanJapaneseOcrSpacing', () => {
  test('should clean spaces between Japanese characters', () => {
    expect(cleanJapaneseOcrSpacing('保 存 で き ま せ ん')).toBe('保存できません');
    expect(cleanJapaneseOcrSpacing('し て く だ さ い')).toBe('してください');
    expect(cleanJapaneseOcrSpacing('コ ソ コ ソ')).toBe('コソコソ');
  });

  test('should keep spacing between Latin and Japanese words', () => {
    expect(cleanJapaneseOcrSpacing('CPU 使 用')).toBe('CPU 使用');
    expect(cleanJapaneseOcrSpacing('settings 保 存')).toBe('settings 保存');
  });
});

describe('cleanKoreanOcrSpacing', () => {
  test('should clean spaces between Korean Hangul characters', () => {
    expect(cleanKoreanOcrSpacing('안 녕 하 세 요')).toBe('안녕하세요');
  });
});

describe('normalizeKoreanOcrNoiseForTranslation', () => {
  test('should normalize Korean full-width punctuation and common colloquial OCR forms', () => {
    expect(normalizeKoreanOcrNoiseForTranslation('완료되었습니다。')).toBe('완료되었습니다.');
    expect(normalizeKoreanOcrNoiseForTranslation('넘어가 줘 말어')).toBe('넘어가 줘 말아');
    expect(normalizeKoreanOcrNoiseForTranslation('붙여놓을라고 하는데 ㅋㅋ')).toBe('붙여놓으려고 하는데 ㅋㅋ');
    expect(normalizeKoreanOcrNoiseForTranslation('분여놓을라고하느데')).toBe('분여놓으려고하는데');
  });
});

describe('normalizeJapaneseOcrNoiseForTranslation', () => {
  test('should normalize symbols and CJK punctuation', () => {
    expect(normalizeJapaneseOcrNoiseForTranslation('。')).toBe('.');
    expect(normalizeJapaneseOcrNoiseForTranslation('、')).toBe(',');
    expect(normalizeJapaneseOcrNoiseForTranslation('！')).toBe('!');
    expect(normalizeJapaneseOcrNoiseForTranslation('？')).toBe('?');
    expect(normalizeJapaneseOcrNoiseForTranslation('エl')).toBe('えっ');
  });
});

describe('normalizeSpanishOcrNoiseForTranslation', () => {
  test('should replace common Spanish OCR artifacts', () => {
    expect(normalizeSpanishOcrNoiseForTranslation('COMOSI')).toBe('COMO SI');
    expect(normalizeSpanishOcrNoiseForTranslation('CIERTASPARTES')).toBe('CIERTAS PARTES');
    expect(normalizeSpanishOcrNoiseForTranslation('iC-COMO')).toBe('¿COMO');
    expect(normalizeSpanishOcrNoiseForTranslation('LISTOCON')).toBe('LISTO CON');
    expect(normalizeSpanishOcrNoiseForTranslation('TODOLOQUE')).toBe('TODO LO QUE');
  });
});

describe('normalizeSourceForTranslation', () => {
  test('should process Spanish texts correctly', () => {
    expect(normalizeSourceForTranslation('iC-COMO LO SUPO...?! NO ERAUNPOCO PERVERTIDO?', 'es')).toBe(
      '¿como lo supo...?! No era un poco pervertido?'
    );
  });

  test('should process Japanese texts correctly', () => {
    expect(normalizeSourceForTranslation('し　て　く　だ　さ　い。', 'ja')).toBe(
      'してください.'
    );
  });

  test('should repair digit confusion like 4O% to 40%', () => {
    expect(normalizeSourceForTranslation('GETTING 4O% OF', 'en')).toBe('Getting 40% of');
    expect(normalizeSourceForTranslation('GETTING 4o% OF', 'en')).toBe('Getting 40% of');
    expect(normalizeSourceForTranslation('I HAVE 1O0 DOLLARS', 'en')).toBe('I have 100 dollars');
  });

  test('should repair dums to dumb', () => {
    expect(normalizeSourceForTranslation('DUMS PRINCESS!!', 'en')).toBe('Dumb princess!!');
  });
});


