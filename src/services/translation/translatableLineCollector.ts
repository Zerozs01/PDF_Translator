import type { BBox, OCRLine, OCREngine } from '../../types';
import type { TranslatableLine } from '../../constants/translationConstants';
import { normalizeWhitespace, normalizeEnglishOcrNoiseForTranslation } from '../ocr/ocrTextNormalizer';
import {
  resolveBestOcrLineText,
  isLikelyGhostTranslatableLine,
  shouldForceKeepTechnicalTranslationLine,
  countReadableLength,
  computeLineWordUnionCoverage
} from '../ocr/ocrTextHeuristics';
import {
  overlapRatio,
  shouldPruneContextualGhostTranslatableLine
} from '../layout/dialogueGroupingService';

export function resolveTranslatableLineBBox(line?: OCRLine): BBox | undefined {
  const rawBBox = line?.bbox;
  const normalizedRawBBox = rawBBox && Number(rawBBox.x1) > Number(rawBBox.x0) && Number(rawBBox.y1) > Number(rawBBox.y0)
    ? {
      x0: Number(rawBBox.x0),
      y0: Number(rawBBox.y0),
      x1: Number(rawBBox.x1),
      y1: Number(rawBBox.y1),
    }
    : undefined;

  const validWords = (Array.isArray(line?.words) ? line!.words : [])
    .filter((word) => {
      const text = normalizeWhitespace(String(word?.text || ''));
      const bbox = word?.bbox;
      if (!text || !bbox) return false;
      return Number(bbox.x1) > Number(bbox.x0) && Number(bbox.y1) > Number(bbox.y0);
    });
  if (validWords.length === 0) return normalizedRawBBox;

  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  validWords.forEach((word) => {
    x0 = Math.min(x0, Number(word.bbox.x0));
    y0 = Math.min(y0, Number(word.bbox.y0));
    x1 = Math.max(x1, Number(word.bbox.x1));
    y1 = Math.max(y1, Number(word.bbox.y1));
  });

  if (!(x1 > x0 && y1 > y0)) return undefined;
  const wordUnionBBox = { x0, y0, x1, y1 };

  if (!normalizedRawBBox) {
    return wordUnionBBox;
  }

  const rawWidth = Math.max(1, normalizedRawBBox.x1 - normalizedRawBBox.x0);
  const rawHeight = Math.max(1, normalizedRawBBox.y1 - normalizedRawBBox.y0);
  const rawArea = Math.max(1, rawWidth * rawHeight);
  const unionWidth = Math.max(1, wordUnionBBox.x1 - wordUnionBBox.x0);
  const unionHeight = Math.max(1, wordUnionBBox.y1 - wordUnionBBox.y0);
  const unionArea = Math.max(1, unionWidth * unionHeight);
  const unionCoverage = unionArea / rawArea;

  const rawLooksMalformed = unionCoverage <= 0.32
    && (
      rawArea >= unionArea * 3.8
      || rawWidth >= unionWidth * 1.9
      || rawHeight >= unionHeight * 1.9
    );

  return rawLooksMalformed ? wordUnionBBox : normalizedRawBBox;
}

export function resolveLineSortHintY(line?: OCRLine): number | undefined {
  const direct = Number(line?.sortHintY);
  if (Number.isFinite(direct)) return direct;
  const legacy = Number((line as OCRLine | undefined)?.['_sortY']);
  return Number.isFinite(legacy) ? legacy : undefined;
}

export function resolveLineSortHintX(line?: OCRLine): number | undefined {
  const direct = Number(line?.sortHintX);
  if (Number.isFinite(direct)) return direct;
  const legacy = Number((line as OCRLine | undefined)?.['_sortX']);
  return Number.isFinite(legacy) ? legacy : undefined;
}

export function collectTranslatableLines(
  lines: OCRLine[],
  engineHint?: string,
  pageWidth?: number,
  pageHeight?: number
): TranslatableLine[] {
  const collected: TranslatableLine[] = [];
  const pageWidthVal = pageWidth && pageWidth > 0 ? pageWidth : 1200;
  const scaleFactor = 1200 / pageWidthVal;

  lines.forEach((line, index) => {
    const text = resolveBestOcrLineText(line);
    if (!text) return;

    const likelyGhost = isLikelyGhostTranslatableLine(line, text, engineHint, pageWidth, pageHeight);
    if (likelyGhost && !shouldForceKeepTechnicalTranslationLine(text, line)) {
      return;
    }

    const bbox = resolveTranslatableLineBBox(line);
    if (!bbox) return;

    const left = Number(bbox.x0);
    const right = Number(bbox.x1);
    const top = Number(bbox.y0);
    const bottom = Number(bbox.y1);
    if (!(right > left && bottom > top)) return;

    const validWordBoxCount = (Array.isArray(line.words) ? line.words : []).filter((word) => {
      const wordText = normalizeWhitespace(String(word?.text || ''));
      const wordBBox = word?.bbox;
      if (!wordText || !wordBBox) return false;
      return Number(wordBBox.x1) > Number(wordBBox.x0) && Number(wordBBox.y1) > Number(wordBBox.y0);
    }).length;
    const compactText = text.replace(/\s+/g, '');
    const tokenCount = text.split(/\s+/g).filter(Boolean).length;
    const width = right - left;
    const height = bottom - top;
    const area = width * height;

    const scaledWidth = width * scaleFactor;
    const scaledHeight = height * scaleFactor;
    const scaledArea = scaledWidth * scaledHeight;

    const wordCoverage = computeLineWordUnionCoverage(line);
    const isExternalEngineLine = engineHint === 'paddleocr' || line.sourceEngine === 'paddleocr' || engineHint === 'easyocr' || line.sourceEngine === 'easyocr';
    const noWordOversizedRawLine = !isExternalEngineLine && (
      validWordBoxCount === 0
      && tokenCount >= 2
      && tokenCount <= 6
      && compactText.length <= 30
      && scaledArea >= 16000
      && (scaledWidth >= 180 || scaledHeight >= 96)
      && (scaledArea / Math.max(1, compactText.length)) >= 680
    );
    const lowCoverageOversizedEffectSection = !isExternalEngineLine && (
      validWordBoxCount <= 1
      && wordCoverage <= 0.2
      && tokenCount >= 2
      && tokenCount <= 6
      && compactText.length <= 30
      && scaledArea >= 17000
      && (scaledWidth >= 170 || scaledHeight >= 96)
      && (scaledArea / Math.max(1, compactText.length)) >= 650
    );
    const isProbableComicDialogue = /^(?:THAT'S|MY|TO|IT'S|HAS)\b/i.test(text) || /^[A-Za-z\s;:'",.!?\-]+$/.test(text);
    if ((noWordOversizedRawLine || lowCoverageOversizedEffectSection) && !shouldForceKeepTechnicalTranslationLine(text, line) && !isProbableComicDialogue) {
      return;
    }
    const repairedText = normalizeEnglishOcrNoiseForTranslation(text);

    collected.push({
      index,
      text: repairedText,
      sourceLength: countReadableLength(text),
      left,
      right,
      top,
      bottom,
      height: Math.max(1, bottom - top),
      area,
      wordCoverage,
      wordBoxCount: validWordBoxCount,
      confidence: Number(line.confidence || 0),
      quad: Array.isArray(line.quad) ? line.quad.map((point) => ({ x: point.x, y: point.y })) : undefined,
      angleDeg: Number.isFinite(line.angleDeg) ? Number(line.angleDeg) : undefined,
      sortHintX: resolveLineSortHintX(line),
      sortHintY: resolveLineSortHintY(line),
      sourceEngine: line.sourceEngine || (engineHint as OCREngine),
    });
  });

  if (collected.length <= 1) {
    return collected;
  }

  const isLikelyEffectBalloonSection = (line: TranslatableLine): boolean => {
    const width = Math.max(1, line.right - line.left);
    const height = Math.max(1, line.bottom - line.top);
    const area = Math.max(1, line.area || (width * height));
    const compact = normalizeWhitespace(String(line.text || '')).replace(/\s+/g, '');
    const tokenCount = normalizeWhitespace(String(line.text || '')).split(/\s+/g).filter(Boolean).length;
    const wordCoverage = Number(line.wordCoverage || 0);
    const wordBoxCount = Number(line.wordBoxCount || 0);

    return (
      wordBoxCount <= 1
      && wordCoverage <= 0.22
      && tokenCount >= 2
      && tokenCount <= 6
      && compact.length <= 30
      && area >= 17000
      && (width >= 170 || height >= 96)
    );
  };

  const hasNearbyTextAnchor = (candidate: TranslatableLine): boolean => {
    const candidateWidth = Math.max(1, candidate.right - candidate.left);
    const candidateHeight = Math.max(1, candidate.bottom - candidate.top);
    const candidateArea = Math.max(1, candidate.area || (candidateWidth * candidateHeight));
    const candidateCenterX = (candidate.left + candidate.right) * 0.5;
    const candidateCenterY = (candidate.top + candidate.bottom) * 0.5;

    return collected.some((other) => {
      if (other.index === candidate.index) return false;

      const otherArea = Math.max(1, other.area || ((other.right - other.left) * (other.bottom - other.top)));
      if (otherArea > candidateArea * 0.74) return false;

      const otherWordCoverage = Number(other.wordCoverage || 0);
      const otherWordBoxCount = Number(other.wordBoxCount || 0);
      const anchorSignal = otherWordBoxCount >= 2 || otherWordCoverage >= 0.32 || other.sourceLength >= Math.max(10, candidate.sourceLength * 0.9);
      if (!anchorSignal) return false;

      const overlapX = overlapRatio(candidate.left, candidate.right, other.left, other.right);
      const overlapY = overlapRatio(candidate.top, candidate.bottom, other.top, other.bottom);
      const otherCenterX = (other.left + other.right) * 0.5;
      const otherCenterY = (other.top + other.bottom) * 0.5;
      const centerDeltaX = Math.abs(candidateCenterX - otherCenterX);
      const centerDeltaY = Math.abs(candidateCenterY - otherCenterY);
      const nearInside = (
        other.left >= candidate.left - 12
        && other.right <= candidate.right + 12
        && other.top >= candidate.top - 28
        && other.bottom <= candidate.bottom + 28
      );

      return (
        (overlapX >= 0.24 && overlapY >= 0.1)
        || (nearInside && centerDeltaX <= candidateWidth * 0.65 && centerDeltaY <= candidateHeight * 0.9)
      );
    });
  };

  const filtered = collected.filter((line) => {
    if (!isLikelyEffectBalloonSection(line)) return true;
    return !hasNearbyTextAnchor(line);
  });

  const contextFiltered = filtered.filter((line) =>
    !shouldPruneContextualGhostTranslatableLine(line, filtered)
  );

  if (contextFiltered.length === 0) {
    return collected;
  }

  return contextFiltered;
}
