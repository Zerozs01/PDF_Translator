import { OCREngine, OCRLine, OCRPageResult } from '../types';

const normalizeFingerprintText = (value: string): string =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

const roundCoord = (value: number | undefined): number => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric);
};

const buildLineGeometrySignature = (line: OCRLine, index: number): string => {
  const bbox = line.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 };
  const wordCount = Array.isArray(line.words) ? line.words.length : 0;
  return [
    index,
    normalizeFingerprintText(line.text || ''),
    roundCoord(bbox.x0),
    roundCoord(bbox.y0),
    roundCoord(bbox.x1),
    roundCoord(bbox.y1),
    wordCount,
  ].join(':');
};

const hashString = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};

export const buildOCRSourceFingerprint = (result: OCRPageResult, fallbackEngine: OCREngine): string => {
  const effectiveEngine = result.ocrEngine || fallbackEngine;
  const lines = Array.isArray(result.lines) ? result.lines : [];
  const textSignature = lines
    .map((line, index) => buildLineGeometrySignature(line, index))
    .join('|');

  return [
    result.algorithmVersion,
    effectiveEngine,
    result.pipelineProfile || 'panel',
    result.language || 'eng',
    result.words.length,
    lines.length,
    normalizeFingerprintText(result.text || '').length,
    hashString(textSignature),
  ].join('|');
};
