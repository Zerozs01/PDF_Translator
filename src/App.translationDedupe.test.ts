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
let isLikelyGhostTranslatableLine: (line: {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  words: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
}, resolvedText: string) => boolean;

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
  isLikelyGhostTranslatableLine = appModule.isLikelyGhostTranslatableLine;
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

  test('maps HER IN RETURN fragment to Thai fallback', () => {
    const source = 'HER IN RETURN.';
    const translated = applyThaiConversationalGlossary(source, 'HER IN RETURN.', 'th');

    expect(translated).toBe('เป็นการตอบแทนเธอ.');
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
