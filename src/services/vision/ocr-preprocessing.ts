/**
 * OCR Preprocessing — image loading, validation, binarization
 */

import { CONFIG } from './ocr-config';

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

      if (options.binarize) {
        // Otsu threshold
        const hist = new Uint32Array(256);
        for (let i = 0; i < grayData.length; i++) {
          hist[grayData[i]]++;
        }
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

        for (let i = 0, p = 0; i < grayData.length; i++, p += 4) {
          const v = grayData[i] > threshold ? 255 : 0;
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
