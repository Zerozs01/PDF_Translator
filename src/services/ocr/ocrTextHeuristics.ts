import { OCRLine, BBox } from '../../types';
import { TranslationMode } from '../../stores/useProjectStore';
import { TranslatableLine } from '../translation/translationBatchService';
import {
  normalizeWhitespace,
  normalizeSourceForTranslation,
  normalizeTranslationLanguage,
} from './ocrTextNormalizer';

export const HANGUL_REGEX = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/;
export const THAI_REGEX = /[\u0E00-\u0E7F]/;

const SENTENCE_END_REGEX = /[.!?\u2026\u3002\uFF01\uFF1F]$/;
export const SOFT_CONTINUATION_END_REGEX = /[,;:\-\u2014\u2013\u3001\uFF0C]$/;
export const CONTINUATION_TRAILING_WORD_REGEX = /\b(?:a|an|the|of|to|for|and|or|but|if|when|while|with|without|into|onto|from|by|as|than|that|this|these|those|my|your|his|her|its|our|their|is|are|was|were|be|been|being|do|does|did|have|has|had|can|could|will|would|should|must|may|might|not|so|up|off|out|over|under|about|around|through|toward|towards)$/i;
const CONTINUATION_LEADING_WORD_REGEX = /^(?:and|or|but|if|when|while|because|that|which|who|whose|whom|to|for|of|with|as|than|then|so|also|still|yet|just)\b/i;

export const countReadableLength = (text: string): number => {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length;
};

export const isStrongSentenceEnd = (text: string): boolean => {
  const compact = text.trim();
  if (!compact) return false;
  return SENTENCE_END_REGEX.test(compact);
};

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

export const computeMedian = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
};

export type ProtectedTokenReplacement = {
  token: string;
  replacement: string;
};

export const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const buildLooseTokenPattern = (token: string): RegExp => {
  const parts = token
    .split('')
    .map((ch) => escapeRegExp(ch))
    .join('[\\s_\\-]*');
  return new RegExp(parts, 'gi');
};

export const collapseRepeatedTranslationFragments = (text: string): string => {
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) return normalized;

  // Common OCR+translation artifact: duplicated hesitant opener (e.g. "A-Are you A-Are you ...").
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

export const TRANSLATION_LETTER_REGEX = /[A-Za-z\u00C0-\u024F\u0400-\u04FF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/;
export const HANGUL_REGEX_HINT = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/;
export const THAI_REGEX_HINT = /[\u0E00-\u0E7F]/;

export const buildTranslationComparisonKey = (value: string): string =>
  normalizeWhitespace(String(value || ''))
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F\u0400-\u04FF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]+/g, '');

export const buildOfflineGroupRetrySourceText = (lines: TranslatableLine[], sourceLanguage = ''): string => {
  const prepared = lines
    .map((line) => normalizeSourceForTranslation(line.text, sourceLanguage))
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  if (prepared.length <= 1) {
    return prepared[0] || '';
  }

  const stitched: string[] = [prepared[0]];
  for (let i = 1; i < prepared.length; i += 1) {
    const current = prepared[i];
    const previous = stitched[stitched.length - 1] || '';
    const previousEndsSentence = /[.!?…]"?$/.test(previous);
    const currentStartsContinuation = /^[a-z,\])]/.test(current);
    stitched[stitched.length - 1] = previousEndsSentence || currentStartsContinuation
      ? previous
      : `${previous}.`;
    stitched.push(current);
  }

  return stitched.join(' ');
};

export const resolveSourceLanguageFromOCR = (ocrLanguageKey: string, fallback: string): string => {
  const candidates = String(ocrLanguageKey || '')
    .split('+')
    .map((part) => normalizeTranslationLanguage(part, ''))
    .filter(Boolean);

  if (candidates.length === 0) {
    return fallback;
  }

  // Prefer non-English OCR source when mixed-language OCR is enabled.
  const nonEnglish = candidates.find((lang) => lang !== 'en');
  return nonEnglish || candidates[0] || fallback;
};

const SPANISH_HINT_WORDS = new Set([
  'que', 'de', 'la', 'el', 'los', 'las', 'un', 'una', 'por', 'para', 'con', 'sin', 'como', 'pero',
  'si', 'ya', 'me', 'mi', 'se', 'te', 'tu', 'lo', 'le', 'del', 'al', 'es', 'son', 'fue', 'esta', 'este', 'eso',
  'estaba', 'estaban', 'estoy', 'eres', 'somos', 'estan', 'todas', 'todos', 'parte', 'partes',
  'cuerpo', 'solo', 'nada', 'doloroso', 'sentia', 'siento', 'espera', 'momento', 'aqui', 'ahi',
]);

const ENGLISH_HINT_WORDS = new Set([
  'the', 'and', 'you', 'your', 'this', 'that', 'with', 'from', 'for', 'are', 'was', 'were',
  'have', 'has', 'had', 'will', 'would', 'there', 'here', 'what', 'when', 'where', 'who',
]);

const SPANISH_MORPH_HINT_REGEX = /\b(?:[a-záéíóúüñ]+(?:ando|iendo|aron|aban|ado|ada|ados|adas|ido|ida|idos|idas|mente|cion(?:es)?|sion(?:es)?)|estaba|estaban|tocando|cuerpo|partes?|sentia|siento|espera|momento)\b/gi;

export const scoreSpanishHintTokens = (tokens: string[]): number => {
  let score = 0;
  for (const tokenRaw of tokens) {
    const token = String(tokenRaw || '').toLowerCase();
    if (!token) continue;

    if (SPANISH_HINT_WORDS.has(token)) {
      score += 1;
      continue;
    }

    if (token.length >= 6 && /(?:ando|iendo|aron|aban|ado|ada|ados|adas|ido|ida|idos|idas|mente|cion(?:es)?|sion(?:es)?)$/.test(token)) {
      score += 0.72;
    }

    if (token.length >= 6 && /(?:que|como|por|para|con|sin|del|al|te|se|me)$/.test(token)) {
      score += 0.46;
    }

    if (/^(?:te|se|me|lo|la|los|las)[a-záéíóúüñ]{4,}$/.test(token)) {
      score += 0.58;
    }
  }
  return score;
};

export const scoreEnglishHintTokens = (tokens: string[]): number =>
  tokens.reduce((score, tokenRaw) => {
    const token = String(tokenRaw || '').toLowerCase();
    return score + (ENGLISH_HINT_WORDS.has(token) ? 1 : 0);
  }, 0);

export const HANGUL_TEXT_HINT_REGEX = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/g;
export const JAPANESE_KANA_HINT_REGEX = /[\u3040-\u30FF]/g;
export const CJK_HAN_HINT_REGEX = /[\u3400-\u4DBF\u4E00-\u9FFF]/g;
export const THAI_TEXT_HINT_REGEX = /[\u0E00-\u0E7F]/g;
export const CYRILLIC_TEXT_HINT_REGEX = /[\u0400-\u04FF]/g;
export const LATIN_TEXT_HINT_REGEX = /[A-Za-z]/g;

export const scoreSpanishVsEnglishHints = (text: string): {
  spanishScore: number;
  englishScore: number;
  latinCount: number;
  spanishAccentHits: number;
} => {
  const normalized = normalizeWhitespace(String(text || '')).toLowerCase();
  const latinCount = (normalized.match(LATIN_TEXT_HINT_REGEX) || []).length;
  const tokens = normalized
    .split(/\s+/g)
    .map((token) => token.replace(/[^a-záéíóúüñ¿¡]/gi, '').toLowerCase())
    .filter(Boolean);
  const spanishTokenScore = scoreSpanishHintTokens(tokens);
  const englishScore = scoreEnglishHintTokens(tokens);
  const spanishAccentHits = (normalized.match(/[áéíóúüñ¿¡]/g) || []).length;
  const spanishMorphHits = (normalized.match(SPANISH_MORPH_HINT_REGEX) || []).length;
  return {
    spanishScore: spanishTokenScore + (spanishAccentHits * 1.8) + (Math.min(4, spanishMorphHits) * 0.5),
    englishScore,
    latinCount,
    spanishAccentHits,
  };
};

export const inferSourceLanguageFromTextHints = (
  lines: TranslatableLine[],
  fallbackLanguage: string
): string => {
  const fallback = normalizeTranslationLanguage(fallbackLanguage, 'en');
  if (lines.length === 0) return fallback;

  const sampleText = lines
    .slice(0, 40)
    .map((line) => normalizeWhitespace(String(line.text || '')))
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (!sampleText) return fallback;

  const hangulCount = (sampleText.match(HANGUL_TEXT_HINT_REGEX) || []).length;
  const kanaCount = (sampleText.match(JAPANESE_KANA_HINT_REGEX) || []).length;
  const hanCount = (sampleText.match(CJK_HAN_HINT_REGEX) || []).length;
  const thaiCount = (sampleText.match(THAI_TEXT_HINT_REGEX) || []).length;
  const cyrillicCount = (sampleText.match(CYRILLIC_TEXT_HINT_REGEX) || []).length;
  const latinCount = (sampleText.match(LATIN_TEXT_HINT_REGEX) || []).length;
  const nonLatinCount = hangulCount + kanaCount + hanCount + thaiCount + cyrillicCount;

  if (thaiCount >= Math.max(4, latinCount * 0.2)) {
    return 'th';
  }
  if (hangulCount >= Math.max(3, latinCount * 0.12)) {
    return 'ko';
  }
  if (kanaCount >= 2) {
    return 'ja';
  }
  if (hanCount >= 3 && kanaCount === 0 && hangulCount === 0) {
    return 'zh';
  }
  if (cyrillicCount >= Math.max(3, latinCount * 0.16)) {
    return 'ru';
  }

  const tokens = sampleText.split(/\s+/g).map((token) => token.replace(/[^a-záéíóúüñ¿¡]/gi, '').toLowerCase()).filter(Boolean);
  if (tokens.length === 0) return fallback;

  const spanishTokenScore = scoreSpanishHintTokens(tokens);
  const englishScore = scoreEnglishHintTokens(tokens);
  const spanishAccentHits = (sampleText.match(/[áéíóúüñ¿¡]/g) || []).length;
  const spanishMorphHits = (sampleText.match(SPANISH_MORPH_HINT_REGEX) || []).length;
  const spanishScore = spanishTokenScore + (spanishAccentHits * 1.8) + (Math.min(6, spanishMorphHits) * 0.45);

  const latinDominant = latinCount >= Math.max(10, nonLatinCount * 2.2);
  const weakNonLatinEvidence = nonLatinCount <= 2 || nonLatinCount <= Math.max(2, latinCount * 0.08);
  const shouldOverrideNonLatinFallback = fallback !== 'en' && fallback !== 'es' && weakNonLatinEvidence;

  if (latinDominant || shouldOverrideNonLatinFallback) {
    if (
      (spanishAccentHits >= 1 && spanishScore >= 2.4)
      || (spanishScore >= 3.2 && spanishScore >= englishScore + 0.8)
      || (spanishScore >= 2.8 && englishScore <= 1.8)
      || (fallback === 'es' && spanishScore >= 2.1)
      || (spanishScore >= 2.6 && /[¿¡]/.test(sampleText))
    ) {
      return 'es';
    }

    if (englishScore >= 3 && englishScore > spanishScore * 1.08) {
      return 'en';
    }
  }

  if (fallback !== 'en' && fallback !== 'es') {
    return fallback;
  }

  if (spanishScore >= 5.6 && spanishScore > englishScore * 1.25) {
    return 'es';
  }
  if (englishScore >= 6 && englishScore > spanishScore * 1.25) {
    return 'en';
  }
  if (spanishAccentHits >= 2 && spanishScore >= 2 && spanishScore >= englishScore) {
    return 'es';
  }

  return fallback;
};

export const resolvePreferredSourceLanguageForText = (
  text: string,
  fallbackLanguage: string
): string => {
  const fallback = normalizeTranslationLanguage(fallbackLanguage, 'en');
  const normalized = normalizeWhitespace(String(text || '')).toLowerCase();
  if (!normalized) return fallback;

  const hangulCount = (normalized.match(HANGUL_TEXT_HINT_REGEX) || []).length;
  const kanaCount = (normalized.match(JAPANESE_KANA_HINT_REGEX) || []).length;
  const hanCount = (normalized.match(CJK_HAN_HINT_REGEX) || []).length;
  const thaiCount = (normalized.match(THAI_TEXT_HINT_REGEX) || []).length;
  const cyrillicCount = (normalized.match(CYRILLIC_TEXT_HINT_REGEX) || []).length;
  const latinCount = (normalized.match(LATIN_TEXT_HINT_REGEX) || []).length;
  const nonLatinCount = hangulCount + kanaCount + hanCount + thaiCount + cyrillicCount;

  if (thaiCount >= Math.max(4, latinCount * 0.5)) {
    return 'th';
  }
  if (hangulCount >= Math.max(2, latinCount * 0.45) && latinCount <= hangulCount * 2.6) {
    return 'ko';
  }
  if (kanaCount >= 1 && latinCount <= Math.max(6, (kanaCount + hanCount) * 2.6)) {
    return 'ja';
  }
  if (hanCount >= 2 && kanaCount === 0 && hangulCount === 0 && latinCount <= hanCount * 2.4) {
    return 'zh';
  }
  if (cyrillicCount >= Math.max(2, latinCount * 0.38) && latinCount <= cyrillicCount * 2.2) {
    return 'ru';
  }

  const latinDominant = latinCount >= Math.max(6, nonLatinCount * 1.4);
  const tokens = normalized
    .split(/\s+/g)
    .map((token) => token.replace(/[^a-záéíóúüñ¿¡]/gi, '').toLowerCase())
    .filter(Boolean);
  const spanishTokenScore = scoreSpanishHintTokens(tokens);
  const englishScore = scoreEnglishHintTokens(tokens);
  const spanishAccentHits = (normalized.match(/[áéíóúüñ¿¡]/g) || []).length;
  const spanishMorphHits = (normalized.match(SPANISH_MORPH_HINT_REGEX) || []).length;
  const spanishScore = spanishTokenScore + (spanishAccentHits * 1.8) + (Math.min(4, spanishMorphHits) * 0.5);

  if (latinDominant || fallback === 'en' || fallback === 'es') {
    if (
      (spanishAccentHits >= 1 && spanishScore >= 1.8)
      || (spanishScore >= 2.4 && spanishScore >= englishScore + 0.5)
      || (spanishScore >= 2.1 && englishScore <= 1.3)
      || (fallback === 'es' && spanishScore >= 1.5)
      || /[¿¡]/.test(normalized)
    ) {
      return 'es';
    }
    if (fallback === 'es' && englishScore < 2.6) {
      return 'es';
    }
    if (englishScore >= 2.6 && englishScore > spanishScore * 1.08) {
      return 'en';
    }
    if (latinCount >= 4) {
      return 'en';
    }
  }

  return fallback;
};

export const isLikelyLatinDominantTranslationPage = (lines: TranslatableLine[]): boolean => {
  if (lines.length < 4) return false;
  const latinHeavyCount = lines.filter((line) => {
    const normalized = normalizeWhitespace(String(line.text || ''));
    const latinChars = (normalized.match(/[A-Za-z]/g) || []).length;
    const nonSpaceChars = normalized.replace(/\s+/g, '').length;
    const latinRatio = latinChars / Math.max(1, nonSpaceChars);
    return latinChars >= 6 && latinRatio >= 0.45;
  }).length;
  return latinHeavyCount >= Math.max(3, Math.floor(lines.length * 0.34));
};

export const hasStrongLatinAnchorLines = (lines: TranslatableLine[]): boolean => {
  const strongLatinCount = lines.filter((line) => {
    const normalized = normalizeWhitespace(String(line.text || ''));
    const latinChars = (normalized.match(/[A-Za-z]/g) || []).length;
    const tokenCount = normalized.split(/\s+/g).filter(Boolean).length;
    const nonSpaceChars = normalized.replace(/\s+/g, '').length;
    const latinRatio = latinChars / Math.max(1, nonSpaceChars);
    return latinChars >= 10 && tokenCount >= 3 && latinRatio >= 0.52;
  }).length;

  return strongLatinCount >= 2;
};

export const isLikelyShortForeignSfxLine = (text: string): boolean => {
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) return false;
  if (/[A-Za-z]/.test(normalized)) return false;

  const compact = normalized.replace(/\s+/g, '');
  const tokens = normalized.split(/\s+/g).filter(Boolean);
  const hasCjkOrThai = /[\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/.test(compact);
  if (!hasCjkOrThai) return false;
  if (/\d/.test(compact)) return false;

  const unknownChars = compact.replace(/[\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/g, '');
  const unknownRatio = unknownChars.length / Math.max(1, compact.length);
  return tokens.length <= 3 && compact.length <= 10 && unknownRatio <= 0.55;
};

export const resolveComicPageSourceLanguage = (
  lines: TranslatableLine[],
  fallbackLanguage: string,
  mode: TranslationMode
): string => {
  const fallback = normalizeTranslationLanguage(fallbackLanguage, 'en');
  if (fallback !== 'en') return fallback;
  if (mode !== 'manga' && mode !== 'manhwa' && mode !== 'adaptive') return fallback;
  if (lines.length < 3) return fallback;

  const sampleText = lines
    .slice(0, 48)
    .map((line) => normalizeWhitespace(String(line.text || '')))
    .filter(Boolean)
    .join(' ');
  if (!sampleText) return fallback;

  const sampleStats = scoreSpanishVsEnglishHints(sampleText);
  const spanishLikeLineCount = lines.filter((line) => {
    const normalized = normalizeWhitespace(String(line.text || ''));
    if (!normalized) return false;
    const stats = scoreSpanishVsEnglishHints(normalized);
    return stats.spanishAccentHits >= 1
      || stats.spanishScore >= 1.2
      || (stats.spanishScore >= 0.8 && stats.englishScore === 0);
  }).length;
  const englishLikeLineCount = lines.filter((line) => {
    const normalized = normalizeWhitespace(String(line.text || ''));
    if (!normalized) return false;
    const stats = scoreSpanishVsEnglishHints(normalized);
    return stats.englishScore >= 1.4 && stats.englishScore > stats.spanishScore * 1.1;
  }).length;

  if (
    sampleStats.latinCount >= 12
    && (
      (sampleStats.spanishAccentHits >= 1 && sampleStats.spanishScore >= 1.8)
      || (sampleStats.spanishScore >= 2.4 && sampleStats.spanishScore >= sampleStats.englishScore + 0.35)
      || (spanishLikeLineCount >= Math.max(2, Math.floor(lines.length * 0.18)) && englishLikeLineCount <= spanishLikeLineCount)
    )
  ) {
    return 'es';
  }

  return fallback;
};

const ENGLISH_TECH_HINT_WORDS = new Set([
  'chapter', 'table', 'continued', 'reaction', 'connection', 'unknowns', 'unknown',
  'force', 'forces', 'moment', 'components', 'component', 'magnitude', 'direction',
  'smooth', 'pin', 'hinge', 'fixed', 'support', 'submarine', 'cables', 'acting',
  'equilibrium', 'methods', 'determine', 'rigid', 'body', 'bridge', 'column',
  'apply', 'important', 'used', 'insure', 'fail', 'this', 'that', 'the', 'in', 'of', 'to'
]);

const OCR_NOISE_COMPACT_FRAGMENTS = [
  'submaie',
  'ureat',
  'ydoot',
  'falinth',
  'willtudhow',
  'effctofravt',
  'gnetiontact',
  'ctriclm',
  'rescaused',
];

export const hasKnownOcrNoisePattern = (text: string): boolean => {
  const compact = normalizeWhitespace(String(text || ''))
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  if (!compact) return false;
  return OCR_NOISE_COMPACT_FRAGMENTS.some((fragment) => compact.includes(fragment));
};

export const isLikelyStructuredOcrGarbageToken = (text: string): boolean => {
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) return false;

  const hasHangul = HANGUL_REGEX_HINT.test(normalized);
  const hasKana = /[\u3040-\u30FF]/.test(normalized);
  const hasHan = /[\u3400-\u9FFF]/.test(normalized);
  const hasThai = THAI_REGEX_HINT.test(normalized);
  if (hasHangul || hasKana || hasHan || hasThai) return false;

  const compact = normalized.replace(/\s+/g, '');
  if (compact.length > 14) return false;

  const alphaCount = (compact.match(/[A-Za-z]/g) || []).length;
  const digitCount = (compact.match(/[0-9]/g) || []).length;
  const symbolCount = (compact.match(/[^A-Za-z0-9]/g) || []).length;
  const bracketCount = (compact.match(/[()[\]{}<>]/g) || []).length;

  const hasMixedSymbolNoise = bracketCount >= 1 && symbolCount >= 2;
  const looksFragmented = compact.length <= 10 && alphaCount <= 5 && digitCount >= 1 && hasMixedSymbolNoise;
  if (!looksFragmented) return false;

  return true;
};

export const scoreSourceLineReadability = (text: string): number => {
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) return -1_000;

  const hasLatin = /[A-Za-z]/.test(normalized);
  if (!hasLatin) {
    return normalized.length * 0.22;
  }

  const tokens = normalized.split(/\s+/g).filter(Boolean);
  let score = 0;
  let weirdTokens = 0;

  if (hasKnownOcrNoisePattern(normalized)) {
    weirdTokens += 2;
    score -= 10.5;
  }

  for (const token of tokens) {
    const clean = token.replace(/[^A-Za-z]/g, '');
    if (!clean) continue;

    const lower = clean.toLowerCase();
    score += Math.min(clean.length, 14) * 0.75;

    if (/[aeiou]/i.test(clean)) {
      score += 1.7;
    } else if (clean.length >= 4) {
      weirdTokens += 1;
      score -= 3.1;
    }

    if (clean === clean.toUpperCase() && clean.length >= 7) {
      score -= 1.2;
    }

    if (ENGLISH_TECH_HINT_WORDS.has(lower)) {
      score += 3.6;
    }

    if (/^(submaie|ureat|ydoot|falinth|willtudhow|chapte|chapt|effctofravt|ctriclm|gnetiontact|rescaused)$/i.test(lower)) {
      weirdTokens += 1;
      score -= 6.2;
    }
  }

  score -= weirdTokens * 0.85;
  return score;
};

export const shouldAcceptWordsOnlyLineFallback = (line: OCRLine | undefined, wordsText: string): boolean => {
  const normalizedWords = normalizeWhitespace(String(wordsText || ''));
  if (!line || !normalizedWords) return false;

  const validWords = (Array.isArray(line.words) ? line.words : [])
    .filter((word) => {
      const text = normalizeWhitespace(String(word?.text || ''));
      const bbox = word?.bbox;
      if (!text || !bbox) return false;
      return (bbox.x1 - bbox.x0) > 0 && (bbox.y1 - bbox.y0) > 0;
    });
  if (validWords.length === 0) return false;

  const lineWidth = Math.max(1, Number(line.bbox?.x1 || 0) - Number(line.bbox?.x0 || 0));
  const lineHeight = Math.max(1, Number(line.bbox?.y1 || 0) - Number(line.bbox?.y0 || 0));
  const lineArea = Math.max(1, lineWidth * lineHeight);

  let unionX0 = Number.POSITIVE_INFINITY;
  let unionY0 = Number.POSITIVE_INFINITY;
  let unionX1 = Number.NEGATIVE_INFINITY;
  let unionY1 = Number.NEGATIVE_INFINITY;
  validWords.forEach((word) => {
    const bbox = word.bbox;
    unionX0 = Math.min(unionX0, bbox.x0);
    unionY0 = Math.min(unionY0, bbox.y0);
    unionX1 = Math.max(unionX1, bbox.x1);
    unionY1 = Math.max(unionY1, bbox.y1);
  });

  const unionArea = Math.max(1, (unionX1 - unionX0) * (unionY1 - unionY0));
  const coverage = unionArea / lineArea;
  const avgConfidence = validWords.reduce((sum, word) => sum + Number(word.confidence || 0), 0) / validWords.length;

  const tokens = normalizedWords.split(/\s+/g).filter(Boolean);
  const hasCjkOrThai = /[\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(normalizedWords);
  const shortSingleToken = tokens.length === 1 && normalizedWords.length <= 8;

  if (shortSingleToken && !hasCjkOrThai) {
    return coverage >= 0.72 && avgConfidence >= 72;
  }

  if (tokens.length <= 2 && normalizedWords.length <= 10 && !hasCjkOrThai) {
    return coverage >= 0.58 && avgConfidence >= 62;
  }

  if (tokens.length >= 3 || normalizedWords.length >= 14) {
    return coverage >= 0.24 || avgConfidence >= 58;
  }

  return coverage >= 0.42;
};

export const computeLineWordUnionCoverage = (line: OCRLine | undefined): number => {
  if (!line?.bbox) return 0;

  const validWords = (Array.isArray(line.words) ? line.words : [])
    .filter((word) => {
      const text = normalizeWhitespace(String(word?.text || ''));
      const bbox = word?.bbox;
      if (!text || !bbox) return false;
      return (bbox.x1 - bbox.x0) > 0 && (bbox.y1 - bbox.y0) > 0;
    });
  if (validWords.length === 0) return 0;

  const lineWidth = Math.max(1, Number(line.bbox.x1 || 0) - Number(line.bbox.x0 || 0));
  const lineHeight = Math.max(1, Number(line.bbox.y1 || 0) - Number(line.bbox.y0 || 0));
  const lineArea = Math.max(1, lineWidth * lineHeight);

  let unionX0 = Number.POSITIVE_INFINITY;
  let unionY0 = Number.POSITIVE_INFINITY;
  let unionX1 = Number.NEGATIVE_INFINITY;
  let unionY1 = Number.NEGATIVE_INFINITY;
  validWords.forEach((word) => {
    const bbox = word.bbox;
    unionX0 = Math.min(unionX0, bbox.x0);
    unionY0 = Math.min(unionY0, bbox.y0);
    unionX1 = Math.max(unionX1, bbox.x1);
    unionY1 = Math.max(unionY1, bbox.y1);
  });

  const unionArea = Math.max(1, (unionX1 - unionX0) * (unionY1 - unionY0));
  return Math.max(0, Math.min(1.8, unionArea / lineArea));
};

export const resolveBestOcrLineText = (line?: OCRLine): string => {
  const rawText = normalizeWhitespace(String(line?.text || ''));
  const wordsText = normalizeWhitespace(
    Array.isArray(line?.words)
      ? line!.words.map((word) => String(word?.text || '')).join(' ')
      : ''
  );

  if (!rawText) {
    if (!wordsText) return '';
    return shouldAcceptWordsOnlyLineFallback(line, wordsText) ? wordsText : '';
  }
  if (!wordsText) return rawText;

  const rawScore = scoreSourceLineReadability(rawText);
  const wordsScore = scoreSourceLineReadability(wordsText);
  const rawHasKnownNoise = hasKnownOcrNoisePattern(rawText);
  const wordsHasKnownNoise = hasKnownOcrNoisePattern(wordsText);

  if (rawHasKnownNoise && !wordsHasKnownNoise) {
    return wordsText;
  }
  if (wordsHasKnownNoise && !rawHasKnownNoise) {
    return rawText;
  }

  if (wordsScore > rawScore + 2.2) {
    return wordsText;
  }
  return rawText;
};

const GHOST_TRANSLATION_PUNCT_ONLY_REGEX = /^[|¦│┃/\\_~.,:;'"`!?-]+$/;
const GHOST_TRANSLATION_SHORT_TOKEN_REGEX = /^[A-Z0-9]{1,4}$/;
const TECHNICAL_GHOST_BYPASS_REGEX = /\b(resultant|magnitude|direction|force|column|columns|connections?|support|reaction|unknowns?|beam|beams|welded|rigid|types?|table|continued|hinge|pin)\b/i;
const TECHNICAL_EQUATION_TAG_REGEX = /\(\s*\d{1,3}[a-z]?\s*\)/i;

export const shouldForceKeepTechnicalTranslationLine = (resolvedText: string, line?: OCRLine): boolean => {
  const normalized = normalizeWhitespace(String(resolvedText || ''));
  if (!normalized) return false;

  const alphaNumLength = normalized.replace(/[^A-Za-z0-9]/g, '').length;
  if (alphaNumLength < 6) return false;

  const tokenCount = normalized.split(/\s+/g).filter(Boolean).length;
  if (tokenCount < 2 || tokenCount > 20) return false;

  const hasTechnicalCue = TECHNICAL_GHOST_BYPASS_REGEX.test(normalized);
  const hasEquationTag = TECHNICAL_EQUATION_TAG_REGEX.test(normalized);
  if (!hasTechnicalCue && !hasEquationTag) return false;

  if (!line?.bbox) return true;

  const width = Math.max(1, Number(line.bbox.x1 || 0) - Number(line.bbox.x0 || 0));
  const height = Math.max(1, Number(line.bbox.y1 || 0) - Number(line.bbox.y0 || 0));
  const rowLikeGeometry = width >= Math.max(88, alphaNumLength * 4.2) && height <= 72;

  return rowLikeGeometry || hasEquationTag;
};

const FORCE_KEEP_COMIC_TRANSLATION_LINE_REGEXES = [
  /^AH\s+ME[.!?…]*$/i,
  /^EH\s+ME[.!?…]*$/i,
  /^EH[.!?…]+$/i,
  /^ME[.!?…]+$/i,
  /^YOU[-\s]+COULD\s+SAY[.!?…]*$/i,
  /^(?:SO\s+ME\s+THING|SOMETHING)\s+THAT\s+MIGHT[.!?…]*$/i,
  /^HELP\s+YOU\s+TOO[.!?…]*$/i,
  /^ENTRANCE[.!?…]*$/i,
  /^ARE\s+ONLY[.!?…]*$/i,
  /^OUR\s+CHANCE[.!?…]*$/i,
  /^THEM[.!?…]*$/i,
  /^SHOE\s+LOCKER[.!?…]*$/i,
  /^AND\s+LEAVE\s+THE[.!?…]*$/i,
  /^OPEN\s+A\s+SHOE\s+LOCKER[.!?…]*$/i,
  /^PRINCESS[.!?…]*$/i,
  /^PRiNCESS[.!?…]*$/i,
  /^DIE[.!?…]*$/i,
  /^PIG[.!?…]*$/i,
  /^CUM[.!?…]*$/i,
  /^OHHH*[!.,?…]*$/i,
  /^OHHH*H*[!.,?…]*$/i,
  /^AGAA[.!?…]*$/i,
  /^SO[.!?…]*$/i,
  /^OF[.!?…]*$/i,
  /^ALL[.!?…]*$/i,
  /^MORE[.!?…]*$/i,
  /^YOU[.!?…]*$/i,
  /^US\s+THE[.!?…]*$/i,
  /^NOT\s+MY[.!?…]*$/i,
  /^ASS-[.!?…]*$/i,
  /^HOLE[.!?…]*$/i,
  /^FOR\s+YOU[.!?…]*$/i,
  /^I\s+CAME[.!?…]*$/i,
  /^OH,\s*OH*H*[!.,?…]*$/i,
  /^BE[.!?…]*$/i,
  /^WET\s+PUSSY[.!?…]*$/i,
  /^WET\s+PuSSY[.!?…]*$/i,
  /^YOU['’]RE[.!?…]*$/i,
  /^A[!.,?…]*$/i,
  /^STOA*O*P*[!.,?…]*$/i,
  /^STO[OA]+P*[!.,?…]*$/i,
  /^MY\s+HEART'S\s+BEING\s+TORN\s+BY\s+THEIR\s+COCKS[!.,?…]*$/i,
  /^RAPING-MY[.!?…]*$/i,
  /^RAPING\s+MY[.!?…]*$/i,
  /^LiKE\s+THIS[.!?…]*$/i,
  /^LIKE\s+THIS[.!?…]*$/i,
  /^WAS\s+TOYED[.!?…]*$/i,
  /^UP\s+LOOKING[.!?…]*$/i,
  /^UP\s+LOOKiNG[.!?…]*$/i,
];

export const shouldForceKeepComicTranslationLine = (
  resolvedText: string,
  line?: OCRLine,
  metrics?: { width?: number; height?: number; area?: number; wordCoverage?: number }
): boolean => {
  const normalized = normalizeWhitespace(String(resolvedText || ''));
  if (!normalized) return false;
  if (!FORCE_KEEP_COMIC_TRANSLATION_LINE_REGEXES.some((regex) => regex.test(normalized))) return false;

  if (!line?.bbox) return true;
  const width = Math.max(1, Number(metrics?.width ?? (Number(line.bbox.x1 || 0) - Number(line.bbox.x0 || 0))));
  const height = Math.max(1, Number(metrics?.height ?? (Number(line.bbox.y1 || 0) - Number(line.bbox.y0 || 0))));
  const area = Math.max(1, Number(metrics?.area ?? (width * height)));
  const wordCoverage = Math.max(0, Number(metrics?.wordCoverage ?? computeLineWordUnionCoverage(line)));

  // Keep the real short dialogue fragments, but do not resurrect cross-column bridge artifacts.
  if (width >= 960 && area >= 76000 && wordCoverage >= 0.52) return false;
  return true;
};

export const isLikelyGhostTranslatableLine = (
  line: OCRLine | undefined,
  resolvedText: string,
  engineHint?: string,
  pageWidth?: number,
  pageHeight?: number
): boolean => {
  const text = normalizeWhitespace(String(resolvedText || ''));
  if (!text) return true;
  if (!line?.bbox) return false;

  const pageWidthVal = pageWidth && pageWidth > 0 ? pageWidth : 1200;
  const scale = 1200 / pageWidthVal;

  const scaledLine: OCRLine = scale === 1.0 ? line : {
    ...line,
    bbox: {
      x0: line.bbox.x0 * scale,
      y0: line.bbox.y0 * scale,
      x1: line.bbox.x1 * scale,
      y1: line.bbox.y1 * scale,
    },
    words: Array.isArray(line.words)
      ? line.words.map((word) => ({
          ...word,
          bbox: {
            x0: word.bbox.x0 * scale,
            y0: word.bbox.y0 * scale,
            x1: word.bbox.x1 * scale,
            y1: word.bbox.y1 * scale,
          },
        }))
      : [],
  };

  const width = Math.max(1, Number(scaledLine.bbox.x1 || 0) - Number(scaledLine.bbox.x0 || 0));
  const height = Math.max(1, Number(scaledLine.bbox.y1 || 0) - Number(scaledLine.bbox.y0 || 0));
  const area = Math.max(1, width * height);
  const compact = text.replace(/\s+/g, '');
  const asciiCompact = compact.replace(/[^A-Za-z0-9]/g, '');
  const latinCompact = compact.replace(/[^A-Za-z]/g, '');
  const hasCjkOrThai = /[\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(compact);
  const cjkCompact = compact.replace(/[^\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/g, '');
  const unknownChars = compact.replace(/[A-Za-z0-9\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/g, '');
  const unknownCharRatio = unknownChars.length / Math.max(1, compact.length);
  const isKnownShortWord = /^[IAO]$/i.test(asciiCompact) || 
    /^(?:OK|NO|HI|OH|AM|AN|AS|AT|BE|BY|DO|GO|HE|IF|IN|IS|IT|ME|MY|OF|ON|OR|SO|TO|UP|US|WE|YE|AH|HA|EH|UH|LO|YA|UM|YES|FOR|AND|BUT|YOU|THE|NOT|HER|HIS|HIM|SHE|CAN|OUT|GET|HOW|WHO|WHY|HEY|BOY|RUN|SAY|SEE|MAN|OUR|DAY|NEW|TOO|ALL|ANY|BAD|BIG|CRY|DID|EAT|END|FAR|FIT|FLY|FUN|GUY|HOT|ITS|JOB|KEY|LET|LIE|LOT|MAD|MAY|MOM|DAD|OLD|ONE|TWO|OWN|PAY|SAD|SON|TRY|USE|WAY|WIN|YET|WOW|YAY|YEP|NAH|NOP|DIE|PIG|CUM|COCK|OHHH|OHHHH|OHHHHH|AGAA|MORE|YOURE|STOOOOP|STOAOOP|STOAAOP|LIKETHIS|LIKE|WASTOYED|UPLOOKING)$/i.test(asciiCompact);

  const validWords = (Array.isArray(scaledLine.words) ? scaledLine.words : []).filter((word) => {
    const wordText = normalizeWhitespace(String(word?.text || ''));
    const bbox = word?.bbox;
    if (!wordText || !bbox) return false;
    return (bbox.x1 - bbox.x0) > 0 && (bbox.y1 - bbox.y0) > 0;
  });
  const sourceTokenCount = text.split(/\s+/g).filter(Boolean).length;
  const wordCount = Math.max(validWords.length, sourceTokenCount);
  const confidenceSamples = validWords.length > 0
    ? validWords.map((word) => Number(word.confidence || 0))
    : [Number(scaledLine.confidence || 0)];
  const avgConfidence = confidenceSamples.reduce((sum, value) => sum + value, 0) / Math.max(1, confidenceSamples.length);
  const readability = scoreSourceLineReadability(text);
  const wordCoverage = computeLineWordUnionCoverage(scaledLine);

  if (shouldForceKeepComicTranslationLine(text, scaledLine)) {
    return false;
  }

  // Apply these safety filters to ALL OCR engines to guarantee obvious ghost noise is always dropped
  // 1. Pure non-alphanumeric symbol noise (e.g., "|||", "///", "\\", "---")
  const isPureSymbolNoise = !hasCjkOrThai && asciiCompact.length === 0;
  if (isPureSymbolNoise) {
    return true;
  }

  // 2. Repetitive vertical lines, slashes, or symbol junk (classic signature of spiky balloon borders, e.g. "lll", "III", "111", "I l I")
  const isVerticalLineJunk = !hasCjkOrThai && /^[lI1|!/\\_\-s]+$/i.test(compact) && !/^[IAO]$/i.test(asciiCompact);
  if (isVerticalLineJunk) {
    return true;
  }

  // 3. Single-character junk (English letters or digits that aren't valid single-letter words like I, A, O)
  const isSingleCharJunk = !hasCjkOrThai
    && asciiCompact.length === 1
    && !/^[IAO]$/i.test(asciiCompact);
  if (isSingleCharJunk) {
    return true;
  }

  // 4. Tiny noise junk boxes with very short character lengths
  const isExternalEngine = engineHint === 'paddleocr' || scaledLine?.sourceEngine === 'paddleocr' || engineHint === 'easyocr' || scaledLine?.sourceEngine === 'easyocr';
  const isTinyJunkBox = !hasCjkOrThai
    && asciiCompact.length <= 3
    && area <= 8000
    && (isExternalEngine ? avgConfidence <= 98 : avgConfidence <= 85)
    && !isKnownShortWord;
  if (isTinyJunkBox) {
    return true;
  }

  const giantLineBox = (
    (width >= 180 && height >= 110 && area >= 18000)
    || (width >= 132 && height >= 88 && area >= 12000 && wordCoverage <= 0.2)
    || (width >= 320 && height >= 98 && area >= 32000)
  );
  const noWordOversizedShortPhrase = validWords.length === 0
    && wordCount >= 2
    && wordCount <= 6
    && compact.length <= 30
    && area >= 17000
    && (width >= 170 || height >= 96)
    && (area / Math.max(1, compact.length)) >= 680
    && !shouldForceKeepTechnicalTranslationLine(text, scaledLine);
  if (noWordOversizedShortPhrase) {
    return true;
  }

  const sparseLargePhrase = wordCount <= 4 && compact.length <= 24;
  const lowCoverageLargeBox = wordCoverage <= 0.26;
  const lowSignalLargeBox = avgConfidence <= 93 || unknownCharRatio >= 0.24 || readability <= 8.8;
  if (giantLineBox && sparseLargePhrase && lowCoverageLargeBox && lowSignalLargeBox) {
    return true;
  }

  // New aggressive sparse SFX filter: large area but very few characters
  // Removed wordCoverage check because OCR sometimes creates word bboxes as large as the line bbox
  const isSparseSfxBox = (area >= 12000 && compact.length <= 14 && (area / Math.max(1, compact.length)) >= 1200)
    || (area >= 24000 && compact.length <= 22 && (area / Math.max(1, compact.length)) >= 1000);
  const englishTokens = text.split(/\s+/g).map(t => t.replace(/[^A-Za-z]/g, '')).filter(t => t.length >= 2 && /[aeiouy]/i.test(t));
  const isNaturalDialogue = englishTokens.length >= 2
    || (englishTokens.length === 1 && englishTokens[0].length >= 3 && readability >= 1.0)
    || isKnownShortWord
    || /^(?:PRINCESS|PRiNCESS|DIE|PIG|CUM|COCK|OH|OHHH|OHHHH|OHHHHH|AGAA|SO|OF|ALL|MORE|YOU|US|THE|THIS|MY|YOURE|STOOOOP|STOAOOP|STOAAOP|LIKETHIS|LIKE|WASTOYED|UPLOOKING)$/i.test(asciiCompact);
  if (isSparseSfxBox && !isNaturalDialogue && !shouldForceKeepComicTranslationLine(text, scaledLine)) {
    return true;
  }

  if (hasCjkOrThai) {
    const tinyCjkSingleton = wordCount <= 1
      && cjkCompact.length <= 3
      && width <= 96
      && height <= 54
      && area <= 3000
      && avgConfidence <= 90;
    const narrowTallCjkNoise = wordCount <= 2
      && cjkCompact.length <= 4
      && width <= 88
      && height <= 180
      && height >= Math.max(42, width * 1.15)
      && avgConfidence <= 90;
    const cjkUnknownHeavy = cjkCompact.length <= 2
      && unknownCharRatio >= 0.45
      && area <= 3200
      && avgConfidence <= 88;
    const shortStylizedNonLatinSfx = wordCount <= 1
      && cjkCompact.length <= 3
      && width <= 132
      && height <= 112
      && area <= 11500
      && avgConfidence <= 92
      && (unknownCharRatio >= 0.08 || height >= width * 0.6);
    const shortNonLatinLowCoverageArtifact = wordCount <= 2
      && cjkCompact.length <= 5
      && area <= 6200
      && wordCoverage <= 0.26
      && (avgConfidence <= 92 || unknownCharRatio >= 0.2);

    if (tinyCjkSingleton || narrowTallCjkNoise || cjkUnknownHeavy || shortStylizedNonLatinSfx || shortNonLatinLowCoverageArtifact) {
      return true;
    }
    return false;
  }

  if (GHOST_TRANSLATION_PUNCT_ONLY_REGEX.test(compact) && width <= 112 && height <= 44) {
    return true;
  }

  const compactUpper = compact.toUpperCase();
  const shortDigitArtifact = GHOST_TRANSLATION_SHORT_TOKEN_REGEX.test(compactUpper)
    && /\d/.test(compactUpper)
    && !/[a-z]/.test(compact);
  if (shortDigitArtifact && wordCount <= 1 && width <= 96 && height <= 42 && avgConfidence <= 82) {
    return true;
  }

  const tinyAsciiSingletonNoise = !hasCjkOrThai
    && wordCount <= 1
    && asciiCompact.length > 0
    && asciiCompact.length <= 2
    && width <= 72
    && height <= 38
    && area <= 2100
    && avgConfidence <= 94
    && !/[!?]/.test(text);
  // Exempt known short English words — "I" (pronoun), "A" (article) are not ghost noise
  if (tinyAsciiSingletonNoise && !isKnownShortWord) {
    return true;
  }

  const noWordTinyAsciiNoise = validWords.length === 0
    && !hasCjkOrThai
    && wordCount <= 2
    && asciiCompact.length > 0
    && asciiCompact.length <= 6
    && width <= 88
    && height <= 44
    && area <= 2600
    && avgConfidence <= 92
    && !isKnownShortWord;
  if (noWordTinyAsciiNoise) {
    return true;
  }

  const pxPerLatinChar = width / Math.max(1, latinCompact.length);
  const suspiciousTinyLongLatin = latinCompact.length >= 10
    && wordCount >= 3
    && pxPerLatinChar < 2.9
    && width <= Math.max(72, latinCompact.length * 5.4)
    && height <= 26;
  if (suspiciousTinyLongLatin) {
    return true;
  }

  const compressedSparseShortPhrase = !hasCjkOrThai
    && sourceTokenCount >= 2
    && sourceTokenCount <= 4
    && latinCompact.length >= 8
    && width <= Math.max(92, latinCompact.length * 6.4)
    && height <= 78
    && area <= Math.max(5200, latinCompact.length * 520)
    && (area / Math.max(1, latinCompact.length)) <= 430
    && wordCoverage <= 0.24
    && avgConfidence <= 94
    && !/[.!?…]\s*$/.test(text);
  if (compressedSparseShortPhrase) {
    return true;
  }

  const lowSignalHyphenGhost = /[a-z]{2,}-[a-z]{2,}/.test(text)
    && wordCount <= 3
    && width <= 220
    && height <= 38
    && avgConfidence <= 82;
  if (lowSignalHyphenGhost) {
    return true;
  }

  if (wordCount <= 2 && area <= 3000 && unknownCharRatio >= 0.45 && avgConfidence <= 82) {
    return true;
  }

  const lowSignalTinySingleton = wordCount <= 1
    && asciiCompact.length > 0
    && asciiCompact.length <= 4
    && area <= 2600
    && width <= 104
    && height <= 40
    && readability <= 0.35
    && avgConfidence <= 78;
  if (lowSignalTinySingleton) {
    return true;
  }

  return false;
};
