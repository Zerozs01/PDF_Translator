import { BBox, OCRLine } from '../../../types';
import type { OverlayPalette } from './overlayTypes';
import { resolveOverlayMaskBBox } from './overlayGeometry';

export const DEFAULT_OVERLAY_PALETTE: OverlayPalette = {
  textColor: '#0f172a',
  backgroundColor: '#ffffff',
  borderColor: 'transparent',
  sourceConfidence: 1,
};

type RGB = { r: number; g: number; b: number };

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const luminance = (rgb: RGB): number => {
  const a = [rgb.r, rgb.g, rgb.b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
};

const contrastRatio = (a: RGB, b: RGB): number => {
  const lumA = luminance(a);
  const lumB = luminance(b);
  const brightest = Math.max(lumA, lumB);
  const darkest = Math.min(lumA, lumB);
  return (brightest + 0.05) / (darkest + 0.05);
};

const blendRgb = (base: RGB, top: RGB, alpha: number): RGB => ({
  r: Math.round(base.r * (1 - alpha) + top.r * alpha),
  g: Math.round(base.g * (1 - alpha) + top.g * alpha),
  b: Math.round(base.b * (1 - alpha) + top.b * alpha),
});

const chooseReadablePair = (rawBackground: RGB): { bg: RGB; text: RGB } => {
  const white: RGB = { r: 248, g: 250, b: 252 };
  const black: RGB = { r: 12, g: 14, b: 18 };

  const max = Math.max(rawBackground.r, rawBackground.g, rawBackground.b);
  const min = Math.min(rawBackground.r, rawBackground.g, rawBackground.b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  const rawLuminance = luminance(rawBackground);

  let background = rawBackground;
  if (rawLuminance > 0.94 && saturation < 0.08) {
    background = { r: 255, g: 255, b: 255 };
  }

  let bestText = contrastRatio(background, black) >= contrastRatio(background, white) ? black : white;
  let bestContrast = contrastRatio(background, bestText);

  for (let i = 0; i < 4 && bestContrast < 4.5; i += 1) {
    if (bestText === black) {
      background = blendRgb(background, { r: 255, g: 255, b: 255 }, 0.16);
    } else {
      background = blendRgb(background, { r: 0, g: 0, b: 0 }, 0.16);
    }
    bestText = contrastRatio(background, black) >= contrastRatio(background, white) ? black : white;
    bestContrast = contrastRatio(background, bestText);
  }

  return { bg: background, text: bestText };
};

const rgbToHex = (c: RGB): string => {
  const toHex = (n: number) => clamp(n, 0, 255).toString(16).padStart(2, '0');
  return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`;
};

export const sampleOverlayPaletteFromBbox = (
  canvas: HTMLCanvasElement | null,
  bbox: BBox
): OverlayPalette => {
  if (!canvas) {
    return DEFAULT_OVERLAY_PALETTE;
  }

  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return DEFAULT_OVERLAY_PALETTE;

    const x = Math.max(0, Math.floor(bbox.x0));
    const y = Math.max(0, Math.floor(bbox.y0));
    const w = Math.min(canvas.width - x, Math.ceil(bbox.x1 - bbox.x0));
    const h = Math.min(canvas.height - y, Math.ceil(bbox.y1 - bbox.y0));

    if (w <= 0 || h <= 0) return DEFAULT_OVERLAY_PALETTE;

    const imgData = ctx.getImageData(x, y, w, h);
    const { data } = imgData;

    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let count = 0;

    // Sample border pixels for background estimate
    for (let col = 0; col < w; col += 2) {
      const topIdx = (0 * w + col) * 4;
      const botIdx = ((h - 1) * w + col) * 4;
      rSum += data[topIdx] + data[botIdx];
      gSum += data[topIdx + 1] + data[botIdx + 1];
      bSum += data[topIdx + 2] + data[botIdx + 2];
      count += 2;
    }

    if (count === 0) return DEFAULT_OVERLAY_PALETTE;

    const avgBg: RGB = {
      r: Math.round(rSum / count),
      g: Math.round(gSum / count),
      b: Math.round(bSum / count),
    };

    const { bg, text } = chooseReadablePair(avgBg);

    return {
      backgroundColor: rgbToHex(bg),
      textColor: rgbToHex(text),
      borderColor: 'transparent',
      sourceConfidence: 0.9,
    };
  } catch (err) {
    return DEFAULT_OVERLAY_PALETTE;
  }
};

export const sampleOverlayPaletteFromLine = (
  canvas: HTMLCanvasElement | null,
  line: OCRLine
): OverlayPalette => {
  const maskBbox = resolveOverlayMaskBBox(line);
  return sampleOverlayPaletteFromBbox(canvas, maskBbox);
};
