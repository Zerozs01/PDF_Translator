/**
 * OCR Text Utilities — character detection, text joining, language helpers
 */

import type { OCRWord } from './ocr-types';

// Character class regular expressions
export const THAI_CHAR_RE = /[\u0E00-\u0E7F]/;
export const CJK_CHAR_RE = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/;
export const LATIN_CHAR_RE = /[A-Za-z0-9]/;

export const splitLangCodes = (lang: string): string[] =>
  lang.split('+').map(code => code.trim()).filter(Boolean);

export const hasLangCode = (lang: string, code: string): boolean =>
  splitLangCodes(lang).includes(code);

export function isCjkLanguage(lang: string): boolean {
  return splitLangCodes(lang).some(code => /^(kor|jpn|jpn_vert|chi_sim|chi_tra)$/.test(code));
}

export function isThaiLanguage(lang: string): boolean {
  return hasLangCode(lang, 'tha');
}

export const normalizeOcrText = (text: string): string => {
  try {
    return text.normalize('NFC');
  } catch {
    return text;
  }
};

export const isPunctOnly = (text: string): boolean => {
  try {
    return /^[\p{P}\p{S}]+$/u.test(text);
  } catch {
    return /^[^A-Za-z0-9\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]+$/.test(text);
  }
};

/** Extract alpha-numeric + CJK/Thai characters (strip punctuation) */
export function getAlphaNum(raw: string): string {
  try {
    return raw.replace(/[^\p{L}\p{N}]/gu, '');
  } catch {
    return raw.replace(/[^A-Za-z0-9\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/g, '');
  }
}

/** Check if a token contains non-Latin characters (any non-ASCII) */
export function isNonLatinToken(alphaNum: string): boolean {
  return /[^\x00-\x7F]/.test(alphaNum);
}

/**
 * Join words into a single string, respecting language-specific spacing rules.
 * Thai/CJK tokens are joined without spaces unless there's a wide gap.
 */
export const joinWordsForLanguage = (words: OCRWord[]): string => {
  if (words.length === 0) return '';
  const heights = words
    .map(w => Math.max(1, w.bbox.y1 - w.bbox.y0))
    .sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || heights[0] || 1;
  const tightGap = Math.max(1, medianHeight * 0.2);
  const wideGap = Math.max(1, medianHeight * 0.9);

  let output = '';
  let prevWord: OCRWord | null = null;
  let prevText = '';

  for (const word of words) {
    const raw = normalizeOcrText(word.text || '');
    const text = raw.trim();
    if (!text) continue;

    if (!prevWord) {
      output = text;
      prevWord = word;
      prevText = text;
      continue;
    }

    const gap = Math.max(0, word.bbox.x0 - prevWord.bbox.x1);
    const prevIsThai = THAI_CHAR_RE.test(prevText);
    const prevIsCjk = CJK_CHAR_RE.test(prevText);
    const prevIsLatin = LATIN_CHAR_RE.test(prevText);
    const currIsThai = THAI_CHAR_RE.test(text);
    const currIsCjk = CJK_CHAR_RE.test(text);
    const currIsLatin = LATIN_CHAR_RE.test(text);
    const currIsPunct = isPunctOnly(text);

    let addSpace = true;

    if (currIsPunct) {
      addSpace = false;
    } else if ((prevIsThai || prevIsCjk) && (currIsThai || currIsCjk)) {
      addSpace = gap > wideGap;
    } else if (prevIsLatin && currIsLatin) {
      addSpace = gap > tightGap;
    } else if ((prevIsThai || prevIsCjk) && currIsLatin) {
      addSpace = true;
    } else if (prevIsLatin && (currIsThai || currIsCjk)) {
      addSpace = true;
    } else if (isPunctOnly(prevText)) {
      addSpace = false;
    } else {
      addSpace = gap > tightGap;
    }

    output += `${addSpace ? ' ' : ''}${text}`;
    prevWord = word;
    prevText = text;
  }
  return output;
};
