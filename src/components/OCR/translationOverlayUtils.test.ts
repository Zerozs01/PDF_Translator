import { describe, expect, test } from 'vitest';
import {
  computeOverlayLayoutMap,
  computeOverlayTypography,
  computeOverlayTypographyMap,
  resolveTranslationOverlayContext,
  resolveOverlayMaskExpansion,
  resolveOverlaySourceBBox,
  shouldSkipOverlayRenderForSuspiciousLine,
} from './translationOverlayUtils';
import { buildOCRSourceFingerprint } from '../../services/ocrSourceFingerprint';

describe('translationOverlayUtils typography', () => {
  test('shrinks font size for longer translated text in the same box', () => {
    const shortTypography = computeOverlayTypography('US NAVY', 180, 28, {
      sourceText: 'US NAVY',
      sourceBoxWidth: 180,
      sourceBoxHeight: 28,
      fontFamily: 'TH Sarabun',
    });

    const longTypography = computeOverlayTypography(
      'นำวิธีสมดุลมาใช้เพื่อหาแรงที่กระทำต่อจุดรองรับของวัตถุแข็งเช่นนี้',
      180,
      28,
      {
        sourceText: 'US NAVY',
        sourceBoxWidth: 180,
        sourceBoxHeight: 28,
        fontFamily: 'TH Sarabun',
      }
    );

    expect(longTypography.fontSize).toBeLessThan(shortTypography.fontSize);
    expect(longTypography.forceSingleLine).toBe(false);
  });

  test('keeps single-line labels constrained in a narrow box', () => {
    const typography = computeOverlayTypography('YD-193', 72, 20, {
      sourceText: 'YD-193',
      sourceBoxWidth: 72,
      sourceBoxHeight: 20,
      fontFamily: 'TH Sarabun',
    });

    expect(typography.forceSingleLine).toBe(true);
    expect(typography.fontSize).toBeLessThanOrEqual(16);
  });

  test('keeps elongated manga dialogue on a single line when the translation still fits', () => {
    const typography = computeOverlayTypography('หรือคุณต้องการ', 220, 32, {
      sourceText: 'OR DO YOU',
      sourceBoxWidth: 220,
      sourceBoxHeight: 32,
      fontFamily: 'TH Sarabun',
      profile: 'manga',
      styleKind: 'comic-line',
    });

    expect(typography.forceSingleLine).toBe(true);
  });

  test('adds wrap safety for dense thai manga bubbles to avoid line overlap', () => {
    const typography = computeOverlayTypography(
      'ตอนนั้นทั้งหมดลองของเขาศพไหม้เหมือนน้ำแข็ง',
      150,
      72,
      {
        sourceText: 'BACK THEN HIS WHOLE BODY WAS BURNING UP LIKE A FURNACE... BUT NOW HE’S COLD AS ICE...',
        sourceBoxWidth: 150,
        sourceBoxHeight: 72,
        fontFamily: 'TH Sarabun',
        profile: 'manga',
        styleKind: 'comic-bubble',
      }
    );

    expect(typography.estimatedLines).toBeGreaterThanOrEqual(3);
    expect(typography.lineHeight).toBeGreaterThan(1.2);
  });

  test('respects source line count for dense thai manga bubbles to avoid collapsing lines', () => {
    const typography = computeOverlayTypography(
      'ตอนนั้นทั้งหมดลองของเขา ตอนนี้เขาศพกำลังไหม้ ตอนนี้เขาขาวนาเหมือนน้ำแข็ง เหมือนเตาหลอม.... แต่',
      170,
      94,
      {
        sourceText: 'BACK THEN HIS WHOLE BODY WAS BURNING UP LIKE A FURNACE... BUT NOW HE’S COLD AS ICE... BUT',
        sourceBoxWidth: 170,
        sourceBoxHeight: 94,
        sourceLineCount: 4,
        fontFamily: 'TH Sarabun',
        profile: 'manga',
        styleKind: 'comic-bubble',
      }
    );

    expect(typography.estimatedLines).toBeGreaterThanOrEqual(4);
  });

  test('keeps document paragraph lines in a readable shared size band', () => {
    const typographyByIndex = computeOverlayTypographyMap([
      {
        index: 0,
        text: 'เงื่อนไขสำหรับสมดุลของวัตถุแข็ง',
        width: 260,
        height: 26,
        bbox: { x0: 100, y0: 100, x1: 420, y1: 126 },
        hints: {
          sourceText: 'Conditions for Rigid-Body Equilibrium',
          sourceBoxWidth: 320,
          sourceBoxHeight: 26,
          fontFamily: 'TH Sarabun',
        },
      },
      {
        index: 1,
        text: 'ในส่วนนี้เราจะพัฒนาทั้งเงื่อนไขที่จำเป็นและเงื่อนไขที่เพียงพอ',
        width: 340,
        height: 22,
        bbox: { x0: 100, y0: 132, x1: 520, y1: 154 },
        hints: {
          sourceText: 'In this section, we will develop both the necessary and sufficient conditions',
          sourceBoxWidth: 420,
          sourceBoxHeight: 22,
          fontFamily: 'TH Sarabun',
        },
      },
      {
        index: 2,
        text: 'สำหรับสมดุลของวัตถุแข็งในรูป',
        width: 250,
        height: 22,
        bbox: { x0: 100, y0: 156, x1: 430, y1: 178 },
        hints: {
          sourceText: 'for the equilibrium of the rigid body in Fig.',
          sourceBoxWidth: 330,
          sourceBoxHeight: 22,
          fontFamily: 'TH Sarabun',
        },
      },
    ]);

    expect(Math.abs((typographyByIndex.get(1)?.fontSize ?? 0) - (typographyByIndex.get(2)?.fontSize ?? 0))).toBeLessThanOrEqual(0.5);
  });

  test('keeps document body text close to source size instead of over-shrinking grouped lines', () => {
    const layoutMap = computeOverlayLayoutMap([
      {
        index: 0,
        text: 'ในส่วนนี้เราจะพัฒนาทั้งเงื่อนไขที่จำเป็นและเงื่อนไขที่เพียงพอ',
        width: 420,
        height: 22,
        bbox: { x0: 100, y0: 132, x1: 520, y1: 154 },
        hints: {
          sourceText: 'In this section, we will develop both the necessary and sufficient conditions',
          sourceBoxWidth: 420,
          sourceBoxHeight: 22,
          sourceLineCount: 1,
          fontFamily: 'TH Sarabun',
          profile: 'official',
          styleKind: 'document-body',
        },
      },
      {
        index: 1,
        text: 'สำหรับสมดุลของวัตถุแข็งในรูป',
        width: 330,
        height: 22,
        bbox: { x0: 100, y0: 156, x1: 430, y1: 178 },
        hints: {
          sourceText: 'for the equilibrium of the rigid body in Fig.',
          sourceBoxWidth: 330,
          sourceBoxHeight: 22,
          sourceLineCount: 1,
          fontFamily: 'TH Sarabun',
          profile: 'official',
          styleKind: 'document-body',
        },
      },
    ], { profile: 'official' });

    expect(layoutMap.get(0)?.typography.fontSize ?? 0).toBeGreaterThan(10);
    expect(layoutMap.get(1)?.typography.fontSize ?? 0).toBeGreaterThan(10);
  });

  test('does not promote adaptive shared-left groups into comic boxes by default', () => {
    const layoutMap = computeOverlayLayoutMap([
      {
        index: 0,
        text: 'เพื่อพัฒนาสมการสมดุลสำหรับวัตถุแข็ง',
        width: 280,
        height: 18,
        bbox: { x0: 100, y0: 120, x1: 420, y1: 138 },
        hints: {
          sourceText: 'To develop the equations of equilibrium for a rigid body.',
          sourceBoxWidth: 320,
          sourceBoxHeight: 18,
          sourceLineCount: 1,
          fontFamily: 'TH Sarabun',
          profile: 'adaptive',
        },
      },
      {
        index: 1,
        text: 'เพื่อแนะนำแนวคิดของแผนภาพแรงอิสระสำหรับวัตถุแข็ง',
        width: 320,
        height: 18,
        bbox: { x0: 100, y0: 142, x1: 452, y1: 160 },
        hints: {
          sourceText: 'To introduce the concept of the free-body diagram for a rigid body.',
          sourceBoxWidth: 352,
          sourceBoxHeight: 18,
          sourceLineCount: 1,
          fontFamily: 'TH Sarabun',
          profile: 'adaptive',
        },
      },
    ], { profile: 'adaptive' });

    expect(layoutMap.get(0)?.styleKind).not.toBe('comic-box');
    expect(layoutMap.get(1)?.styleKind).not.toBe('comic-box');
  });

  test('keeps left-aligned comic box lines readable within the same box cluster', () => {
    const layoutMap = computeOverlayLayoutMap([
      {
        index: 0,
        text: 'เปิด',
        width: 64,
        height: 18,
        bbox: { x0: 100, y0: 120, x1: 164, y1: 138 },
        hints: {
          sourceText: 'OPEN',
          sourceBoxWidth: 64,
          sourceBoxHeight: 18,
          sourceLineCount: 1,
          fontFamily: 'TH Sarabun',
          profile: 'manga',
          styleKind: 'comic-box',
        },
      },
      {
        index: 1,
        text: 'ตู้เก็บรองเท้า',
        width: 116,
        height: 18,
        bbox: { x0: 100, y0: 142, x1: 216, y1: 160 },
        hints: {
          sourceText: 'SHOE LOCKER',
          sourceBoxWidth: 116,
          sourceBoxHeight: 18,
          sourceLineCount: 1,
          fontFamily: 'TH Sarabun',
          profile: 'manga',
          styleKind: 'comic-box',
        },
      },
      {
        index: 2,
        text: 'และทิ้งรองเท้า',
        width: 128,
        height: 18,
        bbox: { x0: 100, y0: 164, x1: 228, y1: 182 },
        hints: {
          sourceText: 'AND LEAVE THE SHOES',
          sourceBoxWidth: 128,
          sourceBoxHeight: 18,
          sourceLineCount: 1,
          fontFamily: 'TH Sarabun',
          profile: 'manga',
          styleKind: 'comic-box',
        },
      },
    ], { profile: 'manga' });

    expect(layoutMap.get(0)?.styleKind).toBe('comic-box');
    expect(layoutMap.get(0)?.renderText).toContain('เปิด');
    expect(layoutMap.get(1)?.renderText).toContain('ตู้เก็บรองเท้า');
    expect(layoutMap.get(2)?.renderText).toContain('และทิ้งรองเท้า');
  });

  test('prefers the tighter union of word boxes over a loose line bbox', () => {
    const bbox = resolveOverlaySourceBBox({
      text: 'Equilibrium of a',
      confidence: 95,
      bbox: { x0: 80, y0: 40, x1: 460, y1: 180 },
      words: [
        { text: 'Equilibrium', confidence: 95, bbox: { x0: 82, y0: 50, x1: 260, y1: 114 } },
        { text: 'of', confidence: 95, bbox: { x0: 274, y0: 54, x1: 320, y1: 112 } },
        { text: 'a', confidence: 95, bbox: { x0: 334, y0: 48, x1: 366, y1: 114 } },
      ],
    });

    expect(bbox).toEqual({ x0: 82, y0: 48, x1: 366, y1: 114 });
  });

  test('falls back to line bbox for thai structured lines when word coverage is sparse', () => {
    const bbox = resolveOverlaySourceBBox({
      text: 'ข้อ (1) แรงลัพธ์ ในแกน x เท่ากับศูนย์',
      confidence: 95,
      bbox: { x0: 100, y0: 200, x1: 420, y1: 240 },
      words: [
        { text: 'ข้อ', confidence: 95, bbox: { x0: 108, y0: 206, x1: 142, y1: 238 } },
        { text: 'แรงลัพธ์', confidence: 95, bbox: { x0: 170, y0: 206, x1: 238, y1: 238 } },
      ],
    });

    expect(bbox).toEqual({ x0: 100, y0: 200, x1: 420, y1: 240 });
  });

  test('falls back to line bbox for technical document lines with aggressively trimmed word boxes', () => {
    const bbox = resolveOverlaySourceBBox({
      text: 'The reactions in the x and y directions together and thus form fixed connections. (10)',
      confidence: 95,
      bbox: { x0: 80, y0: 260, x1: 520, y1: 292 },
      words: [
        { text: 'reactions', confidence: 95, bbox: { x0: 152, y0: 262, x1: 218, y1: 290 } },
        { text: 'directions', confidence: 95, bbox: { x0: 248, y0: 262, x1: 324, y1: 290 } },
        { text: 'connections', confidence: 95, bbox: { x0: 352, y0: 262, x1: 438, y1: 290 } },
      ],
    });

    expect(bbox).toEqual({ x0: 80, y0: 260, x1: 520, y1: 292 });
  });

  test('falls back to line bbox for centered short dialogue lines when word boxes collapse inside the bubble', () => {
    const bbox = resolveOverlaySourceBBox({
      text: 'H-HOW?',
      confidence: 96,
      bbox: { x0: 120, y0: 420, x1: 248, y1: 504 },
      words: [
        { text: 'H-HOW?', confidence: 96, bbox: { x0: 164, y0: 452, x1: 206, y1: 474 } },
      ],
    });

    expect(bbox).toEqual({ x0: 120, y0: 420, x1: 248, y1: 504 });
  });

  test('skips suspicious sparse oversized lines for overlay rendering parity', () => {
    const shouldSkip = shouldSkipOverlayRenderForSuspiciousLine({
      text: 'AA',
      confidence: 90,
      bbox: { x0: 24, y0: 30, x1: 340, y1: 220 },
      words: [{ text: 'A', confidence: 90, bbox: { x0: 178, y0: 118, x1: 192, y1: 134 } }],
    });

    expect(shouldSkip).toBe(true);
  });

  test('keeps sentence-like overlays renderable even when source coverage is low', () => {
    const shouldSkip = shouldSkipOverlayRenderForSuspiciousLine({
      text: 'TE ESTABAN TOCANDO EL CUERPO',
      confidence: 91,
      bbox: { x0: 20, y0: 24, x1: 348, y1: 214 },
      words: [{ text: 'TOCANDO', confidence: 91, bbox: { x0: 166, y0: 112, x1: 218, y1: 138 } }],
    });

    expect(shouldSkip).toBe(false);
  });

  test('keeps normal compact lines renderable for overlay parity', () => {
    const shouldSkip = shouldSkipOverlayRenderForSuspiciousLine({
      text: 'OPEN LOCKER',
      confidence: 95,
      bbox: { x0: 120, y0: 200, x1: 280, y1: 236 },
      words: [
        { text: 'OPEN', confidence: 95, bbox: { x0: 126, y0: 202, x1: 178, y1: 234 } },
        { text: 'LOCKER', confidence: 95, bbox: { x0: 186, y0: 202, x1: 268, y1: 234 } },
      ],
    });

    expect(shouldSkip).toBe(false);
  });

  test('uses tighter mask expansion for compact labels than paragraph lines', () => {
    const label = resolveOverlayMaskExpansion({
      text: 'YD-193',
      confidence: 90,
      bbox: { x0: 0, y0: 0, x1: 60, y1: 18 },
      words: [{ text: 'YD-193', confidence: 90, bbox: { x0: 0, y0: 0, x1: 60, y1: 18 } }],
    });
    const paragraph = resolveOverlayMaskExpansion({
      text: 'This is a longer paragraph line with several words',
      confidence: 90,
      bbox: { x0: 0, y0: 0, x1: 240, y1: 18 },
      words: [
        { text: 'This', confidence: 90, bbox: { x0: 0, y0: 0, x1: 32, y1: 18 } },
        { text: 'is', confidence: 90, bbox: { x0: 36, y0: 0, x1: 48, y1: 18 } },
        { text: 'a', confidence: 90, bbox: { x0: 52, y0: 0, x1: 58, y1: 18 } },
        { text: 'longer', confidence: 90, bbox: { x0: 62, y0: 0, x1: 112, y1: 18 } },
      ],
    });

    expect(label.expandTopRatio).toBeLessThan(paragraph.expandTopRatio);
    expect(label.maxExpandBottom).toBeLessThanOrEqual(paragraph.maxExpandBottom);
  });

  test('shares a common text start for paragraph lines in the same block', () => {
    const layoutMap = computeOverlayLayoutMap([
      {
        index: 0,
        text: 'เพื่อพัฒนาสมการสมดุลสำหรับวัตถุแข็ง',
        width: 260,
        height: 20,
        bbox: { x0: 100, y0: 120, x1: 360, y1: 140 },
        line: {
          text: 'To develop the equations of equilibrium for a rigid body,',
          confidence: 95,
          bbox: { x0: 88, y0: 120, x1: 360, y1: 140 },
          words: [
            { text: 'To', confidence: 95, bbox: { x0: 102, y0: 120, x1: 120, y1: 140 } },
            { text: 'develop', confidence: 95, bbox: { x0: 132, y0: 120, x1: 188, y1: 140 } },
          ],
        },
      },
      {
        index: 1,
        text: 'เพื่อแนะนำแนวคิดของแผนภาพแรงอิสระสำหรับวัตถุแข็ง',
        width: 300,
        height: 20,
        bbox: { x0: 106, y0: 142, x1: 406, y1: 162 },
        line: {
          text: 'To introduce the concept of the free-body diagram',
          confidence: 95,
          bbox: { x0: 92, y0: 142, x1: 406, y1: 162 },
          words: [
            { text: 'To', confidence: 95, bbox: { x0: 108, y0: 142, x1: 126, y1: 162 } },
            { text: 'introduce', confidence: 95, bbox: { x0: 140, y0: 142, x1: 204, y1: 162 } },
          ],
        },
      },
    ]);

    expect(layoutMap.get(0)?.sharedTextStartX).toBe(layoutMap.get(1)?.sharedTextStartX);
    expect(layoutMap.get(0)?.sharedTextStartX).toBe(102);
  });

  test('detects centered layout for dialogue-like stacked lines', () => {
    const layoutMap = computeOverlayLayoutMap([
      {
        index: 0,
        text: 'นักเรียนเหล่านั้นอาจ',
        width: 180,
        height: 22,
        bbox: { x0: 140, y0: 100, x1: 320, y1: 122 },
        line: {
          text: 'THOSE STUDENTS...MAY BE DOING',
          confidence: 94,
          bbox: { x0: 120, y0: 100, x1: 340, y1: 122 },
          words: [
            { text: 'THOSE', confidence: 94, bbox: { x0: 130, y0: 100, x1: 176, y1: 122 } },
            { text: 'STUDENTS', confidence: 94, bbox: { x0: 184, y0: 100, x1: 248, y1: 122 } },
          ],
        },
      },
      {
        index: 1,
        text: 'จะทำเรื่องไม่ดีกับผู้สูง',
        width: 210,
        height: 22,
        bbox: { x0: 122, y0: 128, x1: 332, y1: 150 },
        line: {
          text: 'BAD THINGS TO THE ELDERLY,',
          confidence: 94,
          bbox: { x0: 112, y0: 128, x1: 342, y1: 150 },
          words: [
            { text: 'BAD', confidence: 94, bbox: { x0: 120, y0: 128, x1: 150, y1: 150 } },
            { text: 'THINGS', confidence: 94, bbox: { x0: 166, y0: 128, x1: 220, y1: 150 } },
          ],
        },
      },
    ]);

    expect(layoutMap.get(0)?.alignment).toBe('left');
    expect(layoutMap.get(1)?.alignment).toBe('left');
  });

  test('keeps official document lists left aligned while manga dialogue can still center', () => {
    const inputs = [
      {
        index: 0,
        text: 'นักเรียนเหล่านั้นอาจ',
        width: 180,
        height: 22,
        bbox: { x0: 140, y0: 100, x1: 320, y1: 122 },
        line: {
          text: 'THOSE STUDENTS...MAY BE DOING',
          confidence: 94,
          bbox: { x0: 120, y0: 100, x1: 340, y1: 122 },
          words: [
            { text: 'THOSE', confidence: 94, bbox: { x0: 130, y0: 100, x1: 176, y1: 122 } },
            { text: 'STUDENTS', confidence: 94, bbox: { x0: 184, y0: 100, x1: 248, y1: 122 } },
          ],
        },
      },
      {
        index: 1,
        text: 'จะทำเรื่องไม่ดีกับผู้สูง',
        width: 210,
        height: 22,
        bbox: { x0: 122, y0: 128, x1: 332, y1: 150 },
        line: {
          text: 'BAD THINGS TO THE ELDERLY,',
          confidence: 94,
          bbox: { x0: 112, y0: 128, x1: 342, y1: 150 },
          words: [
            { text: 'BAD', confidence: 94, bbox: { x0: 120, y0: 128, x1: 150, y1: 150 } },
            { text: 'THINGS', confidence: 94, bbox: { x0: 166, y0: 128, x1: 220, y1: 150 } },
          ],
        },
      },
    ];

    const officialLayout = computeOverlayLayoutMap(inputs, { profile: 'official' });
    const mangaLayout = computeOverlayLayoutMap(inputs, { profile: 'manga' });

    expect(officialLayout.get(0)?.alignment).toBe('left');
    expect(officialLayout.get(1)?.alignment).toBe('left');
    expect(mangaLayout.get(0)?.alignment).toBe('center');
    expect(mangaLayout.get(1)?.alignment).toBe('center');
    expect(mangaLayout.get(0)?.sharedBoxLeftX).toBeUndefined();
  });

  test('treats lowercase document-like source lines as official even under manga profile', () => {
    const layoutMap = computeOverlayLayoutMap([
      {
        index: 0,
        text: 'เงื่อนไขสำหรับสมดุลของวัตถุแข็ง',
        width: 420,
        height: 30,
        bbox: { x0: 120, y0: 260, x1: 540, y1: 290 },
        line: {
          text: 'Conditions for Rigid-Body Equilibrium',
          confidence: 95,
          bbox: { x0: 118, y0: 260, x1: 542, y1: 290 },
          words: [
            { text: 'Conditions', confidence: 95, bbox: { x0: 120, y0: 260, x1: 220, y1: 290 } },
            { text: 'for', confidence: 95, bbox: { x0: 228, y0: 260, x1: 256, y1: 290 } },
          ],
        },
        hints: {
          sourceText: 'Conditions for Rigid-Body Equilibrium',
          sourceBoxWidth: 422,
          sourceBoxHeight: 30,
          fontFamily: 'TH Sarabun',
          profile: 'manga',
        },
      },
      {
        index: 1,
        text: 'ในส่วนนี้เราจะพัฒนาทั้งเงื่อนไขที่จำเป็นและเงื่อนไขที่เพียงพอ',
        width: 430,
        height: 24,
        bbox: { x0: 120, y0: 298, x1: 550, y1: 322 },
        line: {
          text: 'In this section, we will develop both the necessary and sufficient conditions',
          confidence: 95,
          bbox: { x0: 118, y0: 298, x1: 552, y1: 322 },
          words: [
            { text: 'In', confidence: 95, bbox: { x0: 120, y0: 298, x1: 138, y1: 322 } },
            { text: 'this', confidence: 95, bbox: { x0: 146, y0: 298, x1: 178, y1: 322 } },
          ],
        },
        hints: {
          sourceText: 'In this section, we will develop both the necessary and sufficient conditions',
          sourceBoxWidth: 434,
          sourceBoxHeight: 24,
          fontFamily: 'TH Sarabun',
          profile: 'manga',
        },
      },
    ], { profile: 'manga' });

    expect(layoutMap.get(0)?.alignment).toBe('left');
    expect(layoutMap.get(1)?.alignment).toBe('left');
    expect(layoutMap.get(0)?.hidden).not.toBe(true);
    expect(layoutMap.get(1)?.hidden).not.toBe(true);
  });

  test('treats lowercase document-like source lines as official even under adaptive profile', () => {
    const layoutMap = computeOverlayLayoutMap([
      {
        index: 0,
        text: 'เงื่อนไขสำหรับสมดุลของวัตถุแข็ง',
        width: 420,
        height: 30,
        bbox: { x0: 120, y0: 260, x1: 540, y1: 290 },
        line: {
          text: 'Conditions for Rigid-Body Equilibrium',
          confidence: 95,
          bbox: { x0: 118, y0: 260, x1: 542, y1: 290 },
          words: [
            { text: 'Conditions', confidence: 95, bbox: { x0: 120, y0: 260, x1: 220, y1: 290 } },
            { text: 'for', confidence: 95, bbox: { x0: 228, y0: 260, x1: 256, y1: 290 } },
          ],
        },
        hints: {
          sourceText: 'Conditions for Rigid-Body Equilibrium',
          sourceBoxWidth: 422,
          sourceBoxHeight: 30,
          fontFamily: 'TH Sarabun',
          profile: 'adaptive',
        },
      },
      {
        index: 1,
        text: 'ในส่วนนี้เราจะพัฒนาทั้งเงื่อนไขที่จำเป็นและเงื่อนไขที่เพียงพอ',
        width: 430,
        height: 24,
        bbox: { x0: 120, y0: 298, x1: 550, y1: 322 },
        line: {
          text: 'In this section, we will develop both the necessary and sufficient conditions',
          confidence: 95,
          bbox: { x0: 118, y0: 298, x1: 552, y1: 322 },
          words: [
            { text: 'In', confidence: 95, bbox: { x0: 120, y0: 298, x1: 138, y1: 322 } },
            { text: 'this', confidence: 95, bbox: { x0: 146, y0: 298, x1: 178, y1: 322 } },
          ],
        },
        hints: {
          sourceText: 'In this section, we will develop both the necessary and sufficient conditions',
          sourceBoxWidth: 434,
          sourceBoxHeight: 24,
          fontFamily: 'TH Sarabun',
          profile: 'adaptive',
        },
      },
    ], { profile: 'adaptive' });

    expect(layoutMap.get(0)?.alignment).toBe('left');
    expect(layoutMap.get(1)?.alignment).toBe('left');
    expect(layoutMap.get(0)?.effectiveProfile).toBe('official');
    expect(layoutMap.get(1)?.effectiveProfile).toBe('official');
  });

  test('treats short document headings as official under adaptive profile', () => {
    const layoutMap = computeOverlayLayoutMap([
      {
        index: 0,
        text: 'วัตถุประสงค์ของบทนี้',
        width: 220,
        height: 26,
        bbox: { x0: 90, y0: 110, x1: 310, y1: 136 },
        line: {
          text: 'CHAPTER OBJECTIVES',
          confidence: 95,
          bbox: { x0: 88, y0: 110, x1: 314, y1: 136 },
          words: [
            { text: 'CHAPTER', confidence: 95, bbox: { x0: 92, y0: 110, x1: 176, y1: 136 } },
            { text: 'OBJECTIVES', confidence: 95, bbox: { x0: 184, y0: 110, x1: 304, y1: 136 } },
          ],
        },
        hints: {
          sourceText: 'CHAPTER OBJECTIVES',
          sourceBoxWidth: 226,
          sourceBoxHeight: 26,
          fontFamily: 'TH Sarabun',
          profile: 'adaptive',
        },
      },
    ], { profile: 'adaptive' });

    expect(layoutMap.get(0)?.effectiveProfile).toBe('official');
    expect(layoutMap.get(0)?.styleKind).toBe('document-heading');
  });

  test('keeps thai structured adaptive blocks as per-line overlays instead of section merge-hide', () => {
    const layoutMap = computeOverlayLayoutMap([
      {
        index: 0,
        text: 'สมการข้อหนึ่ง',
        width: 160,
        height: 22,
        bbox: { x0: 180, y0: 100, x1: 340, y1: 122 },
        line: {
          text: 'ข้อ (1) แรงลัพธ์ ในแกน x เท่ากับศูนย์',
          confidence: 95,
          bbox: { x0: 176, y0: 100, x1: 344, y1: 122 },
          words: [{ text: 'ข้อ', confidence: 95, bbox: { x0: 186, y0: 100, x1: 212, y1: 122 } }],
        },
        hints: {
          sourceText: 'ข้อ (1) แรงลัพธ์ ในแกน x เท่ากับศูนย์',
          sourceBoxWidth: 168,
          sourceBoxHeight: 22,
          fontFamily: 'TH Sarabun',
          profile: 'adaptive',
        },
      },
      {
        index: 1,
        text: 'สมการข้อสอง',
        width: 200,
        height: 22,
        bbox: { x0: 160, y0: 128, x1: 360, y1: 150 },
        line: {
          text: 'ข้อ (2) แรงลัพธ์ ในแกน y เท่ากับศูนย์',
          confidence: 95,
          bbox: { x0: 156, y0: 128, x1: 364, y1: 150 },
          words: [{ text: 'ข้อ', confidence: 95, bbox: { x0: 166, y0: 128, x1: 192, y1: 150 } }],
        },
        hints: {
          sourceText: 'ข้อ (2) แรงลัพธ์ ในแกน y เท่ากับศูนย์',
          sourceBoxWidth: 208,
          sourceBoxHeight: 22,
          fontFamily: 'TH Sarabun',
          profile: 'adaptive',
        },
      },
      {
        index: 2,
        text: 'สมการข้อสาม',
        width: 180,
        height: 22,
        bbox: { x0: 170, y0: 156, x1: 350, y1: 178 },
        line: {
          text: 'ข้อ (3) โมเมนต์ รอบจุดอ้างอิง เท่ากับศูนย์',
          confidence: 95,
          bbox: { x0: 166, y0: 156, x1: 354, y1: 178 },
          words: [{ text: 'ข้อ', confidence: 95, bbox: { x0: 176, y0: 156, x1: 202, y1: 178 } }],
        },
        hints: {
          sourceText: 'ข้อ (3) โมเมนต์ รอบจุดอ้างอิง เท่ากับศูนย์',
          sourceBoxWidth: 188,
          sourceBoxHeight: 22,
          fontFamily: 'TH Sarabun',
          profile: 'adaptive',
        },
      },
    ], { profile: 'adaptive' });

    expect(layoutMap.get(0)?.hidden).not.toBe(true);
    expect(layoutMap.get(1)?.hidden).not.toBe(true);
    expect(layoutMap.get(2)?.hidden).not.toBe(true);
    expect(layoutMap.get(0)?.renderText).toBe('สมการข้อหนึ่ง');
    expect(layoutMap.get(1)?.renderText).toBe('สมการข้อสอง');
    expect(layoutMap.get(2)?.renderText).toBe('สมการข้อสาม');
  });

  test('keeps adaptive mixed technical blocks per-line when document and equation cues are mixed', () => {
    const layoutMap = computeOverlayLayoutMap([
      {
        index: 0,
        text: 'สองตัวแปรไม่ทราบค่า',
        width: 210,
        height: 22,
        bbox: { x0: 100, y0: 100, x1: 310, y1: 122 },
        line: {
          text: 'Two unknowns.',
          confidence: 95,
          bbox: { x0: 98, y0: 100, x1: 314, y1: 122 },
          words: [{ text: 'Two', confidence: 95, bbox: { x0: 108, y0: 100, x1: 138, y1: 122 } }],
        },
        hints: {
          sourceText: 'Two unknowns.',
          sourceBoxWidth: 216,
          sourceBoxHeight: 22,
          fontFamily: 'TH Sarabun',
          profile: 'adaptive',
        },
      },
      {
        index: 1,
        text: 'แรงปฏิกิริยาที่ A และ B ยังไม่ทราบค่า',
        width: 260,
        height: 22,
        bbox: { x0: 250, y0: 128, x1: 510, y1: 150 },
        line: {
          text: 'The reactions at A and B are unknown.',
          confidence: 95,
          bbox: { x0: 246, y0: 128, x1: 514, y1: 150 },
          words: [{ text: 'The', confidence: 95, bbox: { x0: 258, y0: 128, x1: 286, y1: 150 } }],
        },
        hints: {
          sourceText: 'The reactions at A and B are unknown.',
          sourceBoxWidth: 268,
          sourceBoxHeight: 22,
          fontFamily: 'TH Sarabun',
          profile: 'adaptive',
        },
      },
      {
        index: 2,
        text: 'Fx',
        width: 70,
        height: 22,
        bbox: { x0: 160, y0: 156, x1: 230, y1: 178 },
        line: {
          text: 'Fx',
          confidence: 95,
          bbox: { x0: 158, y0: 156, x1: 232, y1: 178 },
          words: [{ text: 'Fx', confidence: 95, bbox: { x0: 174, y0: 156, x1: 212, y1: 178 } }],
        },
        hints: {
          sourceText: 'Fx',
          sourceBoxWidth: 74,
          sourceBoxHeight: 22,
          fontFamily: 'TH Sarabun',
          profile: 'adaptive',
        },
      },
      {
        index: 3,
        text: 'Fy',
        width: 70,
        height: 22,
        bbox: { x0: 170, y0: 184, x1: 240, y1: 206 },
        line: {
          text: 'Fy',
          confidence: 95,
          bbox: { x0: 168, y0: 184, x1: 242, y1: 206 },
          words: [{ text: 'Fy', confidence: 95, bbox: { x0: 184, y0: 184, x1: 222, y1: 206 } }],
        },
        hints: {
          sourceText: 'Fy',
          sourceBoxWidth: 74,
          sourceBoxHeight: 22,
          fontFamily: 'TH Sarabun',
          profile: 'adaptive',
        },
      },
      {
        index: 4,
        text: 'สมการ (8)',
        width: 110,
        height: 22,
        bbox: { x0: 155, y0: 212, x1: 265, y1: 234 },
        line: {
          text: '(8)',
          confidence: 95,
          bbox: { x0: 153, y0: 212, x1: 267, y1: 234 },
          words: [{ text: '(8)', confidence: 95, bbox: { x0: 188, y0: 212, x1: 230, y1: 234 } }],
        },
        hints: {
          sourceText: '(8)',
          sourceBoxWidth: 114,
          sourceBoxHeight: 22,
          fontFamily: 'TH Sarabun',
          profile: 'adaptive',
        },
      },
      {
        index: 5,
        text: 'สามตัวแปรไม่ทราบค่า',
        width: 230,
        height: 22,
        bbox: { x0: 248, y0: 240, x1: 478, y1: 262 },
        line: {
          text: 'Three unknowns.',
          confidence: 95,
          bbox: { x0: 244, y0: 240, x1: 482, y1: 262 },
          words: [{ text: 'Three', confidence: 95, bbox: { x0: 258, y0: 240, x1: 304, y1: 262 } }],
        },
        hints: {
          sourceText: 'Three unknowns.',
          sourceBoxWidth: 238,
          sourceBoxHeight: 22,
          fontFamily: 'TH Sarabun',
          profile: 'adaptive',
        },
      },
    ], { profile: 'adaptive' });

    expect(layoutMap.get(0)?.hidden).not.toBe(true);
    expect(layoutMap.get(1)?.hidden).not.toBe(true);
    expect(layoutMap.get(2)?.hidden).not.toBe(true);
    expect(layoutMap.get(3)?.hidden).not.toBe(true);
    expect(layoutMap.get(4)?.hidden).not.toBe(true);
    expect(layoutMap.get(5)?.hidden).not.toBe(true);
  });

  test('keeps adaptive dialogue groups per-line instead of merge-hide section blocks', () => {
    const layoutMap = computeOverlayLayoutMap([
      {
        index: 0,
        text: 'สองไม่ทราบค่า',
        width: 220,
        height: 22,
        bbox: { x0: 420, y0: 300, x1: 640, y1: 322 },
        line: {
          text: 'Two unknowns.',
          confidence: 95,
          bbox: { x0: 416, y0: 300, x1: 644, y1: 322 },
          words: [{ text: 'Two', confidence: 95, bbox: { x0: 426, y0: 300, x1: 456, y1: 322 } }],
        },
        hints: {
          sourceText: 'Two unknowns.',
          sourceBoxWidth: 228,
          sourceBoxHeight: 22,
          fontFamily: 'TH Sarabun',
          profile: 'adaptive',
        },
      },
      {
        index: 1,
        text: 'และแรงที่ตั้งฉากกับแท่ง',
        width: 260,
        height: 22,
        bbox: { x0: 430, y0: 332, x1: 690, y1: 354 },
        line: {
          text: 'and the force which acts perpendicular to the rod.',
          confidence: 95,
          bbox: { x0: 426, y0: 332, x1: 694, y1: 354 },
          words: [{ text: 'force', confidence: 95, bbox: { x0: 478, y0: 332, x1: 520, y1: 354 } }],
        },
        hints: {
          sourceText: 'and the force which acts perpendicular to the rod.',
          sourceBoxWidth: 268,
          sourceBoxHeight: 22,
          fontFamily: 'TH Sarabun',
          profile: 'adaptive',
        },
      },
    ], { profile: 'adaptive' });

    expect(layoutMap.get(0)?.hidden).not.toBe(true);
    expect(layoutMap.get(1)?.hidden).not.toBe(true);
    expect(layoutMap.get(0)?.renderText).toBe('สองไม่ทราบค่า');
    expect(layoutMap.get(1)?.renderText).toBe('และแรงที่ตั้งฉากกับแท่ง');
  });

  test('keeps manga technical stacked rows per-line instead of merge-hide section blocks', () => {
    const layoutMap = computeOverlayLayoutMap([
      {
        index: 0,
        text: 'อาคารอเนกประสงค์นี้',
        width: 220,
        height: 22,
        bbox: { x0: 250, y0: 320, x1: 470, y1: 342 },
        line: {
          text: 'This utility building is',
          confidence: 95,
          bbox: { x0: 246, y0: 320, x1: 474, y1: 342 },
          words: [{ text: 'This', confidence: 95, bbox: { x0: 256, y0: 320, x1: 286, y1: 342 } }],
        },
        hints: {
          sourceText: 'This utility building is',
          sourceBoxWidth: 228,
          sourceBoxHeight: 22,
          fontFamily: 'TH Sarabun',
          profile: 'manga',
        },
      },
      {
        index: 1,
        text: 'รองรับแบบพินที่ด้านบนของคอลัมน์ (8)',
        width: 300,
        height: 22,
        bbox: { x0: 246, y0: 348, x1: 546, y1: 370 },
        line: {
          text: 'pin supported at the top of the column. (8)',
          confidence: 95,
          bbox: { x0: 242, y0: 348, x1: 550, y1: 370 },
          words: [{ text: 'pin', confidence: 95, bbox: { x0: 258, y0: 348, x1: 282, y1: 370 } }],
        },
        hints: {
          sourceText: 'pin supported at the top of the column. (8)',
          sourceBoxWidth: 308,
          sourceBoxHeight: 22,
          fontFamily: 'TH Sarabun',
          profile: 'manga',
        },
      },
    ], { profile: 'manga' });

    expect(layoutMap.get(0)?.hidden).not.toBe(true);
    expect(layoutMap.get(1)?.hidden).not.toBe(true);
    expect(layoutMap.get(0)?.renderText).toBe('อาคารอเนกประสงค์นี้');
    expect(layoutMap.get(1)?.renderText).toContain('คอลัมน์');
  });

  test('keeps bracketed glossary narrative lines per-line under manga profile', () => {
    const layoutMap = computeOverlayLayoutMap([
      {
        index: 0,
        text: 'อายนาร์',
        width: 120,
        height: 22,
        bbox: { x0: 260, y0: 210, x1: 380, y1: 232 },
        line: {
          text: 'AYNAR',
          confidence: 95,
          bbox: { x0: 254, y0: 210, x1: 386, y1: 232 },
          words: [{ text: 'AYNAR', confidence: 95, bbox: { x0: 262, y0: 210, x1: 352, y1: 232 } }],
        },
        hints: {
          sourceText: 'AYNAR',
          sourceBoxWidth: 132,
          sourceBoxHeight: 22,
          fontFamily: 'TH Sarabun',
          profile: 'manga',
        },
      },
      {
        index: 1,
        text: '[แก่นแท้ของเวอร์ทาร์]',
        width: 260,
        height: 28,
        bbox: { x0: 120, y0: 246, x1: 380, y1: 274 },
        line: {
          text: "[VERTAR'S ESSENCE]",
          confidence: 95,
          bbox: { x0: 114, y0: 246, x1: 386, y1: 274 },
          words: [{ text: "VERTAR'S", confidence: 95, bbox: { x0: 156, y0: 246, x1: 238, y1: 274 } }],
        },
        hints: {
          sourceText: "[VERTAR'S ESSENCE]",
          sourceBoxWidth: 272,
          sourceBoxHeight: 28,
          fontFamily: 'TH Sarabun',
          profile: 'manga',
        },
      },
    ], { profile: 'manga' });

    expect(layoutMap.get(0)?.hidden).not.toBe(true);
    expect(layoutMap.get(1)?.hidden).not.toBe(true);
    expect(layoutMap.get(0)?.mergedBBox).toBeUndefined();
    expect(layoutMap.get(1)?.mergedBBox).toBeUndefined();
    expect(layoutMap.get(1)?.renderText).toBe('[แก่นแท้ของเวอร์ทาร์]');
  });

  test('joins PHENELINE absorbed line with bracketed VERTAR essence continuation', () => {
    const layoutMap = computeOverlayLayoutMap([
      {
        index: 0,
        text: 'ฟีนีลีนได้ดูดซับ',
        width: 220,
        height: 24,
        bbox: { x0: 130, y0: 220, x1: 350, y1: 244 },
        line: {
          text: 'PHENELINE HAS ABSORBED',
          confidence: 95,
          bbox: { x0: 124, y0: 220, x1: 356, y1: 244 },
          words: [{ text: 'PHENELINE', confidence: 95, bbox: { x0: 136, y0: 220, x1: 224, y1: 244 } }],
        },
        hints: {
          sourceText: 'PHENELINE HAS ABSORBED',
          sourceBoxWidth: 232,
          sourceBoxHeight: 24,
          fontFamily: 'TH Sarabun',
          profile: 'manga',
        },
      },
      {
        index: 1,
        text: '[แก่นแท้ของเวอร์ทาร์].',
        width: 220,
        height: 24,
        bbox: { x0: 164, y0: 250, x1: 384, y1: 274 },
        line: {
          text: "[VERTAR'S ESSENCE].",
          confidence: 95,
          bbox: { x0: 158, y0: 250, x1: 390, y1: 274 },
          words: [{ text: "VERTAR'S", confidence: 95, bbox: { x0: 176, y0: 250, x1: 258, y1: 274 } }],
        },
        hints: {
          sourceText: "[VERTAR'S ESSENCE].",
          sourceBoxWidth: 232,
          sourceBoxHeight: 24,
          fontFamily: 'TH Sarabun',
          profile: 'manga',
        },
      },
    ], { profile: 'manga' });

    expect(layoutMap.get(0)?.hidden).not.toBe(true);
    expect(layoutMap.get(1)?.hidden).toBe(true);
    expect(layoutMap.get(1)?.preserveMaskWhenHidden).toBe(true);
    expect(layoutMap.get(0)?.renderText).toContain('ฟีนีลีนได้ดูดซับ');
    expect(layoutMap.get(0)?.renderText).toContain('[แก่นแท้ของเวอร์ทาร์]');
    expect(layoutMap.get(0)?.highlightContinuationText).toContain('แก่นแท้ของเวอร์ทาร์');
    expect(layoutMap.get(0)?.highlightTextColorSourceIndex).toBe(1);
  });

  test('keeps document headings larger than document body text in official typography', () => {
    const heading = computeOverlayTypography('วัตถุประสงค์ของบทนี้', 210, 24, {
      sourceText: 'CHAPTER OBJECTIVES',
      sourceBoxWidth: 210,
      sourceBoxHeight: 24,
      fontFamily: 'TH Sarabun',
      profile: 'official',
    });
    const body = computeOverlayTypography('เพื่อพัฒนาสมการสมดุลสำหรับวัตถุแข็ง', 260, 20, {
      sourceText: 'To develop the equations of equilibrium for a rigid body,',
      sourceBoxWidth: 260,
      sourceBoxHeight: 20,
      fontFamily: 'TH Sarabun',
      profile: 'official',
    });

    expect(heading.fontSize).toBeGreaterThan(body.fontSize);
  });

  test('keeps official document body text within a readable size band', () => {
    const body = computeOverlayTypography('ในส่วนนี้เราจะพัฒนาทั้งเงื่อนไขที่จำเป็นและเงื่อนไขที่เพียงพอ', 430, 24, {
      sourceText: 'In this section, we will develop both the necessary and sufficient conditions',
      sourceBoxWidth: 430,
      sourceBoxHeight: 24,
      fontFamily: 'TH Sarabun',
      profile: 'official',
      styleKind: 'document-body',
    });

    expect(body.fontSize).toBeGreaterThan(8);
  });

  test('keeps separate manga balloons on the same row from being harmonized as one block', () => {
    const layoutMap = computeOverlayLayoutMap([
      {
        index: 0,
        text: 'หรือคุณต้องการ',
        width: 160,
        height: 20,
        bbox: { x0: 80, y0: 100, x1: 240, y1: 120 },
        line: {
          text: 'OR DO YOU',
          confidence: 95,
          bbox: { x0: 78, y0: 100, x1: 242, y1: 120 },
          words: [{ text: 'OR', confidence: 95, bbox: { x0: 120, y0: 100, x1: 142, y1: 120 } }],
        },
        hints: { fontFamily: 'TH Sarabun', profile: 'manga' },
      },
      {
        index: 1,
        text: 'ฉันไม่สน',
        width: 150,
        height: 20,
        bbox: { x0: 320, y0: 128, x1: 470, y1: 148 },
        line: {
          text: "I DON'T CARE.",
          confidence: 95,
          bbox: { x0: 318, y0: 128, x1: 472, y1: 148 },
          words: [{ text: 'I', confidence: 95, bbox: { x0: 364, y0: 128, x1: 372, y1: 148 } }],
        },
        hints: { fontFamily: 'TH Sarabun', profile: 'manga' },
      },
    ], { profile: 'manga' });

    expect(layoutMap.get(0)?.hidden).not.toBe(true);
    expect(layoutMap.get(1)?.hidden).not.toBe(true);
    expect(layoutMap.get(0)?.mergedBBox).toBeUndefined();
    expect(layoutMap.get(1)?.mergedBBox).toBeUndefined();
  });

  test('merges centered manga dialogue blocks into a single rendered overlay', () => {
    const layoutMap = computeOverlayLayoutMap([
      {
        index: 0,
        text: 'นั่น',
        width: 120,
        height: 22,
        bbox: { x0: 180, y0: 100, x1: 300, y1: 122 },
        line: {
          text: "THAT'S",
          confidence: 96,
          bbox: { x0: 170, y0: 100, x1: 310, y1: 122 },
          words: [{ text: "THAT'S", confidence: 96, bbox: { x0: 180, y0: 100, x1: 300, y1: 122 } }],
        },
        hints: { fontFamily: 'TH Sarabun', profile: 'manga' },
      },
      {
        index: 1,
        text: 'เป็นไปได้แน่นอน....',
        width: 180,
        height: 22,
        bbox: { x0: 150, y0: 128, x1: 330, y1: 150 },
        line: {
          text: 'DEFINITELY A POSSIBILITY...',
          confidence: 96,
          bbox: { x0: 140, y0: 128, x1: 340, y1: 150 },
          words: [{ text: 'DEFINITELY', confidence: 96, bbox: { x0: 150, y0: 128, x1: 242, y1: 150 } }],
        },
        hints: { fontFamily: 'TH Sarabun', profile: 'manga' },
      },
      {
        index: 2,
        text: 'คิดว่าไง ริฟรีด',
        width: 180,
        height: 22,
        bbox: { x0: 168, y0: 156, x1: 348, y1: 178 },
        line: {
          text: 'WHAT DO YOU THINK, URIGFRIED?',
          confidence: 96,
          bbox: { x0: 156, y0: 156, x1: 360, y1: 178 },
          words: [{ text: 'WHAT', confidence: 96, bbox: { x0: 168, y0: 156, x1: 208, y1: 178 } }],
        },
        hints: { fontFamily: 'TH Sarabun', profile: 'manga' },
      },
    ], { profile: 'manga' });

    expect(layoutMap.get(0)?.hidden).toBe(false);
    expect(layoutMap.get(0)?.renderText).toBe('นั่น เป็นไปได้แน่นอน.... คิดว่าไง ริฟรีด');
    expect(layoutMap.get(1)?.hidden).toBe(true);
    expect(layoutMap.get(2)?.hidden).toBe(true);
    expect(layoutMap.get(1)?.preserveMaskWhenHidden).not.toBe(true);
    expect(layoutMap.get(2)?.preserveMaskWhenHidden).not.toBe(true);
    expect(layoutMap.get(0)?.mergedBBox).toEqual({ x0: 150, y0: 100, x1: 348, y1: 178 });
    expect(layoutMap.get(0)?.mergedMaskBBox).toEqual({ x0: 140, y0: 100, x1: 360, y1: 178 });
  });

  test('merges short centered manga lines even with larger vertical gaps', () => {
    const layoutMap = computeOverlayLayoutMap([
      {
        index: 0,
        text: 'หรือคุณต้องการ',
        width: 150,
        height: 18,
        bbox: { x0: 160, y0: 100, x1: 310, y1: 118 },
        line: {
          text: 'OR DO YOU',
          confidence: 95,
          bbox: { x0: 150, y0: 100, x1: 320, y1: 118 },
          words: [{ text: 'OR', confidence: 95, bbox: { x0: 178, y0: 100, x1: 198, y1: 118 } }],
        },
        hints: { fontFamily: 'TH Sarabun', profile: 'manga' },
      },
      {
        index: 1,
        text: 'ให้สาระสำคัญนี้ เป็นสิ่งเดียวที่เรา เอาออกไปจากที่นี่',
        width: 220,
        height: 40,
        bbox: { x0: 136, y0: 132, x1: 356, y1: 172 },
        line: {
          text: 'WANT THIS ESSENCE TO BE THE ONE THING WE TAKE OUT OF HERE?',
          confidence: 95,
          bbox: { x0: 126, y0: 132, x1: 366, y1: 172 },
          words: [{ text: 'WANT', confidence: 95, bbox: { x0: 150, y0: 132, x1: 198, y1: 152 } }],
        },
        hints: { fontFamily: 'TH Sarabun', profile: 'manga' },
      },
    ], { profile: 'manga' });

    expect(layoutMap.get(0)?.hidden).toBe(false);
    expect(layoutMap.get(1)?.hidden).toBe(true);
    expect(layoutMap.get(0)?.renderText).toContain('หรือคุณต้องการ');
    expect(layoutMap.get(0)?.renderText).toContain('ให้สาระสำคัญนี้');
  });

  test('treats left-aligned stacked manga box text as a comic box block', () => {
    const layoutMap = computeOverlayLayoutMap([
      {
        index: 0,
        text: 'เปิดตู้เก็บรองเท้า',
        width: 130,
        height: 18,
        bbox: { x0: 360, y0: 200, x1: 490, y1: 218 },
        line: {
          text: 'OPEN A SHOE LOCKER',
          confidence: 95,
          bbox: { x0: 360, y0: 200, x1: 490, y1: 218 },
          words: [{ text: 'OPEN', confidence: 95, bbox: { x0: 366, y0: 200, x1: 410, y1: 218 } }],
        },
        hints: { fontFamily: 'TH Sarabun', profile: 'manga' },
      },
      {
        index: 1,
        text: 'และออกจากอาคาร',
        width: 130,
        height: 18,
        bbox: { x0: 360, y0: 222, x1: 490, y1: 240 },
        line: {
          text: 'AND LEAVE THE BUILDING',
          confidence: 95,
          bbox: { x0: 360, y0: 222, x1: 490, y1: 240 },
          words: [{ text: 'AND', confidence: 95, bbox: { x0: 366, y0: 222, x1: 400, y1: 240 } }],
        },
        hints: { fontFamily: 'TH Sarabun', profile: 'manga' },
      },
    ], { profile: 'manga' });

    expect(layoutMap.get(0)?.styleKind).toBe('comic-box');
    expect(layoutMap.get(1)?.styleKind).toBe('comic-box');
    expect(layoutMap.get(0)?.alignment).toBe('left');
    expect(layoutMap.get(0)?.typography.fontSize).toBe(layoutMap.get(1)?.typography.fontSize);
  });

  test('keeps paragraph-like stacked lines left aligned when they share a left edge', () => {
    const layoutMap = computeOverlayLayoutMap([
      {
        index: 0,
        text: 'สิ่งสำคัญคือต้องสามารถหาแรงได้',
        width: 260,
        height: 20,
        bbox: { x0: 200, y0: 100, x1: 460, y1: 120 },
        line: {
          text: 'It is important to be able to determine the forces',
          confidence: 95,
          bbox: { x0: 190, y0: 100, x1: 470, y1: 120 },
          words: [
            { text: 'It', confidence: 95, bbox: { x0: 202, y0: 100, x1: 214, y1: 120 } },
            { text: 'is', confidence: 95, bbox: { x0: 220, y0: 100, x1: 232, y1: 120 } },
          ],
        },
      },
      {
        index: 1,
        text: 'เรื่องนี้สำคัญเพื่อให้แน่ใจว่าไม่ล่มเหลว',
        width: 258,
        height: 20,
        bbox: { x0: 200, y0: 124, x1: 458, y1: 144 },
        line: {
          text: 'this submarine to insure that they do not fail.',
          confidence: 95,
          bbox: { x0: 190, y0: 124, x1: 468, y1: 144 },
          words: [
            { text: 'this', confidence: 95, bbox: { x0: 202, y0: 124, x1: 228, y1: 144 } },
            { text: 'submarine', confidence: 95, bbox: { x0: 234, y0: 124, x1: 294, y1: 144 } },
          ],
        },
      },
      {
        index: 2,
        text: 'เพื่อหาวิธีการรักษาความสมดุล',
        width: 188,
        height: 20,
        bbox: { x0: 200, y0: 148, x1: 388, y1: 168 },
        line: {
          text: 'to apply equilibrium methods',
          confidence: 95,
          bbox: { x0: 190, y0: 148, x1: 404, y1: 168 },
          words: [
            { text: 'to', confidence: 95, bbox: { x0: 202, y0: 148, x1: 216, y1: 168 } },
            { text: 'apply', confidence: 95, bbox: { x0: 222, y0: 148, x1: 258, y1: 168 } },
          ],
        },
      },
    ]);

    expect(layoutMap.get(0)?.alignment).toBe('left');
    expect(layoutMap.get(1)?.alignment).toBe('left');
    expect(layoutMap.get(2)?.alignment).toBe('left');
    expect(layoutMap.get(0)?.sharedTextStartX).toBe(202);
    expect(layoutMap.get(1)?.sharedTextStartX).toBe(202);
    expect(layoutMap.get(2)?.alignment).toBe('left');
  });

  test('suppresses strongly overlapping overlay borders at the same anchor area', () => {
    const layoutMap = computeOverlayLayoutMap([
      {
        index: 0,
        text: 'ตึกนี้รองรับแบบพิน',
        width: 220,
        height: 24,
        bbox: { x0: 260, y0: 520, x1: 480, y1: 544 },
        line: {
          text: 'This utility building is',
          confidence: 78,
          bbox: { x0: 260, y0: 520, x1: 480, y1: 544 },
          words: [{ text: 'This', confidence: 78, bbox: { x0: 268, y0: 520, x1: 298, y1: 544 } }],
        },
        hints: {
          sourceText: 'This utility building is',
          sourceBoxWidth: 220,
          sourceBoxHeight: 24,
          profile: 'adaptive',
          fontFamily: 'TH Sarabun',
        },
      },
      {
        index: 1,
        text: 'ตึกอเนกประสงค์นี้รองรับแบบพินที่ด้านบนของคอลัมน์',
        width: 224,
        height: 24,
        bbox: { x0: 266, y0: 524, x1: 490, y1: 548 },
        line: {
          text: 'This utility building is pin supported at the top of the column.',
          confidence: 96,
          bbox: { x0: 266, y0: 524, x1: 490, y1: 548 },
          words: [{ text: 'This', confidence: 96, bbox: { x0: 274, y0: 524, x1: 304, y1: 548 } }],
        },
        hints: {
          sourceText: 'This utility building is pin supported at the top of the column.',
          sourceBoxWidth: 224,
          sourceBoxHeight: 24,
          profile: 'adaptive',
          fontFamily: 'TH Sarabun',
        },
      },
    ], { profile: 'adaptive' });

    expect(layoutMap.get(0)?.hidden).toBe(true);
    expect(layoutMap.get(0)?.preserveMaskWhenHidden).not.toBe(true);
    expect(layoutMap.get(1)?.hidden).not.toBe(true);
    expect(layoutMap.get(1)?.renderText).toContain('คอลัมน์');
  });

  test('keeps strongly overlapped overlays when translated texts are clearly different', () => {
    const layoutMap = computeOverlayLayoutMap([
      {
        index: 0,
        text: 'เปิดตู้รองเท้าแล้วออกจากตึก',
        width: 220,
        height: 24,
        bbox: { x0: 260, y0: 520, x1: 480, y1: 544 },
        line: {
          text: 'OPEN A SHOE LOCKER AND LEAVE THE BUILDING',
          confidence: 96,
          bbox: { x0: 260, y0: 520, x1: 480, y1: 544 },
          words: [{ text: 'OPEN', confidence: 96, bbox: { x0: 268, y0: 520, x1: 306, y1: 544 } }],
        },
        hints: {
          sourceText: 'OPEN A SHOE LOCKER AND LEAVE THE BUILDING',
          sourceBoxWidth: 220,
          sourceBoxHeight: 24,
          profile: 'adaptive',
          fontFamily: 'TH Sarabun',
        },
      },
      {
        index: 1,
        text: 'ทีม 30 คนกำลังรอที่ทางเข้า',
        width: 224,
        height: 24,
        bbox: { x0: 266, y0: 524, x1: 490, y1: 548 },
        line: {
          text: 'A TEAM OF 30 PLAYERS IS WAITING AT THE ENTRANCE',
          confidence: 95,
          bbox: { x0: 266, y0: 524, x1: 490, y1: 548 },
          words: [{ text: 'A', confidence: 95, bbox: { x0: 274, y0: 524, x1: 286, y1: 548 } }],
        },
        hints: {
          sourceText: 'A TEAM OF 30 PLAYERS IS WAITING AT THE ENTRANCE',
          sourceBoxWidth: 224,
          sourceBoxHeight: 24,
          profile: 'adaptive',
          fontFamily: 'TH Sarabun',
        },
      },
    ], { profile: 'adaptive' });

    expect(layoutMap.get(0)?.hidden).not.toBe(true);
    expect(layoutMap.get(1)?.hidden).not.toBe(true);
  });

  test('keeps nearby stacked lines when overlap is low and anchors are distinct', () => {
    const layoutMap = computeOverlayLayoutMap([
      {
        index: 0,
        text: 'การรองรับคงที่',
        width: 170,
        height: 24,
        bbox: { x0: 100, y0: 300, x1: 270, y1: 324 },
        line: {
          text: 'fixed support',
          confidence: 95,
          bbox: { x0: 100, y0: 300, x1: 270, y1: 324 },
          words: [{ text: 'fixed', confidence: 95, bbox: { x0: 108, y0: 300, x1: 148, y1: 324 } }],
        },
        hints: {
          sourceText: 'fixed support',
          sourceBoxWidth: 170,
          sourceBoxHeight: 24,
          profile: 'adaptive',
          fontFamily: 'TH Sarabun',
        },
      },
      {
        index: 1,
        text: 'ชนิดของความสัมพันธ์ในตาราง 5-1',
        width: 310,
        height: 24,
        bbox: { x0: 100, y0: 332, x1: 410, y1: 356 },
        line: {
          text: 'CONNECTION types in Table 5-1.',
          confidence: 95,
          bbox: { x0: 100, y0: 332, x1: 410, y1: 356 },
          words: [{ text: 'CONNECTION', confidence: 95, bbox: { x0: 108, y0: 332, x1: 206, y1: 356 } }],
        },
        hints: {
          sourceText: 'CONNECTION types in Table 5-1.',
          sourceBoxWidth: 310,
          sourceBoxHeight: 24,
          profile: 'adaptive',
          fontFamily: 'TH Sarabun',
        },
      },
    ], { profile: 'adaptive' });

    expect(layoutMap.get(0)?.hidden).not.toBe(true);
    expect(layoutMap.get(1)?.hidden).not.toBe(true);
  });
});

describe('resolveTranslationOverlayContext duplicate collapse', () => {
  test('collapses near-identical translated lines that overlap in the same technical caption row', () => {
    const currentPageOCR = {
      pageNumber: 6,
      width: 900,
      height: 1300,
      dpi: 300,
      language: 'eng',
      algorithmVersion: 174,
      pipelineProfile: 'panel' as const,
      ocrEngine: 'paddleocr' as const,
      ocrQualityProfile: 'best' as const,
      lines: [
        {
          text: 'This utility building is',
          confidence: 96,
          bbox: { x0: 260, y0: 520, x1: 470, y1: 542 },
          words: [{ text: 'This', confidence: 96, bbox: { x0: 266, y0: 520, x1: 296, y1: 542 } }],
        },
        {
          text: 'This utility building is',
          confidence: 74,
          bbox: { x0: 266, y0: 526, x1: 474, y1: 548 },
          words: [{ text: 'This', confidence: 74, bbox: { x0: 272, y0: 526, x1: 302, y1: 548 } }],
        },
        {
          text: 'pin supported at the top of the column. (8)',
          confidence: 95,
          bbox: { x0: 256, y0: 550, x1: 566, y1: 572 },
          words: [{ text: 'pin', confidence: 95, bbox: { x0: 266, y0: 550, x1: 292, y1: 572 } }],
        },
      ],
      words: [],
      text: 'This utility building is pin supported at the top of the column. (8)',
      confidence: 92,
    };

    const sourceFingerprint = buildOCRSourceFingerprint(currentPageOCR, 'paddleocr');
    const cacheKey = 'ver:v26|ocr:paddleocr|ocrLang:eng|src:en|dst:th|mode:manga|translator:offline';
    const currentPageTranslationMap = new Map([
      [cacheKey, {
        key: cacheKey,
        pageNum: 6,
        ocrEngine: 'paddleocr' as const,
        ocrLanguage: 'eng',
        sourceLanguage: 'en',
        targetLanguage: 'th',
        translationMode: 'manga' as const,
        translatorEngine: 'offline' as const,
        sourceFingerprint,
        translatedByIndex: [
          { index: 0, text: 'ตึกอเนกประสงค์นี้' },
          { index: 1, text: 'ตึกอเนกประสงค์นี้' },
          { index: 2, text: 'รองรับแบบพินที่ด้านบนของคอลัมน์ (8)' },
        ],
        translatedText: 'ตึกอเนกประสงค์นี้ รองรับแบบพินที่ด้านบนของคอลัมน์ (8)',
        lineCount: 3,
        groupCount: 2,
        createdAt: Date.now(),
      }],
    ]);

    const overlay = resolveTranslationOverlayContext({
      currentPageOCR,
      optionsEngine: 'paddleocr',
      optionsLanguage: 'eng',
      translationMode: 'manga',
      sourceLanguage: 'en',
      targetLanguage: 'th',
      translationPreviewMode: 'translated',
      currentPageTranslationMap,
      activeTranslationKey: cacheKey,
    });

    expect(overlay.shouldRender).toBe(true);
    expect(overlay.translatedByIndex.size).toBe(2);
    expect(overlay.translatedByIndex.has(0)).toBe(true);
    expect(overlay.translatedByIndex.has(1)).toBe(false);
    expect(overlay.translatedByIndex.get(2)).toContain('คอลัมน์');
  });

  test('keeps identical translated labels when they are far apart in different rows', () => {
    const currentPageOCR = {
      pageNumber: 3,
      width: 820,
      height: 1400,
      dpi: 300,
      language: 'eng',
      algorithmVersion: 174,
      pipelineProfile: 'panel' as const,
      ocrEngine: 'paddleocr' as const,
      ocrQualityProfile: 'best' as const,
      lines: [
        {
          text: 'fixed support',
          confidence: 95,
          bbox: { x0: 84, y0: 300, x1: 210, y1: 322 },
          words: [{ text: 'fixed', confidence: 95, bbox: { x0: 90, y0: 300, x1: 130, y1: 322 } }],
        },
        {
          text: 'fixed support',
          confidence: 95,
          bbox: { x0: 86, y0: 692, x1: 212, y1: 714 },
          words: [{ text: 'fixed', confidence: 95, bbox: { x0: 92, y0: 692, x1: 132, y1: 714 } }],
        },
      ],
      words: [],
      text: 'fixed support fixed support',
      confidence: 92,
    };

    const sourceFingerprint = buildOCRSourceFingerprint(currentPageOCR, 'paddleocr');
    const cacheKey = 'ver:v26|ocr:paddleocr|ocrLang:eng|src:en|dst:th|mode:manga|translator:offline';
    const currentPageTranslationMap = new Map([
      [cacheKey, {
        key: cacheKey,
        pageNum: 3,
        ocrEngine: 'paddleocr' as const,
        ocrLanguage: 'eng',
        sourceLanguage: 'en',
        targetLanguage: 'th',
        translationMode: 'manga' as const,
        translatorEngine: 'offline' as const,
        sourceFingerprint,
        translatedByIndex: [
          { index: 0, text: 'การรองรับคงที่' },
          { index: 1, text: 'การรองรับคงที่' },
        ],
        translatedText: 'การรองรับคงที่',
        lineCount: 2,
        groupCount: 2,
        createdAt: Date.now(),
      }],
    ]);

    const overlay = resolveTranslationOverlayContext({
      currentPageOCR,
      optionsEngine: 'paddleocr',
      optionsLanguage: 'eng',
      translationMode: 'manga',
      sourceLanguage: 'en',
      targetLanguage: 'th',
      translationPreviewMode: 'translated',
      currentPageTranslationMap,
      activeTranslationKey: cacheKey,
    });

    expect(overlay.shouldRender).toBe(true);
    expect(overlay.translatedByIndex.size).toBe(2);
    expect(overlay.translatedByIndex.has(0)).toBe(true);
    expect(overlay.translatedByIndex.has(1)).toBe(true);
  });

  test('keeps overlapping translated lines when source text differs substantially', () => {
    const currentPageOCR = {
      pageNumber: 9,
      width: 820,
      height: 1200,
      dpi: 300,
      language: 'eng',
      algorithmVersion: 174,
      pipelineProfile: 'panel' as const,
      ocrEngine: 'paddleocr' as const,
      ocrQualityProfile: 'best' as const,
      lines: [
        {
          text: 'OPEN A SHOE LOCKER AND LEAVE THE BUILDING',
          confidence: 95,
          bbox: { x0: 260, y0: 520, x1: 480, y1: 544 },
          words: [{ text: 'OPEN', confidence: 95, bbox: { x0: 268, y0: 520, x1: 306, y1: 544 } }],
        },
        {
          text: 'A TEAM OF 30 PLAYERS IS WAITING AT THE ENTRANCE',
          confidence: 95,
          bbox: { x0: 266, y0: 524, x1: 490, y1: 548 },
          words: [{ text: 'TEAM', confidence: 95, bbox: { x0: 286, y0: 524, x1: 328, y1: 548 } }],
        },
      ],
      words: [],
      text: '',
      confidence: 90,
    };

    const sourceFingerprint = buildOCRSourceFingerprint(currentPageOCR, 'paddleocr');
    const cacheKey = 'ver:v26|ocr:paddleocr|ocrLang:eng|src:en|dst:th|mode:manga|translator:offline';
    const currentPageTranslationMap = new Map([
      [cacheKey, {
        key: cacheKey,
        pageNum: 9,
        ocrEngine: 'paddleocr' as const,
        ocrLanguage: 'eng',
        sourceLanguage: 'en',
        targetLanguage: 'th',
        translationMode: 'manga' as const,
        translatorEngine: 'offline' as const,
        sourceFingerprint,
        translatedByIndex: [
          { index: 0, text: 'ข้อความเดียวกัน' },
          { index: 1, text: 'ข้อความเดียวกัน' },
        ],
        translatedText: 'ข้อความเดียวกัน',
        lineCount: 2,
        groupCount: 2,
        createdAt: Date.now(),
      }],
    ]);

    const overlay = resolveTranslationOverlayContext({
      currentPageOCR,
      optionsEngine: 'paddleocr',
      optionsLanguage: 'eng',
      translationMode: 'manga',
      sourceLanguage: 'en',
      targetLanguage: 'th',
      translationPreviewMode: 'translated',
      currentPageTranslationMap,
      activeTranslationKey: cacheKey,
    });

    expect(overlay.shouldRender).toBe(true);
    expect(overlay.translatedByIndex.size).toBe(2);
    expect(overlay.translatedByIndex.has(0)).toBe(true);
    expect(overlay.translatedByIndex.has(1)).toBe(true);
  });

  test('collapses document-like overlapping duplicates even when source strings are noisy variants', () => {
    const currentPageOCR = {
      pageNumber: 6,
      width: 1400,
      height: 3200,
      dpi: 300,
      language: 'eng',
      algorithmVersion: 174,
      pipelineProfile: 'panel' as const,
      ocrEngine: 'paddleocr' as const,
      ocrQualityProfile: 'best' as const,
      lines: [
        {
          text: 'BRIDGE GIRDER ALLOWS HORIZONTAL',
          confidence: 88,
          bbox: { x0: 760, y0: 2880, x1: 1420, y1: 2944 },
          words: [{ text: 'BRIDGE', confidence: 88, bbox: { x0: 776, y0: 2882, x1: 866, y1: 2942 } }],
        },
        {
          text: 'bridge girder allows horizontal @',
          confidence: 82,
          bbox: { x0: 756, y0: 2876, x1: 1412, y1: 2938 },
          words: [{ text: 'bridge', confidence: 82, bbox: { x0: 772, y0: 2878, x1: 858, y1: 2936 } }],
        },
      ],
      words: [],
      text: '',
      confidence: 86,
    };

    const sourceFingerprint = buildOCRSourceFingerprint(currentPageOCR, 'paddleocr');
    const cacheKey = 'ver:v26|ocr:paddleocr|ocrLang:eng|src:en|dst:th|mode:official|translator:offline';
    const currentPageTranslationMap = new Map([
      [cacheKey, {
        key: cacheKey,
        pageNum: 6,
        ocrEngine: 'paddleocr' as const,
        ocrLanguage: 'eng',
        sourceLanguage: 'en',
        targetLanguage: 'th',
        translationMode: 'official' as const,
        translatorEngine: 'offline' as const,
        sourceFingerprint,
        translatedByIndex: [
          { index: 0, text: 'คานสะพานรับแรงแนวนอน' },
          { index: 1, text: 'คานสะพานรับแรงแนวนอน' },
        ],
        translatedText: 'คานสะพานรับแรงแนวนอน',
        lineCount: 2,
        groupCount: 2,
        createdAt: Date.now(),
      }],
    ]);

    const overlay = resolveTranslationOverlayContext({
      currentPageOCR,
      optionsEngine: 'paddleocr',
      optionsLanguage: 'eng',
      translationMode: 'official',
      sourceLanguage: 'en',
      targetLanguage: 'th',
      translationPreviewMode: 'translated',
      currentPageTranslationMap,
      activeTranslationKey: cacheKey,
    });

    expect(overlay.shouldRender).toBe(true);
    expect(overlay.translatedByIndex.size).toBe(1);
    expect(overlay.translatedByIndex.has(0) || overlay.translatedByIndex.has(1)).toBe(true);
  });

  test('accepts spanish-source cache entry when OCR language key is english but snapshot matches', () => {
    const currentPageOCR = {
      pageNumber: 2,
      width: 1000,
      height: 1400,
      dpi: 300,
      language: 'eng',
      algorithmVersion: 174,
      pipelineProfile: 'panel' as const,
      ocrEngine: 'paddleocr' as const,
      ocrQualityProfile: 'best' as const,
      lines: [
        {
          text: 'TE ESTABAN TOCANDO EL CUERPO',
          confidence: 94,
          bbox: { x0: 120, y0: 220, x1: 520, y1: 280 },
          words: [{ text: 'TE', confidence: 94, bbox: { x0: 130, y0: 224, x1: 168, y1: 278 } }],
        },
      ],
      words: [],
      text: '',
      confidence: 90,
    };

    const sourceFingerprint = buildOCRSourceFingerprint(currentPageOCR, 'paddleocr');
    const cacheKey = 'ver:v26|ocr:paddleocr|ocrLang:eng|src:es|dst:th|mode:manga|translator:offline';
    const currentPageTranslationMap = new Map([
      [cacheKey, {
        key: cacheKey,
        pageNum: 2,
        ocrEngine: 'paddleocr' as const,
        ocrLanguage: 'eng',
        sourceLanguage: 'es',
        targetLanguage: 'th',
        translationMode: 'manga' as const,
        translatorEngine: 'offline' as const,
        sourceFingerprint,
        translatedByIndex: [
          { index: 0, text: 'พวกเขากำลังแตะตัวเธออยู่เหรอ' },
        ],
        translatedText: 'พวกเขากำลังแตะตัวเธออยู่เหรอ',
        lineCount: 1,
        groupCount: 1,
        createdAt: Date.now(),
      }],
    ]);

    const overlay = resolveTranslationOverlayContext({
      currentPageOCR,
      optionsEngine: 'paddleocr',
      optionsLanguage: 'eng',
      translationMode: 'manga',
      sourceLanguage: 'en',
      targetLanguage: 'th',
      translationPreviewMode: 'translated',
      currentPageTranslationMap,
      activeTranslationKey: cacheKey,
    });

    expect(overlay.shouldRender).toBe(true);
    expect(overlay.sourceLanguage).toBe('es');
    expect(overlay.translatedByIndex.size).toBe(1);
    expect(overlay.translatedByIndex.get(0)).toContain('แตะตัว');
  });
});





