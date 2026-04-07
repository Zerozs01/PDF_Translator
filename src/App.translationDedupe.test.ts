import { beforeAll, describe, expect, test } from 'vitest';

type TranslatableLine = {
  index: number;
  text: string;
  sourceLength: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  height: number;
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
let shouldPreserveSourceLineForTranslation: (
  text: string,
  sourceLanguage: string
) => boolean;

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
  shouldPreserveSourceLineForTranslation = appModule.shouldPreserveSourceLineForTranslation;
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
});

describe('applyThaiConversationalGlossary', () => {
  test('maps compact VERTAR essence OCR variants to full Thai phrase', () => {
    const translated = applyThaiConversationalGlossary("[VERTAR'SESSENCE]", 'เวอร์ทาร์', 'th');
    expect(translated).toBe('[แก่นแท้ของเวอร์ทาร์]');
  });

  test('maps H-HOW and U-UH stutter lines to conversational Thai', () => {
    const hHow = applyThaiConversationalGlossary('H-HOW?', 'H-HOW?', 'th');
    const uUh = applyThaiConversationalGlossary('U-UH...', 'U-UH...', 'th');

    expect(hHow).toBe('ด-ได้ไง?');
    expect(uUh).toBe('อ-อา...');
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
