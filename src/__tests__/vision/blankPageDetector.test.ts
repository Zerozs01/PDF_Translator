import { describe, it, expect } from 'vitest';
import {
  isImageDataBlankOrSolid,
  detectBlankOrSolidCanvas,
  THUMBNAIL_SIZE,
} from '../../services/vision/blankPageDetector';

describe('isImageDataBlankOrSolid', () => {
  it('identifies pure white buffer as blank', () => {
    const totalPixels = 1000;
    const data = new Uint8ClampedArray(totalPixels * 4);
    data.fill(255);

    const res = isImageDataBlankOrSolid(data, totalPixels);
    expect(res.isBlank).toBe(true);
    expect(res.maxDeviation).toBe(0);
    expect(res.baseColor).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('identifies pure black buffer as blank', () => {
    const totalPixels = 1000;
    const data = new Uint8ClampedArray(totalPixels * 4);
    // Fill all with 0 (opaque alpha)
    for (let i = 0; i < totalPixels; i++) {
      data[i * 4] = 0;
      data[i * 4 + 1] = 0;
      data[i * 4 + 2] = 0;
      data[i * 4 + 3] = 255;
    }

    const res = isImageDataBlankOrSolid(data, totalPixels);
    expect(res.isBlank).toBe(true);
    expect(res.maxDeviation).toBe(0);
    expect(res.baseColor).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('identifies uniform solid gray buffer with small noise (<= 4) as blank', () => {
    const totalPixels = 100;
    const data = new Uint8ClampedArray(totalPixels * 4);
    for (let i = 0; i < totalPixels; i++) {
      data[i * 4] = 240 + (i % 3); // 240, 241, 242 (deviation <= 2)
      data[i * 4 + 1] = 240 + (i % 3);
      data[i * 4 + 2] = 240 + (i % 3);
      data[i * 4 + 3] = 255;
    }

    const res = isImageDataBlankOrSolid(data, totalPixels);
    expect(res.isBlank).toBe(true);
    expect(res.maxDeviation).toBeLessThanOrEqual(4);
  });

  it('detects text or high contrast pixels and returns isBlank = false', () => {
    const totalPixels = 1000;
    const data = new Uint8ClampedArray(totalPixels * 4);
    data.fill(255); // White page

    // Place some black text pixels
    data[500 * 4] = 0;
    data[500 * 4 + 1] = 0;
    data[500 * 4 + 2] = 0;

    const res = isImageDataBlankOrSolid(data, totalPixels);
    expect(res.isBlank).toBe(false);
    expect(res.maxDeviation).toBe(255);
  });

  it('handles empty or zero-length buffer gracefully', () => {
    const data = new Uint8ClampedArray(0);
    const res = isImageDataBlankOrSolid(data, 0);
    expect(res.isBlank).toBe(true);
  });
});

describe('detectBlankOrSolidCanvas', () => {
  it('handles null/undefined/zero canvas in Node/SSR environment gracefully', () => {
    const res = detectBlankOrSolidCanvas(null as any);
    expect(res.isBlank).toBe(true);
  });
});
