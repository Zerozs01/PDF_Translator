import type { BBox, OCRLine } from '../../types';
import type { TranslationMode } from '../../stores/useProjectStore';
import {
  normalizeWhitespace,
  normalizeSourceForTranslation,
  normalizeTranslationLanguage,
  normalizeSpanishOcrNoiseForTranslation,
  cleanJapaneseOcrSpacing,
  cleanKoreanOcrSpacing,
  normalizeJapaneseOcrNoiseForTranslation,
  normalizeKoreanOcrNoiseForTranslation,
  normalizeEnglishOcrNoiseForTranslation,
} from '../ocr/ocrTextNormalizer';

import {
  hasKoreanTranslationCarryover,
} from './koreanTranslationPolicy';

import {
  normalizeOverlayInlineText,
  type OverlayTypography,
} from '../../components/OCR/translationOverlayUtils';

// -------------------------------------------------------------
// Translation Constants and Tables
// -------------------------------------------------------------

export const ARGOS_SHORT_PHRASE_LOOKUP_TH: Record<string, string> = {
  // Pronouns
  'i': 'ฉัน', 'you': 'คุณ', 'he': 'เขา', 'she': 'เธอ',
  'we': 'เรา', 'they': 'พวกเขา', 'it': 'มัน', 'me': 'ฉัน',
  'him': 'เขา', 'her': 'เธอ', 'us': 'พวกเรา', 'them': 'พวกเขา',
  // Interjections / short responses
  'yes': 'ใช่', 'no': 'ไม่', 'ok': 'โอเค', 'okay': 'โอเค',
  'what': 'อะไร', 'why': 'ทำไม', 'how': 'อย่างไร', 'when': 'เมื่อไหร่',
  'where': 'ที่ไหน', 'who': 'ใคร', 'wait': 'รอก่อน', 'stop': 'หยุด',
  'go': 'ไป', 'run': 'วิ่ง', 'help': 'ช่วยด้วย', 'look': 'ดูสิ',
  'now': 'ตอนนี้', 'here': 'ที่นี่', 'there': 'ที่นั่น', 'come': 'มา',
  'get': 'รับ', 'hey': 'เฮ้ย', 'huh': 'หยิ', 'hm': 'อืม', 'hmm': 'อืม',
  'ah': 'อา', 'oh': 'โอ้', 'uh': 'เอ่อ', 'ugh': 'โอ๊ย',
  'wow': 'ว้าว', 'whoa': 'โว้ว', 'ha': 'ฮ่า',
  'thanks': 'ขอบคุณ', 'sorry': 'ขอโทษ', 'please': 'กรุณา',
  'right': 'ใช่แล้ว', 'wrong': 'ผิดแล้ว', 'really': 'จริงเหรอ',
  'seriously': 'จริงจังเหรอ', 'impossible': 'เป็นไปไม่ได้',
  'unbelievable': 'เชื่อไม่ได้', 'of course': 'แน่นอน',
  // Common 2-4 word phrases
  'i see': 'เข้าใจแล้ว', 'i know': 'ฉันรู้', 'i get it': 'ฉันเข้าใจ',
  'got it': 'เข้าใจแล้ว', 'got you': 'จับได้แล้ว', 'come on': 'เร็วเข้า',
  'let go': 'ปล่อยไป', 'let me': 'ให้ฉัน', 'lets go': 'ไปกันเถอะ',
  'thank you': 'ขอบคุณ', 'no way': 'ไม่มีทาง', 'no problem': 'ไม่มีปัญหา',
  'watch out': 'ระวัง', 'calm down': 'ใจเย็นๆ', 'shut up': 'หุบปาก',
  'back off': 'ถอยออกไป', 'stand up': 'ลุกขึ้น', 'get up': 'ลุกขึ้น',
  'get out': 'ออกไป', 'get away': 'หนีออกไป', 'go away': 'ไปให้พ้น',
  'go on': 'ดำเนินต่อไป', 'move it': 'รีบไป', 'hurry up': 'รีบขึ้น',
  'give up': 'ยอมแพ้', 'hold on': 'รอสักครู่', 'hang on': 'รอสักครู่',
  'come here': 'มาที่นี่', 'over here': 'ที่นี่', 'over there': 'ที่นั่น',
  'thats right': 'ถูกต้อง', 'no doubt': 'ไม่ต้องสงสัย',
  'good luck': 'โชคดี', 'well done': 'เยี่ยมมาก', 'nice job': 'ทำได้ดี',
  'im sorry': 'ฉันขอโทษ', 'excuse me': 'ขอโทษนะ', 'be careful': 'ระวังด้วย',
  'dont move': 'อย่าขยับ', 'is that so': 'หรือจริงเหรอ',
};

export const TRANSLATION_LETTER_REGEX = /[A-Za-z\u00C0-\u024F\u0400-\u04FF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/;

// -------------------------------------------------------------
// Core Translation & Retry logic
// -------------------------------------------------------------

export const lookupShortPhraseTh = (text: string): string | null => {
  const key = text.trim().toLowerCase()
    .replace(/[_]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return ARGOS_SHORT_PHRASE_LOOKUP_TH[key] ?? null;
};

const OFFLINE_PIVOT_SOURCE_LANGUAGES = new Set(['es', 'ko', 'ja']);

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

export async function translateBatchOffline(
  texts: string[],
  type: string,
  mode: TranslationMode,
  sourceLanguage: string,
  targetLanguage: string,
  offlineBatchBridge: (texts: string[], options: any) => Promise<string[]>
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
      return normalizeSpanishOcrNoiseForTranslation(text);
    }
    if (normalizedSource === 'en') {
      return normalizeSourceForTranslation(text, 'en');
    }
    return normalizeSourceForTranslation(text, normalizedSource);
  };

  const preparedTexts = texts.map((t) => {
    // Keep original case to improve NMT accuracy for English acronyms and proper nouns
    return normalizeOfflineSourceText(String(t || ''));
  });

  const isArgosUntranslated = (result: string, targetLang: string): boolean => {
    const trimmed = result.trim();
    if (!trimmed) return false;
    if (targetLang === 'th') {
      const hasThaiChars = /[\u0E00-\u0E7F]/.test(trimmed);
      const hasLatinLetters = /[a-zA-Z]/.test(trimmed);
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

  // Run Direct translation and Pivot English translation in parallel to minimize IPC latency
  const runPivotEnglish = shouldUseOfflinePivotRoute(normalizedSource, normalizedTarget);
  const directPromise = offlineBatchBridge(preparedTexts, {
    mode,
    sourceType: type,
    sourceLanguage: normalizedSource,
    targetLanguage: normalizedTarget,
  });

  const pivotEnglishPromise = runPivotEnglish
    ? offlineBatchBridge(preparedTexts, {
        mode,
        sourceType: type,
        sourceLanguage: normalizedSource,
        targetLanguage: 'en',
      })
    : Promise.resolve<string[]>([]);

  const [directTranslations, pivotEnglish] = await Promise.all([
    directPromise,
    pivotEnglishPromise,
  ]);

  // Handle hybrid retry by batching the requests to reduce serial roundtrip IPC latency
  const finalDirectTranslations = [...directTranslations];
  const retriesPending: Array<{ index: number; cleaned: string }> = [];

  for (let i = 0; i < directTranslations.length; i++) {
    const text = directTranslations[i] || '';
    const untranslated = isArgosUntranslated(text, normalizedTarget);
    console.log(`[HybridRetry] i=${i} src="${preparedTexts[i]}" argosOut="${text}" untranslated=${untranslated}`);
    if (!untranslated) continue;

    const originalText = texts[i] ?? preparedTexts[i] ?? '';

    const lookupResult = normalizedTarget === 'th' ? lookupShortPhraseTh(originalText) : null;
    if (lookupResult) {
      console.log(`[HybridRetry] LOOKUP HIT: "${originalText}" → "${lookupResult}"`);
      finalDirectTranslations[i] = lookupResult;
      continue;
    }

    const cleaned = cleanForRetry(preparedTexts[i]);
    console.log(`[HybridRetry] cleaned="${cleaned}" sameAsPrepared=${cleaned === preparedTexts[i].trim()}`);
    if (cleaned && cleaned !== preparedTexts[i].trim()) {
      const cleanedLookup = normalizedTarget === 'th' ? lookupShortPhraseTh(cleaned) : null;
      if (cleanedLookup) {
        console.log(`[HybridRetry] CLEANED LOOKUP HIT: "${cleaned}" → "${cleanedLookup}"`);
        finalDirectTranslations[i] = cleanedLookup;
        continue;
      }
      retriesPending.push({ index: i, cleaned });
    } else {
      console.log(`[HybridRetry] GAVE UP (no clean retry target): "${originalText}" → returning original Argos output`);
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
        const stillUntranslated = isArgosUntranslated(retryResult, normalizedTarget);
        console.log(`[HybridRetry] BATCHED ARGOS RETRY: index=${retry.index} cleaned="${retry.cleaned}" → "${retryResult}" stillUntranslated=${stillUntranslated}`);
        if (!stillUntranslated) {
          finalDirectTranslations[retry.index] = retryResult;
        } else {
          console.log(`[HybridRetry] GAVE UP (still untranslated after retry): index=${retry.index} → returning original Argos output`);
        }
      });
    } catch (_retryErr) {
      console.warn('[HybridRetry] Batched retry error:', _retryErr);
    }
  }

  if (!runPivotEnglish) {
    return finalDirectTranslations;
  }

  try {
    const pivotEnglishPrepared = pivotEnglish.map((line, index) => {
      const normalizedPivot = normalizeSourceForTranslation(String(line || ''), 'en');
      if (normalizedPivot) return normalizedPivot;
      return normalizeOfflineSourceText(String(texts[index] || ''));
    });
    const pivotThai = await offlineBatchBridge(pivotEnglishPrepared, {
      mode,
      sourceType: type,
      sourceLanguage: 'en',
      targetLanguage: normalizedTarget,
    });

    return texts.map((sourceText, index) => selectOfflinePivotCandidate(
      String(sourceText || ''),
      normalizedSource,
      normalizedTarget,
      String(finalDirectTranslations[index] || ''),
      String(pivotThai[index] || '')
    ));
  } catch (error) {
    console.warn(`[OfflineTranslation] Pivot fallback ${normalizedSource}->en->${normalizedTarget} failed:`, error);
    return finalDirectTranslations;
  }
}

// -------------------------------------------------------------
// Translation Quality Assessment Helpers
// -------------------------------------------------------------

export const shouldSkipOverlayForUntranslatedCarryOver = (
  sourceText: string,
  translatedText: string,
  targetLanguage: string
): boolean => {
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  if (normalizedTarget !== 'th') return false;

  const source = normalizeWhitespace(String(sourceText || ''));
  const translated = normalizeWhitespace(String(translatedText || ''));
  if (!source || !translated) return false;
  
  // We check for scientific symbols or numbers
  const isScientificSymbolLikeLine = (val: string): boolean => {
    const clean = val.replace(/[\s\-_]+/g, '');
    if (!clean) return false;
    return /^[a-zA-Z0-9\(\)\[\]\{\}\+\-\*\/\\=\.,:;\u0370-\u03FF\u0400-\u04FF%]+$/.test(clean)
      && (/\d/.test(clean) || clean.length <= 4 || /^[Ff][iI][gG]/.test(clean));
  };
  
  if (isScientificSymbolLikeLine(source)) return false;

  const sourceKey = buildTranslationComparisonKey(source);
  const translatedKey = buildTranslationComparisonKey(translated);
  if (!sourceKey || !translatedKey) return false;

  const thaiChars = (translated.match(/[\u0E00-\u0E7F]/g) || []).length;
  const latinChars = (translated.match(/[A-Za-z]/g) || []).length;
  const sourceLatinChars = (source.match(/[A-Za-z]/g) || []).length;
  const tokenCount = source.split(/\s+/g).filter(Boolean).length;
  if (thaiChars > 0) return false;

  if (sourceKey === translatedKey) {
    return tokenCount >= 1 && (sourceLatinChars >= 4 || source.length >= 4);
  }

  return latinChars >= 4 && sourceLatinChars >= 4 && tokenCount >= 2;
};

export const buildTranslationComparisonKey = (value: string): string =>
  normalizeWhitespace(String(value || ''))
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F\u0400-\u04FF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]+/g, '');

export const countReadableLength = (text: string): number => {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length;
};

const SENTENCE_END_REGEX = /[.!?\u2026\u3002\uFF01\uFF1F]$/;
export const isStrongSentenceEnd = (text: string): boolean => {
  const compact = text.trim();
  if (!compact) return false;
  return SENTENCE_END_REGEX.test(compact);
};

const SOFT_CONTINUATION_END_REGEX = /[,;:\-\u2014\u2013\u3001\uFF0C]$/;
const CONTINUATION_TRAILING_WORD_REGEX = /\b(?:a|an|the|of|to|for|and|or|but|if|when|while|with|without|into|onto|from|by|as|than|that|this|these|those|my|your|his|her|its|our|their|is|are|was|were|be|been|being|do|does|did|have|has|had|can|could|will|would|should|must|may|might|not|so|up|off|out|over|under|about|around|through|toward|towards)$/i;
const CONTINUATION_LEADING_WORD_REGEX = /^(?:and|or|but|if|when|while|because|that|which|who|whose|whom|to|for|of|with|as|than|then|so|also|still|yet|just)\b/i;

export const isLikelyContinuation = (previousText: string, currentText: string): boolean => {
  const prev = previousText.trim();
  const curr = currentText.trim();
  if (!prev || !curr) return false;

  if (SOFT_CONTINUATION_END_REGEX.test(prev)) return true;
  if (/[\-\u2013\u2014]$/.test(prev)) return true;
  if (CONTINUATION_TRAILING_WORD_REGEX.test(prev)) return true;
  if (/^[,;:.)\]\}"'\u3001\uFF0C]/.test(curr)) return true;
  if (/^[a-z]/.test(curr)) return true;
  if (CONTINUATION_LEADING_WORD_REGEX.test(curr)) return true;
  return false;
};

export const isLikelyStandaloneInterjectionLine = (text: string): boolean => {
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) return false;

  const compact = normalized.replace(/\s+/g, '');
  const tokens = normalized.split(/\s+/g).filter(Boolean);
  if (compact.length > 16 || tokens.length > 3) return false;

  if (/^[A-Za-z]-[A-Za-z][A-Za-z'’!?….-]{0,12}$/.test(compact)) {
    return true;
  }

  const trailingPunct = /[!?…]{1,3}$/.test(compact);
  const latinLetters = compact.replace(/[^A-Za-z]/g, '').length;
  if (trailingPunct && latinLetters > 0 && latinLetters <= 8 && tokens.length <= 2) {
    return true;
  }

  const nonLatin = compact.replace(/[\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/g, '').length !== compact.length;
  if (trailingPunct && nonLatin && compact.length <= 7) {
    return true;
  }

  return false;
};

export const collapseRepeatedTranslationFragments = (text: string): string => {
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) return normalized;

  const dedupHesitation = normalized.replace(
    /(A-?\s*Are\s+you)(?:\s+\1)+/gi,
    '$1'
  );
  if (dedupHesitation !== normalized) {
    return normalizeWhitespace(dedupHesitation);
  }

  const repeatedChunk = normalized.match(/^(.{4,}?)(?:\s+\1)+$/u);
  if (repeatedChunk?.[1]) {
    return normalizeWhitespace(repeatedChunk[1]);
  }

  const tokens = normalized.split(/\s+/g).filter(Boolean);
  if (tokens.length >= 4 && tokens.length % 2 === 0) {
    const half = tokens.length / 2;
    const firstHalf = tokens.slice(0, half).join(' ');
    const secondHalf = tokens.slice(half).join(' ');
    if (firstHalf === secondHalf) {
      return firstHalf;
    }
  }

  if (tokens.length >= 6) {
    const normalizeTokenSpan = (spanTokens: string[]): string =>
      spanTokens
        .join(' ')
        .toLowerCase()
        .replace(/[^a-z0-9\u00C0-\u024F\u0400-\u04FF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]+/giu, '');

    const maxSpan = Math.min(8, Math.floor(tokens.length / 2));
    for (let span = maxSpan; span >= 2; span -= 1) {
      const firstSpan = tokens.slice(0, span);
      const secondSpan = tokens.slice(span, span * 2);
      if (secondSpan.length < span) continue;

      const firstKey = normalizeTokenSpan(firstSpan);
      const secondKey = normalizeTokenSpan(secondSpan);
      if (!firstKey || firstKey.length < 6) continue;
      if (firstKey !== secondKey) continue;

      const merged = [...firstSpan, ...tokens.slice(span * 2)].join(' ');
      return normalizeWhitespace(merged);
    }
  }

  return normalized;
};

// -------------------------------------------------------------
// Layout, Grouping & Persist Flag Helpers
// -------------------------------------------------------------

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

// -------------------------------------------------------------
// App Quality Gates & Advanced Logic Helpers
// -------------------------------------------------------------

export const shouldRetryLineTranslation = (
  sourceText: string,
  translatedText: string,
  sourceLanguage: string,
  targetLanguage: string
): boolean => {
  const source = normalizeWhitespace(String(sourceText || ''));
  if (!source) return false;
  if (!TRANSLATION_LETTER_REGEX.test(source)) return false;

  const translated = normalizeWhitespace(String(translatedText || ''));
  if (!translated) return true;

  const sourceKey = buildTranslationComparisonKey(source);
  const translatedKey = buildTranslationComparisonKey(translated);
  if (sourceKey && translatedKey && sourceKey === translatedKey) {
    return true;
  }

  const normalizedSource = normalizeTranslationLanguage(sourceLanguage, 'en');
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');

  if (normalizedTarget === 'th') {
    const letterChars = translated.match(/[A-Za-z\u0E00-\u0E7F]/g) || [];
    const latinChars = translated.match(/[A-Za-z]/g) || [];
    const thaiChars = translated.match(/[\u0E00-\u0E7F]/g) || [];
    const latinRatio = latinChars.length / Math.max(1, letterChars.length);

    // 1) Looks mostly untranslated Latin/English
    const looksUntranslatedLatin = letterChars.length >= 10 && latinRatio >= 0.62 && thaiChars.length <= 2;
    if (looksUntranslatedLatin) {
      return true;
    }

    // 2) Short mostly Latin carry-over
    const sourceLatinChars = source.match(/[A-Za-z]/g) || [];
    const translatedAlphaChars = translated.match(/[A-Za-z\u0E00-\u0E7F]/g) || [];
    const translatedHasNoThai = thaiChars.length === 0;
    const mostlyLatinShortCarryOver = translatedHasNoThai
      && sourceLatinChars.length >= 4
      && translatedAlphaChars.length >= Math.min(4, sourceLatinChars.length)
      && latinRatio >= 0.78;
    if (mostlyLatinShortCarryOver) {
      return true;
    }

    // 3) Mixed carry-over (partially translated but with too much English leftovers)
    const mixedCarryOver = sourceLatinChars.length >= 8
      && thaiChars.length >= 1
      && translatedAlphaChars.length >= 10
      && latinRatio >= 0.4;
    if (mixedCarryOver) {
      return true;
    }

    // 4) High English ratio in mid-to-long sentences with very few Thai characters
    const highLatinRatioShortThai = letterChars.length >= 8
      && latinRatio >= 0.35
      && thaiChars.length < 4;
    if (highLatinRatioShortThai) {
      return true;
    }

    // 5) Sentence is reasonably long in source but translated to extremely short garbage Thai
    const sourceLetters = source.replace(/[^A-Za-z]/g, '').length;
    if (sourceLetters >= 15 && thaiChars.length > 0 && thaiChars.length <= 3) {
      return true;
    }

    // 6) Translated text contains visible raw OCR noise remnants
    const containsOcrNoiseTrash = /([lI1|]{3,}|ll\|l|I\|I|ll\|ll|\/\\|\\\/)/gi.test(translated);
    if (containsOcrNoiseTrash && thaiChars.length <= 4) {
      return true;
    }

    const hasKnownOcrNoisePattern = (val: string): boolean => {
      const clean = val.replace(/[\s\-_]+/g, '');
      return /^[|¦│┃￨︱︲/\\_~.,:;'"`!?-]+$/.test(clean);
    };

    if (hasKnownOcrNoisePattern(source) && thaiChars.length === 0) {
      return true;
    }
  }

  if (normalizedSource === 'ko' && normalizedTarget === 'th') {
    if (hasKoreanTranslationCarryover(translated)) {
      return true;
    }
  }

  return false;
};

export const getTranslationScriptStats = (text: string): {
  thaiChars: number;
  latinChars: number;
  letterChars: number;
  latinRatio: number;
  thaiRatio: number;
} => {
  const normalized = normalizeWhitespace(String(text || ''));
  const thaiChars = (normalized.match(/[\u0E00-\u0E7F]/g) || []).length;
  const latinChars = (normalized.match(/[A-Za-z]/g) || []).length;
  const letterChars = thaiChars + latinChars;
  return {
    thaiChars,
    latinChars,
    letterChars,
    latinRatio: latinChars / Math.max(1, letterChars),
    thaiRatio: thaiChars / Math.max(1, letterChars),
  };
};

export const scoreTranslationCandidate = (
  sourceText: string,
  candidateText: string,
  targetLanguage: string
): number => {
  const source = normalizeWhitespace(String(sourceText || ''));
  const candidate = normalizeWhitespace(String(candidateText || ''));
  if (!candidate || !source) return 0;

  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  const sourceLength = source.length;
  const candidateLength = candidate.length;

  if (normalizedTarget === 'th') {
    const stats = getTranslationScriptStats(candidate);
    const hasThai = stats.thaiChars > 0;
    if (!hasThai) {
      return -100; // Penalize candidate heavily if it contains absolutely no Thai characters
    }

    let score = candidateLength * 0.1;

    // 1) Length balance check
    const lengthRatio = candidateLength / Math.max(1, sourceLength);
    if (lengthRatio >= 0.5 && lengthRatio <= 1.8) {
      score += 20; // Ideal length balance bonus
    } else if (lengthRatio >= 0.35 && lengthRatio <= 2.3) {
      score += 10; // Acceptable length balance bonus
    } else if (lengthRatio < 0.22 && sourceLength >= 12) {
      score -= 30; // Heavy penalty for overly truncated translation
    }

    // 2) Thai purity and density metrics
    score += stats.thaiRatio * 30;
    if (stats.latinChars === 0) {
      score += 25; // Bonus for high quality pure Thai without Latin pollution
    } else {
      score -= stats.latinRatio * 35; // Penalize Latin pollution ratio
    }

    // 3) OCR noise leftovers penalty
    const hasOcrTrash = /([lI1|]{3,}|ll\|l|I\|I|ll\|ll|\/\\|\\\/|..|_)/gi.test(candidate);
    if (hasOcrTrash) {
      score -= 40;
    }

    return score;
  }

  return candidateLength * 0.1;
};

export const evaluateUntranslatedTranslation = (
  lines: Array<{ index: number; text: string }>,
  translatedByIndex: Map<number, string>,
  sourceLanguage: string,
  targetLanguage: string
): { shouldSkip: boolean; retryRatio: number; thaiRatio: number; total: number } => {
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  if (normalizedTarget !== 'th') {
    return { shouldSkip: false, retryRatio: 0, thaiRatio: 0, total: 0 };
  }

  let total = 0;
  let retryCount = 0;
  let thaiChars = 0;
  let letterChars = 0;

  lines.forEach((line) => {
    const translated = translatedByIndex.get(line.index) || '';
    total += 1;
    if (shouldRetryLineTranslation(line.text, translated, sourceLanguage, normalizedTarget)) {
      retryCount += 1;
    }
    const stats = getTranslationScriptStats(translated);
    thaiChars += stats.thaiChars;
    letterChars += stats.letterChars;
  });

  if (total < 4) {
    return { shouldSkip: false, retryRatio: 0, thaiRatio: 0, total };
  }

  const retryRatio = retryCount / Math.max(1, total);
  const thaiRatio = thaiChars / Math.max(1, letterChars);
  const shouldSkip = retryRatio >= 0.65 && thaiRatio < 0.06;
  return { shouldSkip, retryRatio, thaiRatio, total };
};

export const evaluateThaiCarryoverForEnglish = (
  groups: Array<{ sourceText: string }>,
  translatedGroups: string[],
  targetLanguage: string
): { shouldFallback: boolean; thaiRatio: number; carryoverRatio: number; total: number } => {
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'en');
  if (normalizedTarget !== 'en') {
    return { shouldFallback: false, thaiRatio: 0, carryoverRatio: 0, total: 0 };
  }

  let total = 0;
  let carryoverCount = 0;
  let thaiChars = 0;
  let letterChars = 0;

  groups.forEach((group, i) => {
    const translated = translatedGroups[i] || '';
    total += 1;
    
    // If target is English, translated text should contain minimal Thai
    const stats = getTranslationScriptStats(translated);
    const hasThai = stats.thaiChars > 0;
    if (hasThai && stats.thaiRatio >= 0.3) {
      carryoverCount += 1;
    }
    thaiChars += stats.thaiChars;
    letterChars += stats.letterChars;
  });

  if (total === 0) {
    return { shouldFallback: false, thaiRatio: 0, carryoverRatio: 0, total };
  }

  const carryoverRatio = carryoverCount / total;
  const thaiRatio = thaiChars / Math.max(1, letterChars);
  const shouldFallback = carryoverRatio >= 0.5 && thaiRatio >= 0.25;
  return { shouldFallback, thaiRatio, carryoverRatio, total };
};
