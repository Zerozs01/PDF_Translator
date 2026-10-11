/**
 * ocrExternalChunking.ts - External OCR Image Chunking & Coordinate Offset Helpers
 * 
 * Extracted from VisionService as part of [M1] modularization.
 */

import type { OCRLine, OCRWord, OCREngine, OCRPipelineProfile } from '../../types';

export const EXTERNAL_PADDLE_CHUNK_MIN_HEIGHT = 5200;
export const EXTERNAL_PADDLE_CHUNK_TARGET_HEIGHT = 2200;
export const EXTERNAL_PADDLE_CHUNK_OVERLAP = 220;

export const isCjkOrThaiLanguage = (language: string): boolean => {
  return language
    .split('+')
    .map((code) => code.trim())
    .filter(Boolean)
    .some((code) => ['kor', 'jpn', 'jpn_vert', 'chi_sim', 'chi_tra', 'tha'].includes(code));
};

export const shouldChunkExternalOcr = (
  engine: OCREngine,
  pipelineProfile: OCRPipelineProfile,
  width: number,
  height: number,
  language: string
): boolean => {
  if (engine !== 'paddleocr') return false;
  if (pipelineProfile !== 'panel') return false;
  const languageCodes = language
    .split('+')
    .map((code) => code.trim())
    .filter(Boolean);
  const isKorean = languageCodes.includes('kor');
  if (!isKorean && isCjkOrThaiLanguage(language)) return false;
  const longest = Math.max(width, height);
  const shortest = Math.max(1, Math.min(width, height));
  const aspectRatio = longest / shortest;
  if (isKorean) {
    return height >= 6200 || aspectRatio >= 2.4;
  }
  return height >= EXTERNAL_PADDLE_CHUNK_MIN_HEIGHT || aspectRatio >= 2.3;
};

export const blobToPng = async (blob: Blob): Promise<{ bytes: Uint8Array; mimeType: string }> => {
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    mimeType: blob.type || 'image/png',
  };
};

export const canvasToPngBlob = async (canvas: HTMLCanvasElement): Promise<Blob> => {
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error('Failed to encode OCR chunk image'));
    }, 'image/png');
  });
};

export const offsetExternalWord = (word: OCRWord, yOffset: number): OCRWord => {
  return {
    ...word,
    bbox: {
      x0: word.bbox.x0,
      y0: word.bbox.y0 + yOffset,
      x1: word.bbox.x1,
      y1: word.bbox.y1 + yOffset,
    },
  };
};

export const offsetExternalLine = (line: OCRLine, yOffset: number): OCRLine => {
  const lineWithHints = line as OCRLine & { _sortY?: number; _sortX?: number; sortHintY?: number; sortHintX?: number };
  return {
    ...lineWithHints,
    bbox: {
      x0: line.bbox.x0,
      y0: line.bbox.y0 + yOffset,
      x1: line.bbox.x1,
      y1: line.bbox.y1 + yOffset,
    },
    words: (line.words || []).map((word) => offsetExternalWord(word, yOffset)),
    quad: Array.isArray(line.quad)
      ? line.quad.map((point) => ({
        x: point.x,
        y: point.y + yOffset,
      }))
      : line.quad,
    ...(typeof lineWithHints._sortY === 'number' ? { _sortY: lineWithHints._sortY + yOffset } : {}),
    ...(typeof lineWithHints._sortX === 'number' ? { _sortX: lineWithHints._sortX } : {}),
    ...(typeof lineWithHints.sortHintY === 'number' ? { sortHintY: lineWithHints.sortHintY + yOffset } : {}),
    ...(typeof lineWithHints.sortHintX === 'number' ? { sortHintX: lineWithHints.sortHintX } : {}),
  };
};
