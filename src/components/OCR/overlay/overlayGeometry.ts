import { BBox, OCRLine } from '../../../types';
import type { OverlayRect } from './overlayTypes';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const clampOverlayRect = (
  left: number,
  top: number,
  width: number,
  height: number,
  bounds: { x0: number; y0: number; x1: number; y1: number }
): OverlayRect => {
  const minWidth = 1;
  const minHeight = 1;
  const clampedLeft = clamp(left, bounds.x0, Math.max(bounds.x0, bounds.x1 - minWidth));
  const clampedTop = clamp(top, bounds.y0, Math.max(bounds.y0, bounds.y1 - minHeight));
  const maxWidth = Math.max(minWidth, bounds.x1 - clampedLeft);
  const maxHeight = Math.max(minHeight, bounds.y1 - clampedTop);

  return {
    left: clampedLeft,
    top: clampedTop,
    width: Math.max(minWidth, Math.min(width, maxWidth)),
    height: Math.max(minHeight, Math.min(height, maxHeight)),
  };
};

export const normalizeOverlayBBox = (bbox?: Partial<BBox> | null): BBox | undefined => {
  const x0 = Number(bbox?.x0);
  const y0 = Number(bbox?.y0);
  const x1 = Number(bbox?.x1);
  const y1 = Number(bbox?.y1);
  if (![x0, y0, x1, y1].every(Number.isFinite)) return undefined;

  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  if (!(right > left && bottom > top)) return undefined;

  return { x0: left, y0: top, x1: right, y1: bottom };
};

export const hasPositiveBBox = (bbox?: BBox): bbox is BBox => Boolean(normalizeOverlayBBox(bbox));

export const mergeOverlayBBoxes = (a: BBox, b: BBox): BBox => ({
  x0: Math.min(a.x0, b.x0),
  y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1),
  y1: Math.max(a.y1, b.y1),
});

export const resolveQuadBBox = (line: OCRLine): BBox | null => {
  if (!Array.isArray(line.quad) || line.quad.length < 2) return null;
  const points = line.quad.filter((point) =>
    Number.isFinite(point?.x) && Number.isFinite(point?.y)
  );
  if (points.length < 2) return null;
  return {
    x0: Math.min(...points.map((point) => Number(point.x))),
    y0: Math.min(...points.map((point) => Number(point.y))),
    x1: Math.max(...points.map((point) => Number(point.x))),
    y1: Math.max(...points.map((point) => Number(point.y))),
  };
};

const MEANINGFUL_WORD_REGEX = /[\p{L}\p{N}]/u;
const DOCUMENT_SOURCE_FALLBACK_HINT_REGEX = /\b(chapter|table|fig(?:ure)?\.?|reaction|unknowns?|equilibrium|rigid|body|support|diagram|objective|objectives|connection|connections|continued|force|moment|component|unknown|column|columns|bridge|building|beam|beams|welded|surface|bracket|cable|utility|floor|member|pin|hinge)\b/i;

export const resolveOverlaySourceBBox = (line: OCRLine): BBox => {
  const quadBBox = normalizeOverlayBBox(resolveQuadBBox(line));
  const normalizedLineBBox = normalizeOverlayBBox(line.bbox);
  const rawLineBBox = normalizedLineBBox
    ? (quadBBox ? mergeOverlayBBoxes(normalizedLineBBox, quadBBox) : normalizedLineBBox)
    : (quadBBox || line.bbox);
  if (!Array.isArray(line.words) || line.words.length === 0) {
    return normalizeOverlayBBox(rawLineBBox) || rawLineBBox;
  }

  const validWords = line.words
    .map((word) => {
      const bbox = normalizeOverlayBBox(word?.bbox);
      if (!bbox) return null;
      return {
        ...word,
        bbox,
      };
    })
    .filter((word): word is OCRLine['words'][number] => Boolean(word));
  const meaningfulWords = validWords.filter((word) => MEANINGFUL_WORD_REGEX.test(String(word.text || '').trim()));
  const wordSource = meaningfulWords.length > 0 ? meaningfulWords : validWords;
  const validWordBoxes = wordSource.map((word) => word.bbox);

  if (validWordBoxes.length === 0) {
    return normalizeOverlayBBox(rawLineBBox) || rawLineBBox;
  }

  const unionWordBox = validWordBoxes.reduce<BBox>((acc, bbox) => ({
    x0: Math.min(acc.x0, bbox.x0),
    y0: Math.min(acc.y0, bbox.y0),
    x1: Math.max(acc.x1, bbox.x1),
    y1: Math.max(acc.y1, bbox.y1),
  }), {
    ...validWordBoxes[0],
  });

  if (!hasPositiveBBox(rawLineBBox)) {
    return unionWordBox;
  }

  const lineWidth = Math.max(1, rawLineBBox.x1 - rawLineBBox.x0);
  const lineHeight = Math.max(1, rawLineBBox.y1 - rawLineBBox.y0);
  const lineArea = lineWidth * lineHeight;
  const wordWidth = Math.max(1, unionWordBox.x1 - unionWordBox.x0);
  const wordHeight = Math.max(1, unionWordBox.y1 - unionWordBox.y0);
  const wordArea = wordWidth * wordHeight;
  const leftTrimRatio = Math.max(0, unionWordBox.x0 - rawLineBBox.x0) / lineWidth;
  const rightTrimRatio = Math.max(0, rawLineBBox.x1 - unionWordBox.x1) / lineWidth;
  const horizontalTrimRatio = leftTrimRatio + rightTrimRatio;
  const widthCoverage = wordWidth / lineWidth;
  const heightCoverage = wordHeight / lineHeight;
  const areaCoverage = wordArea / lineArea;
  const normalizedLineText = String(line.text || '').trim();
  const sourceWordCount = normalizedLineText.split(/\s+/g).filter(Boolean).length;
  const meaningfulCharCount = normalizedLineText.replace(/[^\p{L}\p{N}]/gu, '').length;
  const thaiCharCount = (normalizedLineText.match(/[\u0E00-\u0E7F]/g) || []).length;
  const technicalSourceLike = DOCUMENT_SOURCE_FALLBACK_HINT_REGEX.test(normalizedLineText);
  const numericDocumentLike = sourceWordCount >= 5 && /[0-9()\-]/.test(normalizedLineText);
  const thaiDocumentLike = thaiCharCount >= 12
    && (sourceWordCount >= 3 || /[0-9()\[\].,:;\-]/.test(normalizedLineText));
  const allowLineFallback = technicalSourceLike || numericDocumentLike || thaiDocumentLike;
  const longLineText = normalizedLineText.length >= 18;
  const sparseWordBoxes = validWordBoxes.length <= 3;
  const rawCenterX = (rawLineBBox.x0 + rawLineBBox.x1) * 0.5;
  const rawCenterY = (rawLineBBox.y0 + rawLineBBox.y1) * 0.5;
  const unionCenterX = (unionWordBox.x0 + unionWordBox.x1) * 0.5;
  const unionCenterY = (unionWordBox.y0 + unionWordBox.y1) * 0.5;
  const centerOffsetXRatio = Math.abs(unionCenterX - rawCenterX) / lineWidth;
  const centerOffsetYRatio = Math.abs(unionCenterY - rawCenterY) / lineHeight;
  const rotatedLine = Boolean(quadBBox) && Math.abs(Number(line.angleDeg || 0)) >= 10;
  const severeCoverageLoss = (
    (widthCoverage < 0.62 && areaCoverage < 0.5)
    || (widthCoverage < 0.72 && heightCoverage < 0.38)
  );
  const moderateCoverageLoss = longLineText && sparseWordBoxes && widthCoverage < 0.86 && areaCoverage < 0.78;
  const shortDocumentCoverageLoss = (
    sourceWordCount >= 3
    && sourceWordCount <= 7
    && validWordBoxes.length <= 2
    && widthCoverage < 0.78
    && areaCoverage < 0.8
    && heightCoverage < 0.9
  );
  const longDocumentCoverageLoss = (
    sourceWordCount >= 7
    && longLineText
    && widthCoverage < 0.84
    && areaCoverage < 0.84
    && heightCoverage < 0.95
  );
  const sparseWordCoverage = (
    sourceWordCount >= 5
    && validWordBoxes.length <= Math.max(2, Math.floor(sourceWordCount * 0.45))
  );
  const technicalSparseCoverageLoss = (
    allowLineFallback
    && sparseWordCoverage
    && widthCoverage < 0.9
    && areaCoverage < 0.88
    && heightCoverage < 0.95
  );
  const technicalEdgeTrimLoss = (
    allowLineFallback
    && sourceWordCount >= 3
    && widthCoverage < 0.92
    && areaCoverage >= 0.46
    && areaCoverage < 0.9
    && heightCoverage >= 0.62
    && horizontalTrimRatio > 0.2
  );
  const centeredShortDialogueCoverageLoss = (
    !allowLineFallback
    && meaningfulCharCount >= 4
    && sourceWordCount >= 1
    && sourceWordCount <= 5
    && centerOffsetXRatio <= 0.22
    && centerOffsetYRatio <= 0.24
    && widthCoverage < 0.66
    && heightCoverage < 0.58
    && areaCoverage < 0.42
  );

  if (allowLineFallback && (
    severeCoverageLoss
    || moderateCoverageLoss
    || shortDocumentCoverageLoss
    || longDocumentCoverageLoss
    || technicalSparseCoverageLoss
    || technicalEdgeTrimLoss
  )) {
    return rawLineBBox;
  }

  if (centeredShortDialogueCoverageLoss) {
    return rawLineBBox;
  }

  if (
    rotatedLine
    && meaningfulCharCount >= 3
    && (
      severeCoverageLoss
      || moderateCoverageLoss
      || widthCoverage < 0.82
      || areaCoverage < 0.74
    )
  ) {
    return rawLineBBox;
  }

  return unionWordBox;
};

export const resolveOverlayMaskBBox = (line: OCRLine): BBox => {
  const sourceBbox = resolveOverlaySourceBBox(line);
  const normalizedLineBBox = normalizeOverlayBBox(line.bbox);
  if (!normalizedLineBBox) {
    return sourceBbox;
  }

  return {
    x0: Math.min(normalizedLineBBox.x0, sourceBbox.x0),
    y0: Math.min(normalizedLineBBox.y0, sourceBbox.y0),
    x1: Math.max(normalizedLineBBox.x1, sourceBbox.x1),
    y1: Math.max(normalizedLineBBox.y1, sourceBbox.y1),
  };
};

export const resolveOverlayMaskExpansion = (
  bbox: BBox,
  options?: { isHorizontalJapanese?: boolean; isVerticalJapanese?: boolean }
): { padX: number; padY: number } => {
  const width = Math.max(1, bbox.x1 - bbox.x0);
  const height = Math.max(1, bbox.y1 - bbox.y0);

  if (options?.isVerticalJapanese) {
    return {
      padX: Math.max(2, Math.round(width * 0.12)),
      padY: Math.max(3, Math.round(height * 0.04)),
    };
  }

  if (options?.isHorizontalJapanese) {
    return {
      padX: Math.max(3, Math.round(width * 0.04)),
      padY: Math.max(2, Math.round(height * 0.12)),
    };
  }

  return {
    padX: Math.max(2, Math.min(8, Math.round(width * 0.03))),
    padY: Math.max(2, Math.min(8, Math.round(height * 0.08))),
  };
};

export const estimateLineRotationDeg = (line: OCRLine): number => {
  if (Number.isFinite(line.angleDeg)) {
    return Number(line.angleDeg);
  }
  if (Array.isArray(line.quad) && line.quad.length >= 2) {
    const [p0, p1] = line.quad;
    if (p0 && p1 && Number.isFinite(p0.x) && Number.isFinite(p0.y) && Number.isFinite(p1.x) && Number.isFinite(p1.y)) {
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      return (Math.atan2(dy, dx) * 180) / Math.PI;
    }
  }
  return 0;
};
