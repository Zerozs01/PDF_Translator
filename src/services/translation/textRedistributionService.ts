import { TranslatableLine } from '../layout/dialogueGroupingService';
import {
  normalizeWhitespace,
  normalizeTranslationLanguage,
  normalizeThaiTranslationText,
} from '../ocr/ocrTextNormalizer';
import { normalizeOverlayInlineText } from '../../components/OCR/translationOverlayUtils';

export const findSplitIndexNear = (
  text: string,
  desired: number,
  min: number,
  max: number
): number => {
  const clampedDesired = Math.max(min, Math.min(max, desired));
  const maxRadius = 18;

  for (let radius = 0; radius <= maxRadius; radius += 1) {
    const right = clampedDesired + radius;
    if (right <= max) {
      const c = text[right];
      if (/[\s,.;:!?\u3001\u3002\uFF0C\uFF01\uFF1F]/.test(c || '')) {
        return right;
      }
    }

    const left = clampedDesired - radius;
    if (left >= min) {
      const c = text[left];
      if (/[\s,.;:!?\u3001\u3002\uFF0C\uFF01\uFF1F]/.test(c || '')) {
        return left;
      }
    }
  }

  return clampedDesired;
};

export const computeLineSplitWeight = (line: TranslatableLine): number => {
  const width = Math.max(1, line.right - line.left);
  const height = Math.max(1, line.height);
  const areaScore = Math.sqrt(width * height) * 0.12;
  return Math.max(1, line.sourceLength * 0.82 + areaScore);
};

export const tokenizeRedistributedPart = (value: string, targetLanguage: string): string[] => {
  const normalized = normalizeWhitespace(String(value || ''));
  if (!normalized) return [];

  if (normalizeTranslationLanguage(targetLanguage, 'th') === 'th') {
    const intlWithSegmenter = Intl as unknown as {
      Segmenter?: new (
        locales?: string | string[],
        options?: { granularity?: 'grapheme' | 'word' | 'sentence' }
      ) => {
        segment: (input: string) => Iterable<{ segment: string; isWordLike?: boolean }>;
      };
    };
    if (intlWithSegmenter.Segmenter) {
      const wordSeg = new intlWithSegmenter.Segmenter('th', { granularity: 'word' });
      return Array.from(wordSeg.segment(normalized))
        .map((item) => item.segment)
        .filter((segment) => segment.trim().length > 0);
    }
    return Array.from(normalized).filter((segment) => segment.trim().length > 0);
  }

  return normalized.split(/\s+/g).filter(Boolean);
};

export const joinRedistributedTokens = (tokens: string[], targetLanguage: string): string => {
  if (tokens.length === 0) return '';
  if (normalizeTranslationLanguage(targetLanguage, 'th') === 'th') {
    return tokens.join('');
  }
  return tokens.join(' ');
};

export const rebalanceRedistributedParts = (
  parts: string[],
  sourceLines: TranslatableLine[],
  targetText: string,
  targetLanguage: string
): string[] => {
  const normalizedTarget = normalizeWhitespace(String(targetText || ''));
  const normalizedParts = sourceLines.map((_, index) => normalizeWhitespace(String(parts[index] || '')));

  if (normalizedParts.every((part) => part.length > 0)) {
    return normalizedParts;
  }

  for (let i = 0; i < normalizedParts.length; i += 1) {
    if (normalizedParts[i]) continue;

    let donorIndex = -1;
    let donorScore = Number.NEGATIVE_INFINITY;

    for (let j = 0; j < normalizedParts.length; j += 1) {
      if (i === j) continue;
      const tokens = tokenizeRedistributedPart(normalizedParts[j], targetLanguage);
      if (tokens.length <= 1) continue;

      const score = tokens.length * 10 - Math.abs(j - i);
      if (score > donorScore) {
        donorScore = score;
        donorIndex = j;
      }
    }

    if (donorIndex >= 0) {
      const donorTokens = tokenizeRedistributedPart(normalizedParts[donorIndex], targetLanguage);
      const takeTail = donorIndex < i;
      const moved = takeTail ? donorTokens.pop() : donorTokens.shift();
      if (moved) {
        normalizedParts[i] = moved;
        normalizedParts[donorIndex] = joinRedistributedTokens(donorTokens, targetLanguage);
      }
    }
  }

  if (normalizedParts.every((part) => part.length > 0) || !normalizedTarget) {
    return normalizedParts;
  }

  if (normalizeTranslationLanguage(targetLanguage, 'th') === 'th') {
    // For Thai, do not force-slice target text by character index to fill empty lines,
    // as it chops Thai words into unreadable letters/diacritics. Keep them empty/clean.
    return normalizedParts;
  }

  const partCount = Math.max(1, normalizedParts.length);
  for (let i = 0; i < normalizedParts.length; i += 1) {
    if (normalizedParts[i]) continue;

    const start = Math.floor((i / partCount) * normalizedTarget.length);
    const end = Math.ceil(((i + 1) / partCount) * normalizedTarget.length);
    const chunk = normalizeWhitespace(normalizedTarget.slice(start, end));
    if (chunk) {
      normalizedParts[i] = chunk;
    }
  }

  return normalizedParts;
};

export const THAI_PARTICLES = /^(นะ|ครับ|ค่ะ|สิ|นา|ด้วย|เลย|หน่อย|ล่ะ|จ้า|จ๊ะ|นี่)$/;

export const glueTrailingParticles = (slots: string[]): string[] => {
  const result = [...slots];
  for (let i = 0; i < result.length - 1; i++) {
    const nextSlot = result[i + 1].trim();
    if (!nextSlot) continue;

    const intlWithSegmenter = Intl as unknown as {
      Segmenter?: new (
        locales?: string | string[],
        options?: { granularity?: 'grapheme' | 'word' | 'sentence' }
      ) => {
        segment: (input: string) => Iterable<{ segment: string; isWordLike?: boolean }>;
      };
    };

    if (intlWithSegmenter.Segmenter) {
      const segmenter = new intlWithSegmenter.Segmenter('th', { granularity: 'word' });
      const segments = Array.from(segmenter.segment(nextSlot));
      const firstWordSeg = segments.find((s) => s.segment.trim().length > 0);

      if (firstWordSeg && THAI_PARTICLES.test(firstWordSeg.segment)) {
        const particle = firstWordSeg.segment;
        result[i] = result[i] + particle;
        const particleIdx = result[i + 1].indexOf(particle);
        if (particleIdx >= 0) {
          result[i + 1] = (
            result[i + 1].slice(0, particleIdx) +
            result[i + 1].slice(particleIdx + particle.length)
          ).trim();
        }
      }
    }
  }
  return result;
};

export const isRedistributionPlausible = (
  sourceLinesCount: number,
  redistributedSlots: string[]
): boolean => {
  if (sourceLinesCount <= 1) return true;
  const emptySlots = redistributedSlots.filter((s) => !s.trim()).length;
  const emptyRatio = emptySlots / sourceLinesCount;
  return emptyRatio < 0.4;
};

export const splitTranslatedTextBySourceWeights = (
  translatedText: string,
  sourceLines: TranslatableLine[],
  targetLanguage: string
): string[] => {
  const target = normalizeWhitespace(translatedText);
  if (sourceLines.length <= 1) return [target];
  if (!target) return sourceLines.map(() => '');

  const explicitLineBreaks = translatedText
    .replace(/\\n/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .split(/\r?\n+/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);

  if (explicitLineBreaks.length === sourceLines.length) {
    return rebalanceRedistributedParts(explicitLineBreaks, sourceLines, target, targetLanguage);
  }

  if (explicitLineBreaks.length > 1) {
    const result: string[] = [];
    for (let i = 0; i < sourceLines.length; i++) {
      if (i === sourceLines.length - 1 && explicitLineBreaks.length > sourceLines.length) {
        result.push(explicitLineBreaks.slice(i).join(' '));
      } else {
        result.push(explicitLineBreaks[i] || '');
      }
    }
    return result;
  }

  const isThaiTarget = normalizeTranslationLanguage(targetLanguage, 'th') === 'th';
  if (isThaiTarget) {
    const intlWithSegmenter = Intl as unknown as {
      Segmenter?: new (
        locales?: string | string[],
        options?: { granularity?: 'grapheme' | 'word' | 'sentence' }
      ) => {
        segment: (input: string) => Iterable<{ segment: string; isWordLike?: boolean }>;
      };
    };

    const buildSegments = (): string[] => {
      if (intlWithSegmenter.Segmenter) {
        const wordSeg = new intlWithSegmenter.Segmenter('th', { granularity: 'word' });
        const wordSegments = Array.from(wordSeg.segment(target)).map((item) => item.segment);
        if (wordSegments.length > 0) {
          return wordSegments;
        }
      }
      return Array.from(target);
    };

    const segments = buildSegments();
    const totalSourceChars = sourceLines.reduce((sum, l) => sum + (l.text || '').length, 0) || 1;

    // Calculate cumulative character weights of source lines
    const cumulativeSourceWeights: number[] = [];
    let currentSum = 0;
    for (let i = 0; i < sourceLines.length; i++) {
      currentSum += (sourceLines[i].text || '').length;
      cumulativeSourceWeights.push(currentSum);
    }

    // Calculate cumulative char budgets in target string
    const cumulativeTargetBudgets = cumulativeSourceWeights.map((w) =>
      Math.round((w / totalSourceChars) * target.length)
    );

    // Compute segment lengths and cumulative lengths
    const segmentLengths = segments.map((s) => s.length);
    const cumulativeSegmentLengths: number[] = [];
    let segSum = 0;
    for (let i = 0; i < segments.length; i++) {
      segSum += segmentLengths[i];
      cumulativeSegmentLengths.push(segSum);
    }

    const thaiParts: string[] = [];
    let currentSegStart = 0;

    for (let slot = 0; slot < sourceLines.length; slot++) {
      const isLast = slot === sourceLines.length - 1;
      if (isLast) {
        thaiParts.push(segments.slice(currentSegStart).join('').trim());
        break;
      }

      const targetCumulativeEnd = cumulativeTargetBudgets[slot];

      // Find the segment index that gets closest to targetCumulativeEnd
      let bestSegEnd = currentSegStart;
      let minDifference = Infinity;

      for (let idx = currentSegStart; idx < segments.length; idx++) {
        const cumLen = cumulativeSegmentLengths[idx];
        const diff = Math.abs(cumLen - targetCumulativeEnd);

        // Ensure we leave at least one segment per remaining slot
        const remainingSlots = sourceLines.length - 1 - slot;
        if (segments.length - 1 - idx < remainingSlots) {
          break;
        }

        if (diff <= minDifference) {
          minDifference = diff;
          bestSegEnd = idx + 1;
        } else {
          // Since cumulativeSegmentLengths is monotonically increasing,
          // once the difference starts growing, it will continue to grow.
          break;
        }
      }

      // Safe fallback: at least consume one segment if we haven't consumed any
      if (bestSegEnd <= currentSegStart && currentSegStart < segments.length) {
        bestSegEnd = currentSegStart + 1;
      }

      const part = segments.slice(currentSegStart, bestSegEnd).join('').trim();
      thaiParts.push(part);
      currentSegStart = bestSegEnd;
    }

    const finalParts = glueTrailingParticles(thaiParts);
    if (!isRedistributionPlausible(sourceLines.length, finalParts)) {
      console.warn(`[splitTranslatedTextBySourceWeights] Thai redistribution implausible. Rebalancing segments across all slots.`);
      const intlWithSeg = Intl as unknown as { Segmenter?: new (locales?: string, options?: any) => any };
      let allWords: string[] = [];
      if (intlWithSeg.Segmenter) {
        const seg = new intlWithSeg.Segmenter('th', { granularity: 'word' });
        allWords = Array.from(seg.segment(target)).map((item: any) => item.segment);
      } else {
        allWords = Array.from(target);
      }
      
      const count = sourceLines.length;
      const rebalanced: string[] = [];
      let wIdx = 0;
      for (let s = 0; s < count; s++) {
        const remainingSlots = count - s;
        const targetWordsForSlot = Math.max(1, Math.ceil((allWords.length - wIdx) / remainingSlots));
        const endWIdx = s === count - 1 ? allWords.length : Math.min(allWords.length, wIdx + targetWordsForSlot);
        rebalanced.push(allWords.slice(wIdx, endWIdx).join('').trim());
        wIdx = endWIdx;
      }
      return rebalanced;
    }
    return rebalanceRedistributedParts(finalParts, sourceLines, target, targetLanguage);
  }

  const totalSource = sourceLines
    .map((line) => computeLineSplitWeight(line))
    .reduce((acc, n) => acc + n, 0);

  const parts: string[] = [];
  let start = 0;

  for (let i = 0; i < sourceLines.length; i += 1) {
    if (i === sourceLines.length - 1) {
      parts.push(target.slice(start).trim());
      break;
    }

    const consumedSource = sourceLines
      .slice(0, i + 1)
      .map((line) => computeLineSplitWeight(line))
      .reduce((acc, n) => acc + n, 0);
    const desiredEnd = Math.round((consumedSource / totalSource) * target.length);
    const min = start + 1;
    const max = Math.max(min, target.length - (sourceLines.length - i - 1));
    const end = findSplitIndexNear(target, desiredEnd, min, max);
    parts.push(target.slice(start, end).trim());
    start = end;
  }

  return rebalanceRedistributedParts(parts, sourceLines, target, targetLanguage);
};

export const resolveRedistributedLineFallback = (
  sourceLineText: string,
  groupText: string,
  targetLanguage: string,
  lineIndex: number = 0,
  totalLines: number = 1
): string => {
  const source = normalizeWhitespace(String(sourceLineText || ''));
  const normalizedGroup = normalizeWhitespace(String(groupText || ''));
  const isThaiTarget = normalizeTranslationLanguage(targetLanguage, 'th') === 'th';

  if (normalizedGroup) {
    const clampedTotal = Math.max(1, totalLines);
    const clampedIndex = Math.max(0, Math.min(clampedTotal - 1, lineIndex));

    if (clampedTotal > 1) {
      const sentenceChunks = normalizedGroup
        .split(/(?<=[.!?…。！？])\s+/)
        .map((chunk) => normalizeWhitespace(chunk))
        .filter(Boolean);

      if (sentenceChunks.length === clampedTotal) {
        const sentenceChunk = sentenceChunks[clampedIndex];
        if (sentenceChunk) return sentenceChunk;
      }

      if (normalizedGroup.length >= clampedTotal * 3) {
        if (!isThaiTarget) {
          const start = Math.floor((clampedIndex / clampedTotal) * normalizedGroup.length);
          const end = Math.ceil(((clampedIndex + 1) / clampedTotal) * normalizedGroup.length);
          const proportionalChunk = normalizeWhitespace(normalizedGroup.slice(start, end));
          if (proportionalChunk) return proportionalChunk;
        } else {
          // For Thai, we do not want proportional slicing as it shreds words.
          // Return empty string so it falls back to the original English line text naturally.
          return '';
        }
      }

      // Duplication Prevention: For multi-line groups, if we haven't found any valid split
      // for subsequent lines (index > 0), return empty string to prevent duplicating the whole group.
      if (clampedIndex > 0) {
        return '';
      }
    }

    if (isThaiTarget) {
      const normalizedGroupThai = normalizeThaiTranslationText(normalizedGroup);
      if (normalizedGroupThai) return normalizedGroupThai;
    }

    return normalizedGroup;
  }

  if (isThaiTarget) {
    const normalizedSource = normalizeThaiTranslationText(source);
    if (normalizedSource) return normalizedSource;
  }

  return source;
};

export const isSourceFallbackOverlayText = (sourceText: string, translatedText: string): boolean => {
  const source = normalizeOverlayInlineText(String(sourceText || ''));
  const translated = normalizeOverlayInlineText(String(translatedText || ''));
  if (Boolean(source && translated && source === translated)) return true;

  const sourceKey = String(sourceText || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]+/g, '');
  const translatedKey = String(translatedText || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]+/g, '');
  return Boolean(sourceKey && translatedKey && sourceKey === translatedKey);
};
