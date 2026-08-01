/**
 * Utility service to sample dominant text/background colors from canvas regions
 * for natural contrast rendering during PDF and image exports.
 */

export interface ColorRGB {
  r: number;
  g: number;
  b: number;
}

export interface SampledPalette {
  textColor: string;
  backgroundColor: string;
}

export function sampleRegionPalette(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number
): SampledPalette {
  try {
    const clampedX = Math.max(0, Math.floor(x));
    const clampedY = Math.max(0, Math.floor(y));
    const clampedW = Math.min(ctx.canvas.width - clampedX, Math.ceil(width));
    const clampedH = Math.min(ctx.canvas.height - clampedY, Math.ceil(height));

    if (clampedW <= 0 || clampedH <= 0) {
      return { textColor: '#000000', backgroundColor: '#ffffff' };
    }

    const imageData = ctx.getImageData(clampedX, clampedY, clampedW, clampedH);
    const data = imageData.data;
    let totalR = 0, totalG = 0, totalB = 0;
    let sampleCount = 0;

    // Sample every 4th pixel for performance
    for (let i = 0; i < data.length; i += 16) {
      totalR += data[i];
      totalG += data[i + 1];
      totalB += data[i + 2];
      sampleCount++;
    }

    if (sampleCount === 0) {
      return { textColor: '#000000', backgroundColor: '#ffffff' };
    }

    const avgR = totalR / sampleCount;
    const avgG = totalG / sampleCount;
    const avgB = totalB / sampleCount;

    // Relative luminance
    const luminance = (0.299 * avgR + 0.587 * avgG + 0.114 * avgB) / 255;

    // Dark background -> white text, light background -> dark text
    if (luminance < 0.5) {
      return {
        textColor: '#FFFFFF',
        backgroundColor: `rgb(${Math.round(avgR)}, ${Math.round(avgG)}, ${Math.round(avgB)})`,
      };
    } else {
      return {
        textColor: '#000000',
        backgroundColor: `rgb(${Math.round(avgR)}, ${Math.round(avgG)}, ${Math.round(avgB)})`,
      };
    }
  } catch (err) {
    return { textColor: '#000000', backgroundColor: '#ffffff' };
  }
}
