import { describe, it, expect } from 'vitest';
import { isLikelyGhostTranslatableLine } from './ocrTextHeuristics';
import { OCRLine } from '../../types';

describe('OCR Ghost Line Safety Gate Tests', () => {
  it('should not filter out high-confidence shout words like HHH!', () => {
    // จำลองคำตะโกน HHH! ที่มีขนาดใหญ่ (area >= 12000)
    // แต่มีตัวอักษรน้อย (compact.length <= 14) และ area/len >= 1200
    // ซึ่งปกติจะตกเป็น Ghost Line (isSparseSfxBox === true)
    const line: OCRLine = {
      text: 'HHH!',
      confidence: 94,
      bbox: { x0: 100, y0: 100, x1: 300, y1: 200 }, // width=200, height=100, area=20000
      words: [
        { text: 'HHH!', confidence: 94, bbox: { x0: 100, y0: 100, x1: 300, y1: 200 } }
      ]
    };

    // ก่อนการแก้ไข: คำนี้จะถูกมองว่าเป็น Ghost Line (isLikelyGhostTranslatableLine => true)
    // หลังการแก้ไข: เนื่องจาก avgConfidence = 94 (>= 90) และมีตัวอักษร "HHH" จึงเป็น false
    const isGhost = isLikelyGhostTranslatableLine(line, 'HHH!', 'paddleocr', 1200, 1200);
    expect(isGhost).toBe(false);
  });

  it('should still filter out pure vertical line junk or symbol noise even with high confidence', () => {
    const line: OCRLine = {
      text: '|||',
      confidence: 98,
      bbox: { x0: 100, y0: 100, x1: 120, y1: 200 }, // width=20, height=100
      words: [
        { text: '|||', confidence: 98, bbox: { x0: 100, y0: 100, x1: 120, y1: 200 } }
      ]
    };

    const isGhost = isLikelyGhostTranslatableLine(line, '|||', 'paddleocr', 1200, 1200);
    expect(isGhost).toBe(true); // ต้องเป็น true เพราะเป็น symbol noise
  });
});
