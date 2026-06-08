import type { BBox, OCRDroppedWord, OCREngine, OCRLine, OCRPageResult } from '../../types';

export type LanguageScriptAllowance = {
  latin: boolean;
  hangul: boolean;
  kana: boolean;
  han: boolean;
  thai: boolean;
  cyrillic: boolean;
};

export type ScriptCharStats = {
  latin: number;
  hangul: number;
  kana: number;
  han: number;
  thai: number;
  cyrillic: number;
  total: number;
  allowed: number;
  disallowed: number;
};

export const normalizePreviewText = (text: string): string =>
  String(text || '').replace(/\s+/g, ' ').trim();

export const hasPositivePanelBBox = (bbox?: { x0: number; y0: number; x1: number; y1: number }): boolean => {
  if (!bbox) return false;
  return (Number(bbox.x1 || 0) - Number(bbox.x0 || 0)) > 0
    && (Number(bbox.y1 || 0) - Number(bbox.y0 || 0)) > 0;
};

export const buildLanguageScriptAllowance = (language: string): LanguageScriptAllowance => {
  const codes = String(language || 'eng')
    .split('+')
    .map((code) => code.trim().toLowerCase())
    .filter(Boolean);

  const hasCode = (value: string): boolean => codes.includes(value);
  const hasPrefix = (value: string): boolean => codes.some((code) => code.startsWith(value));
  const hasNonLatinRequested = hasCode('kor')
    || hasCode('jpn')
    || hasCode('jpn_vert')
    || hasPrefix('chi')
    || hasCode('tha')
    || hasCode('rus');
  const englishRequested = hasCode('eng') || hasCode('en');

  return {
    // Keep Latin only when explicitly requested (eng) or when no non-Latin OCR language is selected.
    latin: englishRequested || !hasNonLatinRequested,
    hangul: hasCode('kor'),
    kana: hasCode('jpn') || hasCode('jpn_vert'),
    han: hasPrefix('chi') || hasCode('jpn') || hasCode('jpn_vert'),
    thai: hasCode('tha'),
    cyrillic: hasCode('rus'),
  };
};

export const collectScriptCharStats = (text: string, allowance: LanguageScriptAllowance): ScriptCharStats => {
  const stats: ScriptCharStats = {
    latin: 0,
    hangul: 0,
    kana: 0,
    han: 0,
    thai: 0,
    cyrillic: 0,
    total: 0,
    allowed: 0,
    disallowed: 0,
  };

  for (const ch of String(text || '')) {
    let bucket: keyof Pick<ScriptCharStats, 'latin' | 'hangul' | 'kana' | 'han' | 'thai' | 'cyrillic'> | null = null;
    if (/[A-Za-z\u00C0-\u024F]/.test(ch)) bucket = 'latin';
    else if (/[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/.test(ch)) bucket = 'hangul';
    else if (/[\u3040-\u30FF]/.test(ch)) bucket = 'kana';
    else if (/[\u3400-\u4DBF\u4E00-\u9FFF]/.test(ch)) bucket = 'han';
    else if (/[\u0E00-\u0E7F]/.test(ch)) bucket = 'thai';
    else if (/[\u0400-\u04FF]/.test(ch)) bucket = 'cyrillic';

    if (!bucket) continue;

    stats[bucket] += 1;
    stats.total += 1;
    const allowed = (
      (bucket === 'latin' && allowance.latin)
      || (bucket === 'hangul' && allowance.hangul)
      || (bucket === 'kana' && allowance.kana)
      || (bucket === 'han' && allowance.han)
      || (bucket === 'thai' && allowance.thai)
      || (bucket === 'cyrillic' && allowance.cyrillic)
    );
    if (allowed) {
      stats.allowed += 1;
    } else {
      stats.disallowed += 1;
    }
  }

  return stats;
};

export const isStrictSingleLanguageScriptGate = (allowance: LanguageScriptAllowance): boolean => {
  const nonLatinAllowed = [allowance.hangul, allowance.kana, allowance.han, allowance.thai, allowance.cyrillic]
    .filter(Boolean)
    .length;
  return nonLatinAllowed <= 1;
};

export const isLineLikelyScriptMismatch = (
  text: string,
  allowance: LanguageScriptAllowance,
  averageConfidence: number
): boolean => {
  const stats = collectScriptCharStats(text, allowance);
  if (stats.total === 0 || stats.disallowed <= 0) return false;

  const allowedRatio = stats.allowed / Math.max(1, stats.total);
  if (isStrictSingleLanguageScriptGate(allowance)) {
    const minAllowedChars = allowance.latin ? 1 : 2;
    const minAllowedRatio = allowance.latin ? 0.62 : 0.8;
    const lowConfidenceThreshold = allowance.latin ? 76 : 82;
    if (stats.allowed <= minAllowedChars && stats.disallowed >= 2) return true;
    if (allowedRatio < minAllowedRatio) return true;
    if (averageConfidence < lowConfidenceThreshold && stats.disallowed >= stats.allowed) return true;
    return false;
  }

  if (stats.allowed <= 1 && stats.disallowed >= 3) return true;
  return averageConfidence < 72 && stats.disallowed > (stats.allowed * 1.4);
};

export const isWordAllowedByScriptGate = (text: string, allowance: LanguageScriptAllowance): boolean => {
  const normalized = normalizePreviewText(String(text || ''));
  if (!normalized) return false;

  const hasLatin = /[A-Za-z\u00C0-\u024F]/.test(normalized);
  const hasHangul = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/.test(normalized);
  const hasKana = /[\u3040-\u30FF]/.test(normalized);
  const hasHan = /[\u3400-\u4DBF\u4E00-\u9FFF]/.test(normalized);
  const hasThai = /[\u0E00-\u0E7F]/.test(normalized);
  const hasCyrillic = /[\u0400-\u04FF]/.test(normalized);

  const hasScriptChar = hasLatin || hasHangul || hasKana || hasHan || hasThai || hasCyrillic;
  if (!hasScriptChar) {
    // Digits/punctuation-only tokens are neutral and safe to keep.
    return true;
  }

  const matchesAllowedScript = (
    (allowance.latin && hasLatin)
    || (allowance.hangul && hasHangul)
    || (allowance.kana && hasKana)
    || (allowance.han && hasHan)
    || (allowance.thai && hasThai)
    || (allowance.cyrillic && hasCyrillic)
  );

  if (!matchesAllowedScript) {
    return false;
  }

  const strictGate = isStrictSingleLanguageScriptGate(allowance);
  if (strictGate) {
    const stats = collectScriptCharStats(normalized, allowance);
    if (stats.disallowed <= 0) return true;
    if (!allowance.latin && stats.allowed < 2) return false;
    if (stats.allowed <= 1) return false;
    const allowedRatio = stats.allowed / Math.max(1, stats.total);
    return allowedRatio >= (allowance.latin ? 0.72 : 0.84);
  }

  return true;
};

export const applyPanelLanguageScriptGate = (result: OCRPageResult, requestedLanguage: string): OCRPageResult => {
  const engine = (result.ocrEngine || 'paddleocr') as OCREngine;
  const pipeline = result.pipelineProfile || 'panel';
  if (pipeline !== 'panel') return result;
  if (engine !== 'paddleocr' && engine !== 'easyocr') return result;

  const allowance = buildLanguageScriptAllowance(requestedLanguage || result.language || 'eng');
  const dropped: OCRDroppedWord[] = [];
  let changed = false;

  const gatedLines = (Array.isArray(result.lines) ? result.lines : [])
    .map((line) => {
      const lineWords = Array.isArray(line.words) ? line.words : [];
      const keptWords = lineWords.filter((word) => {
        const wordText = normalizePreviewText(String(word?.text || ''));
        if (!wordText) {
          changed = true;
          return false;
        }

        const allowed = isWordAllowedByScriptGate(wordText, allowance);
        if (!allowed) {
          changed = true;
          dropped.push({
            filter: 'panelLanguageScriptGate',
            reason: 'wordScriptMismatch',
            text: wordText,
            confidence: Number(word.confidence || 0),
            bbox: word.bbox,
          });
        }
        return allowed;
      });

      const rawLineText = normalizePreviewText(String(line.text || ''));
      const rawLineAllowed = rawLineText ? isWordAllowedByScriptGate(rawLineText, allowance) : false;
      const rebuiltFromWords = normalizePreviewText(keptWords.map((word) => String(word.text || '')).join(' '));
      const resolvedLineText = rawLineAllowed
        ? rawLineText
        : rebuiltFromWords;

      if (!resolvedLineText) {
        changed = true;
        dropped.push({
          filter: 'panelLanguageScriptGate',
          reason: 'lineScriptMismatch',
          text: rawLineText,
          confidence: Number(line.confidence || 0),
          bbox: line.bbox,
        });
        return null;
      }

      const confidenceSamples = keptWords.length > 0
        ? keptWords.map((word) => Number(word.confidence || 0))
        : [Number(line.confidence || 0)];
      const averageLineConfidence = confidenceSamples.reduce((sum, value) => sum + value, 0) / Math.max(1, confidenceSamples.length);
      if (isLineLikelyScriptMismatch(resolvedLineText, allowance, averageLineConfidence)) {
        changed = true;
        dropped.push({
          filter: 'panelLanguageScriptGate',
          reason: 'lineLanguageMismatch',
          text: resolvedLineText,
          confidence: averageLineConfidence,
          bbox: line.bbox,
        });
        return null;
      }

      const resolvedWords = keptWords.length > 0
        ? keptWords
        : (hasPositivePanelBBox(line.bbox)
          ? [{
            text: resolvedLineText,
            confidence: Number(line.confidence || 0),
            bbox: line.bbox,
          }]
          : []);

      if (resolvedWords.length !== lineWords.length || resolvedLineText !== rawLineText) {
        changed = true;
        return {
          ...line,
          text: resolvedLineText,
          words: resolvedWords,
        } satisfies OCRLine;
      }

      return line;
    })
    .filter((line): line is OCRLine => Boolean(line));

  if (!changed) {
    return result;
  }

  const gatedWords = gatedLines.flatMap((line) => line.words || []);
  return {
    ...result,
    lines: gatedLines,
    words: gatedWords,
    text: gatedLines.map((line) => String(line.text || '')).filter(Boolean).join('\n').trim(),
    debug: {
      ...(result.debug || {}),
      dropCounts: {
        ...(result.debug?.dropCounts || {}),
        panelLanguageScriptGate: ((result.debug?.dropCounts?.panelLanguageScriptGate || 0) + dropped.length),
      },
      droppedWords: [
        ...(result.debug?.droppedWords || []),
        ...dropped,
      ],
    },
  };
};
