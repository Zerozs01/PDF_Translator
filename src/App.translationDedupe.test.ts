import { beforeAll, describe, expect, test, vi } from 'vitest';
import { translationCoordinator } from './services/translation/translationCoordinator';
import { dbService } from './services/dbService';

type TranslatableLine = {
  index: number;
  text: string;
  sourceLength: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  height: number;
  area?: number;
  wordCoverage?: number;
  wordBoxCount?: number;
  confidence?: number;
};

let dedupeTranslatableLinesForTranslation: (lines: TranslatableLine[]) => TranslatableLine[];
let resolveBestOcrLineText: (line?: {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  words: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
}) => string;
let buildTranslationGroups: (
  lines: TranslatableLine[],
  profile?: 'default' | 'dense-dialogue' | 'line-by-line'
) => Array<{ lines: TranslatableLine[] }>;
let shouldUseLineByLineGrouping: (
  lines: TranslatableLine[],
  sourceLanguage: string,
  targetLanguage: string,
  engine: 'offline' | 'ai',
  mode: 'adaptive' | 'manga' | 'manhwa' | 'official'
) => boolean;
let applyThaiConversationalGlossary: (
  sourceText: string,
  translatedText: string,
  targetLanguage: string
) => string;
let applyThaiTechnicalGlossary: (
  sourceText: string,
  translatedText: string,
  targetLanguage: string
) => string;
let resolveRedistributedLineFallback: (
  sourceLineText: string,
  groupText: string,
  targetLanguage: string,
  lineIndex?: number,
  totalLines?: number
) => string;
let shouldPreserveSourceLineForTranslation: (
  text: string,
  sourceLanguage: string
) => boolean;
let normalizeSpanishOcrNoiseForTranslation: (text: string) => string;
let inferSourceLanguageFromTextHints: (
  lines: TranslatableLine[],
  fallbackLanguage: string
) => string;
let resolvePreferredSourceLanguageForText: (
  text: string,
  fallbackLanguage: string
) => string;
let isLikelyGhostTranslatableLine: (line: {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  words: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
}, resolvedText: string) => boolean;
let shouldPruneContextualGhostTranslatableLine: (
  candidate: TranslatableLine,
  lines: TranslatableLine[]
) => boolean;
let cleanJapaneseOcrSpacing: (text: string) => string;
let cleanKoreanOcrSpacing: (text: string) => string;
let normalizeJapaneseOcrNoiseForTranslation: (text: string) => string;
let normalizeKoreanOcrNoiseForTranslation: (text: string) => string;
let normalizeSourceForTranslation: (text: string, sourceLanguage?: string) => string;

beforeAll(async () => {
  if (typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix === 'undefined') {
    class DOMMatrixPolyfill {
      a = 1;
      b = 0;
      c = 0;
      d = 1;
      e = 0;
      f = 0;
      multiplySelf() {
        return this;
      }
      preMultiplySelf() {
        return this;
      }
      translateSelf() {
        return this;
      }
      scaleSelf() {
        return this;
      }
      rotateSelf() {
        return this;
      }
      invertSelf() {
        return this;
      }
      static fromFloat32Array(): DOMMatrixPolyfill {
        return new DOMMatrixPolyfill();
      }
      static fromFloat64Array(): DOMMatrixPolyfill {
        return new DOMMatrixPolyfill();
      }
    }
    (globalThis as { DOMMatrix?: unknown }).DOMMatrix = DOMMatrixPolyfill;
  }

  const appModule = await import('./App');
  dedupeTranslatableLinesForTranslation = appModule.dedupeTranslatableLinesForTranslation;
  resolveBestOcrLineText = appModule.resolveBestOcrLineText;
  buildTranslationGroups = appModule.buildTranslationGroups;
  shouldUseLineByLineGrouping = appModule.shouldUseLineByLineGrouping;
  applyThaiConversationalGlossary = appModule.applyThaiConversationalGlossary;
  applyThaiTechnicalGlossary = appModule.applyThaiTechnicalGlossary;
  resolveRedistributedLineFallback = appModule.resolveRedistributedLineFallback;
  shouldPreserveSourceLineForTranslation = appModule.shouldPreserveSourceLineForTranslation;
  normalizeSpanishOcrNoiseForTranslation = appModule.normalizeSpanishOcrNoiseForTranslation;
  inferSourceLanguageFromTextHints = appModule.inferSourceLanguageFromTextHints;
  resolvePreferredSourceLanguageForText = appModule.resolvePreferredSourceLanguageForText;
  isLikelyGhostTranslatableLine = appModule.isLikelyGhostTranslatableLine;
  shouldPruneContextualGhostTranslatableLine = appModule.shouldPruneContextualGhostTranslatableLine;
  cleanJapaneseOcrSpacing = appModule.cleanJapaneseOcrSpacing;
  cleanKoreanOcrSpacing = appModule.cleanKoreanOcrSpacing;
  normalizeJapaneseOcrNoiseForTranslation = appModule.normalizeJapaneseOcrNoiseForTranslation;
  normalizeKoreanOcrNoiseForTranslation = appModule.normalizeKoreanOcrNoiseForTranslation;
  normalizeSourceForTranslation = appModule.normalizeSourceForTranslation;
});

const makeLine = (overrides: Partial<TranslatableLine>): TranslatableLine => ({
  index: 0,
  text: '',
  sourceLength: 0,
  top: 0,
  bottom: 20,
  left: 0,
  right: 200,
  height: 20,
  ...overrides,
});

const makeOcrLine = (overrides: Partial<{
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  words: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
}>) => ({
  text: '',
  confidence: 80,
  bbox: { x0: 0, y0: 0, x1: 120, y1: 28 },
  words: [],
  ...overrides,
});

describe('dedupeTranslatableLinesForTranslation', () => {
  test('keeps distinct technical sections with different unknown counts', () => {
    const twoUnknowns = makeLine({
      index: 11,
      text: 'Two unknowns. The reactions at A and B are unknown and the force which acts perpendicular to the rod.',
      sourceLength: 101,
      top: 180,
      bottom: 204,
      left: 92,
      right: 514,
      height: 24,
    });

    const threeUnknowns = makeLine({
      index: 15,
      text: 'Three unknowns. The reactions at A and B are unknown and the force which acts perpendicular to the rod.',
      sourceLength: 103,
      top: 244,
      bottom: 268,
      left: 96,
      right: 520,
      height: 24,
    });

    const deduped = dedupeTranslatableLinesForTranslation([twoUnknowns, threeUnknowns]);

    expect(deduped).toHaveLength(2);
    expect(deduped.map((line) => line.index).sort((a, b) => a - b)).toEqual([11, 15]);
  });

  test('dedupes overlapping near-identical OCR duplicates in the same region', () => {
    const duplicateA = makeLine({
      index: 31,
      text: 'ARE YOU',
      sourceLength: 7,
      top: 400,
      bottom: 424,
      left: 140,
      right: 248,
      height: 24,
    });

    const duplicateB = makeLine({
      index: 32,
      text: 'ARE YOU',
      sourceLength: 7,
      top: 404,
      bottom: 428,
      left: 142,
      right: 246,
      height: 24,
    });

    const deduped = dedupeTranslatableLinesForTranslation([duplicateA, duplicateB]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].text).toBe('ARE YOU');
  });

  test('dedupes same-box noisy phrase variants and keeps the clearer reading', () => {
    const noisyVariant = makeLine({
      index: 36,
      text: 'AEs DEal HER',
      sourceLength: 11,
      top: 442,
      bottom: 474,
      left: 310,
      right: 528,
      height: 32,
      area: 218 * 32,
      wordCoverage: 0.74,
      wordBoxCount: 3,
      confidence: 94,
    });

    const clearerVariant = makeLine({
      index: 37,
      text: 'A BIG DEAL TO HER',
      sourceLength: 17,
      top: 444,
      bottom: 476,
      left: 306,
      right: 536,
      height: 32,
      area: 230 * 32,
      wordCoverage: 0.82,
      wordBoxCount: 5,
      confidence: 90,
    });

    const deduped = dedupeTranslatableLinesForTranslation([noisyVariant, clearerVariant]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].text).toBe('A BIG DEAL TO HER');
  });

  test('keeps the cleaner duplicate geometry while restoring missing I THINK text', () => {
    const richMislocalized = makeLine({
      index: 34,
      text: 'ITHINK.',
      sourceLength: 7,
      top: 100,
      bottom: 148,
      left: 84,
      right: 284,
      height: 48,
      area: 200 * 48,
      wordCoverage: 0.18,
      wordBoxCount: 1,
      confidence: 92,
    });

    const cleanerLocalized = makeLine({
      index: 35,
      text: 'THINK',
      sourceLength: 5,
      top: 112,
      bottom: 140,
      left: 128,
      right: 226,
      height: 28,
      area: 98 * 28,
      wordCoverage: 0.78,
      wordBoxCount: 1,
      confidence: 89,
    });

    const deduped = dedupeTranslatableLinesForTranslation([richMislocalized, cleanerLocalized]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].text).toBe('I THINK.');
    expect(deduped[0].index).toBe(35);
    expect(deduped[0].left).toBe(128);
    expect(deduped[0].right).toBe(226);
  });

  test('keeps repeated long document lines when they are far enough apart vertically', () => {
    const firstLine = makeLine({
      index: 40,
      text: 'and the two force components, or the couple moment and',
      sourceLength: 57,
      top: 300,
      bottom: 322,
      left: 410,
      right: 760,
      height: 22,
    });

    const secondLine = makeLine({
      index: 41,
      text: 'and the two force components, or the couple moment and',
      sourceLength: 57,
      top: 346,
      bottom: 368,
      left: 412,
      right: 760,
      height: 22,
    });

    const deduped = dedupeTranslatableLinesForTranslation([firstLine, secondLine]);

    expect(deduped).toHaveLength(2);
    expect(deduped.map((line) => line.index).sort((a, b) => a - b)).toEqual([40, 41]);
  });

  test('keeps nearby technical subset lines when they are not strong same-box overlaps', () => {
    const shortLine = makeLine({
      index: 51,
      text: 'This utility building is',
      sourceLength: 22,
      top: 520,
      bottom: 542,
      left: 260,
      right: 470,
      height: 22,
    });

    const longLine = makeLine({
      index: 52,
      text: 'This utility building is pin supported at the top of the column. (8)',
      sourceLength: 69,
      top: 548,
      bottom: 570,
      left: 258,
      right: 620,
      height: 22,
    });

    const deduped = dedupeTranslatableLinesForTranslation([shortLine, longLine]);

    expect(deduped).toHaveLength(2);
    expect(deduped.map((line) => line.index).sort((a, b) => a - b)).toEqual([51, 52]);
  });
});

describe('resolveBestOcrLineText', () => {
  test('rejects weak words-only short fallback lines to avoid ghost translation boxes', () => {
    const wordsOnlyGhost = resolveBestOcrLineText({
      text: '',
      confidence: 88,
      bbox: { x0: 300, y0: 280, x1: 560, y1: 360 },
      words: [
        { text: 'H-HOW?', confidence: 86, bbox: { x0: 410, y0: 316, x1: 468, y1: 338 } },
      ],
    });

    expect(wordsOnlyGhost).toBe('');
  });

  test('accepts strong words-only fallback when coverage is high and phrase is meaningful', () => {
    const wordsOnlyValid = resolveBestOcrLineText({
      text: '',
      confidence: 91,
      bbox: { x0: 100, y0: 120, x1: 460, y1: 170 },
      words: [
        { text: 'THINK', confidence: 90, bbox: { x0: 112, y0: 128, x1: 174, y1: 158 } },
        { text: 'ABOUT', confidence: 92, bbox: { x0: 182, y0: 128, x1: 246, y1: 158 } },
        { text: 'THE', confidence: 91, bbox: { x0: 254, y0: 128, x1: 296, y1: 158 } },
        { text: 'MONSTER', confidence: 92, bbox: { x0: 304, y0: 128, x1: 438, y1: 158 } },
      ],
    });

    expect(wordsOnlyValid).toBe('THINK ABOUT THE MONSTER');
  });
});

describe('isLikelyGhostTranslatableLine', () => {
  test('flags tiny uppercase-digit singleton artifacts as ghost lines', () => {
    const ghostLine = makeOcrLine({
      text: '5C',
      confidence: 66,
      bbox: { x0: 620, y0: 412, x1: 684, y1: 430 },
      words: [
        { text: '5C', confidence: 66, bbox: { x0: 622, y0: 414, x1: 682, y1: 428 } },
      ],
    });

    expect(isLikelyGhostTranslatableLine(ghostLine, '5C')).toBe(true);
  });

  test('keeps known single-letter English pronoun I even in tiny boxes', () => {
    const tinyLatinNoise = makeOcrLine({
      text: 'I',
      confidence: 91,
      bbox: { x0: 522, y0: 420, x1: 548, y1: 444 },
      words: [
        { text: 'I', confidence: 91, bbox: { x0: 524, y0: 422, x1: 546, y1: 442 } },
      ],
    });

    // "I" is a valid English pronoun, not ghost noise
    expect(isLikelyGhostTranslatableLine(tinyLatinNoise, 'I')).toBe(false);
  });

  test('flags tiny no-word latin artifacts that can drift translation queue', () => {
    const tinyNoWordNoise = makeOcrLine({
      text: 'AA',
      confidence: 90,
      bbox: { x0: 604, y0: 386, x1: 658, y1: 424 },
      words: [],
    });

    expect(isLikelyGhostTranslatableLine(tinyNoWordNoise, 'AA')).toBe(true);
  });

  test('keeps valid short dialogue tokens with normal geometry', () => {
    const validShortLine = makeOcrLine({
      text: 'NO!',
      confidence: 92,
      bbox: { x0: 240, y0: 300, x1: 392, y1: 344 },
      words: [
        { text: 'NO!', confidence: 92, bbox: { x0: 250, y0: 306, x1: 384, y1: 338 } },
      ],
    });

    expect(isLikelyGhostTranslatableLine(validShortLine, 'NO!')).toBe(false);
  });

  test('flags oversized no-word balloon section boxes with short latin phrases', () => {
    const oversizedNoWordSection = makeOcrLine({
      text: 'YOON HYEYOON?',
      confidence: 98,
      bbox: { x0: 84, y0: 106, x1: 332, y1: 278 },
      words: [],
    });

    expect(isLikelyGhostTranslatableLine(oversizedNoWordSection, 'YOON HYEYOON?')).toBe(true);
  });

  test('flags compressed long latin text in abnormally tiny boxes', () => {
    const tinyLongLine = makeOcrLine({
      text: 'THIS KIND OF STUFF',
      confidence: 78,
      bbox: { x0: 300, y0: 520, x1: 342, y1: 542 },
      words: [
        { text: 'THIS', confidence: 79, bbox: { x0: 301, y0: 522, x1: 311, y1: 539 } },
        { text: 'KIND', confidence: 77, bbox: { x0: 312, y0: 522, x1: 322, y1: 539 } },
        { text: 'OF', confidence: 78, bbox: { x0: 323, y0: 522, x1: 328, y1: 539 } },
        { text: 'STUFF', confidence: 79, bbox: { x0: 329, y0: 522, x1: 341, y1: 539 } },
      ],
    });

    expect(isLikelyGhostTranslatableLine(tinyLongLine, 'THIS KIND OF STUFF')).toBe(true);
  });

  test('flags tiny narrow-tall CJK SFX artifacts as ghost lines', () => {
    const tinySfxLine = makeOcrLine({
      text: '슭금',
      confidence: 74,
      bbox: { x0: 410, y0: 480, x1: 466, y1: 610 },
      words: [
        { text: '슭금', confidence: 74, bbox: { x0: 412, y0: 486, x1: 464, y1: 608 } },
      ],
    });

    expect(isLikelyGhostTranslatableLine(tinySfxLine, '슭금')).toBe(true);
  });

  test('flags oversized low-density border boxes with short text as ghost lines', () => {
    const largeBorderGhost = makeOcrLine({
      text: 'LISTO! CON',
      confidence: 88,
      bbox: { x0: 20, y0: 24, x1: 360, y1: 280 },
      words: [
        { text: 'LISTO!', confidence: 88, bbox: { x0: 128, y0: 120, x1: 198, y1: 154 } },
        { text: 'CON', confidence: 87, bbox: { x0: 208, y0: 120, x1: 242, y1: 154 } },
      ],
    });

    expect(isLikelyGhostTranslatableLine(largeBorderGhost, 'LISTO! CON')).toBe(true);
  });

  test('flags medium-large sparse border captures as ghost lines', () => {
    const mediumBorderGhost = makeOcrLine({
      text: 'สิ่ง',
      confidence: 91,
      bbox: { x0: 74, y0: 120, x1: 248, y1: 230 },
      words: [
        { text: 'สิ่ง', confidence: 91, bbox: { x0: 136, y0: 162, x1: 176, y1: 186 } },
      ],
    });

    expect(isLikelyGhostTranslatableLine(mediumBorderGhost, 'สิ่ง')).toBe(true);
  });

  test('flags compressed short Latin phrases that only occupy a tiny fragment of the box', () => {
    const compressedPhraseGhost = makeOcrLine({
      text: 'WHY IS THIS',
      confidence: 92,
      bbox: { x0: 402, y0: 244, x1: 468, y1: 300 },
      words: [
        { text: 'WHY', confidence: 92, bbox: { x0: 426, y0: 264, x1: 446, y1: 278 } },
      ],
    });

    expect(isLikelyGhostTranslatableLine(compressedPhraseGhost, 'WHY IS THIS')).toBe(true);
  });

  test('keeps known hyphenated aside dialogue even when confidence is low', () => {
    const asideLine = makeOcrLine({
      text: 'you-could say',
      confidence: 78,
      bbox: { x0: 304, y0: 348, x1: 494, y1: 380 },
      words: [
        { text: 'you-could', confidence: 78, bbox: { x0: 312, y0: 350, x1: 410, y1: 378 } },
        { text: 'say', confidence: 79, bbox: { x0: 420, y0: 350, x1: 486, y1: 378 } },
      ],
    });

    expect(isLikelyGhostTranslatableLine(asideLine, 'you-could say')).toBe(false);
  });

  test('keeps short ah me manga dialogue instead of treating it as an effect', () => {
    const ahMeLine = makeOcrLine({
      text: 'AH ME!!',
      confidence: 82,
      bbox: { x0: 88, y0: 42, x1: 198, y1: 92 },
      words: [
        { text: 'AH', confidence: 82, bbox: { x0: 94, y0: 48, x1: 130, y1: 86 } },
        { text: 'ME!!', confidence: 81, bbox: { x0: 138, y0: 48, x1: 190, y1: 86 } },
      ],
    });

    expect(isLikelyGhostTranslatableLine(ahMeLine, 'AH ME!!')).toBe(false);
  });

  test('flags wider stylized Hangul SFX blobs as ghost lines', () => {
    const stylizedSfxLine = makeOcrLine({
      text: '슬금',
      confidence: 89,
      bbox: { x0: 248, y0: 530, x1: 340, y1: 612 },
      words: [
        { text: '슬금', confidence: 89, bbox: { x0: 254, y0: 538, x1: 334, y1: 606 } },
      ],
    });

    expect(isLikelyGhostTranslatableLine(stylizedSfxLine, '슬금')).toBe(true);
  });

  test('keeps normal-sized CJK dialogue lines', () => {
    const cjkDialogue = makeOcrLine({
      text: '그러니까',
      confidence: 93,
      bbox: { x0: 120, y0: 220, x1: 318, y1: 272 },
      words: [
        { text: '그러니까', confidence: 93, bbox: { x0: 124, y0: 226, x1: 314, y1: 268 } },
      ],
    });

    expect(isLikelyGhostTranslatableLine(cjkDialogue, '그러니까')).toBe(false);
  });
});

describe('shouldPruneContextualGhostTranslatableLine', () => {
  test('prunes cross-column bridge lines that merge two neighboring dialogue stacks', () => {
    const lines = [
      makeLine({
        index: 12,
        text: 'SHOE LOCKER',
        sourceLength: 11,
        left: 2483,
        right: 2927,
        top: 2194,
        bottom: 2283,
        height: 89,
        area: 444 * 89,
        wordCoverage: 0.92,
        wordBoxCount: 2,
      }),
      makeLine({
        index: 13,
        text: 'BUT THERE',
        sourceLength: 8,
        left: 354,
        right: 704,
        top: 2217,
        bottom: 2295,
        height: 78,
        area: 350 * 78,
        wordCoverage: 0.9,
        wordBoxCount: 2,
      }),
      makeLine({
        index: 14,
        text: 'ARE ONLY AND LEAVE THE',
        sourceLength: 20,
        left: 374,
        right: 2953,
        top: 2274,
        bottom: 2384,
        height: 110,
        area: 2579 * 110,
        wordCoverage: 0.98,
        wordBoxCount: 5,
      }),
      makeLine({
        index: 16,
        text: 'ENOUGH KEYS',
        sourceLength: 10,
        left: 311,
        right: 752,
        top: 2374,
        bottom: 2463,
        height: 89,
        area: 441 * 89,
        wordCoverage: 0.94,
        wordBoxCount: 2,
      }),
    ];

    expect(shouldPruneContextualGhostTranslatableLine(lines[2], lines)).toBe(true);
    expect(shouldPruneContextualGhostTranslatableLine(lines[0], lines)).toBe(false);
    expect(shouldPruneContextualGhostTranslatableLine(lines[1], lines)).toBe(false);
  });

  test('prunes stacked oversized fragment lines inside a stronger local dialogue chain', () => {
    const lines = [
      makeLine({
        index: 22,
        text: 'iRAPIDO, PRI-',
        sourceLength: 10,
        left: 603,
        right: 866,
        top: 8398,
        bottom: 8642,
        height: 244,
        area: 263 * 244,
        wordCoverage: 0.18,
        wordBoxCount: 1,
      }),
      makeLine({
        index: 23,
        text: 'ME ROLAFO TO',
        sourceLength: 10,
        left: 757,
        right: 1342,
        top: 8627,
        bottom: 8734,
        height: 107,
        area: 585 * 107,
        wordCoverage: 0.88,
        wordBoxCount: 3,
      }),
      makeLine({
        index: 25,
        text: 'H',
        sourceLength: 1,
        left: 781,
        right: 1315,
        top: 8819,
        bottom: 8913,
        height: 94,
        area: 534 * 94,
        wordCoverage: 0.05,
        wordBoxCount: 1,
      }),
      makeLine({
        index: 26,
        text: 'LO ESTABA',
        sourceLength: 8,
        left: 586,
        right: 873,
        top: 8878,
        bottom: 9141,
        height: 263,
        area: 287 * 263,
        wordCoverage: 0.82,
        wordBoxCount: 2,
      }),
    ];

    expect(shouldPruneContextualGhostTranslatableLine(lines[0], lines)).toBe(true);
    expect(shouldPruneContextualGhostTranslatableLine(lines[2], lines)).toBe(true);
    expect(shouldPruneContextualGhostTranslatableLine(lines[1], lines)).toBe(false);
    expect(shouldPruneContextualGhostTranslatableLine(lines[3], lines)).toBe(false);
  });

  test('keeps known aside dialogue fragments inside local stacks', () => {
    const lines = [
      makeLine({
        index: 30,
        text: 'you-could say',
        sourceLength: 13,
        left: 304,
        right: 494,
        top: 348,
        bottom: 380,
        height: 32,
        area: 190 * 32,
        wordCoverage: 0.86,
        wordBoxCount: 2,
        confidence: 78,
      }),
      makeLine({
        index: 31,
        text: 'SO ME THING that might',
        sourceLength: 22,
        left: 258,
        right: 548,
        top: 390,
        bottom: 424,
        height: 34,
        area: 290 * 34,
        wordCoverage: 0.9,
        wordBoxCount: 5,
        confidence: 82,
      }),
      makeLine({
        index: 32,
        text: 'help you too.',
        sourceLength: 13,
        left: 314,
        right: 524,
        top: 432,
        bottom: 464,
        height: 32,
        area: 210 * 32,
        wordCoverage: 0.88,
        wordBoxCount: 3,
        confidence: 84,
      }),
    ];

    expect(shouldPruneContextualGhostTranslatableLine(lines[0], lines)).toBe(false);
    expect(shouldPruneContextualGhostTranslatableLine(lines[1], lines)).toBe(false);
    expect(shouldPruneContextualGhostTranslatableLine(lines[2], lines)).toBe(false);
  });

  test('keeps known manga navigation fragments inside local stacks', () => {
    const lines = [
      makeLine({
        index: 40,
        text: 'BUT THERE',
        sourceLength: 8,
        left: 354,
        right: 704,
        top: 2217,
        bottom: 2295,
        height: 78,
        area: 350 * 78,
        wordCoverage: 0.9,
        wordBoxCount: 2,
      }),
      makeLine({
        index: 41,
        text: 'ARE ONLY',
        sourceLength: 8,
        left: 369,
        right: 693,
        top: 2292,
        bottom: 2385,
        height: 93,
        area: 324 * 93,
        wordCoverage: 0.9,
        wordBoxCount: 2,
      }),
      makeLine({
        index: 42,
        text: 'ENOUGH KEYS',
        sourceLength: 10,
        left: 311,
        right: 752,
        top: 2374,
        bottom: 2463,
        height: 89,
        area: 441 * 89,
        wordCoverage: 0.94,
        wordBoxCount: 2,
      }),
    ];

    expect(shouldPruneContextualGhostTranslatableLine(lines[0], lines)).toBe(false);
    expect(shouldPruneContextualGhostTranslatableLine(lines[1], lines)).toBe(false);
    expect(shouldPruneContextualGhostTranslatableLine(lines[2], lines)).toBe(false);
  });
});

describe('buildTranslationGroups', () => {
  test('keeps interleaved same-row columns from being merged into one dialogue group', () => {
    const leftTop = makeLine({
      index: 0,
      text: "VERTAR'S",
      sourceLength: 7,
      top: 100,
      bottom: 124,
      left: 90,
      right: 238,
      height: 24,
    });

    const rightTop = makeLine({
      index: 1,
      text: 'WHAT IS THAT?',
      sourceLength: 12,
      top: 112,
      bottom: 136,
      left: 352,
      right: 512,
      height: 24,
    });

    const leftBottom = makeLine({
      index: 2,
      text: 'ESSENCE',
      sourceLength: 7,
      top: 132,
      bottom: 156,
      left: 96,
      right: 240,
      height: 24,
    });

    const groups = buildTranslationGroups([leftTop, rightTop, leftBottom], 'dense-dialogue');
    const groupedIndexes = groups.map((group) => group.lines.map((line) => line.index));

    expect(groupedIndexes).toEqual([[0, 2], [1]]);
  });

  test('does not merge vertically separated sentence-ended bubbles in dense dialogue mode', () => {
    const upperBubble = makeLine({
      index: 20,
      text: 'I SOLD IT.',
      sourceLength: 9,
      top: 120,
      bottom: 142,
      left: 180,
      right: 320,
      height: 22,
    });

    const lowerBubble = makeLine({
      index: 21,
      text: 'I WILL LET YOU EXPERIMENT WITH HER IN RETURN.',
      sourceLength: 42,
      top: 174,
      bottom: 196,
      left: 176,
      right: 336,
      height: 22,
    });

    const groups = buildTranslationGroups([upperBubble, lowerBubble], 'dense-dialogue');
    const groupedIndexes = groups.map((group) => group.lines.map((line) => line.index));

    expect(groupedIndexes).toEqual([[20], [21]]);
  });

  test('keeps short interjection lines isolated from previous dialogue stack in dense mode', () => {
    const upperLine = makeLine({
      index: 30,
      text: 'ลองใช้',
      sourceLength: 6,
      top: 180,
      bottom: 202,
      left: 108,
      right: 204,
      height: 22,
    });

    const middleLine = makeLine({
      index: 31,
      text: 'ทักษะของคุณ',
      sourceLength: 11,
      top: 206,
      bottom: 228,
      left: 106,
      right: 226,
      height: 22,
    });

    const lowerLine = makeLine({
      index: 32,
      text: 'ก่อน',
      sourceLength: 4,
      top: 232,
      bottom: 254,
      left: 112,
      right: 182,
      height: 22,
    });

    const interjection = makeLine({
      index: 33,
      text: 'H-HOW?',
      sourceLength: 6,
      top: 262,
      bottom: 286,
      left: 114,
      right: 206,
      height: 24,
    });

    const groups = buildTranslationGroups([upperLine, middleLine, lowerLine, interjection], 'dense-dialogue');
    const groupedIndexes = groups.map((group) => group.lines.map((line) => line.index));

    expect(groupedIndexes).toEqual([[30, 31, 32], [33]]);
  });

  test('keeps adjacent same-row manga bubble stacks as separate groups', () => {
    const leftTop = makeLine({
      index: 100,
      text: 'SHES GLARING',
      sourceLength: 12,
      top: 100,
      bottom: 124,
      left: 72,
      right: 186,
      height: 24,
    });

    const rightTop = makeLine({
      index: 101,
      text: 'DE...',
      sourceLength: 5,
      top: 102,
      bottom: 124,
      left: 232,
      right: 304,
      height: 22,
    });

    const leftMid = makeLine({
      index: 102,
      text: 'FOR SOME',
      sourceLength: 8,
      top: 128,
      bottom: 152,
      left: 70,
      right: 188,
      height: 24,
    });

    const rightMid = makeLine({
      index: 103,
      text: 'DELIVERY EATERS!',
      sourceLength: 15,
      top: 130,
      bottom: 156,
      left: 228,
      right: 318,
      height: 26,
    });

    const leftBottom = makeLine({
      index: 104,
      text: 'REASON',
      sourceLength: 6,
      top: 158,
      bottom: 182,
      left: 76,
      right: 182,
      height: 24,
    });

    const rightBottom = makeLine({
      index: 105,
      text: 'D...',
      sourceLength: 4,
      top: 160,
      bottom: 182,
      left: 236,
      right: 286,
      height: 22,
    });

    const groups = buildTranslationGroups(
      [leftTop, rightTop, leftMid, rightMid, leftBottom, rightBottom],
      'dense-dialogue'
    );
    const groupedIndexes = groups
      .map((group) => group.lines.map((line) => line.index))
      .sort((a, b) => a[0] - b[0]);

    expect(groupedIndexes).toEqual([
      [100, 102, 104],
      [101, 103, 105],
    ]);
  });

  test('keeps same-row column reading order stable in line-by-line profile', () => {
    const leftTop = makeLine({
      index: 0,
      text: 'LEFT TOP',
      sourceLength: 8,
      top: 100,
      bottom: 124,
      left: 80,
      right: 190,
      height: 24,
    });

    const rightTop = makeLine({
      index: 1,
      text: 'RIGHT TOP',
      sourceLength: 9,
      top: 94,
      bottom: 118,
      left: 320,
      right: 430,
      height: 24,
    });

    const leftBottom = makeLine({
      index: 2,
      text: 'LEFT BOTTOM',
      sourceLength: 11,
      top: 130,
      bottom: 154,
      left: 84,
      right: 194,
      height: 24,
    });

    const rightBottom = makeLine({
      index: 3,
      text: 'RIGHT BOTTOM',
      sourceLength: 12,
      top: 124,
      bottom: 148,
      left: 324,
      right: 434,
      height: 24,
    });

    const groups = buildTranslationGroups([leftTop, rightTop, leftBottom, rightBottom], 'line-by-line');
    const orderedIndexes = groups.map((group) => group.lines[0].index);

    expect(orderedIndexes).toEqual([0, 2, 1, 3]);
  });

  test('prioritizes left column first for same-row dense dialogue groups', () => {
    const leftTop = makeLine({
      index: 10,
      text: 'LEFT TOP',
      sourceLength: 8,
      top: 100,
      bottom: 124,
      left: 70,
      right: 180,
      height: 24,
    });

    const rightTop = makeLine({
      index: 11,
      text: 'RIGHT TOP',
      sourceLength: 9,
      top: 94,
      bottom: 118,
      left: 310,
      right: 420,
      height: 24,
    });

    const leftBottom = makeLine({
      index: 12,
      text: 'LEFT BOTTOM',
      sourceLength: 11,
      top: 130,
      bottom: 154,
      left: 74,
      right: 184,
      height: 24,
    });

    const rightBottom = makeLine({
      index: 13,
      text: 'RIGHT BOTTOM',
      sourceLength: 12,
      top: 124,
      bottom: 148,
      left: 314,
      right: 424,
      height: 24,
    });

    const groups = buildTranslationGroups([leftTop, rightTop, leftBottom, rightBottom], 'dense-dialogue');
    const groupedIndexes = groups.map((group) => group.lines.map((line) => line.index));

    expect(groupedIndexes).toEqual([[10, 12], [11, 13]]);
  });

  test('keeps three nearby manga stacks in separate connected groups', () => {
    const leftA = makeLine({ index: 120, text: 'BUT-', sourceLength: 4, top: 300, bottom: 322, left: 56, right: 126, height: 22 });
    const leftB = makeLine({ index: 121, text: 'SHE COULD', sourceLength: 9, top: 326, bottom: 348, left: 54, right: 132, height: 22 });
    const leftC = makeLine({ index: 122, text: 'BE FUWARI-CHAN...', sourceLength: 17, top: 352, bottom: 376, left: 52, right: 148, height: 24 });

    const rightA = makeLine({ index: 123, text: 'IS IT', sourceLength: 5, top: 302, bottom: 324, left: 506, right: 574, height: 22 });
    const rightB = makeLine({ index: 124, text: 'BECAUSE OF WHAT', sourceLength: 14, top: 328, bottom: 350, left: 504, right: 592, height: 22 });
    const rightC = makeLine({ index: 125, text: 'HAPPENED LAST TIME?', sourceLength: 19, top: 354, bottom: 378, left: 500, right: 596, height: 24 });

    const centerA = makeLine({ index: 126, text: 'IM STILL AVOIDING', sourceLength: 16, top: 386, bottom: 410, left: 352, right: 488, height: 24 });
    const centerB = makeLine({ index: 127, text: 'HER BECAUSE OF', sourceLength: 13, top: 412, bottom: 436, left: 350, right: 486, height: 24 });
    const centerC = makeLine({ index: 128, text: 'HOW MUCH SHE', sourceLength: 12, top: 438, bottom: 462, left: 348, right: 484, height: 24 });

    const groups = buildTranslationGroups(
      [leftA, leftB, leftC, rightA, rightB, rightC, centerA, centerB, centerC],
      'dense-dialogue'
    );
    const groupedIndexes = groups
      .map((group) => group.lines.map((line) => line.index).sort((a, b) => a - b))
      .sort((a, b) => a[0] - b[0]);

    expect(groupedIndexes).toEqual([
      [120, 121, 122],
      [123, 124, 125],
      [126, 127, 128],
    ]);
  });

  test('keeps staggered same-row columns in stable left-column-first order', () => {
    const leftTop = makeLine({
      index: 200,
      text: 'LEFT TOP',
      sourceLength: 8,
      top: 122,
      bottom: 146,
      left: 72,
      right: 192,
      height: 24,
    });

    const rightTop = makeLine({
      index: 201,
      text: 'RIGHT TOP',
      sourceLength: 9,
      top: 88,
      bottom: 112,
      left: 330,
      right: 452,
      height: 24,
    });

    const leftMid = makeLine({
      index: 202,
      text: 'LEFT MID',
      sourceLength: 8,
      top: 150,
      bottom: 174,
      left: 74,
      right: 194,
      height: 24,
    });

    const rightMid = makeLine({
      index: 203,
      text: 'RIGHT MID',
      sourceLength: 9,
      top: 116,
      bottom: 140,
      left: 332,
      right: 454,
      height: 24,
    });

    const leftBottom = makeLine({
      index: 204,
      text: 'LEFT BOTTOM',
      sourceLength: 11,
      top: 178,
      bottom: 202,
      left: 76,
      right: 196,
      height: 24,
    });

    const rightBottom = makeLine({
      index: 205,
      text: 'RIGHT BOTTOM',
      sourceLength: 12,
      top: 144,
      bottom: 168,
      left: 334,
      right: 456,
      height: 24,
    });

    const lineByLineGroups = buildTranslationGroups(
      [leftTop, rightTop, leftMid, rightMid, leftBottom, rightBottom],
      'line-by-line'
    );
    const lineByLineOrder = lineByLineGroups.map((group) => group.lines[0].index);

    expect(lineByLineOrder).toEqual([200, 202, 204, 201, 203, 205]);

    const denseGroups = buildTranslationGroups(
      [leftTop, rightTop, leftMid, rightMid, leftBottom, rightBottom],
      'dense-dialogue'
    );
    const denseGroupedIndexes = denseGroups.map((group) => group.lines.map((line) => line.index));

    expect(denseGroupedIndexes).toEqual([
      [200, 202, 204],
      [201, 203, 205],
    ]);
  });

});

describe('resolveRedistributedLineFallback', () => {
  test('uses sentence-aligned group text when a redistributed segment is missing', () => {
    const fallback = resolveRedistributedLineFallback(
      'SOURCE LINE',
      'หนึ่ง. สอง. สาม.',
      'th',
      1,
      3
    );

    expect(fallback).toContain('สอง');
  });

  test('falls back to source text when grouped translation is empty', () => {
    const fallback = resolveRedistributedLineFallback('Original text', '', 'en', 0, 2);
    expect(fallback).toBe('Original text');
  });
});

describe('shouldUseLineByLineGrouping', () => {
  test('enables line-by-line mode for dense technical table-like pages in adaptive mode', () => {
    const lines = [
      makeLine({ index: 0, text: 'TABLE 5-1 Continued', sourceLength: 18, top: 20, bottom: 40, left: 40, right: 240, height: 20 }),
      makeLine({ index: 1, text: 'Types of CONNECTION', sourceLength: 19, top: 44, bottom: 64, left: 40, right: 250, height: 20 }),
      makeLine({ index: 2, text: 'Number of unknowns', sourceLength: 18, top: 68, bottom: 88, left: 40, right: 250, height: 20 }),
      makeLine({ index: 3, text: 'REACTION', sourceLength: 8, top: 92, bottom: 112, left: 40, right: 170, height: 20 }),
      makeLine({ index: 4, text: '(8)', sourceLength: 3, top: 116, bottom: 136, left: 40, right: 90, height: 20 }),
      makeLine({ index: 5, text: 'Two unknowns.', sourceLength: 13, top: 140, bottom: 160, left: 320, right: 470, height: 20 }),
      makeLine({ index: 6, text: 'The reactions are two components of force.', sourceLength: 40, top: 164, bottom: 184, left: 320, right: 700, height: 20 }),
      makeLine({ index: 7, text: 'Fx', sourceLength: 2, top: 188, bottom: 208, left: 330, right: 370, height: 20 }),
      makeLine({ index: 8, text: 'Fy', sourceLength: 2, top: 212, bottom: 232, left: 330, right: 370, height: 20 }),
      makeLine({ index: 9, text: '(9)', sourceLength: 3, top: 236, bottom: 256, left: 40, right: 90, height: 20 }),
      makeLine({ index: 10, text: 'Three unknowns.', sourceLength: 15, top: 260, bottom: 280, left: 320, right: 490, height: 20 }),
      makeLine({ index: 11, text: 'fixed support', sourceLength: 12, top: 284, bottom: 304, left: 320, right: 470, height: 20 }),
    ];

    const shouldLineByLine = shouldUseLineByLineGrouping(lines, 'en', 'th', 'offline', 'adaptive');
    expect(shouldLineByLine).toBe(true);
  });

  test('enables line-by-line mode for mixed technical pages even when inferred source is Thai', () => {
    const lines = [
      makeLine({ index: 0, text: 'TABLE 5-1 Continued', sourceLength: 18, top: 20, bottom: 40, left: 40, right: 240, height: 20 }),
      makeLine({ index: 1, text: 'ประเภทของการเชื่อมต่อ', sourceLength: 18, top: 44, bottom: 64, left: 40, right: 250, height: 20 }),
      makeLine({ index: 2, text: 'Two unknowns. The reactions are force components.', sourceLength: 47, top: 68, bottom: 88, left: 320, right: 760, height: 20 }),
      makeLine({ index: 3, text: 'จำนวนตัวแปรไม่ทราบค่า', sourceLength: 19, top: 92, bottom: 112, left: 40, right: 250, height: 20 }),
      makeLine({ index: 4, text: 'the magnitude and direction of the resultant force.', sourceLength: 48, top: 116, bottom: 136, left: 320, right: 760, height: 20 }),
      makeLine({ index: 5, text: 'fixed connections.', sourceLength: 18, top: 140, bottom: 160, left: 320, right: 520, height: 20 }),
    ];

    const shouldLineByLine = shouldUseLineByLineGrouping(lines, 'th', 'th', 'offline', 'adaptive');
    expect(shouldLineByLine).toBe(true);
  });

  test('forces line-by-line mode for strong technical table pages even in manga mode', () => {
    const lines = [
      makeLine({ index: 0, text: 'TABLE 5-1 Continued', sourceLength: 18, top: 20, bottom: 40, left: 40, right: 240, height: 20 }),
      makeLine({ index: 1, text: 'Types of CONNECTION', sourceLength: 19, top: 44, bottom: 64, left: 40, right: 250, height: 20 }),
      makeLine({ index: 2, text: 'REACTION', sourceLength: 8, top: 68, bottom: 88, left: 40, right: 170, height: 20 }),
      makeLine({ index: 3, text: 'Number of unknowns', sourceLength: 18, top: 92, bottom: 112, left: 40, right: 250, height: 20 }),
      makeLine({ index: 4, text: '(8)', sourceLength: 3, top: 116, bottom: 136, left: 40, right: 90, height: 20 }),
      makeLine({ index: 5, text: 'Two unknowns.', sourceLength: 13, top: 140, bottom: 160, left: 320, right: 470, height: 20 }),
      makeLine({ index: 6, text: 'The reactions are two components of force.', sourceLength: 40, top: 164, bottom: 184, left: 320, right: 700, height: 20 }),
      makeLine({ index: 7, text: 'the magnitude and direction of the resultant force.', sourceLength: 48, top: 188, bottom: 208, left: 320, right: 760, height: 20 }),
      makeLine({ index: 8, text: 'fixed support', sourceLength: 12, top: 212, bottom: 232, left: 320, right: 470, height: 20 }),
    ];

    const shouldLineByLine = shouldUseLineByLineGrouping(lines, 'en', 'th', 'offline', 'manga');
    expect(shouldLineByLine).toBe(true);
  });

  test('enables line-by-line mode for compact technical row pages in official mode', () => {
    const lines = [
      makeLine({ index: 0, text: 'TABLE 5-1 Continued', sourceLength: 18, top: 20, bottom: 40, left: 40, right: 240, height: 20 }),
      makeLine({ index: 1, text: 'Number of unknowns', sourceLength: 18, top: 44, bottom: 64, left: 40, right: 250, height: 20 }),
      makeLine({ index: 2, text: 'REACTION', sourceLength: 8, top: 68, bottom: 88, left: 40, right: 170, height: 20 }),
      makeLine({ index: 3, text: 'Three unknowns.', sourceLength: 15, top: 92, bottom: 112, left: 320, right: 490, height: 20 }),
      makeLine({ index: 4, text: 'fixed support', sourceLength: 12, top: 116, bottom: 136, left: 320, right: 470, height: 20 }),
      makeLine({ index: 5, text: 'The reactions are the couple moment.', sourceLength: 34, top: 140, bottom: 160, left: 320, right: 690, height: 20 }),
      makeLine({ index: 6, text: 'reactions in the x direction and in the y direction are two components.', sourceLength: 66, top: 164, bottom: 184, left: 320, right: 860, height: 20 }),
    ];

    const shouldLineByLine = shouldUseLineByLineGrouping(lines, 'en', 'th', 'offline', 'official');
    expect(shouldLineByLine).toBe(true);
  });
});

describe('source language inference', () => {
  test('infers Spanish on OCR-noisy Latin dialogue lines', () => {
    const lines = [
      makeLine({ index: 0, text: 'TE ESTABAN TOCANDO EL CUERPO', sourceLength: 25, top: 100, bottom: 122, left: 80, right: 420, height: 22 }),
      makeLine({ index: 1, text: 'SENTIA COMO SI ME TOCARANPOR TODAS PARTES', sourceLength: 39, top: 126, bottom: 148, left: 84, right: 506, height: 22 }),
      makeLine({ index: 2, text: 'NO ERA DOLOROSO NI NADA', sourceLength: 22, top: 152, bottom: 174, left: 84, right: 360, height: 22 }),
    ];

    const inferred = inferSourceLanguageFromTextHints(lines, 'en');
    expect(inferred).toBe('es');
  });

  test('prefers Spanish for fused-word dialogue chunks over English fallback', () => {
    const source = 'TE ESTABAN TOCANDO EL CUERPO... SENTIA COMO SI ME TOCARANPOR TODAS PARTES';
    const preferred = resolvePreferredSourceLanguageForText(source, 'en');
    expect(preferred).toBe('es');
  });
});

describe('normalizeSpanishOcrNoiseForTranslation', () => {
  test('splits common OCR-fused spanish phrase fragments', () => {
    const normalized = normalizeSpanishOcrNoiseForTranslation('COMOSI INSISTIERA EN CIERTASPARTES EN ESPECiFICO...');

    expect(normalized).toContain('COMO SI');
    expect(normalized).toContain('CIERTAS PARTES');
    expect(normalized).toContain('EN ESPECIFICO');
  });

  test('restores noisy merged interrogative fragments', () => {
    const normalized = normalizeSpanishOcrNoiseForTranslation('iC-COMO LO SUPO...?! NO ERAUNPOCO PERVERTIDO?');

    expect(normalized).toContain('¿COMO LO SUPO');
    expect(normalized).toContain('NO ERA UN POCO PERVERTIDO');
  });
});

describe('cleanJapaneseOcrSpacing', () => {
  test('strips spaces between Japanese Hiragana, Katakana, and Kanji characters', () => {
    expect(cleanJapaneseOcrSpacing('保 存 で き ま せ ん')).toBe('保存できません');
    expect(cleanJapaneseOcrSpacing('し て く だ さ い')).toBe('してください');
    expect(cleanJapaneseOcrSpacing('コ ソ コ ソ')).toBe('コソコソ');
  });

  test('preserves spaces between English words and Japanese characters', () => {
    expect(cleanJapaneseOcrSpacing('CPU 使 用')).toBe('CPU 使用');
    expect(cleanJapaneseOcrSpacing('settings 保 存')).toBe('settings 保存');
  });
});

describe('cleanKoreanOcrSpacing', () => {
  test('strips spaces between Hangul syllables', () => {
    expect(cleanKoreanOcrSpacing('설 정 을  다 시')).toBe('설정을  다시');
    expect(cleanKoreanOcrSpacing('안 녕 하 세 요')).toBe('안녕하세요');
  });
});

describe('normalizeJapaneseOcrNoiseForTranslation', () => {
  test('normalizes Japanese full-width punctuation', () => {
    expect(normalizeJapaneseOcrNoiseForTranslation('保存できませんでした。')).toBe('保存できませんでした.');
    expect(normalizeJapaneseOcrNoiseForTranslation('えっ、本当に？')).toBe('えっ, 本当に?');
  });

  test('repairs vertical Japanese OCR layout noises', () => {
    expect(normalizeJapaneseOcrNoiseForTranslation('エi')).toBe('えっ');
    expect(normalizeJapaneseOcrNoiseForTranslation('1 ッ')).toBe('っ');
  });
});

describe('normalizeKoreanOcrNoiseForTranslation', () => {
  test('normalizes Korean full-width punctuation', () => {
    expect(normalizeKoreanOcrNoiseForTranslation('완료되었습니다。')).toBe('완료되었습니다.');
  });
});

describe('normalizeSourceForTranslation CJK integration', () => {
  test('integrates Japanese spacing and noise normalization', () => {
    const res = normalizeSourceForTranslation('し　て　く　だ　さ　い。', 'ja');
    expect(res).toBe('してください.');
  });

  test('integrates Korean spacing and noise normalization', () => {
    const res = normalizeSourceForTranslation('안 녕 하 세 요。', 'ko');
    expect(res).toBe('안녕하세요.');
  });
});

describe('applyThaiConversationalGlossary', () => {
  test('maps compact VERTAR essence OCR variants to full Thai phrase', () => {
    const translated = applyThaiConversationalGlossary("[VERTAR'SESSENCE]", 'เวอร์ทาร์', 'th');
    expect(translated).toBe('[แก่นแท้ของเวอร์ทาร์]');
  });

  test('maps OR/ESSENCE/TAKE OUT OF HERE sentence to stable Thai meaning', () => {
    const source = 'OR DO YOu WANT THIS ESSENCE TO BE THE ONE THING WE TAKE OUT OF HERE?';
    const translated = applyThaiConversationalGlossary(source, 'หรือยู่อยาก ให้เรื่องนี้เป็น อย่างเดียวที่เรา ออกไปจากที่นี่', 'th');

    expect(translated).toBe('หรือคุณต้องการให้แก่นแท้นี้เป็นสิ่งเดียวที่เรานำออกไปจากที่นี่?');
  });

  test('maps I WOULD BE GETTING 40% ... HAD I SOLD IT to conditional Thai', () => {
    const source = 'I WOULD BE GETTING 40% OF THE PROFITS HAD I SOLD IT.';
    const translated = applyThaiConversationalGlossary(source, 'ฉันจะเป็น ได้กําไร 40%ผมขายไปแล้ว', 'th');

    expect(translated).toBe('ฉันจะได้กำไร 40% หากฉันขายมัน.');
  });

  test('maps teammate stronger sentence to stable Thai meaning', () => {
    const source = "AND IT'S GOOD FOR\nUS IF OUR TeAMMATE\nBECOMES STRONGER.";
    const translated = applyThaiConversationalGlossary(
      source,
      'มันดีสําหรับพวก เรานะถ้าคู่สมรสของ เรากลายเป็นอุปสรรค',
      'th'
    );

    expect(translated).toBe('และมันก็ดีสำหรับเราด้วย หากเพื่อนร่วมทีมของเราแข็งแกร่งขึ้น.');
  });

  test('repairs teammate stronger sentence when offline output already contains Thai noise', () => {
    const source = "AND IT'S GOOD FOR US IF OUR TeAMMATE BECOMES STRONGER.";
    const translated = applyThaiConversationalGlossary(
      source,
      'มันดีสำหรับพวกเรานะถ้าเพื่อนร่วมทีมของเรากลายเป็นอุปสรรค',
      'th'
    );

    expect(translated).toBe('และมันก็ดีสำหรับเราด้วย หากเพื่อนร่วมทีมของเราแข็งแกร่งขึ้น.');
  });

  test('maps experiment with her in return sentence to stable Thai meaning', () => {
    const source = "I'LL LET YOU\nEXPERIMENT WITH\nHER IN RETURN.";
    const translated = applyThaiConversationalGlossary(
      source,
      'ฉันจะปล่อยให้คุณ ทดลองกับ เธอกลับมา',
      'th'
    );

    expect(translated).toBe('ฉันจะให้คุณทดลองกับเธอเป็นการตอบแทน.');
  });

  test('maps monster skills focus sentence while ignoring RIE ghost text', () => {
    const source = 'THINK ABOUT THE SKILLS THE MONSTER RIE USED EARLIER AND FOCUS.';
    const translated = applyThaiConversationalGlossary(
      source,
      'ลองนึกถึงทักษะที่เจอรี่ใช้ก่อนหน้านี้ดังนั้นสิ่งที่',
      'th'
    );

    expect(translated).toBe('ลองนึกถึงทักษะที่สัตว์ประหลาดใช้ก่อนหน้านี้ แล้วจดจ่ออยู่กับมัน.');
  });

  test('maps you could say something might help sentence despite split OCR words', () => {
    const source = 'you-could say SO ME THING that might help you too.';
    const translated = applyThaiConversationalGlossary(
      source,
      'you-could say ฉันอาจช่วยให้ คุณมากเกินไป',
      'th'
    );

    expect(translated).toBe('คุณอาจพูดได้ว่า มีบางอย่างที่อาจช่วยคุณได้เช่นกัน.');
  });

  test('repairs teammate and becomes stronger fragments from bad offline Thai output', () => {
    const teammate = applyThaiConversationalGlossary(
      'US IF OUR TeAMMATE',
      'เรานะถ้าคู่สมรสของ',
      'th'
    );
    const stronger = applyThaiConversationalGlossary(
      'BECOMES STRONGER.',
      'เรากลายเป็นอุปสรรค',
      'th'
    );

    expect(teammate).toBe('เราด้วย หากเพื่อนร่วมทีมของเรา');
    expect(stronger).toBe('แข็งแกร่งขึ้น.');
  });

  test('maps HER IN RETURN fragment to Thai fallback', () => {
    const source = 'HER IN RETURN.';
    const translated = applyThaiConversationalGlossary(source, 'HER IN RETURN.', 'th');

    expect(translated).toBe('เป็นการตอบแทนเธอ.');
  });

  test('maps H-HOW and U-UH stutter lines to conversational Thai', () => {
    const hHow = applyThaiConversationalGlossary('H-HOW?', 'H-HOW?', 'th');
    const uUh = applyThaiConversationalGlossary('U-UH...', 'U-UH...', 'th');

    expect(hHow).toBe('อ-อย่างไร?');
    expect(uUh).toBe('อ-อา...');
  });

  test('maps short manga navigation fragments so translated overlay is not skipped as English carry-over', () => {
    expect(applyThaiConversationalGlossary('AH ME!!', 'AH ME!!', 'th')).toBe('อ๊ะ ฉัน!!');
    expect(applyThaiConversationalGlossary('ENTRANCE', 'ENTRANCE', 'th')).toBe('ทางเข้า');
    expect(applyThaiConversationalGlossary('ARE ONLY', 'ARE ONLY', 'th')).toBe('มีเพียง');
    expect(applyThaiConversationalGlossary('OUR CHANCE', 'OUR CHANCE', 'th')).toBe('โอกาสของเรา');
    expect(applyThaiConversationalGlossary('THEM.', 'THEM.', 'th')).toBe('พวกเขา.');
    expect(applyThaiConversationalGlossary('EH ME?!!', 'EH ME?!!', 'th')).toBe('เอ๋ ฉัน?!!');
    expect(applyThaiConversationalGlossary('ME?!!', 'ME?!!', 'th')).toBe('ฉัน?!!');
  });

  test('maps latest manga fragments that were previously left as OCR carry-over', () => {
    expect(applyThaiConversationalGlossary("I DON'T CARE.", "I DON'T CARE.", 'th')).toBe('ฉันไม่สน.');
    expect(applyThaiConversationalGlossary('I ALREADY EARNED', 'I ALREADY EARNED', 'th')).toBe('ฉันหาได้แล้ว');
    expect(applyThaiConversationalGlossary('ENOUGH.', 'ENOUGH.', 'th')).toBe('พอแล้ว.');
    expect(applyThaiConversationalGlossary('LOOK, BJORN!', 'LOOK, BJORN!', 'th')).toBe('ดูสิ บียอร์น!');
    expect(applyThaiConversationalGlossary('I HAVE WINGS!!', 'I HAVE WINGS!!', 'th')).toBe('ฉันมีปีก!!');
    expect(applyThaiConversationalGlossary('VALKYRIE', 'VALKYRIE', 'th')).toBe('วาลคีรี');
    expect(applyThaiConversationalGlossary('A LITTLE, YEAH?', 'A LITTLE, YEAH?', 'th')).toBe('นิดหน่อย ใช่ไหม?');
    expect(applyThaiConversationalGlossary('HMM?', 'HMM?', 'th')).toBe('อืม?');
    expect(applyThaiConversationalGlossary('DO YOU', 'DO YOU', 'th')).toBe('คุณต้องการ');
    expect(applyThaiConversationalGlossary('EARLIER AND', 'EARLIER AND', 'th')).toBe('ก่อนหน้านี้ แล้ว');
    expect(applyThaiConversationalGlossary('OF COURSE', 'OF COURSE', 'th')).toBe('แน่นอน');
    expect(applyThaiConversationalGlossary('BARBAR I AN (FEMALE)', 'BARBAR I AN (FEMALE)', 'th')).toBe('บาร์บาเรียน (หญิง)');
    expect(applyThaiConversationalGlossary('VAKYRE MODE', 'VAKYRE MODE', 'th')).toBe('โหมดวาลคีรี');
    expect(applyThaiConversationalGlossary('LIMITED EDITION', 'LIMITED EDITION', 'th')).toBe('รุ่นลิมิเต็ด');
    expect(applyThaiConversationalGlossary('TH-THIS LIGHT...!', 'TH-THIS LIGHT...!', 'th')).toBe('แส-แสงนี้...!');
    expect(applyThaiConversationalGlossary('SUPPORT YOU TO LIVE', 'SUPPORT YOU TO LIVE', 'th')).toBe('ฉันช่วยให้คุณมีชีวิตอยู่');
    expect(applyThaiConversationalGlossary('THE PEOPLE HERE?', 'THE PEOPLE HERE?', 'th')).toBe('คนที่นี่เหรอ?');
  });

  test('maps spanish conversational fragments to stable thai meaning', () => {
    const algoAsi = applyThaiConversationalGlossary('ALGO ASi...', 'ALGO ASi...', 'th');
    const ceh = applyThaiConversationalGlossary('CEH?', 'CEH?', 'th');
    const detalle = applyThaiConversationalGlossary('CON MAS DETALLE.', 'CON MAS DETALLE.', 'th');
    const detalleNoisy = applyThaiConversationalGlossary('CON MAS DETA- LLE.', 'CON MAS DETA- LLE.', 'th');
    const stayingTooLong = applyThaiConversationalGlossary(
      'SI ME QUEDO AQuí MAS TIEMPO, S-SIENTO QUE ME VOY CORRER..',
      'ถ้าฉันอยู่ ที่นี่ มาสัก พักฉันรู้สึก ฆ่าฉันจะมา',
      'th'
    );

    expect(algoAsi).toBe('ประมาณนั้นแหละ...');
    expect(ceh).toBe('เอ๋?');
    expect(detalle).toBe('ในรายละเอียดเพิ่มเติม.');
    expect(detalleNoisy).toBe('ในรายละเอียดเพิ่มเติม.');
    expect(stayingTooLong).toBe('ถ้าฉันอยู่ที่นี่นานกว่านี้ ฉะ-ฉันรู้สึกว่าจะเสร็จแล้ว..');
    expect(applyThaiConversationalGlossary('SI ME QUEDO', 'SI ME QUEDO', 'th')).toBe('ถ้าฉันอยู่');
    expect(applyThaiConversationalGlossary('AQuí MAS', 'AQuí MAS', 'th')).toBe('ที่นี่นานกว่านี้');
    expect(applyThaiConversationalGlossary('S-SIENTO QUE ME', 'S-SIENTO QUE ME', 'th')).toBe('ฉะ-ฉันรู้สึกว่า');
    expect(applyThaiConversationalGlossary('VOY CORRER..', 'VOY CORRER..', 'th')).toBe('ฉันจะเสร็จแล้ว..');
    expect(applyThaiConversationalGlossary('STAFF', 'STAFF', 'th')).toBe('เจ้าหน้าที่');
    expect(applyThaiConversationalGlossary('PRI-MERO LA FOTO', 'PRI-MERO LA FOTO', 'th')).toBe('ภาพแรก');
    expect(applyThaiConversationalGlossary('DE', 'DE', 'th')).toBe('ของ');
    expect(applyThaiConversationalGlossary('METIENDO POR', 'METIENDO POR', 'th')).toBe('กำลังดำเนินการ');
    expect(applyThaiConversationalGlossary('iLISTO! CON', 'iLISTO! CON', 'th')).toBe('พร้อม! ด้วย');
  });

  test('maps noisy spanish question and emphasis fragments', () => {
    const knowHow = applyThaiConversationalGlossary('iC-COMO LO SUPO...?!', 'iCCฉันสามารถ', 'th');
    const entonces = applyThaiConversationalGlossary('ENTONCES SEGURO...', 'ตัวยก เซกูโร่', 'th');

    expect(knowHow).toBe('เขารู้ได้อย่างไร...?!');
    expect(entonces).toBe('งั้น แน่นอน...');
  });

  test('maps Korean abusive and threatening lines to stable Thai output', () => {
    expect(applyThaiConversationalGlossary('걸레년', 'อีสารเลว', 'th')).toBe('อีผู้หญิงสำส่อน');
    expect(applyThaiConversationalGlossary('지울 거지?응?', 'ยังไงข่าว', 'th')).toBe('แกจะลบมันใช่ไหม? ฮึ?');
    expect(applyThaiConversationalGlossary('잘나왔던데 왜 지워?', 'ทำไมคุณรู้?', 'th')).toBe('มันออกมาดีนี่ ทำไมต้องลบ?');
    expect(applyThaiConversationalGlossary('출력해서 집에 붙여놓을라고 하는데 ㅋㅋ', 'ส่ง 출력', 'th')).toBe('ฉันวางแผนจะพิมพ์ออกมาแล้วเอาไปติดไว้ที่บ้าน ฮ่าๆ');
    expect(applyThaiConversationalGlossary('분여놓을라고하느데', 'เกี่ยวกับเรา', 'th')).toBe('ฉันวางแผนจะเอาไปแขวนไว้');
  });

  test('maps Korean OCR-noisy dialogue snippets to intended Thai phrases', () => {
    expect(applyThaiConversationalGlossary('미친색까 뒤지기 싫으면', 'เป็นผู้ใหญ่', 'th')).toBe('ไอ้สารเลว ถ้าไม่อยากตาย');
    expect(applyThaiConversationalGlossary('빨리 지워라', 'มีขนดก', 'th')).toBe('ลบมันซะเร็วๆ');
    expect(applyThaiConversationalGlossary('안 지우면 진짜', 'ฉันจะเป็นผู้', 'th')).toBe('ถ้าไม่ลบ');
    expect(applyThaiConversationalGlossary('죽여 버릴 거야', 'หญิงจริงๆ', 'th')).toBe('ฉันจะฆ่าแกจริงๆ');
    expect(applyThaiConversationalGlossary('음!뭐지?이', 'ดนตรีคืออะไร', 'th')).toBe('หืม! นี่อะไรกันเนี่ย');
    expect(applyThaiConversationalGlossary('가장 빠른 입분제공사이트', 'หนทางที่เร็วที่สุดที่จะเริ่มต้น', 'th')).toBe('เว็บไซต์ให้บริการเข้าเร็วที่สุด');
    expect(applyThaiConversationalGlossary('데자뷰 같은 이 느낌.', '?มุมมองอิเดจา', 'th')).toBe('ความรู้สึกนี้เหมือนเคยเกิดขึ้นมาก่อน.');
    expect(applyThaiConversationalGlossary('출력', '출력', 'th')).toBe('พิมพ์ออกมา');
  });

  test('maps Korean lines that previously leaked template-like garbage tokens', () => {
    expect(applyThaiConversationalGlossary('이거 이거', 'จาก{ {/if]]', 'th')).toBe('เรื่องนี้ เรื่องนี้');
    expect(applyThaiConversationalGlossary('넘어가 줘 말어.', '{/if]]', 'th')).toBe('ฉันควรปล่อยผ่านไปหรือไม่.');
  });
});

describe('applyThaiTechnicalGlossary', () => {
  test('maps short technical document fragments that often stay untranslated offline', () => {
    expect(applyThaiTechnicalGlossary('Three unknowns.', 'Three unknowns.', 'th')).toBe('ตัวไม่ทราบค่าสามตัว.');
    expect(applyThaiTechnicalGlossary(
      'Three unknowns. The reactions are the couple moment',
      'Three unknowns. The reactions are the couple moment',
      'th'
    )).toBe('ตัวไม่ทราบค่าสามตัว แรงปฏิกิริยาเป็นโมเมนต์คู่ควบ');
    expect(applyThaiTechnicalGlossary('The reactions are the couple moment', 'The reactions are the couple moment', 'th'))
      .toBe('แรงปฏิกิริยาเป็นโมเมนต์คู่ควบ');
    expect(applyThaiTechnicalGlossary('the magnitude and direction of the resultant force.', 'the magnitude and direction of the resultant force.', 'th'))
      .toBe('ขนาดและทิศทางของแรงลัพธ์.');
    expect(applyThaiTechnicalGlossary(
      'The floor beams of this building are welded together and thus form fixed connections. (10)',
      'The floor beams of this building are welded together and thus form fixed connections. (10)',
      'th'
    )).toBe('คานพื้นของอาคารนี้เชื่อมเข้าด้วยกัน จึงเกิดเป็นจุดต่อแบบยึดแน่น (10)');
    expect(applyThaiTechnicalGlossary(
      'The floor beams of this building are welded to gether and thus form fixed connections. (10)',
      'The floor beams of this building are welded to gether and thus form fixed connections. (10)',
      'th'
    )).toBe('คานพื้นของอาคารนี้เชื่อมเข้าด้วยกัน จึงเกิดเป็นจุดต่อแบบยึดแน่น (10)');
    expect(applyThaiTechnicalGlossary(
      'to gether and thus form',
      'to gether and thus form',
      'th'
    )).toBe('เชื่อมเข้าด้วยกัน จึงเกิดเป็น');
    expect(applyThaiTechnicalGlossary(
      'This utility building is pin supported at the top of the column. (8)',
      'This utility building is pin supported at the top of the column. (8)',
      'th'
    )).toBe('อาคารอเนกประสงค์นี้รองรับแบบพินที่ด้านบนของเสา (8)');
  });
});

describe('shouldPreserveSourceLineForTranslation', () => {
  test('preserves short non-Latin SFX-like tokens when source is English', () => {
    expect(shouldPreserveSourceLineForTranslation('헉', 'en')).toBe(true);
    expect(shouldPreserveSourceLineForTranslation('えっ', 'en')).toBe(true);
  });

  test('does not force preserve when source language matches the script', () => {
    expect(shouldPreserveSourceLineForTranslation('헉', 'ko')).toBe(false);
    expect(shouldPreserveSourceLineForTranslation('えっ', 'ja')).toBe(false);
  });
});

describe('Sentence-level Translation Caching & Deduplication', () => {
  test('retrieves translation from sentence cache and bypasses offline/online engine', async () => {
    const getSpy = vi.spyOn(dbService, 'getSentenceTranslation');
    const saveSpy = vi.spyOn(dbService, 'saveSentenceTranslation');

    getSpy.mockImplementation(async (text, src, tgt, engine, mode) => {
      if (text === 'Hello' && engine === 'argos') {
        return 'สวัสดี (จากแคชระดับประโยค)';
      }
      return null;
    });

    saveSpy.mockResolvedValue(true);

    const mockTranslateBatchOffline = vi.fn().mockResolvedValue(['ยินดีต้อนรับ']);

    const items = [
      { id: '1', text: 'Hello', groupType: 'balloon' as const },
      { id: '2', text: 'Welcome', groupType: 'balloon' as const },
    ];

    const results = await translationCoordinator.runTranslation('argos', items, {
      sourceLanguage: 'en',
      targetLanguage: 'th',
      translationMode: 'official',
      translateBatchOffline: mockTranslateBatchOffline,
    });

    expect(results).toHaveLength(2);
    
    const helloResult = results.find(r => r.id === '1');
    const welcomeResult = results.find(r => r.id === '2');

    expect(helloResult?.translatedText).toBe('สวัสดี (จากแคชระดับประโยค)');
    expect(helloResult?.engineUsed).toBe('argos-sentence-cache');

    expect(welcomeResult?.translatedText).toBe('ยินดีต้อนรับ');
    expect(welcomeResult?.engineUsed).toBe('argos');

    expect(mockTranslateBatchOffline).toHaveBeenCalledWith(
      ['Welcome'],
      'text',
      'official',
      'en',
      'th'
    );

    expect(saveSpy).toHaveBeenCalledWith(
      'Welcome',
      'en',
      'th',
      'argos',
      'official',
      'ยินดีต้อนรับ'
    );

    getSpy.mockRestore();
    saveSpy.mockRestore();
  });
});
