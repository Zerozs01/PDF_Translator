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
import { isKnownShortWordHelper, isLikelyEnglishDialogue } from '../ocr/ocrSafetyLineDedup';

import {
  hasKoreanTranslationCarryover,
  applyKoreanConversationalFallback,
} from './koreanTranslationPolicy';

import {
  normalizeOverlayInlineText,
  type OverlayTypography,
} from '../../components/OCR/translationOverlayUtils';
import { useGlossaryStore } from '../../stores/useGlossaryStore';

// -------------------------------------------------------------
// Translation Constants and Tables
// -------------------------------------------------------------

import {
  ARGOS_SHORT_PHRASE_LOOKUP_TH,
  GENERAL_ENGLISH_DICTIONARY_TH,
  SPANISH_DICTIONARY_TH,
  KOREAN_DICTIONARY_TH,
  JAPANESE_DICTIONARY_TH,
  FRENCH_DICTIONARY_TH,
  CHINESE_DICTIONARY_TH,
  ENGLISH_DICTIONARY_TH,
  getDictionaryByLanguage,
} from './dictionaries';

export {
  ARGOS_SHORT_PHRASE_LOOKUP_TH,
  GENERAL_ENGLISH_DICTIONARY_TH,
  SPANISH_DICTIONARY_TH,
  KOREAN_DICTIONARY_TH,
  JAPANESE_DICTIONARY_TH,
  FRENCH_DICTIONARY_TH,
  CHINESE_DICTIONARY_TH,
  ENGLISH_DICTIONARY_TH,
  getDictionaryByLanguage,
};

export const TRANSLATION_LETTER_REGEX = /[A-Za-z\u00C0-\u024F\u0400-\u04FF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/;

// ── Pre-compiled Module-Level Regular Expressions ───────────────────
const TEMP_ALERT_REGEX = /^temp:\s*(\d+)\s*c\s*\[alert\]$/i;
const TEMP_NORMAL_REGEX = /^temp:\s*(\d+)\s*c$/i;
const LEADING_PUNCT_REGEX = /^[¡¿\s]+/;
const LEADING_II_REGEX = /^ii(?=[a-z])/i;
const STRIP_DOTS_START_REGEX = /^[\.\,\-\s]+/;
const STRIP_DOTS_END_REGEX = /[\.\,\-\s]+$/;
const TRAILING_PUNCT_REGEX = /([\!\?\.…]+)$/;
const HAS_TRAILING_PUNCT_REGEX = /[\!\?\.…]$/;
const UNDERLINE_REGEX = /[_]+/g;
const PUNCT_SPACE_REGEX = /[\-\/\.\,\!\?\:\;\'\’\”\“\"]+/g;
const NON_LETTER_NUM_REGEX = /[^\p{L}\p{N}\s]/gu;
const MULTI_SPACE_REGEX = /\s+/g;
const DIACRITICS_REGEX = /[\u0300-\u036f]/g;

let _compactPhraseMap: Map<string, string> | null = null;
function getCompactPhraseMap(): Map<string, string> {
  if (!_compactPhraseMap) {
    _compactPhraseMap = new Map<string, string>();
    for (const [k, v] of Object.entries(ARGOS_SHORT_PHRASE_LOOKUP_TH)) {
      const compact = k.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      if (compact && !_compactPhraseMap.has(compact)) {
        _compactPhraseMap.set(compact, v);
      }
    }
    for (const [k, v] of Object.entries(GENERAL_ENGLISH_DICTIONARY_TH)) {
      const compact = k.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      if (compact && !_compactPhraseMap.has(compact)) {
        _compactPhraseMap.set(compact, v);
      }
    }
  }
  return _compactPhraseMap;
}

export const lookupShortPhraseTh = (text: string, sourceLang?: string): string | null => {
  if (!text) return null;
  const trimmed = text.trim();

  // -1. Top Priority: Check User Custom Glossary First (O(1) User Override)
  try {
    const glossaryEntries = useGlossaryStore.getState()?.entries;
    if (glossaryEntries && glossaryEntries.length > 0) {
      const normalizedQuery = trimmed.toLowerCase();
      const match = glossaryEntries.find((e) => {
        if (!e.isActive) return false;
        if (sourceLang && e.sourceLang && e.sourceLang !== 'all' && e.sourceLang.toLowerCase() !== sourceLang.toLowerCase()) {
          return false;
        }
        const eSource = (e.sourceText || '').trim().toLowerCase();
        return eSource === normalizedQuery;
      });
      if (match) {
        return match.targetText;
      }
    }
  } catch {}

  // 0. ตรวจจับและแปลงกรณีพิเศษสำหรับ Log/Status ของอุณหภูมิ เช่น Temp: 45C [Alert] -> อุณหภูมิ: 45°C [แจ้งเตือน]
  const tempAlertMatch = trimmed.match(TEMP_ALERT_REGEX);
  if (tempAlertMatch) {
    return `อุณหภูมิ: ${tempAlertMatch[1]}°C [แจ้งเตือน]`;
  }
  const tempNormalMatch = trimmed.match(TEMP_NORMAL_REGEX);
  if (tempNormalMatch) {
    return `อุณหภูมิ: ${tempNormalMatch[1]}°C`;
  }

  const rawKey = trimmed.toLowerCase();
  const directRawMatch = ARGOS_SHORT_PHRASE_LOOKUP_TH[rawKey] || GENERAL_ENGLISH_DICTIONARY_TH[rawKey];
  if (directRawMatch) return directRawMatch;

  const hasOuterParens = /^\s*[\(\[\{<].*[\)\]\}>]\s*$/.test(trimmed);
  const unwrapped = trimmed.replace(/^\s*[\(\[\{<"']+|[\)\]\}>"'\s]+$/g, '').trim().toLowerCase();
  if (unwrapped && unwrapped !== rawKey) {
    const unwrappedMatch = ARGOS_SHORT_PHRASE_LOOKUP_TH[unwrapped] || GENERAL_ENGLISH_DICTIONARY_TH[unwrapped];
    if (unwrappedMatch) {
      return hasOuterParens && !unwrappedMatch.startsWith('(') ? `(${unwrappedMatch})` : unwrappedMatch;
    }
  }

  const cleanedRawKey = rawKey
    .replace(/^[\(\[\{<"'\s¡¿]+/g, '')
    .replace(/[\)\]\}>"'\s]+$/g, '')
    .replace(LEADING_II_REGEX, '');
  const directCleanedMatch = ARGOS_SHORT_PHRASE_LOOKUP_TH[cleanedRawKey] || GENERAL_ENGLISH_DICTIONARY_TH[cleanedRawKey];
  if (directCleanedMatch) {
    return hasOuterParens && !directCleanedMatch.startsWith('(') ? `(${directCleanedMatch})` : directCleanedMatch;
  }

  // Spanish OCR noise: leading lowercase 'i' misrecognized for inverted exclamation '¡' (e.g. "iTE JURO QUE" -> "te juro que")
  const spanishLeadingIStripped = cleanedRawKey.replace(/^i(?=[a-záéíóúñ])/i, '').trim();
  if (spanishLeadingIStripped && spanishLeadingIStripped !== cleanedRawKey) {
    const spanishMatch = ARGOS_SHORT_PHRASE_LOOKUP_TH[spanishLeadingIStripped] || GENERAL_ENGLISH_DICTIONARY_TH[spanishLeadingIStripped];
    if (spanishMatch) {
      return hasOuterParens && !spanishMatch.startsWith('(') ? `(${spanishMatch})` : spanishMatch;
    }
  }

  const strippedDotsKey = cleanedRawKey.replace(STRIP_DOTS_START_REGEX, '').replace(STRIP_DOTS_END_REGEX, '').trim();
  if (strippedDotsKey && (ARGOS_SHORT_PHRASE_LOOKUP_TH[strippedDotsKey] || GENERAL_ENGLISH_DICTIONARY_TH[strippedDotsKey])) {
    const match = ARGOS_SHORT_PHRASE_LOOKUP_TH[strippedDotsKey] || GENERAL_ENGLISH_DICTIONARY_TH[strippedDotsKey];
    const trailingPunct = text.match(TRAILING_PUNCT_REGEX);
    let result = (trailingPunct && !HAS_TRAILING_PUNCT_REGEX.test(match)) ? match + trailingPunct[1] : match;
    return hasOuterParens && !result.startsWith('(') ? `(${result})` : result;
  }

  // 0.2 ลองค้นหาหลังจากซ่อมแซมเสียงรบกวน OCR (เช่น Suvvenlya -> Suddenly, Bvt -> But, (ME,THERE) -> (ME, THERE))
  const ocrNormalized = normalizeEnglishOcrNoiseForTranslation(trimmed);
  if (ocrNormalized && ocrNormalized.toLowerCase() !== rawKey) {
    const ocrKey = ocrNormalized.toLowerCase();
    const ocrMatch = ARGOS_SHORT_PHRASE_LOOKUP_TH[ocrKey] || GENERAL_ENGLISH_DICTIONARY_TH[ocrKey];
    if (ocrMatch) {
      return hasOuterParens && !ocrMatch.startsWith('(') ? `(${ocrMatch})` : ocrMatch;
    }
    const ocrStripped = ocrKey.replace(STRIP_DOTS_START_REGEX, '').replace(STRIP_DOTS_END_REGEX, '').trim();
    if (ocrStripped && (ARGOS_SHORT_PHRASE_LOOKUP_TH[ocrStripped] || GENERAL_ENGLISH_DICTIONARY_TH[ocrStripped])) {
      const match = ARGOS_SHORT_PHRASE_LOOKUP_TH[ocrStripped] || GENERAL_ENGLISH_DICTIONARY_TH[ocrStripped];
      return hasOuterParens && !match.startsWith('(') ? `(${match})` : match;
    }
  }

  // 0.3 ลองค้นหาหลังจากซ่อมแซมเสียงรบกวน OCR ภาษาสเปน
  const spanishOcrNormalized = normalizeSpanishOcrNoiseForTranslation(trimmed);
  if (spanishOcrNormalized && spanishOcrNormalized.toLowerCase() !== rawKey) {
    const spKey = spanishOcrNormalized.toLowerCase();
    const spMatch = ARGOS_SHORT_PHRASE_LOOKUP_TH[spKey] || GENERAL_ENGLISH_DICTIONARY_TH[spKey];
    if (spMatch) {
      return hasOuterParens && !spMatch.startsWith('(') ? `(${spMatch})` : spMatch;
    }
    const spStripped = spKey.replace(STRIP_DOTS_START_REGEX, '').replace(STRIP_DOTS_END_REGEX, '').trim();
    if (spStripped && (ARGOS_SHORT_PHRASE_LOOKUP_TH[spStripped] || GENERAL_ENGLISH_DICTIONARY_TH[spStripped])) {
      const match = ARGOS_SHORT_PHRASE_LOOKUP_TH[spStripped] || GENERAL_ENGLISH_DICTIONARY_TH[spStripped];
      return hasOuterParens && !match.startsWith('(') ? `(${match})` : match;
    }
  }

  const key = rawKey
    .replace(UNDERLINE_REGEX, ' ')
    .replace(PUNCT_SPACE_REGEX, ' ')
    .replace(NON_LETTER_NUM_REGEX, '')
    .replace(MULTI_SPACE_REGEX, ' ')
    .trim();
  
  // 1. ลองค้นหาแบบตรงตัวใน dictionary ก่อน
  let directMatch = ARGOS_SHORT_PHRASE_LOOKUP_TH[key] || GENERAL_ENGLISH_DICTIONARY_TH[key];
  
  // Try Korean 존나 prefix stripping fallback (e.g. 존나 좋아 -> โคตรชอบ/โคตรฟิน)
  if (!directMatch && key.startsWith('존나 ') && key.length > 3) {
    const strippedJonNa = key.slice(3).trim();
    const subMatch = ARGOS_SHORT_PHRASE_LOOKUP_TH[strippedJonNa] || GENERAL_ENGLISH_DICTIONARY_TH[strippedJonNa];
    if (subMatch) {
      directMatch = `โคตร${subMatch}`;
    }
  }

  // Try Spanish diacritic stripping fallback (e.g. bañas -> banas, montón -> monton)
  if (!directMatch) {
    const strippedKey = key.normalize('NFD').replace(DIACRITICS_REGEX, '').replace(/ñ/g, 'n');
    directMatch = ARGOS_SHORT_PHRASE_LOOKUP_TH[strippedKey] || GENERAL_ENGLISH_DICTIONARY_TH[strippedKey];
  }

  if (directMatch) {
    const trailingPunct = text.match(TRAILING_PUNCT_REGEX);
    let result = (trailingPunct && !HAS_TRAILING_PUNCT_REGEX.test(directMatch)) ? directMatch + trailingPunct[1] : directMatch;
    return hasOuterParens && !result.startsWith('(') ? `(${result})` : result;
  }

  // 1.5 ลองค้นหาแบบ No-Apostrophe (เช่น yuuto's mom -> yuutos mom, we'll -> well)
  const noAposKey = rawKey.replace(/['’]/g, '').replace(PUNCT_SPACE_REGEX, ' ').replace(MULTI_SPACE_REGEX, ' ').trim();
  if (noAposKey && noAposKey !== key) {
    const noAposMatch = ARGOS_SHORT_PHRASE_LOOKUP_TH[noAposKey] || GENERAL_ENGLISH_DICTIONARY_TH[noAposKey];
    if (noAposMatch) {
      return hasOuterParens && !noAposMatch.startsWith('(') ? `(${noAposMatch})` : noAposMatch;
    }
  }

  // 2. ตรวจสอบความลากเสียงยาว (Elongation) สำหรับคำการ์ตูนยอดนิยม
  if (/^p[le]*[ea]*\s*\+?\s*[ea]*s[e]+$/i.test(key)) {
    return 'ได้โปรด ดดดดดด';
  }
  if (/^m[o]+r[e]+$/i.test(key)) {
    return 'มากกกกว่าาาานี้';
  }
  if (/^[o]+[u]+[t]+$/i.test(key)) {
    return 'ออกไปปปป';
  }

  // สำหรับ knight (เช่น kniiiiight)
  if (/^k[n]+[i]+[g]+[h]+[t]+$/i.test(key)) {
    return 'อัศวิน';
  }
  // สำหรับ dead (เช่น deeead)
  if (/^d[e]+a[d]+$/i.test(key)) {
    return 'ตายแล้ว';
  }
  // สำหรับ cocks (เช่น cooooocks)
  if (/^c[o]+ck$/i.test(key)) {
    return 'ควย';
  }
  if (/^c[o]+cks$/i.test(key)) {
    return 'ควยยยยยยพวกนี้';
  }

  // 3. ลองค้นหาผ่าน Compact Unicode Letter Map (ทนทานต่อการตัดคำ/เครื่องหมายวรรคตอน/จุดไข่ปลาทุกภาษา)
  const compactKey = rawKey.replace(/[^\p{L}\p{N}]/gu, '');
  if (compactKey && compactKey.length >= 2) {
    let compactMatch = getCompactPhraseMap().get(compactKey);

    // Korean particle/suffix fallback decomposition (e.g. 쿠기사키가 -> 쿠기사키, 자궁속까지 -> 자궁 + 속까지)
    if (!compactMatch && /[\uAC00-\uD7AF]/.test(compactKey)) {
      if (compactKey.endsWith('속까지')) {
        const base = compactKey.slice(0, -3);
        const baseMatch = getCompactPhraseMap().get(base);
        if (baseMatch) compactMatch = `ลึกเข้าไปถึงใน${baseMatch}`;
      } else if (compactKey.endsWith('으로') || compactKey.endsWith('로')) {
        const base = compactKey.endsWith('으로') ? compactKey.slice(0, -2) : compactKey.slice(0, -1);
        const baseMatch = getCompactPhraseMap().get(base);
        if (baseMatch) compactMatch = `ด้วย${baseMatch}`;
      } else if (compactKey.endsWith('에게')) {
        const base = compactKey.slice(0, -2);
        const baseMatch = getCompactPhraseMap().get(base);
        if (baseMatch) compactMatch = `ให้${baseMatch}`;
      } else if (compactKey.endsWith('에서')) {
        const base = compactKey.slice(0, -2);
        const baseMatch = getCompactPhraseMap().get(base);
        if (baseMatch) compactMatch = `ที่${baseMatch}`;
      } else if (compactKey.endsWith('까지')) {
        const base = compactKey.slice(0, -2);
        const baseMatch = getCompactPhraseMap().get(base);
        if (baseMatch) compactMatch = `จนถึง${baseMatch}`;
      } else if (compactKey.endsWith('들과') || compactKey.endsWith('들과는')) {
        const base = compactKey.replace(/들과는?$/, '');
        const baseMatch = getCompactPhraseMap().get(base);
        if (baseMatch) compactMatch = `กับพวก${baseMatch}`;
      } else if (/[을를이가은는과와도만네라]$/.test(compactKey)) {
        const base = compactKey.slice(0, -1);
        compactMatch = getCompactPhraseMap().get(base);
      }
    }

    if (compactMatch) {
      const trailingPunct = text.match(TRAILING_PUNCT_REGEX);
      let result = (trailingPunct && !HAS_TRAILING_PUNCT_REGEX.test(compactMatch)) ? compactMatch + trailingPunct[1] : compactMatch;
      return hasOuterParens && !result.startsWith('(') ? `(${result})` : result;
    }
  }

  if (/[\uAC00-\uD7AF]/.test(text)) {
    const koreanMatch = applyKoreanConversationalFallback(text, text);
    if (koreanMatch) return koreanMatch;
  }

  return GENERAL_ENGLISH_DICTIONARY_TH[key] || null;
};

export const systemicWordFallbackTranslate = (text: string): string | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const words = trimmed.split(/[\s,!?.-]+/g).filter(Boolean);
  if (words.length === 0 || words.length > 4) return null;

  const translatedWords: string[] = [];
  let matchedCount = 0;

  for (const word of words) {
    const key = word.toLowerCase();
    const directLookup = lookupShortPhraseTh(word) || GENERAL_ENGLISH_DICTIONARY_TH[key];
    if (directLookup) {
      translatedWords.push(directLookup);
      matchedCount += 1;
    } else {
      translatedWords.push(word);
    }
  }

  if (matchedCount > 0) {
    return translatedWords.join(' ');
  }

  return null;
};

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

// -------------------------------------------------------------
// Translation Quality Assessment Helpers
// -------------------------------------------------------------

const ENGLISH_COMMON_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'when',
  'at', 'by', 'for', 'from', 'in', 'into', 'of', 'off', 'on', 'onto',
  'out', 'over', 'to', 'up', 'with', 'was', 'were', 'is', 'are', 'am',
  'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might',
  'must', 'go', 'went', 'gone', 'come', 'came', 'get', 'got', 'put',
  'take', 'took', 'give', 'gave', 'find', 'found', 'think', 'thought',
  'say', 'said', 'tell', 'told', 'you', 'your', 'he', 'his', 'him',
  'she', 'her', 'it', 'its', 'we', 'our', 'us', 'they', 'their', 'them',
  'who', 'whom', 'whose', 'what', 'which', 'where', 'when', 'why', 'how',
  'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some',
  'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
  'very', 's', 't', 'don', 'just', 'shouldn', 'now',
  // Added common pronouns, interjections and common dialogue keywords
  'suck', 'cock', 'bitch', 'pig', 'hell', 'damn', 'ass', 'fuck', 'shit'
]);

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

  const compact = source.replace(/\s+/g, '');
  const asciiCompact = compact.replace(/[^A-Za-z0-9]/g, '');
  const isKnownShortWord = isKnownShortWordHelper(asciiCompact);
  if (isKnownShortWord) {
    return false;
  }

  // ทำไม: ถ้า source มีคำที่อยู่ใน glossary แล้วจะแปลถูกแน่นอน ไม่ควร skip ออกไป
  const glossaryLookup = lookupShortPhraseTh(source);
  if (glossaryLookup !== null) {
    return false;
  }
  
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

  // Check for residual CJK characters in the translated output -> if CJK remains, it failed translation
  const hasCjkResidual = /[\uAC00-\uD7A3\u3040-\u30FF\u4E00-\u9FFF]/.test(translated);
  if (hasCjkResidual) {
    return true; // Skip overlay since CJK text is leaked
  }

  // Check for common watermark layouts (URLs, domain names, or scanlation watermarks)
  const isUrlOrDomain = /\.(com|net|org|io|gg|co|info|cc|to|xyz|me)\b/i.test(source)
    || /www\./i.test(source)
    || /^(?:colamanga|cloudmerge|asurascans|mangatio|likemanga|scans|newtoki)/i.test(source.replace(/[^A-Za-z0-9]/g, ''));

  if (isLikelyEnglishDialogue(source) && !isUrlOrDomain) {
    return false;
  }

  if (thaiChars > 0) return false;

  // ทำไม: manga dialogue fragments ที่รู้จักต้องไม่โดน skip ไม่ว่า Argos จะแปลได้หรือไม่
  // เพราะ glossary จะ override ผลการแปลที่ถูกต้องอยู่แล้ว
  const compactUpper = source.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const KNOWN_MANGA_PHRASES = /^(?:THEPIGYOUARE|LIKETHEPIGYOUARE|PIGYOUARE|THEPIG|PIG|THENTRYANDHOLDBACKYOURORGASMYOUPIG|KILLME|WITHPROCREATION|NIPPLES|SUDDENLY|BUT|FORMAMEDICAL|WAYTOOGOOD|BEINGTOO|FROMTHE|ITFEELS|OUTINSIDE|STILLFULL|ILLNESSBE|WELLSINCE|RESTA|THESEX|BLOWJOB|NURSE|OFME|EROMANGA|OFMEEROMANGA|ITWITHOUT|HEADNURSE|HEADNURS\w+|DISEASE|FOUNDA|RESTRAINT|HERPUSSY|CUMMING|WAYTOO|NOTNECESSARY|ADYDO|PLEASE|YQURE|WIDLY|SIDESHOW|CAME|C[O]+CKS|ONEONONE|CUMALOTJUSTLIKETHAT|GONNADIE|TOBEDEADNOW|ONEBATTLE|SOPLEASE|NONSTOP|HEHEHE|MEEEEEEE|MEEEEEE|MEEEEE|WITHIT|FRONT|YOUFRONT|KNIGHT|KNIIIGHT|KNIIIIGHT|KNIIIIIGHT|KNIIIIIIGHT|YOURE|USTHE|HES|GET|CUM|II|NIPPLES|LONGER|TODAYAGAIN|HERPOSI|HERPOSITION|SUITS|SO|NIPPLESAND|CERVIX|GENERAL|DIEALONG|ALSO|HERPLACE|MAKESURE|SADNESS|ALLARSTOCRATS|ALLARISTOCRATS|KINGAND|BUTINANYAGE|DEAD|OUUUUT|MOREEEEEE|PLEEAAASEEE|RECAPTURING|ANALLOUT|IFI|TOYEDWITH|ANDWASATA|EXPECT|ANDHER|YOUFRONTUSTHEGETTINGAWAYWITH|BE|STOP|HOLE|LETHER|THEBABAR|THEBARBA|PUNCHINGMY|GETTING|ALSOSAYTHAT|BUTINANY|FIRST|AGAIN|ASS|ASSHOLE|ISDEAD|MYHEARTSBEINGTORNBYTHEIRCOCKS|BEINGSLASHEDBYC[O]+CKS|BYC[O]+CKS)$/i.test(compactUpper);
  if (KNOWN_MANGA_PHRASES) return false;

  if (sourceKey === translatedKey) {
    const wordsList = source.toLowerCase().split(/[^a-z]+/g).filter(Boolean);
    const hasCommonWord = wordsList.some(w => ENGLISH_COMMON_WORDS.has(w));
    if (hasCommonWord) {
      return false;
    }
    // Check for common watermark layouts (URLs, domain names, or scanlation watermarks)
    const isUrlOrDomain = /\.(com|net|org|io|gg|co|info|cc|to|xyz|me)\b/i.test(source)
      || /www\./i.test(source)
      || /^(?:colamanga|cloudmerge|asurascans|mangatio|likemanga|scans|newtoki)/i.test(source.replace(/[^A-Za-z0-9]/g, ''));

    const threshold = isUrlOrDomain ? 8 : 18;
    return tokenCount >= 1 && (sourceLatinChars >= threshold || source.length >= threshold);
  }

  // เพิ่ม threshold: >= 6 แทน >= 4 เพื่อป้องกัน multi-word dialogue fragments โดน skip
  return latinChars >= 6 && sourceLatinChars >= 6 && tokenCount >= 3;
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

  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  if (normalizedTarget === 'th' && !/[\u0E00-\u0E7F]/.test(translated)) {
    return true;
  }

  // Bypass low-quality retry classification for normal English dialogue/narrative
  const wordsList = source.toLowerCase().split(/[^a-z]+/g).filter(Boolean);
  const hasCommonWord = wordsList.some(w => ENGLISH_COMMON_WORDS.has(w));
  if (hasCommonWord) {
    return false;
  }

  const isUrlOrDomain = /\.(com|net|org|io|gg|co|info|cc|to|xyz|me)\b/i.test(source)
    || /www\./i.test(source)
    || /^(?:colamanga|cloudmerge|asurascans|mangatio|likemanga|scans|newtoki)/i.test(source.replace(/[^A-Za-z0-9]/g, ''));
  const threshold = isUrlOrDomain ? 8 : 18;
  if (source.length < threshold && !isUrlOrDomain) {
    return false;
  }

  const sourceKey = buildTranslationComparisonKey(source);
  const translatedKey = buildTranslationComparisonKey(translated);
  if (sourceKey && translatedKey && sourceKey === translatedKey) {
    return true;
  }

  const normalizedSource = normalizeTranslationLanguage(sourceLanguage, 'en');

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
