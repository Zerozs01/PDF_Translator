import { describe, expect, test } from 'vitest';
import { buildLayerGroupsFromOCR, splitAggressiveMergedLines } from './LayerGroupingService';
import type { OCRPageResult, OCRLine } from '../../types';

describe('LayerGroupingService Spatial Clustering', () => {
  test('separates side-by-side columns or two-panel layouts even at the same Y level', () => {
    // จำลองหน้าการ์ตูนที่มี 2 Panels (ซ้าย และ ขวา)
    // Panel 1 (ซ้าย): x(10-200), y(100-120) และ y(125-145)
    // Panel 2 (ขวา): x(300-490), y(105-125) และ y(130-150)
    // ทั้งสองคอลัมน์อยู่ระดับ Y ใกล้กันมาก แต่ห่างกันทางแกน X (ไม่มี Horizontal Overlap)
    const ocrResult: OCRPageResult = {
      pageNumber: 1,
      width: 500,
      height: 500,
      dpi: 72,
      language: 'eng',
      algorithmVersion: 1,
      words: [],
      text: '',
      confidence: 90,
      lines: [
        {
          text: 'Panel Left Line 1',
          bbox: { x0: 10, y0: 100, x1: 200, y1: 120 },
          confidence: 90,
          words: [],
        },
        {
          text: 'Panel Left Line 2',
          bbox: { x0: 10, y0: 125, x1: 200, y1: 145 },
          confidence: 90,
          words: [],
        },
        {
          text: 'Panel Right Line 1',
          bbox: { x0: 300, y0: 105, x1: 490, y1: 125 },
          confidence: 92,
          words: [],
        },
        {
          text: 'Panel Right Line 2',
          bbox: { x0: 300, y0: 130, x1: 490, y1: 150 },
          confidence: 92,
          words: [],
        },
      ],
    };

    const result = buildLayerGroupsFromOCR(ocrResult);

    // ผลลัพธ์ต้องสร้าง 2 กลุ่ม (Left group และ Right group แยกจากกันโดยสิ้นเชิง)
    expect(result.groups.length).toBe(2);
    
    // ตรวจสอบว่าแต่ละกลุ่มมีสมาชิก 2 layers เสมอ
    expect(result.groups[0].layerIds.length).toBe(2);
    expect(result.groups[1].layerIds.length).toBe(2);

    // ตรวจสอบว่า Layer ID ของกลุ่มที่หนึ่งอ้างอิงไปยัง Left lines
    const leftGroupLayers = result.layers.filter(l => l.groupId === result.groups[0].id);
    expect(leftGroupLayers.map(l => l.sourceText)).toContain('Panel Left Line 1');
    expect(leftGroupLayers.map(l => l.sourceText)).toContain('Panel Left Line 2');

    // ตรวจสอบว่า Layer ID ของกลุ่มที่สองอ้างอิงไปยัง Right lines
    const rightGroupLayers = result.layers.filter(l => l.groupId === result.groups[1].id);
    expect(rightGroupLayers.map(l => l.sourceText)).toContain('Panel Right Line 1');
    expect(rightGroupLayers.map(l => l.sourceText)).toContain('Panel Right Line 2');
  });

  test('classifies tall or isolated short words as SFX and separates them from balloons', () => {
    // จำลองบทพูดบอลลูนยาว และตัวหนังสือ SFX สั้นตัวใหญ่ที่ลอยอยู่ใกล้กัน
    const ocrResult: OCRPageResult = {
      pageNumber: 1,
      width: 500,
      height: 500,
      dpi: 72,
      language: 'eng',
      algorithmVersion: 1,
      words: [],
      text: '',
      confidence: 90,
      lines: [
        {
          text: 'THIS GAME IS DIVIDED',
          bbox: { x0: 50, y0: 50, x1: 200, y1: 70 },
          confidence: 95,
          words: [],
        },
        {
          text: 'INTO THREE AREAS',
          bbox: { x0: 52, y0: 75, x1: 198, y1: 95 },
          confidence: 95,
          words: [],
        },
        {
          text: 'BOOM',
          bbox: { x0: 220, y0: 60, x1: 280, y1: 140 }, // SFX ชะลูดสูง (aspect ratio สูงมาก)
          confidence: 88,
          words: [],
        },
      ],
    };

    const result = buildLayerGroupsFromOCR(ocrResult);

    // ต้องแยกเป็น 2 กลุ่ม คือ Balloon (2 บรรทัดแรก) และ SFX (ตัวBOOM)
    expect(result.groups.length).toBe(2);

    const sfxGroup = result.groups.find(g => g.groupType === 'sfx');
    const balloonGroup = result.groups.find(g => g.groupType === 'balloon');

    expect(sfxGroup).toBeDefined();
    expect(balloonGroup).toBeDefined();

    expect(sfxGroup?.layerIds.length).toBe(1);
    expect(balloonGroup?.layerIds.length).toBe(2);
  });

  test('clamps inflated raw OCR line bounding boxes using the page median line height', () => {
    const ocrResult: OCRPageResult = {
      pageNumber: 1,
      width: 500,
      height: 500,
      dpi: 72,
      language: 'eng',
      algorithmVersion: 1,
      words: [],
      text: '',
      confidence: 90,
      lines: [
        {
          text: 'NORMAL LINE 1',
          bbox: { x0: 50, y0: 50, x1: 200, y1: 80 }, // height = 30
          confidence: 95,
          words: [],
        },
        {
          text: 'NORMAL LINE 2',
          bbox: { x0: 50, y0: 85, x1: 200, y1: 115 }, // height = 30
          confidence: 95,
          words: [],
        },
        {
          text: 'INFLATED LINE',
          bbox: { x0: 50, y0: 120, x1: 200, y1: 270 }, // height = 150 (inflated)
          confidence: 90,
          words: [],
        },
      ],
    };

    const result = buildLayerGroupsFromOCR(ocrResult);

    // Median height of first two lines is 30.
    // INFLATED LINE is height 150 which is > 2.5 * 30 (75).
    // So INFLATED LINE bbox should be clamped to height 30, centered at (120+270)/2 = 195.
    // Expected y0 = 195 - 15 = 180, expected y1 = 195 + 15 = 210.
    const inflatedLayer = result.layers.find(l => l.sourceText === 'INFLATED LINE');
    expect(inflatedLayer).toBeDefined();
    expect(inflatedLayer?.bbox.y0).toBe(180);
    expect(inflatedLayer?.bbox.y1).toBe(210);
  });

  test('separates cross-balloon lines when top line ends with sentence punctuation and overlap is minimal', () => {
    // จำลองสถานการณ์จริงจาก Webtoon page 5:
    // "BE THAT TYPE~" (y=4752-4787) ซ้อนทับ "CONSIDERING THE" (y=4783-4818) เพียง 4px
    // "BE THAT TYPE~" จบด้วย ~ ซึ่งเป็นเครื่องหมายจบประโยค
    // ดังนั้นต้องแยกเป็นคนละกลุ่ม เพื่อให้ "CONSIDERING THE" ไปอยู่กลุ่มเดียวกับ "KINDS OF AWFUL"
    const ocrResult: OCRPageResult = {
      pageNumber: 5,
      width: 960,
      height: 13540,
      dpi: 300,
      language: 'eng',
      algorithmVersion: 1,
      words: [],
      text: '',
      confidence: 90,
      lines: [
        {
          text: 'EXPECT AHN',
          bbox: { x0: 560, y0: 4684, x1: 720, y1: 4720 },
          confidence: 98,
          words: [],
        },
        {
          text: 'MIN-GYEOLTO',
          bbox: { x0: 555, y0: 4716, x1: 725, y1: 4752 },
          confidence: 99,
          words: [],
        },
        {
          text: 'BE THAT TYPE~',
          bbox: { x0: 550, y0: 4752, x1: 730, y1: 4787 }, // height=35, ends with ~
          confidence: 95,
          words: [],
        },
        {
          text: 'CONSIDERING THE',
          bbox: { x0: 563, y0: 4783, x1: 740, y1: 4818 }, // overlaps "BE THAT TYPE~" by 4px
          confidence: 99,
          words: [],
        },
        {
          text: 'KINDS OF AWFUL',
          bbox: { x0: 570, y0: 4830, x1: 735, y1: 4870 }, // height=40, normal
          confidence: 94,
          words: [],
        },
      ],
    };

    const result = buildLayerGroupsFromOCR(ocrResult);

    // "BE THAT TYPE~" ต้องอยู่คนละกลุ่มกับ "CONSIDERING THE"
    const typeLayer = result.layers.find(l => l.sourceText === 'BE THAT TYPE~');
    const consideringLayer = result.layers.find(l => l.sourceText === 'CONSIDERING THE');
    const kindsLayer = result.layers.find(l => l.sourceText === 'KINDS OF AWFUL');

    expect(typeLayer).toBeDefined();
    expect(consideringLayer).toBeDefined();
    expect(kindsLayer).toBeDefined();

    // "BE THAT TYPE~" ต้องอยู่กลุ่มเดียวกับ "EXPECT AHN" (ไม่ใช่กับ "CONSIDERING THE")
    expect(typeLayer!.groupId).not.toBe(consideringLayer!.groupId);

    // "CONSIDERING THE" ควรอยู่กลุ่มเดียวกับ "KINDS OF AWFUL"
    expect(consideringLayer!.groupId).toBe(kindsLayer!.groupId);
  });

  test('correctly groups Page 5 comic dialogue lines, clamps PaddleOCR coordinate shifts, and keeps adjacent speech balloons separated', () => {
    const ocrResult: OCRPageResult = {
      pageNumber: 5,
      width: 960,
      height: 13540,
      dpi: 300,
      language: 'eng',
      algorithmVersion: 1,
      words: [],
      text: '',
      confidence: 95,
      lines: [
        { text: "I DIDN'T", bbox: { x0: 560, y0: 4385, x1: 720, y1: 4412 }, confidence: 92.3, words: [] },
        { text: "EXPECT AHN", bbox: { x0: 560, y0: 4684, x1: 720, y1: 4720 }, confidence: 98.1, words: [] },
        { text: "MIN-GYEOLTO", bbox: { x0: 555, y0: 4716, x1: 725, y1: 4752 }, confidence: 99.2, words: [] },
        { text: "BE THAT TYPE~", bbox: { x0: 550, y0: 4752, x1: 730, y1: 4787 }, confidence: 95.5, words: [] },
        { text: "CONSIDERING THE", bbox: { x0: 563, y0: 4783, x1: 740, y1: 4818 }, confidence: 99.1, words: [] },
        { text: "KINDS OF AWFUL", bbox: { x0: 570, y0: 4815, x1: 735, y1: 4964 }, confidence: 94.3, words: [] },
        { text: "RUMORS FLOATING", bbox: { x0: 565, y0: 4830, x1: 730, y1: 4955 }, confidence: 97.8, words: [] },
        { text: "AROUND ABOUT HER.", bbox: { x0: 560, y0: 5412, x1: 745, y1: 5454 }, confidence: 97.9, words: [] },
        { text: "..THAT'S NOT SO ME THING", bbox: { x0: 550, y0: 5462, x1: 750, y1: 5503 }, confidence: 92.2, words: [] },
        { text: "ICAN SAY STRAIGHT TO", bbox: { x0: 555, y0: 5505, x1: 745, y1: 5550 }, confidence: 96.2, words: [] },
        { text: "HIS FACE.", bbox: { x0: 560, y0: 5558, x1: 730, y1: 5595 }, confidence: 98.3, words: [] }
      ]
    };

    const result = buildLayerGroupsFromOCR(ocrResult);
    
    // Group 3 should contain "CONSIDERING THE", "KINDS OF AWFUL", "RUMORS FLOATING", "AROUND ABOUT HER."
    const group3 = result.groups.find(g => g.layerIds.some(id => {
      const l = result.layers.find(layer => layer.id === id);
      return l?.sourceText === 'CONSIDERING THE';
    }));
    expect(group3).toBeDefined();
    expect(group3?.layerIds.length).toBe(4);
    
    // Group 4 should contain "..THAT'S NOT SO ME THING", "ICAN SAY STRAIGHT TO", "HIS FACE."
    const group4 = result.groups.find(g => g.layerIds.some(id => {
      const l = result.layers.find(layer => layer.id === id);
      return l?.sourceText === 'HIS FACE.';
    }));
    expect(group4).toBeDefined();
    expect(group4?.layerIds.length).toBe(3);
  });

  test('splitAggressiveMergedLines correctly splits cross-balloon lines with punctuation or capitalized words', () => {
    // 1. "FiTTiNG FOR" and "BEING" merged horizontal line simulation
    const lineFittingBeing = {
      text: 'FiTTiNG FOR BEING',
      confidence: 90,
      bbox: { x0: 10, y0: 100, x1: 200, y1: 120 },
      words: [
        { text: 'FiTTiNG', confidence: 90, bbox: { x0: 10, y0: 100, x1: 70, y1: 120 } },
        { text: 'FOR', confidence: 90, bbox: { x0: 75, y0: 100, x1: 110, y1: 120 } },
        { text: 'BEING', confidence: 90, bbox: { x0: 140, y0: 100, x1: 200, y1: 120 } }
      ]
    };
    // Gap between FOR (x1=110) and BEING (x0=140) is 30px.
    // Average word height is 20.
    // 30 / 20 = 1.5, which is > 0.9 (the capitalization multiplier), so it should split!
    // But it is < 2.2, so a fixed multiplier of 2.2 would NOT split it.
    
    const splitFittingBeing = splitAggressiveMergedLines([lineFittingBeing], 2.2);
    expect(splitFittingBeing.length).toBe(2);
    expect(splitFittingBeing[0].text).toBe('FiTTiNG FOR');
    expect(splitFittingBeing[1].text).toBe('BEING');

    // 1b. Real-world "FiTTiNG FOR BEING" from database (Doc 337 Page 21)
    const lineRealFittingBeing = {
      text: 'FiTTiNG FOR BEING',
      confidence: 90,
      bbox: { x0: 2718, y0: 4224, x1: 3584, y1: 4383 },
      words: [
        { text: 'FiTTiNG', confidence: 91, bbox: { x0: 2718, y0: 4236, x1: 3004.3, y1: 4327 } },
        { text: 'FOR', confidence: 91, bbox: { x0: 3004.3, y0: 4236, x1: 3127, y1: 4327 } },
        { text: 'BEING', confidence: 99, bbox: { x0: 3252, y0: 4224, x1: 3584, y1: 4383 } }
      ]
    };
    // Gap = 3252 - 3127 = 125. avgHeight = 125.
    // 125 / 125 = 1.0, which is > 0.98, so it should split!
    const splitRealFittingBeing = splitAggressiveMergedLines([lineRealFittingBeing], 2.2);
    expect(splitRealFittingBeing.length).toBe(2);
    expect(splitRealFittingBeing[0].text).toBe('FiTTiNG FOR');
    expect(splitRealFittingBeing[1].text).toBe('BEING');

    // 2. "YOu!" and "SLASHED" merged horizontal line simulation
    const lineYouSlashed = {
      text: 'YOu! SLASHED',
      confidence: 90,
      bbox: { x0: 10, y0: 100, x1: 150, y1: 120 },
      words: [
        { text: 'YOu!', confidence: 90, bbox: { x0: 10, y0: 100, x1: 60, y1: 120 } },
        { text: 'SLASHED', confidence: 90, bbox: { x0: 80, y0: 100, x1: 150, y1: 120 } }
      ]
    };
    // Gap between YOu! (x1=60) and SLASHED (x0=80) is 20px.
    // Average height is 20.
    // 20 / 20 = 1.0, which is > 0.85 (punctuation multiplier), so it should split!
    // But it is < 2.2, so a fixed multiplier of 2.2 would NOT split it.

    const splitYouSlashed = splitAggressiveMergedLines([lineYouSlashed], 2.2);
    expect(splitYouSlashed.length).toBe(2);
    expect(splitYouSlashed[0].text).toBe('YOu!');
    expect(splitYouSlashed[1].text).toBe('SLASHED');

    // 3. Normal line "BUT IM SURE" (not to be split)
    const normalLine = {
      text: 'BUT IM SURE',
      confidence: 95,
      bbox: { x0: 10, y0: 100, x1: 150, y1: 120 },
      words: [
        { text: 'BUT', confidence: 95, bbox: { x0: 10, y0: 100, x1: 45, y1: 120 } },
        { text: 'IM', confidence: 95, bbox: { x0: 52, y0: 100, x1: 80, y1: 120 } },
        { text: 'SURE', confidence: 95, bbox: { x0: 88, y0: 100, x1: 150, y1: 120 } }
      ]
    };
    // 4. Hyphenated word "ONE-ON-ONE" (not to be split)
    const hyphenatedLine = {
      text: 'A ONE-ON-ONE BATTLE!',
      confidence: 95,
      bbox: { x0: 10, y0: 100, x1: 220, y1: 120 },
      words: [
        { text: 'A', confidence: 95, bbox: { x0: 10, y0: 100, x1: 20, y1: 120 } },
        { text: 'ONE-ON-', confidence: 95, bbox: { x0: 25, y0: 100, x1: 95, y1: 120 } },
        { text: 'ONE', confidence: 95, bbox: { x0: 105, y0: 100, x1: 140, y1: 120 } },
        { text: 'BATTLE!', confidence: 95, bbox: { x0: 145, y0: 100, x1: 220, y1: 120 } }
      ]
    };
    // Gap between ONE-ON- and ONE is 10px, avgHeight = 20.
    // Ratio = 0.5. Hyphen prevents split because multiplier is 2.5.
    // Even if ONE starts with a capital letter, it shouldn't split.
    const splitHyphenated = splitAggressiveMergedLines([hyphenatedLine], 2.2);
    expect(splitHyphenated.length).toBe(1);
    expect(splitHyphenated[0].text).toBe('A ONE-ON- ONE BATTLE!');
  });

  test('does not group FITTING FOR (left) and BEING (right) into the same group', () => {
    const ocrResult: OCRPageResult = {
      pageNumber: 1,
      width: 500,
      height: 500,
      dpi: 72,
      language: 'eng',
      algorithmVersion: 1,
      words: [],
      text: '',
      confidence: 90,
      lines: [
        // Left column
        { text: 'HEHEHE!', bbox: { x0: 80, y0: 50, x1: 170, y1: 70 }, confidence: 90, words: [] },
        { text: 'THIS TIME,', bbox: { x0: 70, y0: 75, x1: 180, y1: 95 }, confidence: 90, words: [] },
        { text: "WE'LL", bbox: { x0: 95, y0: 100, x1: 155, y1: 120 }, confidence: 90, words: [] },
        { text: 'PIERCE', bbox: { x0: 85, y0: 125, x1: 165, y1: 145 }, confidence: 90, words: [] },
        { text: 'A PLACE', bbox: { x0: 80, y0: 150, x1: 170, y1: 170 }, confidence: 90, words: [] },
        { text: "THAT'S", bbox: { x0: 90, y0: 175, x1: 160, y1: 195 }, confidence: 90, words: [] },
        { text: 'FITTING FOR', bbox: { x0: 60, y0: 200, x1: 190, y1: 220 }, confidence: 90, words: [] },
        { text: 'A PIG LIKE', bbox: { x0: 70, y0: 225, x1: 180, y1: 245 }, confidence: 90, words: [] },
        { text: 'YOU!', bbox: { x0: 90, y0: 250, x1: 160, y1: 270 }, confidence: 90, words: [] },

        // Right column
        { text: 'ARE', bbox: { x0: 280, y0: 100, x1: 340, y1: 120 }, confidence: 90, words: [] },
        { text: 'ALL', bbox: { x0: 280, y0: 130, x1: 340, y1: 150 }, confidence: 90, words: [] },
        { text: 'BEING', bbox: { x0: 160, y0: 200, x1: 240, y1: 220 }, confidence: 90, words: [] },
        { text: 'SLASHED', bbox: { x0: 260, y0: 225, x1: 360, y1: 245 }, confidence: 90, words: [] },
        { text: 'BY', bbox: { x0: 280, y0: 250, x1: 330, y1: 270 }, confidence: 90, words: [] },
        { text: 'COO', bbox: { x0: 270, y0: 250, x1: 340, y1: 270 }, confidence: 90, words: [] },
        { text: 'OOO', bbox: { x0: 270, y0: 275, x1: 340, y1: 295 }, confidence: 90, words: [] },
        { text: 'OCKS', bbox: { x0: 265, y0: 300, x1: 345, y1: 320 }, confidence: 90, words: [] },
        { text: '!!', bbox: { x0: 290, y0: 325, x1: 320, y1: 345 }, confidence: 90, words: [] },
      ],
    };

    const result = buildLayerGroupsFromOCR(ocrResult);

    // Left column and Right column must not be in the same group!
    const fittingLayer = result.layers.find(l => l.sourceText === 'FITTING FOR');
    const beingLayer = result.layers.find(l => l.sourceText === 'BEING');

    expect(fittingLayer).toBeDefined();
    expect(beingLayer).toBeDefined();
    expect(fittingLayer!.groupId).not.toBe(beingLayer!.groupId);
  });

  test('splitAggressiveMergedLines splits horizontal bridge lines based on vertical gutter projection', () => {
    // 2 normal lines defining a left column (x0: 100, x1: 200)
    // 2 normal lines defining a right column (x0: 350, x1: 450)
    // 1 bridge line spanning from 100 to 450: "ONE OPPONENT BATTLE WITH"
    const lines: OCRLine[] = [
      {
        text: 'LEFT COLUMN TOP',
        bbox: { x0: 100, y0: 50, x1: 200, y1: 70 },
        confidence: 90,
        words: [],
      },
      {
        text: 'LEFT COLUMN BOTTOM',
        bbox: { x0: 100, y0: 150, x1: 200, y1: 170 },
        confidence: 90,
        words: [],
      },
      {
        text: 'RIGHT COLUMN TOP',
        bbox: { x0: 350, y0: 50, x1: 450, y1: 70 },
        confidence: 90,
        words: [],
      },
      {
        text: 'RIGHT COLUMN BOTTOM',
        bbox: { x0: 350, y0: 150, x1: 450, y1: 170 },
        confidence: 90,
        words: [],
      },
      {
        text: 'ONE OPPONENT BATTLE WITH',
        bbox: { x0: 100, y0: 100, x1: 450, y1: 120 },
        confidence: 90,
        words: [],
      },
    ];

    const result = splitAggressiveMergedLines(lines, 2.2);

    // The bridge line should be split, so total lines should increase to 6 (left/right normal + 2 split halves of the bridge)
    expect(result.length).toBe(6);

    const splitLeft = result.find(l => l.text === 'ONE OPPONENT');
    const splitRight = result.find(l => l.text === 'BATTLE WITH');

    expect(splitLeft).toBeDefined();
    expect(splitRight).toBeDefined();

    // Check that the left split box is clipped to not cross the gutter (x1 should be <= 201)
    expect(splitLeft!.bbox.x0).toBeGreaterThanOrEqual(100);
    expect(splitLeft!.bbox.x1).toBeLessThanOrEqual(201);

    // Check that the right split box is clipped to not cross the gutter (x0 should be >= 350)
    expect(splitRight!.bbox.x0).toBeGreaterThanOrEqual(350);
    expect(splitRight!.bbox.x1).toBeLessThanOrEqual(450);
  });

  test('correctly groups short English dialogue lines like "But" and "in any" and "age..." into a single group', () => {
    const ocrResult: OCRPageResult = {
      pageNumber: 1,
      width: 800,
      height: 1200,
      dpi: 300,
      language: 'eng',
      algorithmVersion: 1,
      words: [],
      text: '',
      confidence: 90,
      lines: [
        {
          text: 'But',
          bbox: { x0: 200, y0: 100, x1: 280, y1: 130 },
          confidence: 92,
          words: [],
        },
        {
          text: 'in any',
          bbox: { x0: 180, y0: 160, x1: 300, y1: 190 },
          confidence: 93,
          words: [],
        },
        {
          text: 'age...',
          bbox: { x0: 190, y0: 220, x1: 290, y1: 250 },
          confidence: 91,
          words: [],
        },
      ],
    };

    const result = buildLayerGroupsFromOCR(ocrResult);

    expect(result.layers.length).toBe(3);
    const g0 = result.layers[0].groupId;
    const g1 = result.layers[1].groupId;
    const g2 = result.layers[2].groupId;

    expect(g0).toBeDefined();
    expect(g0).toBe(g1);
    expect(g0).toBe(g2);
  });
});



