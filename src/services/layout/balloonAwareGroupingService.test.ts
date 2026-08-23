import { describe, expect, test } from 'vitest';
import type { LayoutGroupingInput, OCRLineWithLayout } from './balloonAwareGroupingService';
import { deriveBalloonAwareLayoutGrouping } from './balloonAwareGroupingService';
import {
  angledDialogueFixture,
  separatedColumnsFixture,
  shiftedMiddleLineBalloonFixture,
  singletonHeavyFixture,
  stackedBalloonFixture,
} from './balloonAwareGroupingService.fixtures';

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
  confidence: 96,
  ...extra,
});

describe('deriveBalloonAwareLayoutGrouping', () => {
  test('groups vertically stacked dialogue lines inside the same balloon', () => {
    const result = deriveBalloonAwareLayoutGrouping(stackedBalloonFixture());

    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]?.orderedLineIndexes).toEqual([0, 1, 2]);
    expect(result.groups[1]?.orderedLineIndexes).toEqual([3, 4, 5]);
    expect(result.orderedLineIndexes).toEqual([0, 1, 2, 3, 4, 5]);
    expect(result.diagnostics.avgConfidence).toBeGreaterThan(0.62);
  });

  test('keeps distant same-row balloons separated instead of merging by row-major order', () => {
    const result = deriveBalloonAwareLayoutGrouping(separatedColumnsFixture());

    expect(result.groups).toHaveLength(2);
    expect(result.groups.map((group) => group.orderedLineIndexes)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
    ]);
    expect(result.orderedLineIndexes).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test('returns low confidence and no groups for singleton-heavy pages', () => {
    const result = deriveBalloonAwareLayoutGrouping(singletonHeavyFixture());

    expect(result.groups).toHaveLength(0);
    expect(result.ungroupedLineIndexes).toEqual([0, 2, 3, 1, 4]);
    expect(result.diagnostics.avgConfidence).toBeLessThan(0.62);
    expect(result.diagnostics.warnings).toContain('no_multi_line_groups');
  });

  test('groups angled dialogue lines using quad metadata and preserves reading order', () => {
    const result = deriveBalloonAwareLayoutGrouping(angledDialogueFixture());

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.orderedLineIndexes).toEqual([0, 1, 2]);
    expect(result.orderedLineIndexes).toEqual([0, 1, 2]);
    expect(result.diagnostics.avgConfidence).toBeGreaterThan(0.62);
  });

  test('keeps shifted middle lines in the same compact balloon stack', () => {
    const result = deriveBalloonAwareLayoutGrouping(shiftedMiddleLineBalloonFixture());

    expect(result.groups.map((group) => group.orderedLineIndexes)).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(result.orderedLineIndexes).toEqual([0, 1, 2, 3]);
    expect(result.diagnostics.avgConfidence).toBeGreaterThan(0.62);
  });

  test('detects vertical gap anomalies and separates adjacent speech balloons', () => {
    const anomalyFixture = {
      pageNumber: 8,
      imageWidth: 1000,
      imageHeight: 1500,
      mode: 'balloon-aware' as const,
      readingMode: 'ltr' as const,
      lines: [
        { index: 0, text: 'HELLO WORLD', left: 100, top: 100, right: 300, bottom: 130, height: 30, confidence: 95, sourceLength: 10 },
        { index: 1, text: 'HOW ARE YOU', left: 102, top: 160, right: 298, bottom: 190, height: 30, confidence: 95, sourceLength: 11 },
        { index: 2, text: 'I AM FINE', left: 98, top: 320, right: 302, bottom: 350, height: 30, confidence: 95, sourceLength: 9 },
      ]
    };

    const result = deriveBalloonAwareLayoutGrouping(anomalyFixture);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.orderedLineIndexes).toEqual([0, 1]);
    expect(result.ungroupedLineIndexes).toEqual([2]);
  });

  test('prevents merging when ellipsis clues indicate a dialogue boundary starts', () => {
    const ellipsisFixture = {
      pageNumber: 9,
      imageWidth: 1000,
      imageHeight: 1500,
      mode: 'balloon-aware' as const,
      readingMode: 'ltr' as const,
      lines: [
        { index: 0, text: 'IT IS ALMOST OVER.', left: 100, top: 100, right: 300, bottom: 130, height: 30, confidence: 95, sourceLength: 18 },
        { index: 1, text: '...THAT\'S WHY', left: 100, top: 170, right: 300, bottom: 200, height: 30, confidence: 95, sourceLength: 13 },
      ]
    };

    const result = deriveBalloonAwareLayoutGrouping(ellipsisFixture);

    expect(result.groups).toHaveLength(0);
    expect(result.ungroupedLineIndexes).toEqual([0, 1]);
  });

  test('clamps inflated height bounding boxes and separates them from normal adjacent balloons', () => {
    const inflatedFixture = {
      pageNumber: 10,
      imageWidth: 1000,
      imageHeight: 1500,
      mode: 'balloon-aware' as const,
      readingMode: 'ltr' as const,
      lines: [
        { index: 0, text: 'BE THAT TYPE~', left: 100, top: 100, right: 300, bottom: 130, height: 30, confidence: 95, sourceLength: 13 },
        { index: 1, text: 'CONSIDERING THE', left: 100, top: 210, right: 300, bottom: 240, height: 30, confidence: 95, sourceLength: 15 },
        { index: 2, text: 'KINDS OF AWFUL', left: 100, top: 172, right: 300, bottom: 322, height: 150, confidence: 95, sourceLength: 14 },
        { index: 3, text: 'RUMORS FLOATING', left: 100, top: 185, right: 300, bottom: 310, height: 125, confidence: 95, sourceLength: 15 },
        // บรรทัดขนาดปกติเพิ่มเติมเพื่อพยุงค่ามัธยฐาน (Median Height) ให้เป็น 30px เสมือนหน้าเอกสารจริง
        { index: 4, text: 'SOME NORMAL LINE', left: 100, top: 500, right: 300, bottom: 530, height: 30, confidence: 95, sourceLength: 16 },
        { index: 5, text: 'ANOTHER NORMAL', left: 100, top: 540, right: 300, bottom: 570, height: 30, confidence: 95, sourceLength: 14 },
        { index: 6, text: 'MORE NORMAL TEXT', left: 100, top: 580, right: 300, bottom: 610, height: 30, confidence: 95, sourceLength: 16 },
        { index: 7, text: 'YET ANOTHER ONE', left: 100, top: 620, right: 300, bottom: 650, height: 30, confidence: 95, sourceLength: 15 },
      ]
    };

    const result = deriveBalloonAwareLayoutGrouping(inflatedFixture);

    // ยืนยันว่าบรรทัดแรก (index 0) จะแยกกันอย่างเด็ดขาดกับบรรทัดที่เหลือ (index 1, 2, 3) 
    // โดยไม่มีการสร้างกลุ่มร่วมกันข้ามบอลลูน (cross-balloon)
    const groupWithLine0 = result.groups.find(g => g.lineIndexes.includes(0));
    const groupWithLine2 = result.groups.find(g => g.lineIndexes.includes(2));
    
    if (groupWithLine0 && groupWithLine2) {
      expect(groupWithLine0.id).not.toEqual(groupWithLine2.id);
    }
    
    const groupWithLine1 = result.groups.find(g => g.lineIndexes.includes(1));
    if (groupWithLine0 && groupWithLine1) {
      expect(groupWithLine0.id).not.toEqual(groupWithLine1.id);
    }
  });

  test('merges heavily fragmented vertical dialogue into a single group (DSF geometry)', () => {
    const fragmentedFixture: LayoutGroupingInput = {
      pageNumber: 11,
      imageWidth: 900,
      imageHeight: 1400,
      mode: 'balloon-aware',
      readingMode: 'ltr',
      lines: [
        line(0, 'THIS', 120, 200, 240, 232, { sortHintX: 120, sortHintY: 200 }),
        line(1, 'IS', 130, 242, 220, 272, { sortHintX: 130, sortHintY: 242 }),
        line(2, 'ONE', 124, 284, 238, 314, { sortHintX: 124, sortHintY: 284 }),
        line(3, 'BALLOON', 118, 326, 280, 360, { sortHintX: 118, sortHintY: 326 }),
      ],
    };

    const result = deriveBalloonAwareLayoutGrouping(fragmentedFixture);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.orderedLineIndexes).toEqual([0, 1, 2, 3]);
    expect(result.ungroupedLineIndexes).toEqual([]);
    expect(Number.isFinite(result.diagnostics.avgConfidence)).toBe(true);
  });

  test('keeps Thai blocks isolated from Latin fragments even when geometry overlaps', () => {
    const mixedScriptFixture: LayoutGroupingInput = {
      pageNumber: 12,
      imageWidth: 900,
      imageHeight: 1400,
      mode: 'balloon-aware',
      readingMode: 'ltr',
      lines: [
        line(0, 'ฉันไม่รู้', 140, 240, 320, 272, { sortHintX: 140, sortHintY: 240 }),
        line(1, 'WHY?', 150, 276, 260, 306, { sortHintX: 150, sortHintY: 276 }),
        line(2, 'ต้องทำแบบนี้', 142, 312, 340, 346, { sortHintX: 142, sortHintY: 312 }),
      ],
    };

    const result = deriveBalloonAwareLayoutGrouping(mixedScriptFixture);

    const thaiGroup = result.groups.find((group) =>
      group.lineIndexes.includes(0) && group.lineIndexes.includes(2)
    );

    expect(thaiGroup?.orderedLineIndexes).toEqual([0, 2]);
    expect(result.ungroupedLineIndexes).toContain(1);
    expect(Number.isFinite(result.diagnostics.avgConfidence)).toBe(true);
    expect(result.diagnostics.avgConfidence).toBeGreaterThanOrEqual(0);
    expect(result.diagnostics.avgConfidence).toBeLessThanOrEqual(1);
  });

  test('preserves vertical reading order for horizontally overlapping lines in same balloon', () => {
    const overlappingFixture: LayoutGroupingInput = {
      pageNumber: 2,
      imageWidth: 1000,
      imageHeight: 15000,
      mode: 'balloon-aware',
      readingMode: 'ltr',
      lines: [
        line(0, 'A-Are Vou', 315, 12218, 595, 12319, { sortHintX: 315, sortHintY: 12218 }),
        line(1, 'selling mg Off to', 220, 12278, 699, 12416, { sortHintX: 220, sortHintY: 12278 }),
      ],
    };

    const result = deriveBalloonAwareLayoutGrouping(overlappingFixture);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.orderedLineIndexes).toEqual([0, 1]);
  });

  test('keeps "FiTTiNG FOR" (left column) and "BEING" (right column) separated on page 21', () => {
    const page21Fixture: LayoutGroupingInput = {
      pageNumber: 21,
      imageWidth: 5132,
      imageHeight: 7394,
      mode: 'balloon-aware',
      readingMode: 'ltr',
      lines: [
        // Dummy lines to stabilize baseHeight (median height) around 100px
        line(90, 'DUMMY 1', 10, 10, 50, 110),
        line(91, 'DUMMY 2', 10, 120, 50, 220),
        line(92, 'DUMMY 3', 10, 230, 50, 330),
        line(93, 'DUMMY 4', 10, 340, 50, 440),
        line(94, 'DUMMY 5', 10, 450, 50, 550),

        // Left Column
        line(35, 'FiTTiNG FOR', 2718, 4236, 3127, 4327, { sortHintX: 2718, sortHintY: 4224 }),
        line(38, 'A PiG LiKE', 2742, 4339, 3095, 4422, { sortHintX: 313.49, sortHintY: 4339 }),
        line(39, 'yOU!', 2835, 4434, 3003, 4525, { sortHintX: 2835, sortHintY: 4426 }),

        // Right Column
        line(28, 'ARE', 3308, 3812, 3528, 3990, { sortHintX: 3308, sortHintY: 3812 }),
        line(31, 'ALL', 3316, 4010, 3512, 4181, { sortHintX: 3316, sortHintY: 4010 }),
        line(36, 'BEING', 3252, 4224, 3584, 4383, { sortHintX: 2718, sortHintY: 4224 }),
        line(40, 'SLASHED', 3171, 4426, 3653, 4589, { sortHintX: 2835, sortHintY: 4426 }),
      ],
    };

    const result = deriveBalloonAwareLayoutGrouping(page21Fixture);

    const groupWithFitting = result.groups.find(g => g.lineIndexes.includes(35));
    const groupWithBeing = result.groups.find(g => g.lineIndexes.includes(36));

    expect(groupWithFitting).toBeDefined();
    expect(groupWithBeing).toBeDefined();
    expect(groupWithFitting!.id).not.toEqual(groupWithBeing!.id);
  });

  test('pussy balloon grouping debug test', () => {
    const input: LayoutGroupingInput = {
      pageNumber: 7,
      imageWidth: 5000,
      imageHeight: 8000,
      mode: 'balloon-aware',
      readingMode: 'ltr',
      lines: [
        // Dummy lines to stabilize baseHeight (median height) around 80px
        line(90, 'DUMMY 1', 10, 10, 50, 90),
        line(91, 'DUMMY 2', 10, 120, 50, 200),
        line(92, 'DUMMY 3', 10, 230, 50, 310),
        line(93, 'DUMMY 4', 10, 340, 50, 420),
        line(94, 'DUMMY 5', 10, 450, 50, 530),

        // Target balloon
        line(45, 'UGH,', 4374, 3448, 4563, 3586, { sortHintX: 4374, sortHintY: 3448 }),
        line(48, 'HAA!', 4366, 3590, 4579, 3729, { sortHintX: 4366, sortHintY: 3590 }),
        line(51, 'HER', 4382, 3745, 4567, 3868, { sortHintX: 4382, sortHintY: 3745 }),
        line(52, "PuSSy's", 4273, 3887, 4664, 4023, { sortHintX: 4273, sortHintY: 3887 }),
        line(53, '6o', 4386, 4042, 4563, 4169, { sortHintX: 4386, sortHintY: 4042 }),
        line(54, 'STiNKY', 4322, 4192, 4623, 4319, { sortHintX: 4322, sortHintY: 4192 }),
      ],
    };

    const result = deriveBalloonAwareLayoutGrouping(input);
    console.log('DEBUG GROUPS:', result.groups.map(g => g.orderedLineIndexes));
    console.log('DEBUG UNGROUPED:', result.ungroupedLineIndexes);
  });
});

