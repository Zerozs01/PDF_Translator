import { OCRLine, OCRWord } from '../../types';

export const bboxCenterX = (bbox: OCRWord['bbox'] | OCRLine['bbox']): number => (bbox.x0 + bbox.x1) / 2;
export const bboxCenterY = (bbox: OCRWord['bbox'] | OCRLine['bbox']): number => (bbox.y0 + bbox.y1) / 2;
export const bboxWidth = (bbox: OCRWord['bbox'] | OCRLine['bbox']): number => Math.max(0, bbox.x1 - bbox.x0);
export const bboxHeight = (bbox: OCRWord['bbox'] | OCRLine['bbox']): number => Math.max(0, bbox.y1 - bbox.y0);
export const bboxArea = (bbox: OCRWord['bbox'] | OCRLine['bbox']): number =>
  Math.max(1, bboxWidth(bbox) * bboxHeight(bbox));

export const verticalOverlapRatio = (a: OCRWord['bbox'] | OCRLine['bbox'], b: OCRWord['bbox'] | OCRLine['bbox']): number => {
  const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  const minHeight = Math.max(1, Math.min(bboxHeight(a), bboxHeight(b)));
  return Math.max(0, overlap) / minHeight;
};

export const horizontalOverlapRatio = (a: OCRWord['bbox'] | OCRLine['bbox'], b: OCRWord['bbox'] | OCRLine['bbox']): number => {
  const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const minWidth = Math.max(1, Math.min(bboxWidth(a), bboxWidth(b)));
  return Math.max(0, overlap) / minWidth;
};

export const horizontalContainmentRatio = (inner: OCRWord['bbox'] | OCRLine['bbox'], outer: OCRWord['bbox'] | OCRLine['bbox']): number => {
  const innerWidth = Math.max(1, bboxWidth(inner));
  const overlap = Math.min(inner.x1, outer.x1) - Math.max(inner.x0, outer.x0);
  return Math.max(0, overlap) / innerWidth;
};

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

export const bboxIoURatio = (a: OCRWord['bbox'] | OCRLine['bbox'], b: OCRWord['bbox'] | OCRLine['bbox']): number => {
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
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 0) {
    return (ordered[middle - 1] + ordered[middle]) / 2;
  }
  return ordered[middle];
};

export const buildBigrams = (value: string): Set<string> => {
  const compact = String(value || '').trim();
  const grams = new Set<string>();
  if (!compact) return grams;
  if (compact.length === 1) {
    grams.add(compact);
    return grams;
  }
  for (let i = 0; i < compact.length - 1; i += 1) {
    grams.add(compact.slice(i, i + 2));
  }
  return grams;
};

export const diceSimilarity = (a: string, b: string): number => {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const aBigrams = buildBigrams(a);
  const bBigrams = buildBigrams(b);
  if (aBigrams.size === 0 || bBigrams.size === 0) return 0;

  let overlap = 0;
  for (const gram of aBigrams) {
    if (bBigrams.has(gram)) overlap += 1;
  }

  return (2 * overlap) / (aBigrams.size + bBigrams.size);
};

export const boundedLevenshteinDistance = (a: string, b: string, maxDistance: number): number => {
  if (a === b) return 0;
  if (maxDistance < 0) return Number.MAX_SAFE_INTEGER;

  const lenA = a.length;
  const lenB = b.length;
  if (Math.abs(lenA - lenB) > maxDistance) {
    return maxDistance + 1;
  }

  let prev = new Array<number>(lenB + 1);
  let curr = new Array<number>(lenB + 1);
  for (let j = 0; j <= lenB; j += 1) {
    prev[j] = j;
  }

  for (let i = 1; i <= lenA; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];

    for (let j = 1; j <= lenB; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
      if (curr[j] < rowMin) {
        rowMin = curr[j];
      }
    }

    if (rowMin > maxDistance) {
      return maxDistance + 1;
    }

    [prev, curr] = [curr, prev];
  }

  return prev[lenB];
};
