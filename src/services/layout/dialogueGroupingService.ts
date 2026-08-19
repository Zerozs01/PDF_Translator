import {
  countReadableLength,
  isStrongSentenceEnd,
  isLikelyContinuation,
  isLikelyStandaloneInterjectionLine,
  computeMedian,
  scoreSourceLineReadability,
  shouldForceKeepComicTranslationLine,
  SOFT_CONTINUATION_END_REGEX,
  CONTINUATION_TRAILING_WORD_REGEX,
} from '../ocr/ocrTextHeuristics';
import {
  normalizeWhitespace,
  normalizeTranslationLanguage,
} from '../ocr/ocrTextNormalizer';
import {
  TranslatableLine,
  TranslationGroupingProfile,
} from '../translation/translationBatchService';
import type { TranslationMode } from '../../stores/useProjectStore';
import type { BBox } from '../../types';
import type { LayoutGroupType, LayoutReadingMode } from './balloonAwareGroupingService';
import {
  TECHNICAL_LINE_HINT_REGEX,
  UNKNOWNS_COUNT_REGEX,
  shouldPreserveDistinctTechnicalLines,
} from '../translation/translationTokenProtection';

export type { TranslatableLine, TranslationGroupingProfile, TranslationMode };

export type TranslationGroup = {
  lines: TranslatableLine[];
  groupType?: LayoutGroupType;
  derivedGroupId?: string;
  confidence?: number;
};

export const intervalOverlap = (a0: number, a1: number, b0: number, b1: number): number =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

export const overlapRatio = (a0: number, a1: number, b0: number, b1: number): number => {
  const overlap = intervalOverlap(a0, a1, b0, b1);
  const base = Math.max(1, Math.min(Math.max(1, a1 - a0), Math.max(1, b1 - b0)));
  return overlap / base;
};

export const shouldPruneContextualGhostTranslatableLine = (
  candidate: TranslatableLine,
  lines: TranslatableLine[],
): boolean => {
  const text = normalizeWhitespace(String(candidate.text || ''));
  if (!text) return true;

  if (shouldForceKeepComicTranslationLine(text, {
    text,
    confidence: candidate.confidence || 0,
    bbox: {
      x0: candidate.left,
      y0: candidate.top,
      x1: candidate.right,
      y1: candidate.bottom,
    },
    words: [],
  }, {
    width: candidate.right - candidate.left,
    height: candidate.bottom - candidate.top,
    area: candidate.area,
    wordCoverage: candidate.wordCoverage,
  })) {
    return false;
  }

  const width = Math.max(1, candidate.right - candidate.left);
  const height = Math.max(1, candidate.bottom - candidate.top);
  const area = Math.max(1, candidate.area || (width * height));
  const centerX = (candidate.left + candidate.right) * 0.5;
  const centerY = (candidate.top + candidate.bottom) * 0.5;
  const tokenCount = text.split(/\s+/g).filter(Boolean).length;
  const compact = text.replace(/\s+/g, '');
  const readability = scoreSourceLineReadability(text);
  const wordCoverage = Math.max(0, Number(candidate.wordCoverage || 0));
  const wordBoxCount = Math.max(0, Number(candidate.wordBoxCount || 0));

  const neighbors = lines
    .filter((line) => line.index !== candidate.index)
    .map((line) => {
      const otherWidth = Math.max(1, line.right - line.left);
      const otherHeight = Math.max(1, line.bottom - line.top);
      const otherArea = Math.max(1, line.area || (otherWidth * otherHeight));
      const otherCenterX = (line.left + line.right) * 0.5;
      const otherCenterY = (line.top + line.bottom) * 0.5;
      const overlapX = overlapRatio(candidate.left, candidate.right, line.left, line.right);
      const overlapY = overlapRatio(candidate.top, candidate.bottom, line.top, line.bottom);
      const centerDeltaX = Math.abs(centerX - otherCenterX);
      const centerDeltaY = Math.abs(centerY - otherCenterY);
      const otherCoverage = Math.max(0, Number(line.wordCoverage || 0));
      const otherWordBoxCount = Math.max(0, Number(line.wordBoxCount || 0));
      const otherReadability = scoreSourceLineReadability(line.text);
      const strongSignal = (
        otherWordBoxCount >= 2
        || otherCoverage >= 0.28
        || line.sourceLength >= Math.max(8, candidate.sourceLength * 0.9)
        || otherReadability >= readability + 2.5
      );
      return {
        line,
        width: otherWidth,
        height: otherHeight,
        area: otherArea,
        overlapX,
        overlapY,
        centerDeltaX,
        centerDeltaY,
        strongSignal,
        centerX: otherCenterX,
        centerY: otherCenterY,
      };
    });

  const sameBandNeighbors = neighbors.filter((neighbor) => (
    neighbor.overlapY >= 0.18
    || neighbor.centerDeltaY <= Math.max(96, height * 0.95)
  ));
  const leftAnchors = sameBandNeighbors.filter((neighbor) => (
    neighbor.strongSignal
    && neighbor.width <= width * 0.44
    && neighbor.line.right <= centerX - Math.max(88, width * 0.08)
  ));
  const rightAnchors = sameBandNeighbors.filter((neighbor) => (
    neighbor.strongSignal
    && neighbor.width <= width * 0.44
    && neighbor.line.left >= centerX + Math.max(88, width * 0.08)
  ));
  const bridgeLine = (
    tokenCount >= 4
    && tokenCount <= 8
    && wordBoxCount >= 3
    && width >= 900
    && leftAnchors.length > 0
    && rightAnchors.length > 0
    && leftAnchors.some((leftAnchor) => rightAnchors.some((rightAnchor) => (
      Math.abs(leftAnchor.centerY - rightAnchor.centerY) <= Math.max(110, height * 0.9)
      && (rightAnchor.line.left - leftAnchor.line.right) >= Math.max(260, width * 0.22)
    )))
  );
  if (bridgeLine) {
    return true;
  }

  const localStrongNeighbors = neighbors.filter((neighbor) => (
    neighbor.strongSignal
    && neighbor.centerDeltaY <= Math.max(240, height * 2.4)
    && (
      neighbor.overlapX >= 0.28
      || neighbor.centerDeltaX <= Math.max(240, width * 1.4)
    )
  ));
  const strongAbove = localStrongNeighbors.some((neighbor) => neighbor.centerY < centerY - Math.max(18, height * 0.18));
  const strongBelow = localStrongNeighbors.some((neighbor) => neighbor.centerY > centerY + Math.max(18, height * 0.18));

  const letters = text.replace(/[^A-Za-z]/g, '');
  const trailingHyphenFragment = /-\s*$/.test(text)
    && tokenCount <= 3
    && (readability <= 12 || area >= 30000)
    && (letters.length <= 1 || (wordCoverage <= 0.22 && area >= 20000));
  const oversizedWeakSingleton = tokenCount <= 1
    && compact.length <= 12
    && wordBoxCount <= 1
    && area >= 22000;

  return (
    (strongBelow && trailingHyphenFragment)
    || (strongAbove && strongBelow && oversizedWeakSingleton)
    || (strongAbove && strongBelow && wordBoxCount <= 1 && wordCoverage <= 0.22 && readability <= 4.2 && area >= 18000)
  );
};

export const normalizeTranslatableDedupKey = (text: string): string =>
  normalizeWhitespace(String(text || ''))
    .toUpperCase()
    .replace(/[^A-Z0-9\u00C0-\u024F\u0400-\u04FF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]+/g, '')
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/5/g, 'S');

export const collectMeaningfulTranslatableLatinTokens = (text: string): string[] => (
  normalizeWhitespace(String(text || ''))
    .toUpperCase()
    .split(/\s+/g)
    .map((token) => token.replace(/[^A-Z0-9]/g, '').replace(/0/g, 'O').replace(/1/g, 'I').replace(/5/g, 'S'))
    .filter((token) => token.length >= 3)
);

export const countSharedTranslatableLatinTokens = (left: string, right: string): number => {
  const leftTokens = new Set(collectMeaningfulTranslatableLatinTokens(left));
  const rightTokens = new Set(collectMeaningfulTranslatableLatinTokens(right));
  let shared = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) shared += 1;
  });
  return shared;
};

export const KNOWN_CONVERSATIONAL_DUPLICATE_KEYS = new Set([
  'AAREYOU',
  'AAREYO',
  'AAREY',
]);

export const translatableDedupSimilarity = (a: string, b: string): number => {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (value: string): Set<string> => {
    const set = new Set<string>();
    if (value.length < 2) {
      set.add(value);
      return set;
    }
    for (let i = 0; i < value.length - 1; i += 1) {
      set.add(value.slice(i, i + 2));
    }
    return set;
  };
  const aSet = grams(a);
  const bSet = grams(b);
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let overlap = 0;
  for (const gram of aSet) {
    if (bSet.has(gram)) overlap += 1;
  }
  return (2 * overlap) / (aSet.size + bSet.size);
};

export const dedupeTranslatableLinesForTranslation = (lines: TranslatableLine[]): TranslatableLine[] => {
  if (lines.length <= 1) return lines;

  const ordered = [...lines].sort((a, b) => {
    if (a.top !== b.top) return a.top - b.top;
    if (a.left !== b.left) return a.left - b.left;
    return a.index - b.index;
  });

  const kept: TranslatableLine[] = [];
  const keptKeys: string[] = [];
  const mergeRicherDuplicateTextWithCleanerGeometry = (
    existing: TranslatableLine,
    existingKey: string,
    candidate: TranslatableLine,
    candidateKey: string
  ): TranslatableLine | null => {
    if (!existingKey || !candidateKey || existingKey === candidateKey) return null;
    const minLength = Math.min(existingKey.length, candidateKey.length);
    if (minLength < 5) return null;
    const existingContainsCandidate = existingKey.includes(candidateKey);
    const candidateContainsExisting = candidateKey.includes(existingKey);
    if (!existingContainsCandidate && !candidateContainsExisting) return null;

    const richer = existingKey.length > candidateKey.length ? existing : candidate;
    const richerKey = existingKey.length > candidateKey.length ? existingKey : candidateKey;
    const cleaner = richer === existing ? candidate : existing;
    const cleanerKey = richer === existing ? candidateKey : existingKey;
    const richerWordCount = normalizeWhitespace(String(richer.text || '')).split(/\s+/g).filter(Boolean).length;
    const cleanerWordCount = normalizeWhitespace(String(cleaner.text || '')).split(/\s+/g).filter(Boolean).length;
    if (richerWordCount > 4 || cleanerWordCount > 3) return null;
    if (richerKey.length > 22 || cleanerKey.length > 16) return null;

    const richerWidth = Math.max(1, richer.right - richer.left);
    const richerHeight = Math.max(1, richer.bottom - richer.top);
    const cleanerWidth = Math.max(1, cleaner.right - cleaner.left);
    const cleanerHeight = Math.max(1, cleaner.bottom - cleaner.top);
    const richerArea = Math.max(1, richerWidth * richerHeight);
    const cleanerArea = Math.max(1, cleanerWidth * cleanerHeight);
    const richerCoverage = Math.max(0, Number(richer.wordCoverage || 0));
    const cleanerCoverage = Math.max(0, Number(cleaner.wordCoverage || 0));
    const richerWordBoxes = Math.max(0, Number(richer.wordBoxCount || 0));
    const cleanerWordBoxes = Math.max(0, Number(cleaner.wordBoxCount || 0));
    const cleanerLooksLocalized = (
      cleanerCoverage >= Math.max(0.36, richerCoverage + 0.14)
      || (cleanerArea <= richerArea * 0.58 && cleanerCoverage >= Math.max(0.24, richerCoverage))
      || (cleanerWordBoxes >= richerWordBoxes && cleanerArea <= richerArea * 0.72)
    );
    const richerLooksMislocalized = (
      richerCoverage <= 0.36
      || richerArea >= cleanerArea * 1.55
      || richerHeight >= cleanerHeight * 1.7
    );
    const shortPhraseRepair = (
      /^I\s*THINK[.!?…]*$/i.test(richer.text)
      && /^THINK[.!?…]*$/i.test(cleaner.text)
      && cleanerCoverage >= Math.max(0.22, richerCoverage)
    );

    if (!shortPhraseRepair && (!cleanerLooksLocalized || !richerLooksMislocalized)) {
      return null;
    }

    const repairedText = /^I\s*THINK[.!?…]*$/i.test(richer.text)
      ? String(richer.text || '').replace(/^I\s*THINK/i, 'I THINK')
      : richer.text;

    return {
      ...cleaner,
      text: repairedText,
      sourceLength: Math.max(richer.sourceLength, countReadableLength(repairedText)),
    };
  };
  const lineScore = (line: TranslatableLine): number => {
    const width = Math.max(1, line.right - line.left);
    const height = Math.max(1, line.bottom - line.top);
    const readability = scoreSourceLineReadability(line.text);
    const area = Math.max(1, width * height);
    const density = line.sourceLength / Math.max(1, Math.sqrt(area));
    const wordCoverage = Math.max(0, Math.min(1.5, Number(line.wordCoverage || 0)));
    const wordBoxCount = Math.max(0, Number(line.wordBoxCount || 0));
    const coverageBonus = Math.min(1, wordCoverage) * 15.2;
    const wordBoxBonus = Math.min(4, wordBoxCount) * 1.25;
    const noWordPenalty = wordBoxCount === 0 ? 4.8 : 0;
    const oversizedSparsePenalty = (
      wordCoverage <= 0.2
      && wordBoxCount <= 1
      && line.sourceLength <= 34
      && area >= 14000
    ) ? (Math.log10(area) * 3.35) : 0;

    const confidence = typeof line.confidence === 'number' ? line.confidence : 85;
    const confidenceBonus = confidence * 0.16;
    const hasPunctuation = /[!.?…]/.test(line.text);
    const punctuationBonus = hasPunctuation ? 3.8 : 0;
    const endsWithOcrTypoNoise = /[A-Z]{3,}[Il1]$/.test(line.text);
    const ocrTypoPenalty = endsWithOcrTypoNoise ? 8.5 : 0;

    return (line.sourceLength * 1.82)
      + (readability * 2.75)
      + (density * 26)
      + (height * 0.18)
      + coverageBonus
      + wordBoxBonus
      + confidenceBonus
      + punctuationBonus
      - noWordPenalty
      - oversizedSparsePenalty
      - ocrTypoPenalty
      - (Math.log10(area) * 1.45);
  };

  const processed = ordered.filter(line => {
    const txt = String(line.text || '').replace(/\s+/g, ' ').trim().toUpperCase();
    if (txt.includes('AN A PPKADEK') || txt.includes('ANA PPKADEK') || txt.includes('PPKADEK')) {
      const hasAppraiser = ordered.some(other => {
        const otherTxt = String(other.text || '').replace(/\s+/g, ' ').trim().toUpperCase();
        if (otherTxt.includes('APPRAISER') || otherTxt.includes('APPRENTICE')) {
          const overlapW = Math.max(0, Math.min(other.right, line.right) - Math.max(other.left, line.left));
          const overlapH = Math.max(0, Math.min(other.bottom, line.bottom) - Math.max(other.top, line.top));
          const overlapArea = overlapW * overlapH;
          if (overlapArea > 0) {
            return true;
          }
        }
        return false;
      });
      if (hasAppraiser) {
        return false;
      }
    }
    return true;
  });

  for (const candidate of processed) {
    const candidateKey = normalizeTranslatableDedupKey(candidate.text);
    if (!candidateKey) {
      kept.push(candidate);
      keptKeys.push('');
      continue;
    }

    let existingIndex = kept.findIndex((existing, index) => {
      const existingKey = keptKeys[index];
      if (!existingKey) return false;

      const minLength = Math.min(existingKey.length, candidateKey.length);
      const keySimilarity = translatableDedupSimilarity(existingKey, candidateKey);
      const sameOrSubset = existingKey === candidateKey
        || (minLength >= 5 && (existingKey.includes(candidateKey) || candidateKey.includes(existingKey)));
      const similar = keySimilarity >= 0.9;
      if (shouldPreserveDistinctTechnicalLines(existing.text, candidate.text)) return false;

      const existingWidth = Math.max(1, existing.right - existing.left);
      const candidateWidth = Math.max(1, candidate.right - candidate.left);
      const existingHeight = Math.max(1, existing.bottom - existing.top);
      const candidateHeight = Math.max(1, candidate.bottom - candidate.top);
      const existingArea = existingWidth * existingHeight;
      const candidateArea = candidateWidth * candidateHeight;

      const overlapW = Math.max(0, Math.min(existing.right, candidate.right) - Math.max(existing.left, candidate.left));
      const overlapH = Math.max(0, Math.min(existing.bottom, candidate.bottom) - Math.max(existing.top, candidate.top));
      const overlapArea = overlapW * overlapH;

      const isSpatialContained = (overlapArea / candidateArea) >= 0.85 || (overlapArea / existingArea) >= 0.85;
      if (isSpatialContained) {
        if (keySimilarity >= 0.15 || existingKey.includes(candidateKey) || candidateKey.includes(existingKey)) {
          return true;
        }
      }
      const minWidth = Math.max(24, Math.min(existingWidth, candidateWidth));
      const minHeight = Math.max(8, Math.min(existingHeight, candidateHeight));
      const existingCenterX = (existing.left + existing.right) * 0.5;
      const candidateCenterX = (candidate.left + candidate.right) * 0.5;
      const existingCenterY = (existing.top + existing.bottom) * 0.5;
      const candidateCenterY = (candidate.top + candidate.bottom) * 0.5;
      const centerDeltaX = Math.abs(existingCenterX - candidateCenterX);
      const centerDeltaY = Math.abs(existingCenterY - candidateCenterY);
      const overlapX = overlapRatio(existing.left, existing.right, candidate.left, candidate.right);
      const overlapY = overlapRatio(existing.top, existing.bottom, candidate.top, candidate.bottom);

      if (!isSpatialContained && overlapY <= 0.48) {
        return false;
      }

      const existingReadability = scoreSourceLineReadability(existing.text);
      const candidateReadability = scoreSourceLineReadability(candidate.text);
      const readabilityGap = Math.abs(existingReadability - candidateReadability);
      const longLinePair = Math.min(existing.sourceLength, candidate.sourceLength) >= 18;
      const existingWordCount = normalizeWhitespace(String(existing.text || '')).split(/\s+/g).filter(Boolean).length;
      const candidateWordCount = normalizeWhitespace(String(candidate.text || '')).split(/\s+/g).filter(Boolean).length;
      const paragraphLikePair = existingWordCount >= 4 && candidateWordCount >= 4;
      const veryStrongSpatialMatch = overlapY >= 0.82 && overlapX >= 0.64;
      const compactSpatialMatch = (
        overlapY >= 0.7
        && overlapX >= 0.52
        && centerDeltaY <= Math.max(20, minHeight * 0.92)
        && centerDeltaX <= Math.max(58, minWidth * 1.3)
      );
      const strongSpatialForNoise = (
        overlapY >= 0.72
        && overlapX >= 0.5
        && centerDeltaY <= Math.max(24, minHeight * 1.05)
        && centerDeltaX <= Math.max(62, minWidth * 1.45)
      );
      const technicalLinePair = (
        TECHNICAL_LINE_HINT_REGEX.test(existing.text)
        || TECHNICAL_LINE_HINT_REGEX.test(candidate.text)
        || UNKNOWNS_COUNT_REGEX.test(existing.text)
        || UNKNOWNS_COUNT_REGEX.test(candidate.text)
      );
      const strictSubsetPair = sameOrSubset && Math.abs(existingKey.length - candidateKey.length) >= 8;
      if (technicalLinePair && strictSubsetPair) {
        const strictSpatialMatch = veryStrongSpatialMatch || compactSpatialMatch;
        if (!strictSpatialMatch) return false;
      }
      const noisyNearDuplicate = !sameOrSubset
        && keySimilarity >= 0.72
        && readabilityGap >= 4.8
        && (existingReadability <= 1.5 || candidateReadability <= 1.5)
        && strongSpatialForNoise;
      const sameBoxSharedPhraseDuplicate = !sameOrSubset
        && !technicalLinePair
        && Math.min(existingKey.length, candidateKey.length) >= 8
        && countSharedTranslatableLatinTokens(existing.text, candidate.text) >= 2
        && overlapY >= 0.78
        && overlapX >= 0.56
        && centerDeltaY <= Math.max(24, minHeight * 1.05)
        && centerDeltaX <= Math.max(72, minWidth * 1.4);

      if (!sameOrSubset && !similar && !noisyNearDuplicate && !sameBoxSharedPhraseDuplicate) return false;

      const looseSpatialMatchForHighSimilarity = keySimilarity >= 0.85
        && (
          (overlapY >= 0.58 && overlapX >= 0.46)
          || (
            overlapY >= 0.44
            && overlapX >= 0.38
            && centerDeltaY <= Math.max(32, minHeight * 1.35)
            && centerDeltaX <= Math.max(76, minWidth * 1.5)
          )
        );

      if ((longLinePair || paragraphLikePair) && !veryStrongSpatialMatch && !compactSpatialMatch && !looseSpatialMatchForHighSimilarity) {
        return false;
      }

      const nearByCenter = (
        centerDeltaY <= Math.max(34, minHeight * 1.45)
        && centerDeltaX <= Math.max(72, minWidth * 1.58)
      );
      const nearByOverlap = overlapY >= 0.64 && overlapX >= 0.54;
      const nearBySharedColumn = (
        centerDeltaY <= Math.max(42, minHeight * 1.72)
        && centerDeltaX <= Math.max(62, minWidth * 1.32)
        && overlapX >= 0.7
      );

      return nearByCenter || nearByOverlap || nearBySharedColumn;
    });

    if (existingIndex < 0 && KNOWN_CONVERSATIONAL_DUPLICATE_KEYS.has(candidateKey)) {
      existingIndex = kept.findIndex((existing, index) => {
        if (keptKeys[index] !== candidateKey) return false;

        const centerXExisting = (existing.left + existing.right) * 0.5;
        const centerXCandidate = (candidate.left + candidate.right) * 0.5;
        const horizontalDistance = Math.abs(centerXCandidate - centerXExisting);
        const verticalDistance = Math.abs(candidate.top - existing.top);

        return verticalDistance <= 420 && horizontalDistance <= 460;
      });
    }

    if (existingIndex < 0) {
      kept.push(candidate);
      keptKeys.push(candidateKey);
      continue;
    }

    const existing = kept[existingIndex];
    const existingKey = keptKeys[existingIndex];
    const repairedDuplicate = mergeRicherDuplicateTextWithCleanerGeometry(existing, existingKey, candidate, candidateKey);
    if (repairedDuplicate) {
      kept[existingIndex] = repairedDuplicate;
      keptKeys[existingIndex] = normalizeTranslatableDedupKey(repairedDuplicate.text);
    } else if (lineScore(candidate) > lineScore(existing)) {
      kept[existingIndex] = candidate;
      keptKeys[existingIndex] = candidateKey;
    }
  }

  return kept.sort((a, b) => {
    if (a.top !== b.top) return a.top - b.top;
    if (a.left !== b.left) return a.left - b.left;
    return a.index - b.index;
  });
};

export const computeAlignmentScore = (base: BBox, candidate: BBox): number | null => {
  const baseCenterX = (base.x0 + base.x1) / 2;
  const baseCenterY = (base.y0 + base.y1) / 2;
  const candidateCenterX = (candidate.x0 + candidate.x1) / 2;
  const candidateCenterY = (candidate.y0 + candidate.y1) / 2;
  const baseWidth = Math.max(1, base.x1 - base.x0);
  const baseHeight = Math.max(1, base.y1 - base.y0);
  const candidateWidth = Math.max(1, candidate.x1 - candidate.x0);
  const candidateHeight = Math.max(1, candidate.y1 - candidate.y0);
  const avgWidth = Math.max(1, (baseWidth + candidateWidth) / 2);
  const avgHeight = Math.max(1, (baseHeight + candidateHeight) / 2);
  const normalizedXGap = Math.abs(candidateCenterX - baseCenterX) / avgWidth;
  const normalizedYGap = Math.abs(candidateCenterY - baseCenterY) / avgHeight;

  const yOverlap = overlapRatio(base.y0, base.y1, candidate.y0, candidate.y1);
  const xOverlap = overlapRatio(base.x0, base.x1, candidate.x0, candidate.x1);

  const sameBand = yOverlap >= 0.14 || normalizedYGap <= 1.55;
  const sameColumn = xOverlap >= 0.08 || normalizedXGap <= 1.35;
  if (!sameBand && !sameColumn) return null;

  return 1 - (normalizedXGap * 0.45 + normalizedYGap * 0.55);
};

export const computeOverlapRatio = (a: TranslatableLine, b: TranslatableLine): number => {
  const overlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const baseWidth = Math.max(1, Math.min(a.right - a.left, b.right - b.left));
  return overlap / baseWidth;
};

export const TECHNICAL_SOURCE_HINT_REGEX = /\b(chapter|table|fig(?:ure)?\.?|conditions?|equilibrium|rigid|body|reaction|moment|force|free[-\s]?body|unknowns?|support|collinear|diagram|objectives?)\b/i;
export const TECHNICAL_TABLE_ROW_HINT_REGEX = /\b(?:table|continued|types?\s+of\s+connection|number\s+of\s+unknowns|reactions?|unknowns?|components?|couple\s+moment|magnitude|direction|resultant|smooth\s+pin|hinge|fixed\s+support|collar|rod|member\s+fixed|bridge|building|beam|welded|column)\b|^\(?\d+\)?$|^(?:fx|fy|fyt|f|m|or)$/i;

export const isHesitantSpeech = (text: string): boolean => {
  const normalized = (text || '').trim();
  return /^[A-Za-z]\s*-\s*[A-Za-z][A-Za-z]{0,3}[!?….-]*$/i.test(normalized);
};

export const shouldMergeLines = (
  previous: TranslatableLine,
  current: TranslatableLine,
  medianHeight: number,
  profile: TranslationGroupingProfile = 'default'
): boolean => {
  const baseHeight = Math.max(8, medianHeight || previous.height || current.height || 8);
  const isDense = profile === 'dense-dialogue';
  const verticalGap = current.top - previous.bottom;
  const overlap = computeOverlapRatio(previous, current);
  const leftDelta = Math.abs(current.left - previous.left);
  const previousCenter = (previous.left + previous.right) * 0.5;
  const currentCenter = (current.left + current.right) * 0.5;
  const centerDelta = Math.abs(currentCenter - previousCenter);

  if (isHesitantSpeech(previous.text) || isHesitantSpeech(current.text)) {
    const tightSameBubble = overlap >= 0.75
      && centerDelta <= baseHeight * 0.8
      && Math.abs(verticalGap) <= baseHeight * 0.25;
    if (!tightSameBubble) {
      return false;
    }
  }
  const centeredStack = isDense && centerDelta <= baseHeight * 1.7;
  const aligned = overlap >= (isDense ? 0.14 : 0.18)
    || leftDelta <= baseHeight * (isDense ? 2.4 : 1.8)
    || centeredStack;
  const continuation = isLikelyContinuation(previous.text, current.text);
  const sameRowSeparatedColumns = Math.abs(current.top - previous.top) <= baseHeight * 1.25
    && overlap <= 0.34
    && centerDelta >= baseHeight * 2.8;
  const sameRowFarSeparatedColumns = Math.abs(current.top - previous.top) <= baseHeight * 1.45
    && overlap <= 0.28
    && centerDelta >= baseHeight * 4.2;

  const previousInterjection = isLikelyStandaloneInterjectionLine(previous.text);
  const currentInterjection = isLikelyStandaloneInterjectionLine(current.text);

  if (previousInterjection || currentInterjection) {
    const tightSameBubble = overlap >= 0.56
      && centerDelta <= baseHeight * 1.05
      && Math.abs(verticalGap) <= baseHeight * 1.25;
    if (!tightSameBubble) {
      return false;
    }
  }

  if (sameRowSeparatedColumns || sameRowFarSeparatedColumns) {
    return false;
  }

  const previousEndsSentence = isStrongSentenceEnd(previous.text)
    && !SOFT_CONTINUATION_END_REGEX.test(previous.text.trim());
  if (previousEndsSentence && !continuation) {
    const wideVerticalBreak = verticalGap >= baseHeight * 1.1;
    if (wideVerticalBreak) {
      return false;
    }
  }

  const isLikelyStandaloneDialogueLine = (text: string): boolean => {
    const normalized = normalizeWhitespace(String(text || ''));
    if (!normalized) return false;
    const tokens = normalized.split(/\s+/g).filter(Boolean);
    if (tokens.length === 0 || tokens.length > 7) return false;
    if (normalized.length > 42) return false;
    if (SOFT_CONTINUATION_END_REGEX.test(normalized)) return false;
    if (CONTINUATION_TRAILING_WORD_REGEX.test(normalized)) return false;

    const latin = normalized.replace(/[^A-Za-z]/g, '');
    const uppercaseRatio = latin.length > 0
      ? latin.replace(/[^A-Z]/g, '').length / latin.length
      : 0;
    const bracketNarration = /^\[[^\]]+\]$/.test(normalized);

    return bracketNarration
      || (!isStrongSentenceEnd(normalized) && (uppercaseRatio >= 0.58 || tokens.length <= 3));
  };

  if (!continuation && verticalGap >= baseHeight * 0.45) {
    const previousStandalone = isLikelyStandaloneDialogueLine(previous.text);
    const currentStandalone = isLikelyStandaloneDialogueLine(current.text);
    const weakColumnLink = overlap < 0.38 && centerDelta >= baseHeight * 1.25;
    if (previousStandalone && currentStandalone && weakColumnLink) {
      return false;
    }
  }

  if (verticalGap <= 0 && aligned) return true;

  const normalGapLimit = baseHeight * (isDense ? 1.85 : 1.15);
  const continuationGapLimit = baseHeight * (isDense ? 2.55 : 1.9);
  const gapLimit = continuation ? continuationGapLimit : normalGapLimit;
  if (verticalGap > gapLimit) return false;

  if (aligned) return true;
  return continuation && verticalGap <= continuationGapLimit;
};

export type GroupingColumn = {
  lines: TranslatableLine[];
  left: number;
  right: number;
  centerX: number;
  firstTop: number;
  lastTop: number;
  lastBottom: number;
};

export const computeGroupingColumnAffinity = (
  column: GroupingColumn,
  line: TranslatableLine,
  baseHeight: number
): number | null => {
  const columnWidth = Math.max(1, column.right - column.left);
  const lineWidth = Math.max(1, line.right - line.left);
  const overlap = overlapRatio(column.left, column.right, line.left, line.right);
  const lineCenterX = (line.left + line.right) * 0.5;
  const centerDelta = Math.abs(lineCenterX - column.centerX);
  const rowDelta = Math.abs(line.top - column.lastTop);
  const verticalGap = line.top - column.lastBottom;
  const normalizedCenterDelta = centerDelta / Math.max(1, Math.max(columnWidth, lineWidth));
  const sameRowButDifferentColumn = rowDelta <= baseHeight * 1.4
    && overlap <= 0.24
    && centerDelta >= baseHeight * 1.35;
  if (sameRowButDifferentColumn) return null;

  const centerAligned = centerDelta <= Math.max(34, Math.min(columnWidth, lineWidth) * 0.48, baseHeight * 1.55);
  const leftAligned = Math.abs(line.left - column.left) <= Math.max(42, baseHeight * 2.2);
  const canBridge = overlap >= 0.2 || (centerAligned && leftAligned && rowDelta <= baseHeight * 1.95);
  if (!canBridge) return null;

  const outsideVerticalBand = verticalGap > baseHeight * 3.3 || verticalGap < -baseHeight * 0.95;
  if (outsideVerticalBand) return null;

  const backwardsPenalty = line.top < column.lastTop - baseHeight * 0.8 ? 1.6 : 0;
  const stretchedGapPenalty = verticalGap > baseHeight * 1.9
    ? ((verticalGap - (baseHeight * 1.9)) / Math.max(1, baseHeight)) * 1.25
    : 0;
  return overlap * 5.8 - normalizedCenterDelta * 2.8 - backwardsPenalty - stretchedGapPenalty;
};

export const orderLinesForGrouping = (lines: TranslatableLine[], medianHeight: number): TranslatableLine[] => {
  if (lines.length <= 2) return [...lines];

  const seeded = [...lines].sort((a, b) => {
    if (a.top !== b.top) return a.top - b.top;
    if (a.left !== b.left) return a.left - b.left;
    return a.index - b.index;
  });

  const baseHeight = Math.max(8, medianHeight || computeMedian(seeded.map((line) => Math.max(1, line.height))));
  const columns: GroupingColumn[] = [];

  seeded.forEach((line) => {
    let bestColumnIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < columns.length; i += 1) {
      const score = computeGroupingColumnAffinity(columns[i], line, baseHeight);
      if (score === null) continue;
      if (score > bestScore) {
        bestScore = score;
        bestColumnIndex = i;
      }
    }

    if (bestColumnIndex < 0 || bestScore < -2.1) {
      columns.push({
        lines: [line],
        left: line.left,
        right: line.right,
        centerX: (line.left + line.right) * 0.5,
        firstTop: line.top,
        lastTop: line.top,
        lastBottom: line.bottom,
      });
      return;
    }

    const column = columns[bestColumnIndex];
    column.lines.push(line);
    column.left = Math.min(column.left, line.left);
    column.right = Math.max(column.right, line.right);
    column.centerX = (column.left + column.right) * 0.5;
    column.lastTop = line.top;
    column.lastBottom = Math.max(column.lastBottom, line.bottom);
  });

  const orderedColumns = columns
    .map((column) => ({
      ...column,
      lines: [...column.lines].sort((a, b) => {
        if (a.top !== b.top) return a.top - b.top;
        if (a.left !== b.left) return a.left - b.left;
        return a.index - b.index;
      }),
    }))
    .sort((a, b) => {
      const topDelta = a.firstTop - b.firstTop;
      const verticalOverlap = intervalOverlap(a.firstTop, a.lastBottom, b.firstTop, b.lastBottom);
      const minColumnSpan = Math.max(1, Math.min(
        Math.max(1, a.lastBottom - a.firstTop),
        Math.max(1, b.lastBottom - b.firstTop)
      ));
      const overlap = verticalOverlap / minColumnSpan;
      const sameReadingBand = overlap >= 0.16 || Math.abs(topDelta) <= baseHeight * 1.35;
      if (sameReadingBand) {
        if (a.left !== b.left) return a.left - b.left;
        if (a.centerX !== b.centerX) return a.centerX - b.centerX;
      }
      if (topDelta !== 0) return topDelta;
      if (a.left !== b.left) return a.left - b.left;
      return a.centerX - b.centerX;
    });

  return orderedColumns.flatMap((column) => column.lines);
};

export const computeLineHorizontalGap = (a: TranslatableLine, b: TranslatableLine): number =>
  Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));

export const computeLineVerticalGap = (a: TranslatableLine, b: TranslatableLine): number =>
  Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));

export const shouldConnectDenseDialogueLines = (
  a: TranslatableLine,
  b: TranslatableLine,
  baseHeight: number
): boolean => {
  const overlapX = overlapRatio(a.left, a.right, b.left, b.right);
  const overlapY = overlapRatio(a.top, a.bottom, b.top, b.bottom);
  const horizontalGap = computeLineHorizontalGap(a, b);
  const verticalGap = computeLineVerticalGap(a, b);

  const centerAx = (a.left + a.right) * 0.5;
  const centerBx = (b.left + b.right) * 0.5;
  const centerDeltaX = Math.abs(centerAx - centerBx);

  const widthA = Math.max(1, a.right - a.left);
  const widthB = Math.max(1, b.right - b.left);
  const minWidth = Math.max(1, Math.min(widthA, widthB));

  const hesitantA = isHesitantSpeech(a.text);
  const hesitantB = isHesitantSpeech(b.text);
  if (hesitantA || hesitantB) {
    const tightSameBubble = overlapX >= 0.75
      && centerDeltaX <= baseHeight * 0.8
      && verticalGap <= baseHeight * 0.25;
    if (!tightSameBubble) {
      return false;
    }
  }

  const interjectionA = isLikelyStandaloneInterjectionLine(a.text);
  const interjectionB = isLikelyStandaloneInterjectionLine(b.text);
  if (interjectionA || interjectionB) {
    const tightSameBubble = overlapX >= 0.56
      && centerDeltaX <= baseHeight * 1.05
      && verticalGap <= baseHeight * 1.3;
    if (!tightSameBubble) {
      return false;
    }
  }

  const sameRowSeparatedColumns = overlapY >= 0.24
    && overlapX <= 0.18
    && horizontalGap >= baseHeight * 0.9
    && centerDeltaX >= baseHeight * 1.9;
  if (sameRowSeparatedColumns) return false;

  const verticallyStacked = overlapX >= 0.24
    && verticalGap <= baseHeight * 1.95
    && centerDeltaX <= Math.max(96, minWidth * 0.9);
  const tightlyStacked = overlapX >= 0.16
    && verticalGap <= baseHeight * 1.15
    && centerDeltaX <= Math.max(72, minWidth * 0.66);
  const nearDiagonalInBubble = overlapX >= 0.2
    && verticalGap <= baseHeight * 1.4
    && horizontalGap <= Math.max(42, baseHeight * 1.4)
    && centerDeltaX <= Math.max(86, minWidth * 1.08);
  const strongContainment = overlapX >= 0.55 && overlapY >= 0.35;

  if (verticallyStacked || tightlyStacked || nearDiagonalInBubble || strongContainment) {
    return true;
  }

  return false;
};

export const buildDenseDialogueGroupsByConnectivity = (
  orderedLines: TranslatableLine[],
  medianHeight: number
): TranslationGroup[] => {
  if (orderedLines.length === 0) return [];
  if (orderedLines.length === 1) return [{ lines: [orderedLines[0]] }];

  const baseHeight = Math.max(8, medianHeight || computeMedian(orderedLines.map((line) => Math.max(1, line.height))));
  const parent = orderedLines.map((_, index) => index);

  const find = (index: number): number => {
    let current = index;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };

  const unite = (aIndex: number, bIndex: number): void => {
    const rootA = find(aIndex);
    const rootB = find(bIndex);
    if (rootA === rootB) return;
    parent[rootB] = rootA;
  };

  for (let i = 0; i < orderedLines.length; i += 1) {
    for (let j = i + 1; j < orderedLines.length; j += 1) {
      if (shouldConnectDenseDialogueLines(orderedLines[i], orderedLines[j], baseHeight)) {
        unite(i, j);
      }
    }
  }

  const grouped = new Map<number, TranslatableLine[]>();
  orderedLines.forEach((line, index) => {
    const root = find(index);
    const bucket = grouped.get(root) || [];
    bucket.push(line);
    grouped.set(root, bucket);
  });

  return Array.from(grouped.values())
    .map((bucket) => {
      const lines = orderLinesForGrouping(bucket, baseHeight);

      return {
        lines,
        bounds: {
          top: Math.min(...lines.map((line) => line.top)),
          bottom: Math.max(...lines.map((line) => line.bottom)),
          left: Math.min(...lines.map((line) => line.left)),
          right: Math.max(...lines.map((line) => line.right)),
        },
      };
    })
    .sort((a, b) => {
      const topDelta = a.bounds.top - b.bounds.top;
      const verticalOverlap = intervalOverlap(a.bounds.top, a.bounds.bottom, b.bounds.top, b.bounds.bottom);
      const minGroupSpan = Math.max(1, Math.min(
        Math.max(1, a.bounds.bottom - a.bounds.top),
        Math.max(1, b.bounds.bottom - b.bounds.top)
      ));
      const overlap = verticalOverlap / minGroupSpan;
      const sameReadingBand = overlap >= 0.16 || Math.abs(topDelta) <= baseHeight * 1.35;

      if (sameReadingBand) {
        if (a.bounds.left !== b.bounds.left) return a.bounds.left - b.bounds.left;
      }

      if (topDelta !== 0) return topDelta;
      if (a.bounds.left !== b.bounds.left) return a.bounds.left - b.bounds.left;
      return a.bounds.right - b.bounds.right;
    })
    .map((bucket) => ({ lines: bucket.lines }));
};

export const buildTranslationGroups = (
  lines: TranslatableLine[],
  profile: TranslationGroupingProfile = 'default'
): TranslationGroup[] => {
  if (lines.length === 0) return [];

  const heights = lines.map((line) => Math.max(1, line.height));
  const medianHeight = computeMedian(heights);
  const orderedForGrouping = orderLinesForGrouping(lines, medianHeight);

  if (profile === 'line-by-line') {
    return orderedForGrouping.map((line) => ({ lines: [line] }));
  }

  if (profile === 'dense-dialogue' && orderedForGrouping.length >= 3) {
    return buildDenseDialogueGroupsByConnectivity(orderedForGrouping, medianHeight);
  }

  const groups: TranslationGroup[] = [];
  let currentGroup: TranslatableLine[] = [orderedForGrouping[0]];

  for (let i = 1; i < orderedForGrouping.length; i += 1) {
    const previous = currentGroup[currentGroup.length - 1];
    const current = orderedForGrouping[i];
    if (shouldMergeLines(previous, current, medianHeight, profile)) {
      currentGroup.push(current);
      continue;
    }

    groups.push({ lines: currentGroup });
    currentGroup = [current];
  }

  if (currentGroup.length > 0) {
    groups.push({ lines: currentGroup });
  }

  return groups;
};

export const shouldUseDenseDialogueGrouping = (
  lines: TranslatableLine[],
  sourceLanguage: string,
  targetLanguage: string,
  mode: TranslationMode
): boolean => {
  const normalizedSource = normalizeTranslationLanguage(sourceLanguage, 'en');
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  if (normalizedTarget !== 'th') return false;
  const avgLength = lines.reduce((sum, line) => sum + line.text.length, 0) / Math.max(1, lines.length);
  const technicalHits = lines.reduce((count, line) => count + (TECHNICAL_SOURCE_HINT_REGEX.test(line.text) ? 1 : 0), 0);
  const longSentenceLines = lines.filter((line) => {
    const normalized = normalizeWhitespace(String(line.text || ''));
    return normalized.length >= 44 || normalized.split(/\s+/g).filter(Boolean).length >= 8;
  }).length;
  const looksDocumentLike = technicalHits >= 2 || longSentenceLines >= 3 || avgLength >= 24;

  if (mode === 'adaptive' && looksDocumentLike) {
    return false;
  }

  if (mode === 'manga') {
    return ['en', 'ja', 'ko', 'zh', 'es'].includes(normalizedSource);
  }

  if (mode === 'manhwa') {
    return normalizedSource === 'ko' || normalizedSource === 'en';
  }

  if (mode === 'adaptive') {
    return ['en', 'ja', 'ko', 'zh', 'es'].includes(normalizedSource);
  }

  return normalizedSource === 'ko' || normalizedSource === 'es';
};

export const isLikelyComicDialogueLayout = (lines: TranslatableLine[]): boolean => {
  if (lines.length < 4) return false;

  const widths = lines.map((line) => Math.max(1, line.right - line.left));
  const heights = lines.map((line) => Math.max(1, line.height));
  const medianWidth = computeMedian(widths);
  const medianHeight = computeMedian(heights);
  const shortLineCount = lines.filter((line) => normalizeWhitespace(String(line.text || '')).length <= 34).length;
  const narrowOrBubbleLikeCount = lines.filter((line) => {
    const width = Math.max(1, line.right - line.left);
    const height = Math.max(1, line.height);
    const aspect = width / Math.max(1, height);
    return aspect <= 8.0 || width <= medianWidth * 0.95 || height >= medianHeight * 1.15;
  }).length;
  const longPunctuatedCount = lines.filter((line) => {
    const text = normalizeWhitespace(String(line.text || ''));
    return text.length >= 20 && /[.,;:]/.test(text);
  }).length;

  const result = (
    shortLineCount >= Math.ceil(lines.length * 0.62)
    && narrowOrBubbleLikeCount >= Math.ceil(lines.length * 0.58)
    && longPunctuatedCount <= Math.max(1, Math.floor(lines.length * 0.24))
  );
  return result;
};

export const shouldForceLineByLineForOfflinePanel = (lines: TranslatableLine[]): boolean => {
  if (lines.length < 3) return false;

  const normalizedLines = lines.map((line) => normalizeWhitespace(String(line.text || ''))).filter(Boolean);
  if (normalizedLines.length < 3) return false;

  const avgLength = normalizedLines.reduce((sum, text) => sum + text.length, 0) / normalizedLines.length;
  const technicalHits = normalizedLines.filter((text) => TECHNICAL_SOURCE_HINT_REGEX.test(text)).length;
  if (technicalHits < 3) return false;
  const shortLineCount = normalizedLines.filter((text) => text.length <= 34).length;
  const uppercaseDominantCount = normalizedLines.filter((text) => {
    const letters = text.replace(/[^A-Za-z]/g, '');
    if (letters.length < 5) return false;
    return letters === letters.toUpperCase();
  }).length;
  const hasBracketNarration = normalizedLines.some((text) => /\[[^\]]{4,}\]/.test(text));
  const hasPossessiveCompound = normalizedLines.some((text) => /\b[A-Za-z]{3,}['’]S[A-Za-z]{3,}\b/.test(text));

  const mostlyShort = shortLineCount >= Math.ceil(normalizedLines.length * 0.7);
  const mostlyUppercase = uppercaseDominantCount >= Math.ceil(normalizedLines.length * 0.5);
  if (normalizedLines.length >= 5 && mostlyShort && avgLength >= 18 && avgLength <= 38 && technicalHits >= 4) {
    return true;
  }

  return mostlyShort && mostlyUppercase && (hasBracketNarration || hasPossessiveCompound);
};

export const shouldUseLineByLineGrouping = (
  lines: TranslatableLine[],
  sourceLanguage: string,
  targetLanguage: string,
  engine: 'offline' | 'ai' | 'm2m100',
  mode: TranslationMode
): boolean => {
  const normalizedSource = normalizeTranslationLanguage(sourceLanguage, 'en');
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  if (normalizedTarget !== 'th') return false;
  if (lines.length <= 4) return false;

  const markerHits = lines.reduce((count, line) => count + (TECHNICAL_SOURCE_HINT_REGEX.test(line.text) ? 1 : 0), 0);
  const tableRowSignalCount = lines.reduce((count, line) => {
    const normalized = normalizeWhitespace(String(line.text || ''));
    return count + (TECHNICAL_TABLE_ROW_HINT_REGEX.test(normalized) ? 1 : 0);
  }, 0);
  const latinHeavyLineCount = lines.filter((line) => {
    const normalized = normalizeWhitespace(String(line.text || ''));
    const latinChars = (normalized.match(/[A-Za-z]/g) || []).length;
    const nonSpaceChars = normalized.replace(/\s+/g, '').length;
    const latinRatio = latinChars / Math.max(1, nonSpaceChars);
    return latinChars >= 8 && latinRatio >= 0.45;
  }).length;
  const avgLength = lines.reduce((sum, line) => sum + line.text.length, 0) / Math.max(1, lines.length);
  const longSentenceLines = lines.filter((line) => {
    const normalized = normalizeWhitespace(String(line.text || ''));
    const tokenCount = normalized.split(/\s+/g).filter(Boolean).length;
    return normalized.length >= 48
      || (normalized.length >= 20 && /[.,;:]/.test(normalized))
      || tokenCount >= 8;
  }).length;
  const shortLineCount = lines.filter((line) => {
    const normalized = normalizeWhitespace(String(line.text || ''));
    return normalized.length > 0 && normalized.length <= 36;
  }).length;
  const compactTechnicalRowCount = lines.filter((line) => {
    const normalized = normalizeWhitespace(String(line.text || ''));
    const tokenCount = normalized.split(/\s+/g).filter(Boolean).length;
    return tokenCount >= 2
      && tokenCount <= 9
      && (
        TECHNICAL_TABLE_ROW_HINT_REGEX.test(normalized)
        || (
          TECHNICAL_SOURCE_HINT_REGEX.test(normalized)
          && normalized.length <= 56
        )
      );
  }).length;
  const uppercaseHeadingLines = lines.filter((line) => {
    const latin = line.text.replace(/[^A-Za-z]/g, '');
    if (latin.length < 5) return false;
    const upperRatio = latin.replace(/[^A-Z]/g, '').length / latin.length;
    return upperRatio >= 0.72;
  }).length;
  const tableLikeTechnicalDocument = markerHits >= 3
    && shortLineCount >= Math.ceil(lines.length * 0.45)
    && tableRowSignalCount >= Math.max(4, Math.floor(lines.length * 0.28));
  const mixedTechnicalEvidence = markerHits >= 2
    && latinHeavyLineCount >= 3
    && (longSentenceLines >= 1 || tableRowSignalCount >= 2);
  const strongTechnicalDocument = markerHits >= 3
    && longSentenceLines >= 3
    && avgLength >= 21
    && uppercaseHeadingLines >= 1;
  const compactTechnicalRowPage = markerHits >= 1
    && compactTechnicalRowCount >= Math.max(3, Math.floor(lines.length * 0.32))
    && shortLineCount >= Math.ceil(lines.length * 0.4)
    && latinHeavyLineCount >= Math.max(2, Math.floor(lines.length * 0.24));
  const technicalEvidenceStrong = (
    tableLikeTechnicalDocument
    || strongTechnicalDocument
    || mixedTechnicalEvidence
    || compactTechnicalRowPage
  );

  if ((mode === 'manga' || mode === 'manhwa') && tableLikeTechnicalDocument) {
    return true;
  }

  if (mode !== 'official' && mode !== 'adaptive') return false;

  return technicalEvidenceStrong;
};

export const shouldUseBalloonAwareGrouping = (
  lines: TranslatableLine[],
  sourceLanguage: string,
  targetLanguage: string,
  mode: TranslationMode
): boolean => {
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  if (normalizedTarget !== 'th') return false;
  if (lines.length < 2) return false;
  if (mode === 'official') return false;

  const technicalHits = lines.reduce((count, line) => count + (TECHNICAL_SOURCE_HINT_REGEX.test(line.text) ? 1 : 0), 0);
  const technicalRowHits = lines.reduce((count, line) => count + (TECHNICAL_TABLE_ROW_HINT_REGEX.test(normalizeWhitespace(line.text)) ? 1 : 0), 0);
  if (technicalHits >= 3 || technicalRowHits >= Math.max(3, Math.floor(lines.length * 0.24))) {
    return false;
  }

  const normalizedSource = normalizeTranslationLanguage(sourceLanguage, 'en');
  const comicLike = isLikelyComicDialogueLayout(lines);
  if (mode === 'manga' || mode === 'manhwa') {
    return comicLike || ['en', 'es', 'ja', 'ko', 'zh'].includes(normalizedSource);
  }

  if (mode === 'adaptive') {
    return comicLike;
  }

  return false;
};

export const resolveBalloonAwareReadingMode = (
  sourceLanguage: string,
  mode: TranslationMode
): LayoutReadingMode => {
  const normalizedSource = normalizeTranslationLanguage(sourceLanguage, 'en');
  if (mode === 'manga' && normalizedSource === 'ja') {
    return 'rtl';
  }
  if (mode === 'manhwa' || normalizedSource === 'ko' || normalizedSource === 'zh') {
    return 'auto';
  }
  return 'ltr';
};

export const shouldPreferEnglishSourceForMixedTechnicalPage = (
  lines: TranslatableLine[],
  inferredSourceLanguage: string,
  targetLanguage: string,
  mode: TranslationMode
): boolean => {
  const normalizedSource = normalizeTranslationLanguage(inferredSourceLanguage, 'en');
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  if (normalizedTarget !== 'th') return false;
  if (mode !== 'official' && mode !== 'adaptive') return false;
  if (normalizedSource === 'en') return false;

  const latinHeavyLineCount = lines.filter((line) => {
    const normalized = normalizeWhitespace(String(line.text || ''));
    const latinChars = (normalized.match(/[A-Za-z]/g) || []).length;
    const nonSpaceChars = normalized.replace(/\s+/g, '').length;
    const latinRatio = latinChars / Math.max(1, nonSpaceChars);
    return latinChars >= 8 && latinRatio >= 0.5;
  }).length;

  if (latinHeavyLineCount < 3) return false;

  const technicalHintCount = lines.reduce((count, line) => (
    count + (TECHNICAL_SOURCE_HINT_REGEX.test(String(line.text || '')) ? 1 : 0)
  ), 0);
  const longLatinSentenceCount = lines.filter((line) => {
    const normalized = normalizeWhitespace(String(line.text || ''));
    const latinChars = (normalized.match(/[A-Za-z]/g) || []).length;
    const tokenCount = normalized.split(/\s+/g).filter(Boolean).length;
    return latinChars >= 12 && tokenCount >= 5 && /[.,;:]/.test(normalized);
  }).length;

  return technicalHintCount >= 2 || longLatinSentenceCount >= 2;
};
