/**
 * OCR Preprocessing — image loading, validation, binarization
 */

import { CONFIG } from './ocr-config';

interface TileStats {
  means: Float32Array;
  stds: Float32Array;
  cols: number;
  rows: number;
  meanSpread: number;
}

function computeOtsuThreshold(grayData: Uint8ClampedArray): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < grayData.length; i++) hist[grayData[i]] += 1;

  const total = grayData.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 128;

  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) * (mB - mF);
    if (varBetween > maxVar) {
      maxVar = varBetween;
      threshold = i;
    }
  }

  return threshold;
}

function computeTileStats(grayData: Uint8ClampedArray, width: number, height: number, tileSize: number): TileStats {
  const cols = Math.max(1, Math.ceil(width / tileSize));
  const rows = Math.max(1, Math.ceil(height / tileSize));
  const sum = new Float64Array(cols * rows);
  const sumSq = new Float64Array(cols * rows);
  const count = new Uint32Array(cols * rows);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    const rowTile = Math.floor(y / tileSize) * cols;
    for (let x = 0; x < width; x++) {
      const tileIndex = rowTile + Math.floor(x / tileSize);
      const value = grayData[rowOffset + x];
      sum[tileIndex] += value;
      sumSq[tileIndex] += value * value;
      count[tileIndex] += 1;
    }
  }

  const means = new Float32Array(cols * rows);
  const stds = new Float32Array(cols * rows);
  let minMean = 255;
  let maxMean = 0;

  for (let i = 0; i < means.length; i++) {
    const c = Math.max(1, count[i]);
    const mean = sum[i] / c;
    const variance = Math.max(0, (sumSq[i] / c) - (mean * mean));
    means[i] = mean;
    stds[i] = Math.sqrt(variance);
    if (mean < minMean) minMean = mean;
    if (mean > maxMean) maxMean = mean;
  }

  return {
    means,
    stds,
    cols,
    rows,
    meanSpread: maxMean - minMean,
  };
}

function computeCenterMean(grayData: Uint8ClampedArray, width: number, height: number): number {
  const x0 = Math.floor(width * 0.2);
  const x1 = Math.ceil(width * 0.8);
  const y0 = Math.floor(height * 0.2);
  const y1 = Math.ceil(height * 0.8);
  let sum = 0;
  let count = 0;

  for (let y = y0; y < y1; y++) {
    const rowOffset = y * width;
    for (let x = x0; x < x1; x++) {
      sum += grayData[rowOffset + x];
      count += 1;
    }
  }

  return count > 0 ? sum / count : 255;
}

function cleanDarkBorders(grayData: Uint8ClampedArray, width: number, height: number): void {
  if (!CONFIG.PREPROCESS_ENABLE_BORDER_CLEANUP || width < 32 || height < 32) return;

  const centerMean = computeCenterMean(grayData, width, height);
  const darkThreshold = Math.min(
    CONFIG.PREPROCESS_BORDER_DARK_MEAN_MAX,
    centerMean - CONFIG.PREPROCESS_BORDER_CENTER_DELTA_MIN
  );
  if (!Number.isFinite(darkThreshold) || darkThreshold <= 24) return;

  const maxBand = Math.max(2, Math.min(48, Math.round(Math.min(width, height) * CONFIG.PREPROCESS_BORDER_MAX_RATIO)));
  const scanSpanX0 = Math.floor(width * 0.08);
  const scanSpanX1 = Math.ceil(width * 0.92);
  const scanSpanY0 = Math.floor(height * 0.08);
  const scanSpanY1 = Math.ceil(height * 0.92);

  const rowMean = (y: number): number => {
    let sum = 0;
    let count = 0;
    const rowOffset = y * width;
    for (let x = scanSpanX0; x < scanSpanX1; x++) {
      sum += grayData[rowOffset + x];
      count += 1;
    }
    return count > 0 ? sum / count : 255;
  };

  const colMean = (x: number): number => {
    let sum = 0;
    let count = 0;
    for (let y = scanSpanY0; y < scanSpanY1; y++) {
      sum += grayData[y * width + x];
      count += 1;
    }
    return count > 0 ? sum / count : 255;
  };

  const detectBand = (length: number, sample: (index: number) => number): number => {
    let band = 0;
    let grace = 0;
    const limit = Math.min(length, maxBand);
    for (let i = 0; i < limit; i++) {
      const mean = sample(i);
      const darkEnough = mean <= darkThreshold;
      if (darkEnough) {
        band = i + 1;
        grace = 1;
        continue;
      }
      if (grace > 0 && mean <= darkThreshold + 10) {
        grace -= 1;
        band = i + 1;
        continue;
      }
      break;
    }
    return band;
  };

  const topBand = detectBand(height, rowMean);
  const bottomBand = detectBand(height, (index) => rowMean(height - 1 - index));
  const leftBand = detectBand(width, colMean);
  const rightBand = detectBand(width, (index) => colMean(width - 1 - index));

  if (topBand > 0) {
    for (let y = 0; y < topBand; y++) {
      grayData.fill(255, y * width, (y + 1) * width);
    }
  }
  if (bottomBand > 0) {
    for (let y = height - bottomBand; y < height; y++) {
      grayData.fill(255, y * width, (y + 1) * width);
    }
  }
  if (leftBand > 0 || rightBand > 0) {
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;
      for (let x = 0; x < leftBand; x++) grayData[rowOffset + x] = 255;
      for (let x = width - rightBand; x < width; x++) {
        if (x >= 0) grayData[rowOffset + x] = 255;
      }
    }
  }
}

function shouldUseAdaptiveBinarization(contrastRange: number, tileStats: TileStats): boolean {
  if (!CONFIG.PREPROCESS_ADAPTIVE_BINARIZE) return false;
  return contrastRange <= CONFIG.PREPROCESS_ADAPTIVE_LOW_CONTRAST_RANGE
    || tileStats.meanSpread >= CONFIG.PREPROCESS_ADAPTIVE_TILE_MEAN_SPREAD;
}

function computeGrayRange(grayData: Uint8ClampedArray): number {
  let min = 255;
  let max = 0;
  for (let i = 0; i < grayData.length; i++) {
    const value = grayData[i];
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return Math.max(0, max - min);
}

function buildBinaryMask(grayData: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const tileSize = Math.max(24, CONFIG.PREPROCESS_ADAPTIVE_TILE_SIZE);
  const tileStats = computeTileStats(grayData, width, height, tileSize);
  const contrastRange = computeGrayRange(grayData);
  const useAdaptive = shouldUseAdaptiveBinarization(contrastRange, tileStats);
  const binary = new Uint8Array(width * height);

  if (useAdaptive) {
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;
      const tileRow = Math.min(tileStats.rows - 1, Math.floor(y / tileSize)) * tileStats.cols;
      for (let x = 0; x < width; x++) {
        const index = rowOffset + x;
        const tileIndex = tileRow + Math.min(tileStats.cols - 1, Math.floor(x / tileSize));
        const mean = tileStats.means[tileIndex];
        const std = tileStats.stds[tileIndex];
        const bias = Math.max(CONFIG.PREPROCESS_ADAPTIVE_BASE_BIAS, std * CONFIG.PREPROCESS_ADAPTIVE_STD_WEIGHT);
        const threshold = Math.max(32, Math.min(224, mean - bias));
        binary[index] = grayData[index] <= threshold ? 1 : 0;
      }
    }
  } else {
    const threshold = computeOtsuThreshold(grayData);
    for (let i = 0; i < grayData.length; i++) {
      binary[i] = grayData[i] <= threshold ? 1 : 0;
    }
  }

  return binary;
}

function repairBinaryMask(binary: Uint8Array, width: number, height: number): Uint8Array {
  if (!CONFIG.PREPROCESS_ENABLE_BINARY_REPAIR || width < 3 || height < 3) return binary;

  const repaired = binary.slice();
  for (let y = 1; y < height - 1; y++) {
    const rowOffset = y * width;
    for (let x = 1; x < width - 1; x++) {
      const index = rowOffset + x;
      const left = binary[index - 1];
      const right = binary[index + 1];
      const up = binary[index - width];
      const down = binary[index + width];
      const upLeft = binary[index - width - 1];
      const upRight = binary[index - width + 1];
      const downLeft = binary[index + width - 1];
      const downRight = binary[index + width + 1];
      const neighbors = left + right + up + down + upLeft + upRight + downLeft + downRight;

      if (binary[index] === 0) {
        const bridgesStroke = (left === 1 && right === 1) || (up === 1 && down === 1) || neighbors >= 6;
        if (bridgesStroke) repaired[index] = 1;
      } else if (neighbors <= 1) {
        repaired[index] = 0;
      }
    }
  }
  return repaired;
}

/**
 * Preprocess image: Load, validate, and re-render through canvas.
 * Fixes corrupted JPEG issues and ensures proper dimensions.
 * NOTE: Uses fetch + createImageBitmap because Image is not available in Workers.
 */
export async function preprocessImage(
  imageUrl: string | Blob,
  options: { binarize?: boolean; returnGray?: boolean } = {}
): Promise<{
  image: Blob;
  width: number;
  height: number;
  gray?: Uint8ClampedArray;
}> {
  try {
    const blob = typeof imageUrl === 'string'
      ? await (await fetch(imageUrl)).blob()
      : imageUrl;

    const imageBitmap = await createImageBitmap(blob);
    const width = imageBitmap.width;
    const height = imageBitmap.height;

    if (width < 10 || height < 10) {
      imageBitmap.close();
      throw new Error(`Image too small: ${width}x${height}`);
    }

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      imageBitmap.close();
      throw new Error('Failed to create canvas context');
    }

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(imageBitmap, 0, 0, width, height);
    imageBitmap.close();

    let gray: Uint8ClampedArray | undefined;
    if (options.binarize || options.returnGray) {
      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;
      const grayData = new Uint8ClampedArray(width * height);

      let min = 255;
      let max = 0;
      for (let i = 0, p = 0; i < grayData.length; i++, p += 4) {
        const r = data[p];
        const g = data[p + 1];
        const b = data[p + 2];
        const v = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
        grayData[i] = v;
        if (v < min) min = v;
        if (v > max) max = v;
      }

      // Contrast stretch
      const range = Math.max(1, max - min);
      const scale = 255 / range;
      for (let i = 0; i < grayData.length; i++) {
        grayData[i] = Math.max(0, Math.min(255, ((grayData[i] - min) * scale) | 0));
      }

      cleanDarkBorders(grayData, width, height);

      if (options.binarize) {
        const binary = repairBinaryMask(buildBinaryMask(grayData, width, height), width, height);
        for (let i = 0, p = 0; i < grayData.length; i++, p += 4) {
          const v = binary[i] === 1 ? 0 : 255;
          data[p] = v;
          data[p + 1] = v;
          data[p + 2] = v;
          data[p + 3] = 255;
        }
      } else {
        for (let i = 0, p = 0; i < grayData.length; i++, p += 4) {
          const v = grayData[i];
          data[p] = v;
          data[p + 1] = v;
          data[p + 2] = v;
          data[p + 3] = 255;
        }
      }

      ctx.putImageData(imageData, 0, 0);
      gray = grayData;
    }

    const outputBlob = await canvas.convertToBlob({ type: 'image/png' });
    return { image: outputBlob, width, height, gray };
  } catch (error) {
    console.error('[Preprocess] error:', error);
    throw error;
  }
}

/**
 * Get image dimensions using createImageBitmap (worker-safe)
 */
export async function getImageDimensions(imageUrl: string | Blob): Promise<{ width: number; height: number }> {
  const blob = typeof imageUrl === 'string'
    ? await (await fetch(imageUrl)).blob()
    : imageUrl;

  const imageBitmap = await createImageBitmap(blob);
  const result = { width: imageBitmap.width, height: imageBitmap.height };
  imageBitmap.close();
  return result;
}
