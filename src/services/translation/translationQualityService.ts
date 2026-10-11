/**
 * Translation Quality & Text Assessment Service
 * 
 * [Scrutinize S3]: Extracted from offlineTranslationService.ts
 * Manages translation quality gates, candidate scoring, carry-over detection,
 * retry heuristics, and continuation analysis.
 */

import {
  normalizeWhitespace,
  normalizeTranslationLanguage,
} from '../ocr/ocrTextNormalizer';
import { isKnownShortWordHelper, isLikelyEnglishDialogue } from '../ocr/ocrSafetyLineDedup';
import { hasKoreanTranslationCarryover } from './koreanTranslationPolicy';
import { lookupShortPhraseTh } from './shortPhraseDictionaryService';

export const TRANSLATION_LETTER_REGEX = /[A-Za-z\u00C0-\u024F\u0400-\u04FF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/;

export const ENGLISH_COMMON_WORDS = new Set([
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

  const glossaryLookup = lookupShortPhraseTh(source);
  if (glossaryLookup !== null) {
    return false;
  }
  
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

  const hasCjkResidual = /[\uAC00-\uD7A3\u3040-\u30FF\u4E00-\u9FFF]/.test(translated);
  if (hasCjkResidual) {
    return true;
  }

  const isUrlOrDomain = /\.(com|net|org|io|gg|co|info|cc|to|xyz|me)\b/i.test(source)
    || /www\./i.test(source)
    || /^(?:colamanga|cloudmerge|asurascans|mangatio|likemanga|scans|newtoki)/i.test(source.replace(/[^A-Za-z0-9]/g, ''));

  if (isLikelyEnglishDialogue(source) && !isUrlOrDomain) {
    return false;
  }

  if (thaiChars > 0) return false;

  const compactUpper = source.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const KNOWN_MANGA_PHRASES = /^(?:THEPIGYOUARE|LIKETHEPIGYOUARE|PIGYOUARE|THEPIG|PIG|THENTRYANDHOLDBACKYOURORGASMYOUPIG|KILLME|WITHPROCREATION|NIPPLES|SUDDENLY|BUT|FORMAMEDICAL|WAYTOOGOOD|BEINGTOO|FROMTHE|ITFEELS|OUTINSIDE|STILLFULL|ILLNESSBE|WELLSINCE|RESTA|THESEX|BLOWJOB|NURSE|OFME|EROMANGA|OFMEEROMANGA|ITWITHOUT|HEADNURSE|HEADNURS\w+|DISEASE|FOUNDA|RESTRAINT|HERPUSSY|CUMMING|WAYTOO|NOTNECESSARY|ADYDO|PLEASE|YQURE|WIDLY|SIDESHOW|CAME|C[O]+CKS|ONEONONE|CUMALOTJUSTLIKETHAT|GONNADIE|TOBEDEADNOW|ONEBATTLE|SOPLEASE|NONSTOP|HEHEHE|MEEEEEEE|MEEEEEE|MEEEEE|WITHIT|FRONT|YOUFRONT|KNIGHT|KNIIIGHT|KNIIIIGHT|KNIIIIIGHT|KNIIIIIIGHT|YOURE|USTHE|HES|GET|CUM|II|NIPPLES|LONGER|TODAYAGAIN|HERPOSI|HERPOSITION|SUITS|SO|NIPPLESAND|CERVIX|GENERAL|DIEALONG|ALSO|HERPLACE|MAKESURE|SADNESS|ALLARSTOCRATS|ALLARISTOCRATS|KINGAND|BUTINANYAGE|DEAD|OUUUUT|MOREEEEEE|PLEEAAASEEE|RECAPTURING|ANALLOUT|IFI|TOYEDWITH|ANDWASATA|EXPECT|ANDHER|YOUFRONTUSTHEGETTINGAWAYWITH|BE|STOP|HOLE|LETHER|THEBABAR|THEBARBA|PUNCHINGMY|GETTING|ALSOSAYTHAT|BUTINANY|FIRST|AGAIN|ASS|ASSHOLE|ISDEAD|MYHEARTSBEINGTORNBYTHEIRCOCKS|BEINGSLASHEDBYC[O]+CKS|BYC[O]+CKS)$/i.test(compactUpper);
  if (KNOWN_MANGA_PHRASES) return false;

  if (sourceKey === translatedKey) {
    const wordsList = source.toLowerCase().split(/[^a-z]+/g).filter(Boolean);
    const hasCommonWord = wordsList.some(w => ENGLISH_COMMON_WORDS.has(w));
    if (hasCommonWord) {
      return false;
    }
    const threshold = isUrlOrDomain ? 8 : 18;
    return tokenCount >= 1 && (sourceLatinChars >= threshold || source.length >= threshold);
  }

  return latinChars >= 6 && sourceLatinChars >= 6 && tokenCount >= 3;
};

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
      return -100;
    }

    let score = candidateLength * 0.1;

    // 1) Length balance check
    const lengthRatio = candidateLength / Math.max(1, sourceLength);
    if (lengthRatio >= 0.5 && lengthRatio <= 1.8) {
      score += 20;
    } else if (lengthRatio >= 0.35 && lengthRatio <= 2.3) {
      score += 10;
    } else if (lengthRatio < 0.22 && sourceLength >= 12) {
      score -= 30;
    }

    // 2) Thai purity and density metrics
    score += stats.thaiRatio * 30;
    if (stats.latinChars === 0) {
      score += 25;
    } else {
      score -= stats.latinRatio * 35;
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

/**
 * ตรวจสอบว่าผลลัพธ์การแปลที่ถูกแคชไว้เป็นคำที่ไม่ได้แปลจริงหรือไม่ (Untranslated / Hallucination / Residual)
 * หากคืนค่า true แสดงว่าเป็นแคชที่ไม่มีคุณภาพ ควรส่งแปลใหม่
 */
export const isCachedUntranslated = (
  cachedText: string,
  sourceText: string,
  targetLang: string,
  sourceLang: string
): boolean => {
  if (targetLang !== 'th') return false;
  const trimmed = cachedText.trim();
  if (!trimmed) return true;

  const hasThaiChars = /[\u0E00-\u0E7F]/.test(trimmed);
  const hasLatinLetters = /[a-zA-Z]/.test(trimmed);

  if (hasLatinLetters && !hasThaiChars) return true;

  const normSource = normalizeTranslationLanguage(sourceLang, '').toLowerCase();
  if ((normSource === 'es' || normSource === 'spa') && hasLatinLetters && !hasThaiChars) {
    const lenDelta = Math.abs(trimmed.length - sourceText.length) / Math.max(1, sourceText.length);
    if (lenDelta < 0.20 && trimmed.toLowerCase() === sourceText.toLowerCase().trim()) {
      return true;
    }
  }

  const hasCjkResidual = /[\uAC00-\uD7A3\u3040-\u30FF\u4E00-\u9FFF]/.test(trimmed);
  if (hasCjkResidual) return true;

  const sourceHasHangul = /[\uAC00-\uD7AF]/.test(sourceText);
  if (hasKoreanTranslationCarryover(trimmed) && (normSource === 'ko' || normSource === 'kor' || sourceHasHangul)) return true;
  const hasKana = /[\u3040-\u30FF]/.test(trimmed);
  const sourceHasKana = /[\u3040-\u30FF]/.test(sourceText);
  if (hasKana && (normSource === 'ja' || normSource === 'jpn' || sourceHasKana)) return true;
  const hasHan = /[\u3400-\u4DBF\u4E00-\u9FFF]/.test(trimmed);
  const sourceHasHan = /[\u3400-\u4DBF\u4E00-\u9FFF]/.test(sourceText);
  if (hasHan && sourceHasHan) return true;

  const sourceLen = sourceText.trim().length;
  const resultLen = trimmed.length;
  if (sourceLen > 15 && resultLen < 4) return true;
  const resultHasOnlyDots = /^[\s.·•\-_]+$/.test(trimmed);
  if (resultHasOnlyDots && sourceLen > 5) return true;

  const isCjkSource = /[\uAC00-\uD7AF\u3040-\u30FF\u4E00-\u9FFF]/.test(sourceText);
  const isActualBoilerplateSource = /회사\s*소개|이용\s*약관|개인정보|서비스\s*약관/.test(sourceText);
  if (isCjkSource && !isActualBoilerplateSource) {
    const boilerplateTerms = [
      'เกี่ยวกับเรา',
      'เงื่อนไขการบริการ',
      'นโยบายความเป็นส่วนตัว',
      'ข้อตกลงในการให้บริการ',
      'ผมตกลงในเงื่อนไข',
      'ฉันตกลงในเงื่อนไข',
      'ข้อมูลส่วนบุคคล'
    ];
    const hasBoilerplate = boilerplateTerms.some(term => trimmed.includes(term));
    if (hasBoilerplate) return true;
  }

  return false;
};

