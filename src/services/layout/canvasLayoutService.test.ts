import { describe, it, expect } from 'vitest';
import {
  computeInscribedEllipseLineWidth,
  computeInscribedDiamondLineWidth,
  estimateBalloonFontSize,
  wrapCanvasText,
  truncateCanvasText,
} from './canvasLayoutService';

describe('canvasLayoutService - Balloon Constraints & Math', () => {
  describe('computeInscribedEllipseLineWidth', () => {
    it('returns middle line wider than top and bottom lines for 3 lines', () => {
      const boxWidth = 200;
      const boxHeight = 300;
      const totalLines = 3;

      const topWidth = computeInscribedEllipseLineWidth(boxWidth, boxHeight, 0, totalLines);
      const middleWidth = computeInscribedEllipseLineWidth(boxWidth, boxHeight, 1, totalLines);
      const bottomWidth = computeInscribedEllipseLineWidth(boxWidth, boxHeight, 2, totalLines);

      // บรรทัดกลาง (index 1) ต้องกว้างกว่าบรรทัดบนสุด (index 0) และล่างสุด (index 2)
      expect(middleWidth).toBeGreaterThan(topWidth);
      expect(middleWidth).toBeGreaterThan(bottomWidth);

      // ความสมมาตรของวงรี: บรรทัดบนสุดและล่างสุดต้องกว้างเท่ากัน
      expect(topWidth).toBe(bottomWidth);
    });

    it('handles single line without crashing and applies padding', () => {
      const width = computeInscribedEllipseLineWidth(200, 100, 0, 1, 0.1);
      // 200 * (1 - 0.2) = 160
      expect(width).toBe(160);
    });

    it('respects minimum width ratio floor', () => {
      const width = computeInscribedEllipseLineWidth(200, 200, 0, 10, 0.08, 0.4);
      const minAllowed = Math.round(200 * 0.84 * 0.4);
      expect(width).toBeGreaterThanOrEqual(minAllowed);
    });
  });

  describe('computeInscribedDiamondLineWidth', () => {
    it('calculates linear decrease from center to edges', () => {
      const boxWidth = 200;
      const boxHeight = 300;
      const totalLines = 5;

      const edgeWidth = computeInscribedDiamondLineWidth(boxWidth, boxHeight, 0, totalLines);
      const centerWidth = computeInscribedDiamondLineWidth(boxWidth, boxHeight, 2, totalLines);

      expect(centerWidth).toBeGreaterThan(edgeWidth);
    });
  });

  describe('estimateBalloonFontSize', () => {
    it('computes smaller font for longer text within same box', () => {
      const boxWidth = 150;
      const boxHeight = 200;

      const shortSize = estimateBalloonFontSize('สวัสดี', boxWidth, boxHeight);
      const longSize = estimateBalloonFontSize('สวัสดีครับ วันนี้มีเรื่องสำคัญจะมาบอกทุกคนในห้องนี้', boxWidth, boxHeight);

      expect(shortSize).toBeGreaterThan(longSize);
      expect(longSize).toBeGreaterThanOrEqual(10); // min bound
    });

    it('computes execution in less than 1 ms', () => {
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        estimateBalloonFontSize('ข้อความทดสอบความเร็วในบอลลูนคำพูดมังงะ', 200, 300);
      }
      const duration = performance.now() - start;
      const avgPerCall = duration / 100;
      expect(avgPerCall).toBeLessThan(1); // < 1ms
    });
  });

  describe('truncateCanvasText and wrapCanvasText', () => {
    const mockCtx = {
      measureText: (str: string) => ({ width: str.length * 10 }),
    } as unknown as CanvasRenderingContext2D;

    it('truncates text with suffix when exceeding maxWidth', () => {
      const truncated = truncateCanvasText(mockCtx, '1234567890', 50, '...');
      expect(mockCtx.measureText(truncated).width).toBeLessThanOrEqual(50);
      expect(truncated.endsWith('...')).toBe(true);
    });

    it('wraps text into multiple lines within maxWidth', () => {
      const lines = wrapCanvasText(mockCtx, 'Hello World From IDE Test Run', 100, 5, false);
      expect(lines.length).toBeGreaterThan(1);
      lines.forEach((l) => {
        expect(mockCtx.measureText(l).width).toBeLessThanOrEqual(100);
      });
    });
  });
});
