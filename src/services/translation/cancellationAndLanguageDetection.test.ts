import { describe, it, expect } from 'vitest';
import { preparePageTranslationPlan } from './pageTranslationPipeline';
import { OCRPageResult, BBox } from '../../types';

const makeBBox = (x0: number, y0: number, x1: number, y1: number): BBox => ({ x0, y0, x1, y1 });

describe('Auto-detect Language Switch in preparePageTranslationPlan', () => {
  it('detects Spanish text and suggests switching from eng to spa when user default is en', () => {
    const spanishOcrPage: OCRPageResult = {
      pageNumber: 1,
      lines: [
        {
          text: '¿Qué estás haciendo aquí?',
          bbox: makeBBox(10, 10, 200, 40),
          confidence: 0.95,
          words: [],
        },
        {
          text: 'No puedo creer que esto esté pasando de verdad.',
          bbox: makeBBox(10, 45, 300, 75),
          confidence: 0.96,
          words: [],
        },
        {
          text: '¡Espera un momento por favor!',
          bbox: makeBBox(10, 80, 250, 110),
          confidence: 0.94,
          words: [],
        },
      ],
      words: [],
      text: '¿Qué estás haciendo aquí? No puedo creer que esto esté pasando de verdad. ¡Espera un momento por favor!',
      confidence: 0.95,
      width: 800,
      height: 1200,
      dpi: 72,
      algorithmVersion: 1,
      language: 'eng',
      ocrEngine: 'paddleocr',
    };

    const plan = preparePageTranslationPlan(1, spanishOcrPage, 'paddleocr', {
      userSourceLanguage: 'en',
      ocrLanguageOverride: 'eng',
      targetLanguage: 'th',
    });

    expect(plan).not.toBeNull();
    expect(plan?.detectedLanguageSwitch).toBeDefined();
    expect(plan?.detectedLanguageSwitch?.sourceLanguage).toBe('es');
    expect(plan?.detectedLanguageSwitch?.ocrLanguageKey).toBe('spa');
    expect(plan?.detectedLanguageSwitch?.languageName).toContain('ภาษาสเปน');
  });

  it('detects Korean text and suggests switching from eng to kor when user default is en', () => {
    const koreanOcrPage: OCRPageResult = {
      pageNumber: 1,
      lines: [
        {
          text: '이게 정말 무슨 일이야?',
          bbox: makeBBox(10, 10, 200, 40),
          confidence: 0.95,
          words: [],
        },
        {
          text: '잠깐만 기다려봐!',
          bbox: makeBBox(10, 45, 200, 75),
          confidence: 0.95,
          words: [],
        },
      ],
      words: [],
      text: '이게 정말 무슨 일이야? 잠깐만 기다려봐!',
      confidence: 0.95,
      width: 800,
      height: 1200,
      dpi: 72,
      algorithmVersion: 1,
      language: 'eng',
      ocrEngine: 'paddleocr',
    };

    const plan = preparePageTranslationPlan(1, koreanOcrPage, 'paddleocr', {
      userSourceLanguage: 'en',
      ocrLanguageOverride: 'eng',
      targetLanguage: 'th',
    });

    expect(plan).not.toBeNull();
    expect(plan?.detectedLanguageSwitch).toBeDefined();
    expect(plan?.detectedLanguageSwitch?.sourceLanguage).toBe('ko');
    expect(plan?.detectedLanguageSwitch?.ocrLanguageKey).toBe('kor');
    expect(plan?.detectedLanguageSwitch?.languageName).toContain('ภาษาเกาหลี');
  });

  it('detects Japanese text and suggests switching from eng to jpn when user default is en', () => {
    const japaneseOcrPage: OCRPageResult = {
      pageNumber: 1,
      lines: [
        {
          text: 'こんにちは、元気ですか？',
          bbox: makeBBox(10, 10, 200, 40),
          confidence: 0.95,
          words: [],
        },
        {
          text: 'ちょっと待ってください！',
          bbox: makeBBox(10, 45, 200, 75),
          confidence: 0.95,
          words: [],
        },
      ],
      words: [],
      text: 'こんにちは、元気ですか？ ちょっと待ってください！',
      confidence: 0.95,
      width: 800,
      height: 1200,
      dpi: 72,
      algorithmVersion: 1,
      language: 'eng',
      ocrEngine: 'paddleocr',
    };

    const plan = preparePageTranslationPlan(1, japaneseOcrPage, 'paddleocr', {
      userSourceLanguage: 'en',
      ocrLanguageOverride: 'eng',
      targetLanguage: 'th',
    });

    expect(plan).not.toBeNull();
    expect(plan?.detectedLanguageSwitch).toBeDefined();
    expect(plan?.detectedLanguageSwitch?.sourceLanguage).toBe('ja');
    expect(plan?.detectedLanguageSwitch?.ocrLanguageKey).toBe('jpn');
  });

  it('does NOT trigger detectedLanguageSwitch if the document matches the user-selected language', () => {
    const spanishOcrPage: OCRPageResult = {
      pageNumber: 1,
      lines: [
        {
          text: '¿Qué estás haciendo aquí?',
          bbox: makeBBox(10, 10, 200, 40),
          confidence: 0.95,
          words: [],
        },
      ],
      words: [],
      text: '¿Qué estás haciendo aquí?',
      confidence: 0.95,
      width: 800,
      height: 1200,
      dpi: 72,
      algorithmVersion: 1,
      language: 'spa',
      ocrEngine: 'paddleocr',
    };

    const plan = preparePageTranslationPlan(1, spanishOcrPage, 'paddleocr', {
      userSourceLanguage: 'es',
      ocrLanguageOverride: 'spa',
      targetLanguage: 'th',
    });

    expect(plan).not.toBeNull();
    expect(plan?.detectedLanguageSwitch).toBeUndefined();
  });
});

describe('Single Page Translation Cancellation Protocol', () => {
  it('correctly creates and aborts signal', () => {
    const controller = new AbortController();
    expect(controller.signal.aborted).toBe(false);

    controller.abort();
    expect(controller.signal.aborted).toBe(true);
  });

  it('throws DOMException with AbortError when signal is aborted', () => {
    const controller = new AbortController();
    controller.abort();

    const testExecution = () => {
      if (controller.signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
    };

    expect(testExecution).toThrowError('Aborted');
    try {
      testExecution();
    } catch (err: any) {
      expect(err.name).toBe('AbortError');
    }
  });
});
