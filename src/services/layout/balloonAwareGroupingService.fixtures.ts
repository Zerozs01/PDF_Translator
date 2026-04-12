import type { LayoutGroupingInput, OCRLineWithLayout } from './balloonAwareGroupingService';

const line = (
  index: number,
  text: string,
  left: number,
  top: number,
  right: number,
  bottom: number,
  extra: Partial<OCRLineWithLayout> = {},
): OCRLineWithLayout => ({
  index,
  text,
  sourceLength: text.replace(/\s+/g, '').length,
  left,
  top,
  right,
  bottom,
  height: Math.max(1, bottom - top),
  confidence: 94,
  ...extra,
});

export const stackedBalloonFixture = (): LayoutGroupingInput => ({
  pageNumber: 6,
  imageWidth: 1200,
  imageHeight: 1800,
  mode: 'balloon-aware',
  readingMode: 'ltr',
  lines: [
    line(0, 'BUT THERE', 120, 220, 260, 252, { sortHintY: 220, sortHintX: 120 }),
    line(1, 'ARE ONLY', 122, 258, 252, 290, { sortHintY: 258, sortHintX: 122 }),
    line(2, 'ENOUGH KEYS', 126, 296, 274, 328, { sortHintY: 296, sortHintX: 126 }),
    line(3, 'OPEN A', 780, 210, 900, 242, { sortHintY: 210, sortHintX: 780 }),
    line(4, 'SHOE LOCKER', 774, 248, 928, 280, { sortHintY: 248, sortHintX: 774 }),
    line(5, 'AND LEAVE THE', 768, 286, 946, 318, { sortHintY: 286, sortHintX: 768 }),
  ],
});

export const separatedColumnsFixture = (): LayoutGroupingInput => ({
  pageNumber: 2,
  imageWidth: 1400,
  imageHeight: 1800,
  mode: 'balloon-aware',
  readingMode: 'ltr',
  lines: [
    line(0, 'A-Are you', 120, 420, 292, 458, { sortHintY: 420, sortHintX: 120 }),
    line(1, 'selling me off to', 110, 456, 330, 494, { sortHintY: 456, sortHintX: 110 }),
    line(2, 'the mage?!!', 118, 494, 276, 532, { sortHintY: 494, sortHintX: 118 }),
    line(3, 'Stay still, yeah?', 402, 1040, 650, 1082, { sortHintY: 1040, sortHintX: 402 }),
    line(4, 'Bjorn is negotiating,', 392, 1080, 720, 1124, { sortHintY: 1080, sortHintX: 392 }),
    line(5, 'nyah.', 414, 1122, 512, 1156, { sortHintY: 1122, sortHintX: 414 }),
  ],
});

export const singletonHeavyFixture = (): LayoutGroupingInput => ({
  pageNumber: 3,
  imageWidth: 1000,
  imageHeight: 1500,
  mode: 'balloon-aware',
  readingMode: 'ltr',
  lines: [
    line(0, 'THINK...', 140, 160, 262, 194),
    line(1, 'H-HOW?', 250, 920, 372, 954),
    line(2, 'EH?!', 680, 340, 748, 372),
    line(3, 'ME?!!', 690, 612, 774, 648),
    line(4, 'Oow', 108, 1210, 174, 1242),
  ],
});

export const angledDialogueFixture = (): LayoutGroupingInput => ({
  pageNumber: 1,
  imageWidth: 900,
  imageHeight: 1400,
  mode: 'balloon-aware',
  readingMode: 'ltr',
  lines: [
    line(0, '사진 뭐냐?', 122, 214, 338, 282, {
      sortHintY: 214,
      sortHintX: 122,
      angleDeg: -26,
      quad: [
        { x: 144, y: 214 },
        { x: 338, y: 246 },
        { x: 316, y: 282 },
        { x: 122, y: 250 },
      ],
    }),
    line(1, '개변태인거', 108, 278, 332, 348, {
      sortHintY: 278,
      sortHintX: 108,
      angleDeg: -25,
      quad: [
        { x: 132, y: 278 },
        { x: 332, y: 312 },
        { x: 308, y: 348 },
        { x: 108, y: 314 },
      ],
    }),
    line(2, '티내는 거임?', 94, 342, 326, 414, {
      sortHintY: 342,
      sortHintX: 94,
      angleDeg: -24,
      quad: [
        { x: 118, y: 342 },
        { x: 326, y: 376 },
        { x: 302, y: 414 },
        { x: 94, y: 380 },
      ],
    }),
  ],
});

export const shiftedMiddleLineBalloonFixture = (): LayoutGroupingInput => ({
  pageNumber: 7,
  imageWidth: 900,
  imageHeight: 1400,
  mode: 'balloon-aware',
  readingMode: 'ltr',
  lines: [
    line(0, 'AQUI MAS TIEMPO,', 170, 210, 410, 242, { sortHintY: 210, sortHintX: 170 }),
    line(1, 'VOY A CORRER.', 248, 252, 468, 284, { sortHintY: 252, sortHintX: 248 }),
    line(2, 'LISTO! CON', 360, 520, 548, 552, { sortHintY: 520, sortHintX: 360 }),
    line(3, 'CERO DE PRUEBA!', 300, 560, 622, 592, { sortHintY: 560, sortHintX: 300 }),
  ],
});
