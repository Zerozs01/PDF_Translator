import { describe, expect, test } from 'vitest';
import { buildLayerGroupsFromOCR } from './LayerGroupingService';
import type { OCRPageResult } from '../../types';

describe('LayerGroupingService Spatial Clustering', () => {
  test('separates side-by-side columns or two-panel layouts even at the same Y level', () => {
    // จำลองหน้าการ์ตูนที่มี 2 Panels (ซ้าย และ ขวา)
    // Panel 1 (ซ้าย): x(10-200), y(100-120) และ y(125-145)
    // Panel 2 (ขวา): x(300-490), y(105-125) และ y(130-150)
    // ทั้งสองคอลัมน์อยู่ระดับ Y ใกล้กันมาก แต่ห่างกันทางแกน X (ไม่มี Horizontal Overlap)
    const ocrResult: OCRPageResult = {
      width: 500,
      height: 500,
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
      width: 500,
      height: 500,
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
});
