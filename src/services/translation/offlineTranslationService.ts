/**
 * Offline Translation Service — Facade & Batch Execution Coordinator
 * 
 * [Scrutinize S3]: Refactored & Modularized
 * - Short phrase dictionary & fallbacks -> shortPhraseDictionaryService.ts
 * - Quality scoring, heuristics & carryover evaluation -> translationQualityService.ts
 * - Offline batch execution & UI typography scale -> offlineTranslationService.ts
 */

import type { TranslationMode } from '../../stores/useProjectStore';
import {
  normalizeWhitespace,
  normalizeSourceForTranslation,
  normalizeTranslationLanguage,
  cleanJapaneseOcrSpacing,
  cleanKoreanOcrSpacing,
  normalizeJapaneseOcrNoiseForTranslation,
  normalizeKoreanOcrNoiseForTranslation,
} from '../ocr/ocrTextNormalizer';

import {
  normalizeOverlayInlineText,
  type OverlayTypography,
} from '../../components/OCR/translationOverlayUtils';

// ── Re-export Dictionary Definitions ─────────────────────────────────
export {
  ARGOS_SHORT_PHRASE_LOOKUP_TH,
  GENERAL_ENGLISH_DICTIONARY_TH,
  SPANISH_DICTIONARY_TH,
  KOREAN_DICTIONARY_TH,
  JAPANESE_DICTIONARY_TH,
  FRENCH_DICTIONARY_TH,
  CHINESE_DICTIONARY_TH,
  ENGLISH_DICTIONARY_TH,
  DICTIONARIES_LIST,
  getDictionaryByLanguage,
} from './dictionaries';

// ── Re-export Short Phrase Dictionary & Fallback Services ────────────
export {
  lookupShortPhraseTh,
  systemicWordFallbackTranslate,
  getCompactPhraseMap,
} from './shortPhraseDictionaryService';

// ── Re-export Translation Quality & Text Assessment Services ─────────
export {
  TRANSLATION_LETTER_REGEX,
  ENGLISH_COMMON_WORDS,
  buildTranslationComparisonKey,
  countReadableLength,
  isStrongSentenceEnd,
  isLikelyContinuation,
  isLikelyStandaloneInterjectionLine,
  collapseRepeatedTranslationFragments,
  shouldSkipOverlayForUntranslatedCarryOver,
  shouldRetryLineTranslation,
  getTranslationScriptStats,
  scoreTranslationCandidate,
  evaluateUntranslatedTranslation,
  evaluateThaiCarryoverForEnglish,
} from './translationQualityService';

import {
  lookupShortPhraseTh,
  systemicWordFallbackTranslate,
} from './shortPhraseDictionaryService';

import {
  shouldRetryLineTranslation,
  getTranslationScriptStats,
  scoreTranslationCandidate,
} from './translationQualityService';

// ── Routing & Pivot Logic ───────────────────────────────────────────
const OFFLINE_PIVOT_SOURCE_LANGUAGES = new Set(['es', 'ko', 'ja', 'zh', 'chi', 'zho']);

export const shouldUseOfflinePivotRoute = (sourceLanguage: string, targetLanguage: string): boolean => {
  const normalizedSource = normalizeTranslationLanguage(sourceLanguage, 'en');
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  return normalizedTarget === 'th' && OFFLINE_PIVOT_SOURCE_LANGUAGES.has(normalizedSource);
};

export const selectOfflinePivotCandidate = (
  sourceText: string,
  sourceLanguage: string,
  targetLanguage: string,
  directText: string,
  pivotText: string
): string => {
  const normalizedSource = normalizeTranslationLanguage(sourceLanguage, 'en');
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  const direct = normalizeWhitespace(String(directText || ''));
  const pivot = normalizeWhitespace(String(pivotText || ''));

  if (!pivot) return direct;
  if (!direct) return pivot;

  const directNeedsRetry = shouldRetryLineTranslation(sourceText, direct, normalizedSource, normalizedTarget);
  const pivotNeedsRetry = shouldRetryLineTranslation(sourceText, pivot, normalizedSource, normalizedTarget);
  const directStats = getTranslationScriptStats(direct);
  const pivotStats = getTranslationScriptStats(pivot);

  if (normalizedSource === 'ko' && pivotStats.thaiChars > 0) {
    const directWeak = directNeedsRetry || directStats.thaiChars === 0 || directStats.latinRatio >= 0.22;
    if (directWeak || pivotStats.thaiRatio >= directStats.thaiRatio) {
      return pivot;
    }
  }
  if (OFFLINE_PIVOT_SOURCE_LANGUAGES.has(normalizedSource) && !pivotNeedsRetry) {
    return pivot;
  }
  if (directNeedsRetry && !pivotNeedsRetry) return pivot;
  if (!directNeedsRetry && pivotNeedsRetry) return direct;

  const directScore = scoreTranslationCandidate(sourceText, direct, normalizedTarget);
  const pivotScore = scoreTranslationCandidate(sourceText, pivot, normalizedTarget);
  const pivotBias = normalizedSource === 'ko' ? 24 : (normalizedSource === 'es' ? 14 : 10);
  if (pivotScore >= directScore - pivotBias) {
    return pivot;
  }
  return directScore >= pivotScore ? direct : pivot;
};

// ── Batch Offline Translation Orchestrator ───────────────────────────
export async function translateBatchOffline(
  texts: string[],
  type: string,
  mode: TranslationMode,
  sourceLanguage: string,
  targetLanguage: string,
  offlineBatchBridge: (texts: string[], options: any) => Promise<string[]>,
  engine?: string
): Promise<string[]> {
  if (texts.length === 0) return [];

  const normalizedSource = normalizeTranslationLanguage(sourceLanguage, 'en');
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');

  const normalizeOfflineSourceText = (rawText: string): string => {
    const text = String(rawText || '');
    if (normalizedSource === 'ko') {
      return normalizeKoreanOcrNoiseForTranslation(cleanKoreanOcrSpacing(text));
    }
    if (normalizedSource === 'ja' || normalizedSource === 'jpn' || normalizedSource === 'jpn_vert') {
      return normalizeJapaneseOcrNoiseForTranslation(cleanJapaneseOcrSpacing(text));
    }
    if (normalizedSource === 'es') {
      return normalizeSourceForTranslation(text, 'es');
    }
    if (normalizedSource === 'en') {
      return normalizeSourceForTranslation(text, 'en');
    }
    return normalizeSourceForTranslation(text, normalizedSource);
  };

  // Short-circuit lookup for known short phrases to bypass NMT and prevent translation artifacts
  const finalDirectTranslations = new Array<string>(texts.length).fill('');
  const indicesToTranslate: number[] = [];
  const textsToTranslate: string[] = [];

  for (let i = 0; i < texts.length; i++) {
    const originalText = texts[i] || '';
    const lookupResult = normalizedTarget === 'th' ? lookupShortPhraseTh(originalText) : null;
    if (lookupResult) {
      finalDirectTranslations[i] = lookupResult;
    } else {
      indicesToTranslate.push(i);
      textsToTranslate.push(originalText);
    }
  }

  if (indicesToTranslate.length === 0) {
    return finalDirectTranslations;
  }

  const preparedTexts = textsToTranslate.map((t) => {
    // Keep original case to improve NMT accuracy for English acronyms and proper nouns
    return normalizeOfflineSourceText(String(t || ''));
  });

  const isArgosUntranslated = (result: string, targetLang: string, sourceLang?: string): boolean => {
    const trimmed = result.trim();
    if (!trimmed) return false;
    if (targetLang === 'th') {
      const hasThaiChars = /[\u0E00-\u0E7F]/.test(trimmed);
      const hasLatinLetters = /[a-zA-Z]/.test(trimmed);
      // Korean carryover: Argos returned Hangul instead of translating to Thai
      if ((sourceLang === 'ko') && /[\uAC00-\uD7AF]/.test(trimmed) && !hasThaiChars) {
        return true;
      }
      return hasLatinLetters && !hasThaiChars;
    }
    return false;
  };

  const cleanForRetry = (raw: string): string =>
    raw
      .replace(/[_]+/g, ' ')
      .replace(/\.{2,}/g, ' ')
      .replace(/[!?]{2,}/g, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

  // Run Direct translation or 2-step Pivot English translation based on route
  const runPivotEnglish = engine === 'm2m100' ? false : shouldUseOfflinePivotRoute(normalizedSource, normalizedTarget);

  if (runPivotEnglish) {
    try {
      // Step 1: source -> English
      const pivotEnglishResults = await offlineBatchBridge(preparedTexts, {
        mode,
        sourceType: type,
        sourceLanguage: normalizedSource,
        targetLanguage: 'en',
        engine: engine || 'argos',
      });

      // Step 2: English -> Thai
      const pivotEnglishPrepared = pivotEnglishResults.map((line, i) => {
        const normalizedPivot = normalizeSourceForTranslation(String(line || ''), 'en');
        if (normalizedPivot) return normalizedPivot;
        const originalIndex = indicesToTranslate[i];
        return normalizeOfflineSourceText(String(texts[originalIndex] || ''));
      });

      const pivotThaiResults = await offlineBatchBridge(pivotEnglishPrepared, {
        mode,
        sourceType: type,
        sourceLanguage: 'en',
        targetLanguage: normalizedTarget,
      });

      indicesToTranslate.forEach((originalIndex, i) => {
        const engText = pivotEnglishPrepared[i] || pivotEnglishResults[i] || '';
        const dictLookup = lookupShortPhraseTh(engText);
        if (dictLookup) {
          finalDirectTranslations[originalIndex] = dictLookup;
        } else {
          finalDirectTranslations[originalIndex] = pivotThaiResults[i] || '';
        }
      });

      return finalDirectTranslations;
    } catch (pivotErr) {
      console.warn(`[translateBatchOffline] Pivot route ${normalizedSource}->en->${normalizedTarget} failed, falling back to direct translation:`, pivotErr);
    }
  }

  const directResults = await offlineBatchBridge(preparedTexts, {
    mode,
    sourceType: type,
    sourceLanguage: normalizedSource,
    targetLanguage: normalizedTarget,
    engine: engine || 'argos',
  }).catch((err) => {
    console.error(`[translateBatchOffline] Direct translation call failed for ${normalizedSource}->${normalizedTarget}:`, err);
    return new Array<string>(preparedTexts.length).fill('');
  });

  // Merge batch direct translations back
  indicesToTranslate.forEach((originalIndex, batchIndex) => {
    finalDirectTranslations[originalIndex] = directResults[batchIndex] || '';
  });

  // Handle hybrid retry by batching the requests to reduce serial roundtrip IPC latency
  const retriesPending: Array<{ index: number; cleaned: string }> = [];

  for (let i = 0; i < indicesToTranslate.length; i++) {
    const originalIndex = indicesToTranslate[i];
    const text = directResults[i] || '';
    const untranslated = isArgosUntranslated(text, normalizedTarget, normalizedSource);
    if (!untranslated) continue;

    const originalText = texts[originalIndex] ?? preparedTexts[i] ?? '';

    const lookupResult = normalizedTarget === 'th' ? lookupShortPhraseTh(originalText) : null;
    if (lookupResult) {
      finalDirectTranslations[originalIndex] = lookupResult;
      continue;
    }

    const cleaned = cleanForRetry(preparedTexts[i]);
    if (cleaned && cleaned !== preparedTexts[i].trim()) {
      const cleanedLookup = normalizedTarget === 'th' ? lookupShortPhraseTh(cleaned) : null;
      if (cleanedLookup) {
        finalDirectTranslations[originalIndex] = cleanedLookup;
        continue;
      }
      retriesPending.push({ index: originalIndex, cleaned });
    } else {
      const fallback = systemicWordFallbackTranslate(originalText);
      if (fallback) {
        finalDirectTranslations[originalIndex] = fallback;
      }
    }
  }

  if (retriesPending.length > 0) {
    try {
      const cleanedTexts = retriesPending.map((r) => r.cleaned);
      const retryResults = await offlineBatchBridge(cleanedTexts, {
        mode,
        sourceType: type,
        sourceLanguage: normalizedSource,
        targetLanguage: normalizedTarget,
      });

      retriesPending.forEach((retry, batchIdx) => {
        const retryResult = retryResults[batchIdx] ?? '';
        const stillUntranslated = isArgosUntranslated(retryResult, normalizedTarget, normalizedSource);
        if (!stillUntranslated) {
          finalDirectTranslations[retry.index] = retryResult;
        } else {
          const origText = texts[retry.index] || retry.cleaned;
          const fallback = systemicWordFallbackTranslate(origText);
          if (fallback) {
            finalDirectTranslations[retry.index] = fallback;
          }
        }
      });
    } catch (_retryErr) {
      console.error('[HybridRetry] Batched retry error:', _retryErr);
    }
  }

  return finalDirectTranslations.map((t) => (t ? t.replace(/#\s*(.*?)\s*#/g, '$1').replace(/#/g, '').trim() : ''));
}

// ── Layout, Typography & Persist Flag Helpers ─────────────────────────
const DOCUMENT_SOURCE_HINT_REGEX = /\b(chapter|table|fig(?:ure)?\.?|reaction|unknowns?|equilibrium|rigid|body|support|diagram|objective|objectives|connection|connections|continued|force|moment|component|unknown|column|columns|bridge|building|beam|beams|welded|surface|bracket|cable|utility|floor|member|pin|hinge)\b/i;

export const shouldUseDocumentCoverageFallback = (sourceText: string): boolean => {
  const normalized = normalizeOverlayInlineText(String(sourceText || ''));
  if (!normalized) return false;
  const wordCount = normalized.split(/\s+/g).filter(Boolean).length;
  const thaiCharCount = (normalized.match(/[\u0E00-\u0E7F]/g) || []).length;
  const technicalLike = DOCUMENT_SOURCE_HINT_REGEX.test(normalized);
  const numericDocumentLike = wordCount >= 6 && /[0-9()\-]/.test(normalized);
  const thaiDocumentLike = thaiCharCount >= 12
    && (wordCount >= 3 || /[0-9()\[\].,:;\-]/.test(normalized));
  return technicalLike || numericDocumentLike || thaiDocumentLike;
};

export const clampOverlayTypographyScale = (value: number): number => {
  if (!Number.isFinite(value)) return 1;
  if (value < 0.7) return 0.7;
  if (value > 1.6) return 1.6;
  return value;
};

export const scaleOverlayTypography = (typography: OverlayTypography, scale: number): OverlayTypography => {
  const normalizedScale = clampOverlayTypographyScale(scale);
  if (Math.abs(normalizedScale - 1) < 0.0001) return typography;

  return {
    ...typography,
    fontSize: Math.max(8, Number((typography.fontSize * normalizedScale).toFixed(2))),
    lineHeight: Number((typography.lineHeight * normalizedScale).toFixed(3)),
    padX: Math.max(1, Math.round(typography.padX * normalizedScale)),
    padY: Math.max(1, Math.round(typography.padY * normalizedScale)),
    contentHeight: Math.max(1, Number((typography.contentHeight * normalizedScale).toFixed(2))),
  };
};

export const readPersistedBooleanFlag = (key: string, defaultValue: boolean): boolean => {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const raw = String(window.localStorage.getItem(key) || '').trim().toLowerCase();
    if (!raw) return defaultValue;
    if (raw === '0' || raw === 'false' || raw === 'off') return false;
    if (raw === '1' || raw === 'true' || raw === 'on') return true;
    return defaultValue;
  } catch {
    return defaultValue;
  }
};

export const isBalloonAwareGroupingEnabled = (storageKey: string = 'pdf_translator_balloon_aware_grouping'): boolean =>
  readPersistedBooleanFlag(storageKey, true);

export const isLayoutGroupingDebugEnabled = (storageKey: string = 'pdf_translator_layout_grouping_debug'): boolean =>
  readPersistedBooleanFlag(storageKey, false);

export const resolveOverlayExportScale = (
  visibleWidth: number,
  visibleHeight: number,
  sourceWidth: number,
  sourceHeight: number
): number => {
  const safeVisibleWidth = Math.max(1, visibleWidth);
  const safeVisibleHeight = Math.max(1, visibleHeight);
  const safeSourceWidth = Math.max(1, sourceWidth);
  const safeSourceHeight = Math.max(1, sourceHeight);
  const sourceRatio = Math.max(safeSourceWidth / safeVisibleWidth, safeSourceHeight / safeVisibleHeight);
  const deviceRatio = typeof window !== 'undefined' ? Math.max(1, window.devicePixelRatio || 1) : 1;

  return Math.min(3, Math.max(1.5, deviceRatio, sourceRatio));
};
