import type { OCRLine, OCRWord } from '../../types';

type OcrBBox = OCRWord['bbox'] | OCRLine['bbox'];

export const bboxCenterX = (bbox: OcrBBox): number => (bbox.x0 + bbox.x1) / 2;

export const bboxCenterY = (bbox: OcrBBox): number => (bbox.y0 + bbox.y1) / 2;

export const bboxWidth = (bbox: OcrBBox): number => Math.max(0, bbox.x1 - bbox.x0);

export const bboxHeight = (bbox: OcrBBox): number => Math.max(0, bbox.y1 - bbox.y0);

export const verticalOverlapRatio = (a: OcrBBox, b: OcrBBox): number => {
  const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  const minHeight = Math.max(1, Math.min(bboxHeight(a), bboxHeight(b)));
  return Math.max(0, overlap) / minHeight;
};

export const horizontalOverlapRatio = (a: OcrBBox, b: OcrBBox): number => {
  const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const minWidth = Math.max(1, Math.min(bboxWidth(a), bboxWidth(b)));
  return Math.max(0, overlap) / minWidth;
};

export const horizontalContainmentRatio = (inner: OcrBBox, outer: OcrBBox): number => {
  const innerWidth = Math.max(1, bboxWidth(inner));
  const overlap = Math.min(inner.x1, outer.x1) - Math.max(inner.x0, outer.x0);
  return Math.max(0, overlap) / innerWidth;
};

export const bboxArea = (bbox: OcrBBox): number =>
  Math.max(1, bboxWidth(bbox) * bboxHeight(bbox));

export const expandContextualPhraseBBox = (
  bbox: OCRLine['bbox'],
  pageWidth: number,
  pageHeight: number,
  leftRatio: number,
  rightRatio: number,
  verticalRatio: number = 0.08
): OCRLine['bbox'] => {
  const width = Math.max(1, bboxWidth(bbox));
  const height = Math.max(1, bboxHeight(bbox));
  return {
    x0: Math.max(0, bbox.x0 - width * leftRatio),
    y0: Math.max(0, bbox.y0 - height * verticalRatio),
    x1: Math.min(Math.max(1, pageWidth), bbox.x1 + width * rightRatio),
    y1: Math.min(Math.max(1, pageHeight), bbox.y1 + height * verticalRatio),
  };
};

export const bboxIoURatio = (a: OcrBBox, b: OcrBBox): number => {
  const overlapWidth = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const overlapHeight = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const intersection = overlapWidth * overlapHeight;
  if (intersection <= 0) return 0;

  const union = bboxArea(a) + bboxArea(b) - intersection;
  return union > 0 ? (intersection / union) : 0;
};

export const medianNumber = (values: number[]): number => {
  if (values.length === 0) return 0;
  const ordered = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  if (ordered.length % 2 === 0) {
    return (ordered[middle - 1] + ordered[middle]) / 2;
  }
  return ordered[middle];
};

export const computeLineWordUnionCoverage = (line: OCRLine): number => {
  const validWords = (Array.isArray(line.words) ? line.words : [])
    .filter((word) => String(word.text || '').trim().length > 0 && bboxWidth(word.bbox) > 0 && bboxHeight(word.bbox) > 0);
  if (validWords.length === 0) return 0;

  const x0 = Math.min(...validWords.map((word) => word.bbox.x0));
  const y0 = Math.min(...validWords.map((word) => word.bbox.y0));
  const x1 = Math.max(...validWords.map((word) => word.bbox.x1));
  const y1 = Math.max(...validWords.map((word) => word.bbox.y1));
  const unionArea = Math.max(1, (x1 - x0) * (y1 - y0));
  return Math.max(0, Math.min(1.8, unionArea / Math.max(1, bboxArea(line.bbox))));
};
