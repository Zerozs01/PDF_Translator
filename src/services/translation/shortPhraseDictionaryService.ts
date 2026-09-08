/**
 * Short Phrase Dictionary & Fallback Service
 * 
 * [Scrutinize S3]: Extracted from offlineTranslationService.ts
 * Manages glossary lookup, fast phrase matching, normalization fallbacks,
 * and systemic word-by-word translations.
 */

import { useGlossaryStore } from '../../stores/useGlossaryStore';
import {
  ARGOS_SHORT_PHRASE_LOOKUP_TH,
  DICTIONARIES_LIST,
  getDictionaryByLanguage,
} from './dictionaries';
import {
  normalizeEnglishOcrNoiseForTranslation,
  normalizeSpanishOcrNoiseForTranslation,
} from '../ocr/ocrTextNormalizer';
import { applyKoreanConversationalFallback } from './koreanTranslationPolicy';

// ── Pre-compiled Module-Level Regular Expressions ───────────────────
const TEMP_ALERT_REGEX = /^temp:\s*(\d+)\s*c\s*\[alert\]$/i;
const TEMP_NORMAL_REGEX = /^temp:\s*(\d+)\s*c$/i;
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
export function getCompactPhraseMap(): Map<string, string> {
  if (!_compactPhraseMap) {
    _compactPhraseMap = new Map<string, string>();
    for (let d = 0; d < DICTIONARIES_LIST.length; d++) {
      const dict = DICTIONARIES_LIST[d];
      for (const [k, v] of Object.entries(dict)) {
        const compact = k.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
        if (compact && !_compactPhraseMap.has(compact)) {
          _compactPhraseMap.set(compact, v);
        }
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

  // Scoped dictionary lookup helper (prioritizes active source language, falls back to ARGOS_SHORT_PHRASE_LOOKUP_TH)
  const scopedDict = sourceLang ? getDictionaryByLanguage(sourceLang) : null;
  const lookup = (keyCandidate: string): string | undefined => {
    if (!keyCandidate) return undefined;
    if (scopedDict && scopedDict[keyCandidate] !== undefined) {
      return scopedDict[keyCandidate];
    }
    return ARGOS_SHORT_PHRASE_LOOKUP_TH[keyCandidate];
  };

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
  const directRawMatch = lookup(rawKey);
  if (directRawMatch) return directRawMatch;

  const hasOuterParens = /^\s*[\(\[\{<].*[\)\]\}>]\s*$/.test(trimmed);
  const unwrapped = trimmed.replace(/^\s*[\(\[\{<"']+|[\)\]\}>"'\s]+$/g, '').trim().toLowerCase();
  if (unwrapped && unwrapped !== rawKey) {
    const unwrappedMatch = lookup(unwrapped);
    if (unwrappedMatch) {
      return hasOuterParens && !unwrappedMatch.startsWith('(') ? `(${unwrappedMatch})` : unwrappedMatch;
    }
  }

  const cleanedRawKey = rawKey
    .replace(/^[\(\[\{<"'\s¡¿]+/g, '')
    .replace(/[\)\]\}>"'\s]+$/g, '')
    .replace(LEADING_II_REGEX, '');
  const directCleanedMatch = lookup(cleanedRawKey);
  if (directCleanedMatch) {
    return hasOuterParens && !directCleanedMatch.startsWith('(') ? `(${directCleanedMatch})` : directCleanedMatch;
  }

  // Spanish OCR noise: leading lowercase 'i' misrecognized for inverted exclamation '¡' (e.g. "iTE JURO QUE" -> "te juro que")
  const spanishLeadingIStripped = cleanedRawKey.replace(/^i(?=[a-záéíóúñ])/i, '').trim();
  if (spanishLeadingIStripped && spanishLeadingIStripped !== cleanedRawKey) {
    const spanishMatch = lookup(spanishLeadingIStripped);
    if (spanishMatch) {
      return hasOuterParens && !spanishMatch.startsWith('(') ? `(${spanishMatch})` : spanishMatch;
    }
  }

  const strippedDotsKey = cleanedRawKey.replace(STRIP_DOTS_START_REGEX, '').replace(STRIP_DOTS_END_REGEX, '').trim();
  if (strippedDotsKey) {
    const match = lookup(strippedDotsKey);
    if (match) {
      const trailingPunct = text.match(TRAILING_PUNCT_REGEX);
      let result = (trailingPunct && !HAS_TRAILING_PUNCT_REGEX.test(match)) ? match + trailingPunct[1] : match;
      return hasOuterParens && !result.startsWith('(') ? `(${result})` : result;
    }
  }

  // 0.2 ลองค้นหาหลังจากซ่อมแซมเสียงรบกวน OCR (เช่น Suvvenlya -> Suddenly, Bvt -> But, (ME,THERE) -> (ME, THERE))
  const ocrNormalized = normalizeEnglishOcrNoiseForTranslation(trimmed);
  if (ocrNormalized && ocrNormalized.toLowerCase() !== rawKey) {
    const ocrKey = ocrNormalized.toLowerCase();
    const ocrMatch = lookup(ocrKey);
    if (ocrMatch) {
      return hasOuterParens && !ocrMatch.startsWith('(') ? `(${ocrMatch})` : ocrMatch;
    }
    const ocrStripped = ocrKey.replace(STRIP_DOTS_START_REGEX, '').replace(STRIP_DOTS_END_REGEX, '').trim();
    if (ocrStripped) {
      const match = lookup(ocrStripped);
      if (match) {
        return hasOuterParens && !match.startsWith('(') ? `(${match})` : match;
      }
    }
  }

  // 0.3 ลองค้นหาหลังจากซ่อมแซมเสียงรบกวน OCR ภาษาสเปน
  const spanishOcrNormalized = normalizeSpanishOcrNoiseForTranslation(trimmed);
  if (spanishOcrNormalized && spanishOcrNormalized.toLowerCase() !== rawKey) {
    const spKey = spanishOcrNormalized.toLowerCase();
    const spMatch = lookup(spKey);
    if (spMatch) {
      return hasOuterParens && !spMatch.startsWith('(') ? `(${spMatch})` : spMatch;
    }
    const spStripped = spKey.replace(STRIP_DOTS_START_REGEX, '').replace(STRIP_DOTS_END_REGEX, '').trim();
    if (spStripped) {
      const match = lookup(spStripped);
      if (match) {
        return hasOuterParens && !match.startsWith('(') ? `(${match})` : match;
      }
    }
  }

  const key = rawKey
    .replace(UNDERLINE_REGEX, ' ')
    .replace(PUNCT_SPACE_REGEX, ' ')
    .replace(NON_LETTER_NUM_REGEX, '')
    .replace(MULTI_SPACE_REGEX, ' ')
    .trim();
  
  // 1. ลองค้นหาแบบตรงตัวใน dictionary ก่อน
  let directMatch = lookup(key);
  
  // Try Korean 존นา prefix stripping fallback (e.g. 존นา 좋아 -> โคตรชอบ/โคตรฟิน)
  if (!directMatch && key.startsWith('존นา ') && key.length > 3) {
    const strippedJonNa = key.slice(3).trim();
    const subMatch = lookup(strippedJonNa);
    if (subMatch) {
      directMatch = `โคตร${subMatch}`;
    }
  }

  // Try Spanish diacritic stripping fallback (e.g. bañas -> banas, montón -> monton)
  if (!directMatch) {
    const strippedKey = key.normalize('NFD').replace(DIACRITICS_REGEX, '').replace(/ñ/g, 'n');
    directMatch = lookup(strippedKey);
  }

  if (directMatch) {
    const trailingPunct = text.match(TRAILING_PUNCT_REGEX);
    let result = (trailingPunct && !HAS_TRAILING_PUNCT_REGEX.test(directMatch)) ? directMatch + trailingPunct[1] : directMatch;
    return hasOuterParens && !result.startsWith('(') ? `(${result})` : result;
  }

  // 1.5 ลองค้นหาแบบ No-Apostrophe (เช่น yuuto's mom -> yuutos mom, we'll -> well)
  const noAposKey = rawKey.replace(/['’]/g, '').replace(PUNCT_SPACE_REGEX, ' ').replace(MULTI_SPACE_REGEX, ' ').trim();
  if (noAposKey && noAposKey !== key) {
    const noAposMatch = lookup(noAposKey);
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
  if (/^k[n]+[i]+[g]+[h]+[t]+$/i.test(key)) {
    return 'อัศวิน';
  }
  if (/^d[e]+[a]+d[d]*$/i.test(key)) {
    return 'ตาย';
  }
  if (/^c[o]+ck[s]*$/i.test(key)) {
    return key.endsWith('s') ? 'ควยยยยยยพวกนี้' : 'ควย';
  }
  if (/^s[o]+\+?$/i.test(key)) {
    return 'ดังนั้น';
  }
  if (/^(?:no+|no+h+)\+?$/i.test(key)) {
    return 'ไม่นะ';
  }
  if (/^y[e]+[s]+\+?$/i.test(key)) {
    return 'ใช่';
  }

  // 3. Compact match สำหรับข้อความภาษาเอเชีย (CJK / Thai)
  const compactKey = rawKey.replace(/[^\p{L}\p{N}]/gu, '');
  if (compactKey) {
    let compactMatch = getCompactPhraseMap().get(compactKey);

    if (!compactMatch) {
      if (compactKey.endsWith('에게서') || compactKey.endsWith('한테서')) {
        const base = compactKey.slice(0, -3);
        const baseMatch = getCompactPhraseMap().get(base);
        if (baseMatch) compactMatch = `จาก${baseMatch}`;
      } else if (compactKey.endsWith('속으로') || compactKey.endsWith('속까지')) {
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

  // [Scrutinize S2]: Built-in alphanumeric stripped fallback
  const strippedAlpha = rawKey.replace(/[^a-z0-9\uac00-\ud7a3\u3040-\u30ff\u4e00-\u9fff]/g, '');
  if (strippedAlpha && strippedAlpha !== rawKey && strippedAlpha !== key) {
    const strippedMatch = lookup(strippedAlpha);
    if (strippedMatch) {
      return strippedMatch;
    }
  }

  return null;
};

export const systemicWordFallbackTranslate = (text: string): string | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const words = trimmed.split(/[\s,!?.-]+/g).filter(Boolean);
  if (words.length === 0 || words.length > 4) return null;

  const translatedWords: string[] = [];
  let matchedCount = 0;

  for (const word of words) {
    const directLookup = lookupShortPhraseTh(word);
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
