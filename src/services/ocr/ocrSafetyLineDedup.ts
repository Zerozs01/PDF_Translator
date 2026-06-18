import React from 'react';
import type { BBox, OCRDroppedWord, OCRLine, OCRPageResult } from '../../types';
import { OCR_ALGORITHM_VERSION } from '../vision/ocrVersion';
import { collectTextSearchMatches } from '../textSearch';

// -------------------------------------------------------------
// Helper and Utility functions for Geometry & Safety Filtering
// -------------------------------------------------------------

export const normalizePreviewText = (text: string): string => String(text || '').replace(/\s+/g, ' ').trim();

export const isKnownShortWordHelper = (asciiCompact: string): boolean => {
  return /^[IAO]$/i.test(asciiCompact) || 
    /^(?:OK|NO|HI|OH|AM|AN|AS|AT|BE|BY|DO|GO|HE|IF|IN|IS|IT|ME|MY|OF|ON|OR|SO|TO|UP|US|WE|YE|AH|HA|EH|UH|LO|YA|UM|YES|FOR|AND|BUT|YOU|THE|NOT|HER|HIS|HIM|SHE|CAN|OUT|GET|HOW|WHO|WHY|HEY|BOY|RUN|SAY|SEE|MAN|OUR|DAY|NEW|TOO|ALL|ANY|BAD|BIG|CRY|DID|EAT|END|FAR|FIT|FLY|FUN|GUY|HOT|ITS|JOB|KEY|LET|LIE|LOT|MAD|MAY|MOM|DAD|OLD|ONE|TWO|OWN|PAY|SAD|SON|TRY|USE|WAY|WIN|YET|WOW|YAY|YEP|NAH|NOP|DIE|PIG|CUM|COCK|OHHH|OHHHH|OHHHHH|AGAA|MORE|YOURE|STOOOOP|STOAOOP|STOAAOP|LIKETHIS|LIKE|WASTOYED|UPLOOKING|SIR|YESSIR|QUCK|QUICK|USTHE|NOWI|II|IIM|ONA|YYOU|IIS|IIT|IIN|SSHE|HHE|TTHEY|WWE|TTHIS|TTHAT|NNO|MME|III|MEEE|MEEEE|5O|S0|6O|OFME|EROMANGA|OFMEEROMANGA|BLOWJOB|IM|NURSE|BEINGTOO|SUDDENLY|ILL|RESTA|THESEX|WELLSINCE|JUST|ILLNESSBE|METHOD|FROMTHE|ITFEELS|OUTINSIDE|STILLFULL|BLOWTOB|NOU|DISEASE|FOUNDA|II333S|S3HS|INSIDEI|INSIDE|WHTTTTT|RESTRAINT|GOO|IHNH|ISIHS|2IHG|EIH3|IIMOM|OD111|VAYS|BEEELEE|WNTTTT|HERPUSSY|WOMB|MING|CUMMING|WAYTOO|GOOD|TOMAKETHREADS|MYCUM|THATS|NOTNECESSARY|ADYDO|UMEAN|WERE|PLEASE|YQURE|WIDLY|SIDESHOW|CAME|COOOOOOCKS|COOOOOCKS|COOOOCKS|COOOCKS|COOCKS|COCKS|ONEONONE|CUMALOTJUSTLIKETHAT|MUCH|FOOL|SOW|NONSTOP|HA|HEHE|HEHEHE|MEEEEEEE|MEEEEEE|MEEEEE|CHARGE|ASS|HOLE|ASSHOLE|GONNADIE|TOBEDEADNOW|SOPLEASE|ONEBATTLE|WHY|WITHIT|SIDE|THING|WITH|HES|FRONT|WOULD|THISMY|CUMMING|KNIIIIIGHT|KNIIIIIIGHT|NIPPLES|LONGER|SUITS|CERVIX|GENERAL|SADNESS|DEAD|OUUUUT|MOREEEEEE|PLEEAAASEEE|RECAPTURING|RECAPTURINA|ALLARISTOCRATS|ALLARSTOCRATS|KINGAND|ANALLOUT|BUTINANYAGE|IFI|TOYEDWITH|ANDWASATA|TODAYAGAIN|HERPOSI|NIPPLESAND|DIEALONG|ALSO|HERPLACE|MAKESURE|THEWAR|WEDEAL|AWAYWITH|BITCHHEY|THEPIGYOUARE|PIGYOUARE|ANORMAL|ALLCOLD|THANANY|FEELINGS|CANT|CANTBELIEVE|LADYROSERIAISDEAD|LADYROSERIA|ROSERIA|ROSERIAISDEAD|DUINEOSPE|DUINESPE|BORRM|THISMY|WEDEALWITHIT|774)$/i.test(asciiCompact);
};

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
  'i', 'my', 'me', 'hey', 'oh', 'ah', 'yeah', 'like', 'dont', 'cant', 'didnt',
  'suck', 'cock', 'bitch', 'pig', 'hell', 'damn', 'ass', 'fuck', 'shit'
]);

export const isLikelyEnglishDialogue = (text: string): boolean => {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;

  // Clean spaces, dots, exclamation/question marks, commas, hyphens and underscores before checking ratio
  const compact = normalized.replace(/[\s\.\!\?\,\-\_]+/g, '');
  const latin = compact.replace(/[^a-z]/g, '');
  if (latin.length / Math.max(1, compact.length) < 0.75) return false;

  const wordsList = normalized.split(/[^a-z']+/g).filter(Boolean);
  if (wordsList.some(w => ENGLISH_COMMON_WORDS.has(w))) return true;

  if (wordsList.length === 1 && wordsList[0].length >= 5) {
    const word = wordsList[0];
    const hasVowels = /[aeiouy]/i.test(word);
    const hasConsonants = /[bcdfghjklmnpqrstvwxz]/i.test(word);
    if (hasVowels && hasConsonants) return true;
  }

  return false;
};

export const renderPreviewTextWithHighlight = (
  text: string,
  pattern: any // TextSearchPattern from textSearch service
): React.ReactNode => {
  const normalizedText = String(text || '');
  if (!pattern || !normalizedText) return normalizedText;

  const matches = collectTextSearchMatches(normalizedText, pattern);
  if (matches.length === 0) return normalizedText;

  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  matches.forEach((match: any, index: number) => {
    if (match.start > cursor) {
      nodes.push(
        React.createElement(
          React.Fragment,
          { key: `plain-${cursor}` },
          normalizedText.slice(cursor, match.start)
        )
      );
    }
    nodes.push(
      React.createElement(
        'mark',
        {
          key: `match-${index}-${match.start}`,
          className: 'rounded bg-amber-300/30 px-px text-amber-100'
        },
        normalizedText.slice(match.start, match.end)
      )
    );
    cursor = match.end;
  });

  if (cursor < normalizedText.length) {
    nodes.push(
      React.createElement(
        React.Fragment,
        { key: `plain-tail-${cursor}` },
        normalizedText.slice(cursor)
      )
    );
  }

  return nodes;
};

export const hasPositivePanelBBox = (bbox?: { x0: number; y0: number; x1: number; y1: number }): boolean => {
  if (!bbox) return false;
  return (Number(bbox.x1 || 0) - Number(bbox.x0 || 0)) > 0
    && (Number(bbox.y1 || 0) - Number(bbox.y0 || 0)) > 0;
};

export const normalizePanelBBox = (bbox?: { x0?: number; y0?: number; x1?: number; y1?: number }): BBox | undefined => {
  const x0 = Number(bbox?.x0);
  const y0 = Number(bbox?.y0);
  const x1 = Number(bbox?.x1);
  const y1 = Number(bbox?.y1);
  if (![x0, y0, x1, y1].every(Number.isFinite)) return undefined;

  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  if (!(right > left && bottom > top)) return undefined;

  return { x0: left, y0: top, x1: right, y1: bottom };
};

export const isSamePanelBBox = (a?: BBox, b?: BBox): boolean => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1;
};

export const resolvePanelLineBBoxForSafety = (line: OCRLine): BBox | undefined => {
  const normalizedRawBBox = normalizePanelBBox(line?.bbox);

  const validWords: Array<{ bbox: BBox }> = [];
  for (const word of Array.isArray(line.words) ? line.words : []) {
    const text = normalizePreviewText(String(word?.text || ''));
    if (!text) continue;
    const bbox = normalizePanelBBox(word?.bbox);
    if (!bbox) continue;
    validWords.push({ bbox });
  }

  if (validWords.length === 0) {
    return normalizedRawBBox;
  }

  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const word of validWords) {
    x0 = Math.min(x0, word.bbox.x0);
    y0 = Math.min(y0, word.bbox.y0);
    x1 = Math.max(x1, word.bbox.x1);
    y1 = Math.max(y1, word.bbox.y1);
  }

  if (!(x1 > x0 && y1 > y0)) {
    return normalizedRawBBox;
  }

  const wordUnionBBox: BBox = { x0, y0, x1, y1 };
  if (!normalizedRawBBox) {
    return wordUnionBBox;
  }

  const rawWidth = Math.max(1, normalizedRawBBox.x1 - normalizedRawBBox.x0);
  const rawHeight = Math.max(1, normalizedRawBBox.y1 - normalizedRawBBox.y0);
  const rawArea = Math.max(1, rawWidth * rawHeight);
  const unionWidth = Math.max(1, wordUnionBBox.x1 - wordUnionBBox.x0);
  const unionHeight = Math.max(1, wordUnionBBox.y1 - wordUnionBBox.y0);
  const unionArea = Math.max(1, unionWidth * unionHeight);
  const unionCoverage = unionArea / rawArea;

  const rawLooksOversized = unionCoverage <= 0.32
    && (
      rawArea >= unionArea * 3.8
      || rawWidth >= unionWidth * 1.9
      || rawHeight >= unionHeight * 1.9
    );

  const rawLooksClipped = validWords.length >= 2
    && unionCoverage >= 2.2
    && unionCoverage <= 4.6
    && (
      unionWidth >= rawWidth * 1.8
      || unionHeight >= rawHeight * 1.8
    );

  return (rawLooksOversized || rawLooksClipped) ? wordUnionBBox : normalizedRawBBox;
};

export const resolvePanelLineTextForSafety = (line: OCRLine): string => {
  const rawText = normalizePreviewText(String(line.text || ''));
  if (rawText) return rawText;

  const validWords = (Array.isArray(line.words) ? line.words : [])
    .filter((word) => hasPositivePanelBBox(word?.bbox))
    .map((word) => ({
      ...word,
      text: normalizePreviewText(String(word?.text || '')),
    }))
    .filter((word) => word.text.length > 0);

  if (validWords.length === 0) return '';

  const wordsText = normalizePreviewText(validWords.map((word) => word.text).join(' '));
  if (!wordsText) return '';

  const lineWidth = Math.max(1, Number(line.bbox?.x1 || 0) - Number(line.bbox?.x0 || 0));
  const lineHeight = Math.max(1, Number(line.bbox?.y1 || 0) - Number(line.bbox?.y0 || 0));
  const lineArea = Math.max(1, lineWidth * lineHeight);

  let unionX0 = Number.POSITIVE_INFINITY;
  let unionY0 = Number.POSITIVE_INFINITY;
  let unionX1 = Number.NEGATIVE_INFINITY;
  let unionY1 = Number.NEGATIVE_INFINITY;
  validWords.forEach((word) => {
    const bbox = word.bbox;
    unionX0 = Math.min(unionX0, Number(bbox.x0 || 0));
    unionY0 = Math.min(unionY0, Number(bbox.y0 || 0));
    unionX1 = Math.max(unionX1, Number(bbox.x1 || 0));
    unionY1 = Math.max(unionY1, Number(bbox.y1 || 0));
  });

  const unionArea = Math.max(1, (unionX1 - unionX0) * (unionY1 - unionY0));
  const coverage = unionArea / lineArea;
  const avgConfidence = validWords.reduce((sum, word) => sum + Number(word.confidence || 0), 0) / validWords.length;
  const tokens = wordsText.split(/\s+/g).filter(Boolean);
  const hasCjkOrThai = /[\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(wordsText);
  const shortSingleToken = tokens.length === 1 && wordsText.length <= 8;

  if (shortSingleToken && !hasCjkOrThai) {
    return coverage >= 0.72 && avgConfidence >= 72 ? wordsText : '';
  }
  if (tokens.length <= 2 && wordsText.length <= 10 && !hasCjkOrThai) {
    return coverage >= 0.58 && avgConfidence >= 62 ? wordsText : '';
  }
  if (tokens.length >= 3 || wordsText.length >= 14) {
    return (coverage >= 0.24 || avgConfidence >= 58) ? wordsText : '';
  }
  return coverage >= 0.42 ? wordsText : '';
};

const PANEL_GHOST_PUNCT_ONLY_REGEX = /^[|¦│┃/\\_~.,:;'"`!?-]+$/;
const PANEL_GHOST_SHORT_TOKEN_REGEX = /^[A-Z0-9]{1,4}$/;
const PANEL_TECHNICAL_ROW_HINT_REGEX = /\b(resultant|magnitude|direction|force|column|columns|connections?|support|reaction|unknowns?|beam|beams|welded|rigid|types?|table|continued|hinge|pin|collar|utility|building|bridge|girder|floor|member|concrete)\b/i;
const PANEL_TECHNICAL_EQUATION_TAG_REGEX = /\(\s*\d{1,3}[a-z]?\s*\)/i;

export const isLikelyTechnicalDocumentLineForSafety = (resolvedText: string): boolean => {
  const normalized = normalizePreviewText(String(resolvedText || ''));
  if (!normalized) return false;

  const alphaNumLength = normalized.replace(/[^A-Za-z0-9]/g, '').length;
  if (alphaNumLength < 6) return false;

  const tokenCount = normalized.split(/\s+/g).filter(Boolean).length;
  if (tokenCount < 2 || tokenCount > 20) return false;

  return PANEL_TECHNICAL_ROW_HINT_REGEX.test(normalized) || PANEL_TECHNICAL_EQUATION_TAG_REGEX.test(normalized);
};

export const isLikelyDocumentLikePanelPage = (result: OCRPageResult): boolean => {
  const lines = Array.isArray(result.lines) ? result.lines : [];
  if (lines.length < 28) return false;

  const width = Math.max(1, Number(result.width || 0));
  const height = Math.max(1, Number(result.height || 0));
  const aspectRatio = Math.max(width, height) / Math.max(1, Math.min(width, height));
  if (aspectRatio > 2.25) return false;

  let wordCount = 0;
  for (const line of lines) {
    const lineWords = Array.isArray(line.words) ? line.words : [];
    if (lineWords.length > 0) {
      wordCount += lineWords.filter((word) => normalizePreviewText(String(word?.text || '')).length > 0).length;
      continue;
    }
    wordCount += normalizePreviewText(String(line.text || '')).split(/\s+/g).filter(Boolean).length;
  }

  const avgWordsPerLine = wordCount / Math.max(1, lines.length);
  return avgWordsPerLine >= 1.7;
};

export const isLikelyLatinDominantPanelPage = (result: OCRPageResult): boolean => {
  const lines = Array.isArray(result.lines) ? result.lines : [];
  if (lines.length < 8) return false;

  let latinChars = 0;
  let nonLatinChars = 0;
  let latinHeavyLines = 0;

  for (const line of lines) {
    const text = normalizePreviewText(String(line?.text || ''));
    if (!text) continue;

    const lineLatin = (text.match(/[A-Za-z]/g) || []).length;
    const lineNonLatin = (text.match(/[\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/g) || []).length;
    const nonSpace = text.replace(/\s+/g, '').length;
    const latinRatio = lineLatin / Math.max(1, nonSpace);

    latinChars += lineLatin;
    nonLatinChars += lineNonLatin;
    if (lineLatin >= 6 && latinRatio >= 0.45) {
      latinHeavyLines += 1;
    }
  }

  if (latinChars < 18) return false;
  if (latinChars < Math.max(18, nonLatinChars * 0.9)) return false;
  if (latinHeavyLines < Math.max(3, Math.floor(lines.length * 0.24))) return false;
  return true;
};

export const computePanelLineAverageConfidence = (line: OCRLine): number => {
  const validWords = (Array.isArray(line.words) ? line.words : [])
    .filter((word) => hasPositivePanelBBox(word?.bbox) && normalizePreviewText(String(word?.text || '')).length > 0);
  if (validWords.length === 0) {
    return Number(line.confidence || 0);
  }
  return validWords.reduce((sum, word) => sum + Number(word.confidence || 0), 0) / validWords.length;
};

export const computePanelLineWordUnionCoverage = (line: OCRLine): number => {
  const validWords = (Array.isArray(line.words) ? line.words : [])
    .filter((word) => hasPositivePanelBBox(word?.bbox) && normalizePreviewText(String(word?.text || '')).length > 0);
  if (validWords.length === 0) return 0;

  let unionX0 = Number.POSITIVE_INFINITY;
  let unionY0 = Number.POSITIVE_INFINITY;
  let unionX1 = Number.NEGATIVE_INFINITY;
  let unionY1 = Number.NEGATIVE_INFINITY;
  validWords.forEach((word) => {
    const bbox = word.bbox;
    unionX0 = Math.min(unionX0, Number(bbox.x0 || 0));
    unionY0 = Math.min(unionY0, Number(bbox.y0 || 0));
    unionX1 = Math.max(unionX1, Number(bbox.x1 || 0));
    unionY1 = Math.max(unionY1, Number(bbox.y1 || 0));
  });

  const lineWidth = Math.max(1, Number(line.bbox?.x1 || 0) - Number(line.bbox?.x0 || 0));
  const lineHeight = Math.max(1, Number(line.bbox?.y1 || 0) - Number(line.bbox?.y0 || 0));
  const lineArea = Math.max(1, lineWidth * lineHeight);
  const unionArea = Math.max(1, (unionX1 - unionX0) * (unionY1 - unionY0));
  return Math.max(0, Math.min(1.8, unionArea / lineArea));
};

export const isLikelyLargeBorderEffectLineForSafety = (
  line: OCRLine,
  resolvedText: string,
  pageWidth: number,
  pageHeight: number,
  dpi: number = 300,
): boolean => {
  const text = normalizePreviewText(String(resolvedText || ''));
  if (!text || !line?.bbox) return false;

  const width = Math.max(1, Number(line.bbox?.x1 || 0) - Number(line.bbox?.x0 || 0));
  const height = Math.max(1, Number(line.bbox?.y1 || 0) - Number(line.bbox?.y0 || 0));
  const area = Math.max(1, width * height);
  const pageArea = Math.max(1, pageWidth * pageHeight);
  const widthRatio = width / Math.max(1, pageWidth);
  const heightRatio = height / Math.max(1, pageHeight);
  const areaRatio = area / pageArea;

  const compact = text.replace(/\s+/g, '');
  const alphaNum = compact.replace(/[^A-Za-z0-9]/g, '');
  const isKnownShortWord = isKnownShortWordHelper(alphaNum);
  if (isKnownShortWord) return false;

  const hasLatin = /[A-Za-z\u00C0-\u024F]/.test(compact);
  const hasCjkOrThai = /[\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/.test(compact);
  const unknownChars = compact.replace(/[A-Za-z0-9\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/g, '');
  const unknownCharRatio = unknownChars.length / Math.max(1, compact.length);

  const validWords = (Array.isArray(line.words) ? line.words : [])
    .filter((word) => hasPositivePanelBBox(word?.bbox) && normalizePreviewText(String(word?.text || '')).length > 0);
  const wordCount = validWords.length > 0
    ? validWords.length
    : text.split(/\s+/g).filter(Boolean).length;
  const tokenCount = text.split(/\s+/g).filter(Boolean).length;
  const avgConfidence = computePanelLineAverageConfidence(line);
  const wordCoverage = computePanelLineWordUnionCoverage(line);

  const looksLikeWideDocumentRow = widthRatio >= 0.66
    && heightRatio <= 0.085
    && tokenCount >= 4
    && compact.length >= 16;
  if (looksLikeWideDocumentRow) return false;

  const dpiScale = Math.max(0.2, dpi / 300);

  const hugeBorderBox = areaRatio >= 0.038
    || (widthRatio >= 0.34 && heightRatio >= 0.16)
    || (widthRatio >= 0.2 && heightRatio >= 0.24);
  const mediumBorderBox = areaRatio >= 0.026
    && (widthRatio >= 0.18 || heightRatio >= 0.16)
    && (width >= 120 * dpiScale || height >= 92 * dpiScale);
  if (!hugeBorderBox && !mediumBorderBox) return false;

  const sparsePhrase = wordCount <= 3 || compact.length <= 16;
  const sparseCjk = hasCjkOrThai && compact.length <= 8 && wordCount <= 3;
  const sparseLatin = hasLatin && alphaNum.length <= 18 && wordCount <= 4;
  const veryLowCoverage = wordCoverage <= 0.16;
  const lowCoverage = wordCoverage <= 0.24;
  const lowSignal = avgConfidence <= 92 || unknownCharRatio >= 0.25;

  if (veryLowCoverage && sparsePhrase && (sparseCjk || sparseLatin || unknownCharRatio >= 0.32)) {
    return true;
  }

  if (lowCoverage && (sparseCjk || sparseLatin) && lowSignal && areaRatio >= 0.05) {
    return true;
  }

  if (lowCoverage && sparsePhrase && (sparseCjk || sparseLatin || unknownCharRatio >= 0.28) && areaRatio >= 0.026) {
    return true;
  }

  const latinEffectSectionGhost = hasLatin
    && !hasCjkOrThai
    && validWords.length <= 1
    && tokenCount >= 2
    && tokenCount <= 7
    && alphaNum.length >= 6
    && alphaNum.length <= 34
    && areaRatio >= 0.022
    && widthRatio >= 0.14
    && heightRatio >= 0.1
    && wordCoverage <= 0.24
    && (area / Math.max(1, alphaNum.length)) >= 620;
  if (latinEffectSectionGhost) {
    return true;
  }

  return false;
};

export const isLikelyPanelGhostLineForSafety = (
  line: OCRLine,
  resolvedText: string,
  pageWidth: number,
  dpi: number = 300,
): boolean => {
  const text = normalizePreviewText(String(resolvedText || ''));
  if (!text) return true;

  const width = Math.max(1, Number(line.bbox?.x1 || 0) - Number(line.bbox?.x0 || 0));
  const height = Math.max(1, Number(line.bbox?.y1 || 0) - Number(line.bbox?.y0 || 0));
  const area = Math.max(1, width * height);
  const compact = text.replace(/\s+/g, '');
  const asciiCompact = compact.replace(/[^A-Za-z0-9]/g, '');
  const latinCompact = compact.replace(/[^A-Za-z]/g, '');
  const hasCjkOrThai = /[\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(compact);
  if (hasCjkOrThai) return false;

  const validWords = (Array.isArray(line.words) ? line.words : [])
    .filter((word) => hasPositivePanelBBox(word?.bbox) && normalizePreviewText(String(word?.text || '')).length > 0);
  const wordCount = validWords.length > 0
    ? validWords.length
    : text.split(/\s+/g).filter(Boolean).length;
  const avgConfidence = computePanelLineAverageConfidence(line);

  const dpiScale = Math.max(0.2, dpi / 300);

  if (PANEL_GHOST_PUNCT_ONLY_REGEX.test(compact) && width <= 112 * dpiScale && height <= 44 * dpiScale) {
    return true;
  }

  const isPureSymbolNoise = asciiCompact.length === 0;
  if (isPureSymbolNoise) {
    return true;
  }

  const isVerticalLineJunk = /^[lI1|!/\\_\-]+$/i.test(compact) && !/^[IAO]$/i.test(asciiCompact);
  if (isVerticalLineJunk) {
    return true;
  }

  const isSingleCharJunk = asciiCompact.length === 1 && !/^[IAO]$/i.test(asciiCompact);
  if (isSingleCharJunk) {
    return true;
  }

  const isKnownShortWord = isKnownShortWordHelper(asciiCompact);
  if (isKnownShortWord) {
    return false;
  }
  const isTinyJunkBox = asciiCompact.length <= 3 && area <= 8000 * dpiScale * dpiScale;
  if (isTinyJunkBox) {
    return true;
  }

  const compactUpper = compact.toUpperCase();
  const shortDigitArtifact = PANEL_GHOST_SHORT_TOKEN_REGEX.test(compactUpper)
    && /\d/.test(compactUpper)
    && !/[a-z]/.test(compact);
  if (shortDigitArtifact && wordCount <= 1 && width <= 96 * dpiScale && height <= 42 * dpiScale && avgConfidence <= 82) {
    return true;
  }

  const pxPerLatinChar = width / Math.max(1, latinCompact.length);
  const suspiciousTinyLongLatin = latinCompact.length >= 10
    && wordCount >= 3
    && pxPerLatinChar < 2.85 * dpiScale
    && width <= Math.max(72 * dpiScale, latinCompact.length * 5.4 * dpiScale)
    && width <= Math.max(96 * dpiScale, pageWidth * 0.06)
    && height <= 28 * dpiScale
    && avgConfidence <= 84;
  if (suspiciousTinyLongLatin) {
    return true;
  }

  const pxPerAsciiChar = width / Math.max(1, asciiCompact.length);
  const tinyDenseAsciiArtifact = wordCount <= 2
    && asciiCompact.length >= 6
    && asciiCompact.length <= 14
    && pxPerAsciiChar < 2.9 * dpiScale
    && width <= Math.max(118 * dpiScale, pageWidth * 0.07)
    && height <= 30 * dpiScale
    && avgConfidence <= 82;
  if (tinyDenseAsciiArtifact) {
    return true;
  }

  const lowSignalTinySingleton = wordCount <= 1
    && asciiCompact.length > 0
    && asciiCompact.length <= 4
    && area <= 2600 * dpiScale * dpiScale
    && width <= 104 * dpiScale
    && height <= 40 * dpiScale
    && avgConfidence <= 78;
  if (lowSignalTinySingleton) {
    return true;
  }

  return false;
};

export const isLikelyTinyMangaArtifactLineForSafety = (
  line: OCRLine,
  resolvedText: string,
  pageWidth: number,
  pageHeight: number,
  latinDominantPage: boolean,
  dpi: number = 300,
): boolean => {
  const text = normalizePreviewText(String(resolvedText || ''));
  if (!text) return true;
  if (!line?.bbox) return false;

  const width = Math.max(1, Number(line.bbox?.x1 || 0) - Number(line.bbox?.x0 || 0));
  const height = Math.max(1, Number(line.bbox?.y1 || 0) - Number(line.bbox?.y0 || 0));
  const area = Math.max(1, width * height);
  const compact = text.replace(/\s+/g, '');
  const confidence = Number(line.confidence || 0);
  const words = (Array.isArray(line.words) ? line.words : [])
    .filter((word) => hasPositivePanelBBox(word?.bbox) && normalizePreviewText(String(word?.text || '')).length > 0);
  const wordCount = words.length > 0
    ? words.length
    : text.split(/\s+/g).filter(Boolean).length;

  const hasLatin = /[A-Za-z\u00C0-\u024F]/.test(compact);
  const hasCjkOrThai = /[\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(compact);
  const alphaNum = compact.replace(/[^A-Za-z0-9]/g, '');
  const isKnownShortWord = isKnownShortWordHelper(alphaNum);
  if (isKnownShortWord) return false;
  const unknownChars = compact.replace(/[A-Za-z0-9\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/g, '');
  const unknownCharRatio = unknownChars.length / Math.max(1, compact.length);
  const wordCoverage = computePanelLineWordUnionCoverage(line);

  const dpiScale = Math.max(0.2, dpi / 300);

  if (wordCount <= 1 && width <= 68 * dpiScale && height <= 34 * dpiScale && area <= 1700 * dpiScale * dpiScale) {
    if (hasCjkOrThai && compact.length <= 2 && confidence <= 90) {
      return true;
    }
    if (hasLatin && alphaNum.length <= 2 && confidence <= 84) {
      return true;
    }
  }

  if (wordCount <= 2 && width <= 84 * dpiScale && height <= 38 * dpiScale && area <= 2200 * dpiScale * dpiScale) {
    if (hasCjkOrThai && compact.length <= 3 && confidence <= 80) {
      return true;
    }
    if (hasLatin && alphaNum.length <= 3 && confidence <= 76) {
      return true;
    }
  }

  const narrowTallLowSignalArtifact = wordCount <= 2
    && width <= Math.max(52 * dpiScale, pageWidth * 0.03)
    && height <= Math.max(188 * dpiScale, pageHeight * 0.08)
    && height >= Math.max(44 * dpiScale, width * 1.2)
    && confidence <= 86;
  if (narrowTallLowSignalArtifact) {
    if (hasCjkOrThai && compact.length <= 2) return true;
    if (hasLatin && alphaNum.length <= 3) return true;
  }

  if (wordCount <= 2 && area <= 2800 * dpiScale * dpiScale && unknownCharRatio >= 0.45 && confidence <= 88) {
    return true;
  }

  const shortStylizedNonLatinSfx = hasCjkOrThai
    && wordCount <= 1
    && compact.length <= 3
    && width <= Math.max(132 * dpiScale, pageWidth * 0.085)
    && height <= Math.max(112 * dpiScale, pageHeight * 0.12)
    && area <= Math.max(11500 * dpiScale * dpiScale, pageWidth * pageHeight * 0.008)
    && confidence <= 92
    && (unknownCharRatio >= 0.08 || height >= width * 0.6);
  if (shortStylizedNonLatinSfx) {
    return true;
  }

  if (hasCjkOrThai && wordCount <= 2 && compact.length <= 5 && area <= 6200 * dpiScale * dpiScale && wordCoverage <= 0.26) {
    if (confidence <= 92 || unknownCharRatio >= 0.2) {
      return true;
    }
  }

  const shortForeignSfxOnLatinPage = latinDominantPage
    && hasCjkOrThai
    && !hasLatin
    && wordCount <= 3
    && compact.length <= 12
    && width <= Math.max(220 * dpiScale, pageWidth * 0.18)
    && height <= Math.max(220 * dpiScale, pageHeight * 0.22)
    && area <= Math.max(26000 * dpiScale * dpiScale, pageWidth * pageHeight * 0.015)
    && confidence <= 96;
  if (shortForeignSfxOnLatinPage) {
    return true;
  }

  return false;
};

export const normalizePanelDedupTextKey = (value: string): string =>
  String(value || '')
    .toUpperCase()
    .replace(/[|¦│┃￨︱︲]+/g, '')
    .replace(/[^A-Z0-9\uAC00-\uD7A3\u3040-\u30FF\u3400-\u9FFF]+/g, '')
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/5/g, 'S');

export const panelLineWidth = (line: OCRLine): number => Math.max(0, Number(line.bbox?.x1 || 0) - Number(line.bbox?.x0 || 0));
export const panelLineHeight = (line: OCRLine): number => Math.max(0, Number(line.bbox?.y1 || 0) - Number(line.bbox?.y0 || 0));
export const panelLineArea = (line: OCRLine): number => Math.max(1, panelLineWidth(line) * panelLineHeight(line));
export const panelLineCenterX = (line: OCRLine): number => (Number(line.bbox?.x0 || 0) + Number(line.bbox?.x1 || 0)) * 0.5;
export const panelLineCenterY = (line: OCRLine): number => (Number(line.bbox?.y0 || 0) + Number(line.bbox?.y1 || 0)) * 0.5;

export const panelOverlapRatioX = (a: OCRLine, b: OCRLine): number => {
  const overlap = Math.max(0, Math.min(Number(a.bbox?.x1 || 0), Number(b.bbox?.x1 || 0)) - Math.max(Number(a.bbox?.x0 || 0), Number(b.bbox?.x0 || 0)));
  const minWidth = Math.max(1, Math.min(panelLineWidth(a), panelLineWidth(b)));
  return overlap / minWidth;
};

export const panelOverlapRatioY = (a: OCRLine, b: OCRLine): number => {
  const overlap = Math.max(0, Math.min(Number(a.bbox?.y1 || 0), Number(b.bbox?.y1 || 0)) - Math.max(Number(a.bbox?.y0 || 0), Number(b.bbox?.y0 || 0)));
  const minHeight = Math.max(1, Math.min(panelLineHeight(a), panelLineHeight(b)));
  return overlap / minHeight;
};

export const panelIoURatio = (a: OCRLine, b: OCRLine): number => {
  const overlapWidth = Math.max(0, Math.min(Number(a.bbox?.x1 || 0), Number(b.bbox?.x1 || 0)) - Math.max(Number(a.bbox?.x0 || 0), Number(b.bbox?.x0 || 0)));
  const overlapHeight = Math.max(0, Math.min(Number(a.bbox?.y1 || 0), Number(b.bbox?.y1 || 0)) - Math.max(Number(a.bbox?.y0 || 0), Number(b.bbox?.y0 || 0)));
  const intersection = overlapWidth * overlapHeight;
  if (intersection <= 0) return 0;

  const union = panelLineArea(a) + panelLineArea(b) - intersection;
  return union > 0 ? (intersection / union) : 0;
};

export const buildPanelDedupBigrams = (value: string): Set<string> => {
  const compact = String(value || '').trim();
  const grams = new Set<string>();
  if (!compact) return grams;
  if (compact.length === 1) {
    grams.add(compact);
    return grams;
  }
  for (let i = 0; i < compact.length - 1; i += 1) {
    grams.add(compact.slice(i, i + 2));
  }
  return grams;
};

export const panelDedupDiceSimilarity = (a: string, b: string): number => {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const aBigrams = buildPanelDedupBigrams(a);
  const bBigrams = buildPanelDedupBigrams(b);
  if (aBigrams.size === 0 || bBigrams.size === 0) return 0;

  let overlap = 0;
  for (const gram of aBigrams) {
    if (bBigrams.has(gram)) overlap += 1;
  }
  return (2 * overlap) / (aBigrams.size + bBigrams.size);
};

export const shouldCollapsePanelSafetyDuplicate = (
  existingLine: OCRLine,
  existingKey: string,
  candidateLine: OCRLine,
  candidateKey: string
): boolean => {
  if (!existingKey || !candidateKey) return false;

  const candidateArea = Math.max(1, panelLineArea(candidateLine));
  const existingArea = Math.max(1, panelLineArea(existingLine));
  const overlapW = Math.max(0, Math.min(existingLine.bbox.x1, candidateLine.bbox.x1) - Math.max(existingLine.bbox.x0, candidateLine.bbox.x0));
  const overlapH = Math.max(0, Math.min(existingLine.bbox.y1, candidateLine.bbox.y1) - Math.max(existingLine.bbox.y0, candidateLine.bbox.y0));
  const overlapArea = overlapW * overlapH;
  
  const candidateOverlapRatio = overlapArea / candidateArea;
  const existingOverlapRatio = overlapArea / existingArea;
  const isBoxContained = candidateOverlapRatio >= 0.85 || existingOverlapRatio >= 0.85;
  const isSamePosition = candidateOverlapRatio >= 0.82 && existingOverlapRatio >= 0.82;

  if (isSamePosition) {
    return true;
  }

  if (isBoxContained) {
    const textSimilarity = panelDedupDiceSimilarity(existingKey, candidateKey);
    if (textSimilarity >= 0.15 || existingKey.includes(candidateKey) || candidateKey.includes(existingKey)) {
      return true;
    }
  }

  const overlapY = panelOverlapRatioY(existingLine, candidateLine);
  const centerDeltaY = Math.abs(panelLineCenterY(existingLine) - panelLineCenterY(candidateLine));
  const centerDeltaX = Math.abs(panelLineCenterX(existingLine) - panelLineCenterX(candidateLine));
  const minHeight = Math.max(8, Math.min(panelLineHeight(existingLine), panelLineHeight(candidateLine)));
  const minWidth = Math.max(24, Math.min(panelLineWidth(existingLine), panelLineWidth(candidateLine)));

  // กรองคำซ้ำ (เช่น CAME ซ้ำกับ CHME ที่ถูก normalized มาเป็น CAME ในจุดเดียวกัน)
  // หากคำศัพท์เหมือนกัน และทับซ้อนในแนวดิ่งอย่างน้อย 45% และศูนย์กลางอยู่ใกล้กัน ถือว่าเป็นคำซ้ำทันที
  if (existingKey === candidateKey && overlapY >= 0.45 && centerDeltaX <= minWidth * 1.5 && centerDeltaY <= minHeight * 1.5) {
    return true;
  }

  // ป้องกันไม่ให้ลบคำศัพท์ซ้ำที่อยู่คนละบรรทัดกัน (เช่น FOR YOU / FOR YOU, I CAME / I CAME)
  if (overlapY <= 0.48 && !isBoxContained) {
    return false;
  }
  const overlapX = panelOverlapRatioX(existingLine, candidateLine);
  const iou = panelIoURatio(existingLine, candidateLine);
  const areaRatio = existingArea / candidateArea;
  const areaSpanRatio = Math.max(existingArea, candidateArea) / Math.max(1, Math.min(existingArea, candidateArea));
  const nearSizeMatch = areaRatio >= 0.64 && areaRatio <= 1.56;
  const existingCoverage = computePanelLineWordUnionCoverage(existingLine);
  const candidateCoverage = computePanelLineWordUnionCoverage(candidateLine);
  const dominantCoverage = Math.max(existingCoverage, candidateCoverage);
  const weakCoverage = Math.min(existingCoverage, candidateCoverage);
  const strongSpatialMatch = (
    iou >= 0.58
    || (overlapY >= 0.86 && overlapX >= 0.74)
    || (
      overlapY >= 0.68
      && overlapX >= 0.46
      && centerDeltaY <= minHeight * 0.72
      && centerDeltaX <= minWidth * 0.62
    )
  );

  const existingPreview = normalizePreviewText(existingLine.text || '');
  const candidatePreview = normalizePreviewText(candidateLine.text || '');
  const technicalLinePair = (
    isLikelyTechnicalDocumentLineForSafety(existingPreview)
    || isLikelyTechnicalDocumentLineForSafety(candidatePreview)
  );

  const severeGeometryEcho = (
    overlapX >= 0.62
    && (overlapY >= 0.16 || iou >= 0.1)
    && centerDeltaX <= Math.max(104, minWidth * 1.2)
    && centerDeltaY <= Math.max(136, minHeight * 4.2)
    && areaSpanRatio >= 1.34
    && (dominantCoverage - weakCoverage) >= 0.16
    && weakCoverage <= 0.44
    && (technicalLinePair || Math.max(existingArea, candidateArea) >= 9000 || iou >= 0.22)
  );
  if (severeGeometryEcho) {
    return true;
  }

  const minLength = Math.min(existingKey.length, candidateKey.length);
  const sameOrSubset = existingKey === candidateKey
    || (minLength >= 5 && (existingKey.includes(candidateKey) || candidateKey.includes(existingKey)));
  if (!sameOrSubset) {
    const similarity = panelDedupDiceSimilarity(existingKey, candidateKey);
    if (similarity < 0.72) return false;
    
    // Allow loose short match if the similarity is reasonably high and spatial overlap is strong
    const isLooseShortMatch = minLength < 8
      && similarity >= 0.70
      && (iou >= 0.35 || (overlapY >= 0.50 && overlapX >= 0.45));
      
    if (minLength < 8 && similarity < 0.86 && !isLooseShortMatch) return false;
  }

  if (technicalLinePair) {
    const technicalStackedEcho = (
      (sameOrSubset || panelDedupDiceSimilarity(existingKey, candidateKey) >= 0.88)
      && areaSpanRatio <= 2.8
      && overlapX >= 0.74
      && centerDeltaX <= Math.max(78, minWidth * 1.08)
      && centerDeltaY <= Math.max(142, minHeight * 4.8)
      && (overlapY >= 0.01 || iou >= 0.02)
    );
    return (
      technicalStackedEcho
      ||
      iou >= 0.62
      || (
        overlapY >= 0.86
        && overlapX >= 0.74
        && centerDeltaY <= minHeight * 0.72
        && centerDeltaX <= minWidth * 0.62
      )
      || (
        overlapY >= 0.72
        && overlapX >= 0.58
        && nearSizeMatch
        && centerDeltaY <= minHeight * 0.86
        && centerDeltaX <= minWidth * 0.78
      )
    );
  }

  const exactKeyMatch = existingKey === candidateKey;
  const existingWordCount = existingPreview.split(/\s+/g).filter(Boolean).length;
  const candidateWordCount = candidatePreview.split(/\s+/g).filter(Boolean).length;
  const nearStackedBand = overlapY >= 0.02 || centerDeltaY <= Math.max(96, minHeight * 4.2);
  const shortExactPhrase = exactKeyMatch && candidateKey.length >= 4 && candidateKey.length <= 14;
  const looseAreaRatio = areaRatio >= 0.32 && areaRatio <= 3.2;
  const shortPhraseDuplicate = (
    shortExactPhrase
    && looseAreaRatio
    && centerDeltaY <= Math.max(126, minHeight * 6.2)
    && centerDeltaX <= Math.max(132, minWidth * 2.6)
    && (iou >= 0.12 || overlapY >= 0.24)
  );
  const stackedSameColumnShortDuplicate = (
    shortExactPhrase
    && candidateKey.length >= 10
    && looseAreaRatio
    && centerDeltaY <= Math.max(170, minHeight * 7.5)
    && centerDeltaX <= Math.max(64, minWidth * 1.25)
    && overlapX >= 0.7
  );
  const sameColumnEchoDuplicate = (
    exactKeyMatch
    && candidateKey.length >= 14
    && Math.min(existingWordCount, candidateWordCount) >= 3
    && looseAreaRatio
    && centerDeltaY <= Math.max(220, minHeight * 9.2)
    && centerDeltaX <= Math.max(72, minWidth * 1.35)
    && overlapX >= 0.52
  );
  const localStackedDuplicate = (
    exactKeyMatch
    && candidateKey.length >= 4
    && nearSizeMatch
    && centerDeltaY <= Math.max(112, minHeight * 4.8)
    && centerDeltaX <= Math.max(108, minWidth * 1.9)
    && overlapX >= 0.44
    && nearStackedBand
  );

  if (sameOrSubset) {
    // Fast-path: หากข้อความ Key เหมือนกันเป๊ะ (หลังลบขยะ) ให้ยุบรวมหากอยู่ใกล้กัน
    // แก้ปัญหา STILL ALIVE / STILL ALive_ ที่อยู่ตำแหน่งทับซ้อนกันแต่ดูไม่เหมือนเพราะขยะท้ายคำ
    if (exactKeyMatch) {
      const isCloseProximity = (
        iou >= 0.08
        || (overlapY >= 0.08 && overlapX >= 0.08)
        || (centerDeltaY <= Math.max(minHeight * 4.0, 120) && centerDeltaX <= Math.max(minWidth * 1.8, 140))
      );
      if (isCloseProximity) return true;
    }
    return strongSpatialMatch
      || localStackedDuplicate
      || shortPhraseDuplicate
      || stackedSameColumnShortDuplicate
      || sameColumnEchoDuplicate;
  }

  const similarity = panelDedupDiceSimilarity(existingKey, candidateKey);
  const highSimilarity = similarity >= 0.88;
  const looseSpatialMatch = highSimilarity
    && (
      iou >= 0.32
      || (
        overlapY >= 0.48
        && overlapX >= 0.42
        && centerDeltaY <= minHeight * 1.4
        && centerDeltaX <= minWidth * 1.3
      )
    );

  return (
    iou >= 0.72
    || (overlapY >= 0.9 && overlapX >= 0.8)
    || (
      strongSpatialMatch
      && centerDeltaY <= minHeight * 0.6
      && centerDeltaX <= minWidth * 0.55
    )
    || looseSpatialMatch
  );
};

export const findTopWatermarkDialogueEchoTarget = (
  line: OCRLine,
  key: string,
  allLines: Array<{ line: OCRLine; index: number }>,
  pageWidth: number,
  pageHeight: number,
): { line: OCRLine; index: number } | null => {
  if (!key || key.length > 14) return null;
  if (key !== 'ITHINK' && key !== 'THINK') return null;
  const bbox = normalizePanelBBox(line.bbox);
  if (!bbox) return null;

  const width = Math.max(1, bbox.x1 - bbox.x0);
  const height = Math.max(1, bbox.y1 - bbox.y0);
  const area = Math.max(1, width * height);
  const centerX = (bbox.x0 + bbox.x1) * 0.5;
  const centerY = (bbox.y0 + bbox.y1) * 0.5;
  const topBand = bbox.y0 <= Math.max(160, pageHeight * 0.16) || centerY <= Math.max(190, pageHeight * 0.18);
  if (!topBand) return null;
  if (width > pageWidth * 0.44 || height > Math.max(72, pageHeight * 0.075) || area > pageWidth * pageHeight * 0.018) {
    return null;
  }

  const coverage = computePanelLineWordUnionCoverage(line);
  const lineLooksLikeTopWatermarkEcho = coverage <= 0.34 || centerX >= pageWidth * 0.58;
  const candidates = allLines.filter((candidate) => {
    if (candidate.line === line) return false;
    const candidateKey = normalizePanelDedupTextKey(candidate.line.text || '');
    if (!candidateKey) return false;
    const minLength = Math.min(key.length, candidateKey.length);
    const samePhraseFamily = key === candidateKey
      || (minLength >= 5 && (key.includes(candidateKey) || candidateKey.includes(key)));
    if (!samePhraseFamily) return false;

    const candidateBBox = normalizePanelBBox(candidate.line.bbox);
    if (!candidateBBox) return false;

    const candidateCoverage = computePanelLineWordUnionCoverage(candidate.line);
    const candidateHeight = Math.max(1, candidateBBox.y1 - candidateBBox.y0);
    const candidateCenterX = (candidateBBox.x0 + candidateBBox.x1) * 0.5;
    const candidateCenterY = (candidateBBox.y0 + candidateBBox.y1) * 0.5;
    const candidateTopBand = candidateBBox.y0 <= Math.max(160, pageHeight * 0.16)
      || candidateCenterY <= Math.max(190, pageHeight * 0.18);

    const lowerDialogueEcho = (
      lineLooksLikeTopWatermarkEcho
      && candidateBBox.y0 - bbox.y1 >= Math.max(110, pageHeight * 0.13)
      && candidateCoverage >= Math.max(0.2, coverage - 0.08)
      && candidateHeight >= Math.max(10, height * 0.72)
    );
    if (lowerDialogueEcho) return true;

    const sameTopBandRightWatermarkEcho = (
      candidateTopBand
      && centerX >= pageWidth * 0.58
      && candidateCenterX <= centerX - Math.max(96, pageWidth * 0.18)
      && Math.abs(candidateCenterY - centerY) <= Math.max(48, Math.min(height, candidateHeight) * 1.8)
      && candidateCoverage >= Math.max(0.18, coverage - 0.16)
      && candidateHeight >= Math.max(10, height * 0.62)
    );
    return sameTopBandRightWatermarkEcho;
  });

  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => {
    const aBBox = normalizePanelBBox(a.line.bbox);
    const bBBox = normalizePanelBBox(b.line.bbox);
    const aLower = aBBox ? Math.max(0, aBBox.y0 - bbox.y1) : 0;
    const bLower = bBBox ? Math.max(0, bBBox.y0 - bbox.y1) : 0;
    if (aLower !== bLower) return bLower - aLower;
    if (aBBox && bBBox && aBBox.x0 !== bBBox.x0) return aBBox.x0 - bBBox.x0;
    return a.index - b.index;
  })[0];
};

export const mergePanelRicherTextWithCleanerDuplicateGeometry = (
  existingLine: OCRLine,
  existingKey: string,
  candidateLine: OCRLine,
  candidateKey: string,
): OCRLine | null => {
  if (!existingKey || !candidateKey || existingKey === candidateKey) return null;
  const minLength = Math.min(existingKey.length, candidateKey.length);
  if (minLength < 5) return null;
  if (!existingKey.includes(candidateKey) && !candidateKey.includes(existingKey)) return null;

  const richer = existingKey.length > candidateKey.length ? existingLine : candidateLine;
  const cleaner = richer === existingLine ? candidateLine : existingLine;
  const richerKey = richer === existingLine ? existingKey : candidateKey;
  const cleanerKey = richer === existingLine ? candidateKey : existingKey;
  if (richerKey.length > 22 || cleanerKey.length > 16) return null;

  const richerCoverage = computePanelLineWordUnionCoverage(richer);
  const cleanerCoverage = computePanelLineWordUnionCoverage(cleaner);
  const richerArea = Math.max(1, panelLineArea(richer));
  const cleanerArea = Math.max(1, panelLineArea(cleaner));
  const richerHeight = Math.max(1, panelLineHeight(richer));
  const cleanerHeight = Math.max(1, panelLineHeight(cleaner));
  const cleanerLooksLocalized = (
    cleanerCoverage >= Math.max(0.36, richerCoverage + 0.14)
    || (cleanerArea <= richerArea * 0.58 && cleanerCoverage >= Math.max(0.24, richerCoverage))
    || cleanerHeight <= richerHeight * 0.72
  );
  const richerLooksMislocalized = richerCoverage <= 0.36
    || richerArea >= cleanerArea * 1.55
    || richerHeight >= cleanerHeight * 1.7;
  const shortThinkRepair = /^I\s*THINK[.!?…]*$/i.test(richer.text || '')
    && /^THINK[.!?…]*$/i.test(cleaner.text || '')
    && cleanerCoverage >= Math.max(0.2, richerCoverage - 0.08);

  if (!shortThinkRepair && (!cleanerLooksLocalized || !richerLooksMislocalized)) {
    return null;
  }

  const repairedText = /^I\s*THINK[.!?…]*$/i.test(richer.text || '')
    ? String(richer.text || '').replace(/^I\s*THINK/i, 'I THINK')
    : richer.text;

  return {
    ...cleaner,
    text: repairedText,
    confidence: Math.max(Number(cleaner.confidence || 0), Number(richer.confidence || 0)),
    layoutHints: {
      ...(cleaner.layoutHints || {}),
      repairedTextFromDuplicate: repairedText,
    },
  };
};

export const suppressDisplacedPrefixEchoes = (
  items: Array<{ line: OCRLine; index: number }>,
): { items: Array<{ line: OCRLine; index: number }>; dropped: OCRDroppedWord[] } => {
  if (items.length <= 1) return { items, dropped: [] };

  const droppedIndexes = new Set<number>();
  const dropped: OCRDroppedWord[] = [];

  for (let i = 0; i < items.length; i++) {
    const ghostItem = items[i];
    if (droppedIndexes.has(ghostItem.index)) continue;

    const ghostText = normalizePreviewText(String(ghostItem.line.text || ''));
    const ghostKey = normalizePanelDedupTextKey(ghostText);
    if (!ghostKey || ghostKey.length < 8) continue;
    const ghostTokens = ghostText.split(/\s+/g).filter(Boolean).length;
    if (ghostTokens < 2 || ghostTokens > 7) continue;

    const ghostCoverage = computePanelLineWordUnionCoverage(ghostItem.line);
    if (ghostCoverage > 0.44) continue;

    const ghostArea = panelLineArea(ghostItem.line);
    const ghostCenterX = panelLineCenterX(ghostItem.line);
    const ghostCenterY = panelLineCenterY(ghostItem.line);
    const ghostWidth = Math.max(24, panelLineWidth(ghostItem.line));
    const ghostHeight = Math.max(8, panelLineHeight(ghostItem.line));
    const ghostBBox = ghostItem.line.bbox;

    for (let j = 0; j < items.length; j++) {
      if (i === j || droppedIndexes.has(items[j].index)) continue;

      const realItem = items[j];
      const realKey = normalizePanelDedupTextKey(realItem.line.text || '');

      if (!realKey || realKey.length < ghostKey.length + 8) continue;
      if (!realKey.includes(ghostKey)) continue;

      const realCoverage = computePanelLineWordUnionCoverage(realItem.line);
      if (realCoverage < ghostCoverage + 0.1 || realCoverage < 0.28) continue;

      const iou = panelIoURatio(ghostItem.line, realItem.line);
      const overlapX = panelOverlapRatioX(ghostItem.line, realItem.line);
      const overlapY = panelOverlapRatioY(ghostItem.line, realItem.line);
      const realArea = panelLineArea(realItem.line);
      const realCenterX = panelLineCenterX(realItem.line);
      const realCenterY = panelLineCenterY(realItem.line);
      const centerDeltaY = Math.abs(ghostCenterY - realCenterY);
      const centerDeltaX = Math.abs(ghostCenterX - realCenterX);

      const spatiallyDetached = (
        iou <= 0.22
        && (overlapX <= 0.62 || overlapY <= 0.52)
        && centerDeltaY <= Math.max(420, ghostHeight * 22)
        && centerDeltaX <= Math.max(420, ghostWidth * 6.5)
      );

      const wrappingBorder = (
        ghostArea >= realArea * 1.55
        && ghostCoverage <= 0.36
        && realCoverage >= 0.38
        && ghostBBox != null
        && Number(ghostBBox.x0) <= realCenterX
        && Number(ghostBBox.x1) >= realCenterX
        && Number(ghostBBox.y0) <= realCenterY
        && Number(ghostBBox.y1) >= realCenterY
      );

      if (!spatiallyDetached && !wrappingBorder) continue;

      droppedIndexes.add(ghostItem.index);
      dropped.push({
        filter: 'panelSafetyDedup',
        reason: 'displacedPrefixEcho',
        text: ghostText,
        confidence: Number(ghostItem.line.confidence || 0),
        bbox: ghostItem.line.bbox,
      });
      break;
    }
  }

  if (droppedIndexes.size === 0) return { items, dropped: [] };
  return {
    items: items.filter((item) => !droppedIndexes.has(item.index)),
    dropped,
  };
};

export const suppressDisplacedPanelLongPhraseEchoes = (
  items: Array<{ line: OCRLine; index: number }>,
): { items: Array<{ line: OCRLine; index: number }>; dropped: OCRDroppedWord[] } => {
  if (items.length <= 1) {
    return { items, dropped: [] };
  }

  type LineMetric = {
    item: { line: OCRLine; index: number };
    key: string;
    tokenCount: number;
    wordCount: number;
    coverage: number;
    confidence: number;
    area: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
    score: number;
  };

  const grouped = new Map<string, LineMetric[]>();
  items.forEach((item) => {
    const text = normalizePreviewText(String(item.line.text || ''));
    const key = normalizePanelDedupTextKey(text);
    if (!key) return;

    const tokenCount = text.split(/\s+/g).filter(Boolean).length;
    if (key.length < 14 || tokenCount < 3 || tokenCount > 12) return;

    const coverage = computePanelLineWordUnionCoverage(item.line);
    const words = (Array.isArray(item.line.words) ? item.line.words : [])
      .filter((word) => hasPositivePanelBBox(word?.bbox) && normalizePreviewText(String(word?.text || '')).length > 0);
    const wordCount = words.length > 0 ? words.length : tokenCount;
    const confidence = Number(item.line.confidence || 0);
    const area = Math.max(1, panelLineArea(item.line));
    const width = Math.max(1, panelLineWidth(item.line));
    const height = Math.max(1, panelLineHeight(item.line));
    const centerX = panelLineCenterX(item.line);
    const centerY = panelLineCenterY(item.line);
    const score = (coverage * 120) + (wordCount * 9) + (confidence * 0.22) - (Math.log10(area) * 6);

    const metric: LineMetric = {
      item,
      key,
      tokenCount,
      wordCount,
      coverage,
      confidence,
      area,
      width,
      height,
      centerX,
      centerY,
      score,
    };
    const current = grouped.get(key) || [];
    current.push(metric);
    grouped.set(key, current);
  });

  const droppedIndexes = new Set<number>();
  const dropped: OCRDroppedWord[] = [];

  grouped.forEach((metrics) => {
    if (metrics.length <= 1) return;
    const ordered = [...metrics].sort((a, b) => b.score - a.score);
    const anchor = ordered[0];
    if (!anchor) return;

    for (let i = 1; i < ordered.length; i += 1) {
      const candidate = ordered[i];
      if (!candidate || droppedIndexes.has(candidate.item.index)) continue;

      const overlapX = panelOverlapRatioX(anchor.item.line, candidate.item.line);
      const overlapY = panelOverlapRatioY(anchor.item.line, candidate.item.line);
      const minWidth = Math.max(24, Math.min(anchor.width, candidate.width));
      const minHeight = Math.max(8, Math.min(anchor.height, candidate.height));
      const centerDeltaX = Math.abs(anchor.centerX - candidate.centerX);
      const centerDeltaY = Math.abs(anchor.centerY - candidate.centerY);
      const areaRatio = candidate.area / Math.max(1, anchor.area);
      const widthRatio = candidate.width / Math.max(1, anchor.width);
      const heightRatio = candidate.height / Math.max(1, anchor.height);

      const spatiallyDetached = (
        overlapX <= 0.44
        || overlapY <= 0.34
        || centerDeltaX >= Math.max(96, minWidth * 1.2)
        || centerDeltaY >= Math.max(78, minHeight * 1.45)
      );
      const clearlyOversized = areaRatio >= 1.55 || widthRatio >= 1.42 || heightRatio >= 1.55;
      const lowCoverageEcho = candidate.coverage <= Math.max(0.34, anchor.coverage - 0.14);
      const weakerSignal = candidate.wordCount <= anchor.wordCount
        && candidate.confidence <= anchor.confidence + 4;

      if (!(spatiallyDetached && clearlyOversized && lowCoverageEcho && weakerSignal)) {
        continue;
      }

      droppedIndexes.add(candidate.item.index);
      dropped.push({
        filter: 'panelSafetyDedup',
        reason: 'displacedLongPhraseEcho',
        text: normalizePreviewText(String(candidate.item.line.text || '')),
        confidence: Number(candidate.item.line.confidence || 0),
        bbox: candidate.item.line.bbox,
      });
    }
  });

  if (droppedIndexes.size === 0) {
    return { items, dropped: [] };
  }

  return {
    items: items.filter((item) => !droppedIndexes.has(item.index)),
    dropped,
  };
};

export const applyPanelSafetyLineDedup = (result: OCRPageResult): OCRPageResult => {
  const inputLines = Array.isArray(result.lines) ? result.lines : [];
  if ((result.pipelineProfile || 'panel') !== 'panel') {
    return result;
  }
  // ขยายให้รองรับทุก OCR Engine (ไม่จำกัดแค่ PaddleOCR)
  // Engine อื่น เช่น EasyOCR หรือ Google Vision ก็อาจสร้างคำซ้ำซ้อนได้เช่นกัน
  const activeEngine = result.ocrEngine || 'paddleocr';
  const isPaddleOcr = activeEngine === 'paddleocr';
  // สำหรับ Engine ที่ไม่ใช่ PaddleOCR จะยังคงรัน dedup แต่ข้ามขั้นตอน ghost artifact ที่ specific กับ Paddle
  void isPaddleOcr; // ใช้ variable นี้ไว้สำหรับ future feature gating


  const markPanelSafetyNormalized = (value: OCRPageResult): OCRPageResult => {
    const debug = value.debug || { droppedWords: [], dropCounts: {} };
    return {
      ...value,
      debug: {
        ...debug,
        droppedWords: debug.droppedWords || [],
        dropCounts: debug.dropCounts || {},
        panelSafetyNormalizedVersion: OCR_ALGORITHM_VERSION,
      },
    };
  };

  const dropped: OCRDroppedWord[] = [];
  let normalizedTextChanges = 0;
  let normalizedGeometryChanges = 0;
  const pageWidth = Math.max(1, Number(result.width || 0));
  const pageHeight = Math.max(1, Number(result.height || 0));
  const documentLikePage = isLikelyDocumentLikePanelPage(result);
  const latinDominantPage = isLikelyLatinDominantPanelPage(result);
  const preparedLines = inputLines
    .map((line, index) => {
      const rawBBox = normalizePanelBBox(line.bbox);
      const resolvedBBox = resolvePanelLineBBoxForSafety(line);
      const bboxChanged = !isSamePanelBBox(rawBBox, resolvedBBox);
      const lineWithResolvedGeometry = bboxChanged && resolvedBBox
        ? {
          ...line,
          bbox: resolvedBBox,
        }
        : line;

      if (bboxChanged) {
        normalizedGeometryChanges += 1;
      }

      const resolvedText = resolvePanelLineTextForSafety(lineWithResolvedGeometry);
      if (!resolvedText) {
        dropped.push({
          filter: 'panelSafetyDedup',
          reason: 'ghostEmptyLine',
          text: normalizePreviewText(String(line.text || '')),
          confidence: Number(line.confidence || 0),
          bbox: lineWithResolvedGeometry.bbox,
        });
        return null;
      }

      const normalizedLineBBox = normalizePanelBBox(lineWithResolvedGeometry.bbox);
      if (!normalizedLineBBox) {
        dropped.push({
          filter: 'panelSafetyDedup',
          reason: 'invalidLineBBox',
          text: normalizePreviewText(String(resolvedText || line.text || '')),
          confidence: Number(line.confidence || 0),
          bbox: lineWithResolvedGeometry.bbox,
        });
        return null;
      }

      const validWordCount = (Array.isArray(lineWithResolvedGeometry.words) ? lineWithResolvedGeometry.words : [])
        .filter((word) => hasPositivePanelBBox(word?.bbox) && normalizePreviewText(String(word?.text || '')).length > 0)
        .length;
      const compactResolvedText = resolvedText.replace(/\s+/g, '');
      const bboxWidth = Math.max(1, normalizedLineBBox.x1 - normalizedLineBBox.x0);
      const bboxHeight = Math.max(1, normalizedLineBBox.y1 - normalizedLineBBox.y0);
      const bboxArea = Math.max(1, bboxWidth * bboxHeight);
      const asciiCompactResolved = compactResolvedText.replace(/[^A-Za-z0-9]/g, '');
      const isKnown = isKnownShortWordHelper(asciiCompactResolved);
      const isEnglishDialogue = isLikelyEnglishDialogue(resolvedText);
      
      const tinyNoWordLatinArtifact = !documentLikePage
        && !isEnglishDialogue
        && validWordCount === 0
        && /[A-Za-z0-9]/.test(compactResolvedText)
        && compactResolvedText.length <= 6
        && bboxWidth <= 96
        && bboxHeight <= 44
        && bboxArea <= 3000
        && Number(lineWithResolvedGeometry.confidence || 0) <= 94
        && !isKnown;
      if (tinyNoWordLatinArtifact) {
        dropped.push({
          filter: 'panelSafetyDedup',
          reason: 'ghostTinyNoWordLine',
          text: normalizePreviewText(String(resolvedText || line.text || '')),
          confidence: Number(line.confidence || 0),
          bbox: normalizedLineBBox,
        });
        return null;
      }

      const wordCoverage = computePanelLineWordUnionCoverage(lineWithResolvedGeometry);
      const hugeSparseBorderMismatch = !documentLikePage
        && !isEnglishDialogue
        && compactResolvedText.length <= 12
        && validWordCount <= 1
        && bboxArea >= Math.max(15000, pageWidth * pageHeight * 0.012)
        && wordCoverage <= 0.12
        && Number(lineWithResolvedGeometry.confidence || 0) <= 95;
      if (hugeSparseBorderMismatch) {
        dropped.push({
          filter: 'panelSafetyDedup',
          reason: 'ghostBorderMismatchLine',
          text: normalizePreviewText(String(resolvedText || line.text || '')),
          confidence: Number(line.confidence || 0),
          bbox: normalizedLineBBox,
        });
        return null;
      }

      const dpi = Number(result.dpi || 300);

      const technicalDocumentLine = isLikelyTechnicalDocumentLineForSafety(resolvedText);
      if (documentLikePage && !technicalDocumentLine && !isEnglishDialogue && isLikelyPanelGhostLineForSafety(lineWithResolvedGeometry, resolvedText, pageWidth, dpi)) {
        dropped.push({
          filter: 'panelSafetyDedup',
          reason: 'ghostLowSignalLine',
          text: normalizePreviewText(String(resolvedText || line.text || '')),
          confidence: Number(line.confidence || 0),
          bbox: lineWithResolvedGeometry.bbox,
        });
        return null;
      }

      if (!documentLikePage && !isEnglishDialogue && isLikelyLargeBorderEffectLineForSafety(lineWithResolvedGeometry, resolvedText, pageWidth, pageHeight, dpi)) {
        dropped.push({
          filter: 'panelSafetyDedup',
          reason: 'ghostLargeBorderEffectLine',
          text: normalizePreviewText(String(resolvedText || line.text || '')),
          confidence: Number(line.confidence || 0),
          bbox: lineWithResolvedGeometry.bbox,
        });
        return null;
      }

      if (!documentLikePage && !isEnglishDialogue && isLikelyTinyMangaArtifactLineForSafety(lineWithResolvedGeometry, resolvedText, pageWidth, pageHeight, latinDominantPage, dpi)) {
        dropped.push({
          filter: 'panelSafetyDedup',
          reason: 'ghostTinyArtifactLine',
          text: normalizePreviewText(String(resolvedText || line.text || '')),
          confidence: Number(line.confidence || 0),
          bbox: lineWithResolvedGeometry.bbox,
        });
        return null;
      }

      if (resolvedText !== normalizePreviewText(String(line.text || ''))) {
        normalizedTextChanges += 1;
      }

      const normalizedLine = resolvedText === line.text && !bboxChanged
        ? lineWithResolvedGeometry
        : {
          ...lineWithResolvedGeometry,
          text: resolvedText,
        };

      return { line: normalizedLine, index };
    })
    .filter((item): item is { line: OCRLine; index: number } => Boolean(item));

  if (preparedLines.length === 0) {
    return {
      ...result,
      lines: [],
      words: [],
      text: '',
      debug: {
        ...(result.debug || {}),
        dropCounts: {
          ...(result.debug?.dropCounts || {}),
          panelSafetyDuplicate: ((result.debug?.dropCounts?.panelSafetyDuplicate || 0) + dropped.length),
        },
        droppedWords: [
          ...(result.debug?.droppedWords || []),
          ...dropped,
        ],
      },
    };
  }

  const echoTextRepairs = new Map<number, { text: string; confidence: number }>();
  const watermarkFilteredLines = preparedLines.filter((item) => {
    const key = normalizePanelDedupTextKey(item.line.text || '');
    const echoTarget = findTopWatermarkDialogueEchoTarget(item.line, key, preparedLines, pageWidth, pageHeight);
    if (!echoTarget) {
      return true;
    }
    const targetKey = normalizePanelDedupTextKey(echoTarget.line.text || '');
    if (key.length > targetKey.length) {
      const existingRepair = echoTextRepairs.get(echoTarget.index);
      if (!existingRepair || key.length > normalizePanelDedupTextKey(existingRepair.text).length) {
        const repairedEchoText = /^I\s*THINK[.!?…]*$/i.test(item.line.text || '')
          ? String(item.line.text || '').replace(/^I\s*THINK/i, 'I THINK')
          : normalizePreviewText(String(item.line.text || ''));
        echoTextRepairs.set(echoTarget.index, {
          text: repairedEchoText,
          confidence: Number(item.line.confidence || 0),
        });
      }
    }
    dropped.push({
      filter: 'panelSafetyDedup',
      reason: 'ghostTopWatermarkDialogueEcho',
      text: normalizePreviewText(String(item.line.text || '')),
      confidence: Number(item.line.confidence || 0),
      bbox: item.line.bbox,
    });
    return false;
  });

  const repairedWatermarkFilteredLines = watermarkFilteredLines.map((item) => {
    const repair = echoTextRepairs.get(item.index);
    if (!repair) return item;
    const currentKey = normalizePanelDedupTextKey(item.line.text || '');
    const repairKey = normalizePanelDedupTextKey(repair.text);
    if (!repairKey || repairKey.length <= currentKey.length) return item;
    normalizedTextChanges += 1;
    return {
      ...item,
      line: {
        ...item.line,
        text: repair.text,
        confidence: Math.max(Number(item.line.confidence || 0), repair.confidence),
        layoutHints: {
          ...(item.line.layoutHints || {}),
          repairedTextFromDialogueEcho: repair.text,
        },
      },
    };
  });

  const displacedEchoPrune = suppressDisplacedPanelLongPhraseEchoes(repairedWatermarkFilteredLines);
  if (displacedEchoPrune.dropped.length > 0) {
    dropped.push(...displacedEchoPrune.dropped);
  }

  const prefixEchoPrune = suppressDisplacedPrefixEchoes(displacedEchoPrune.items);
  if (prefixEchoPrune.dropped.length > 0) {
    dropped.push(...prefixEchoPrune.dropped);
  }
  const dedupInputLines = prefixEchoPrune.items;

  const orderedLines = dedupInputLines
    .sort((a, b) => {
      const ay = Number(a.line.bbox?.y0 || 0);
      const by = Number(b.line.bbox?.y0 || 0);
      if (ay !== by) return ay - by;
      const ax = Number(a.line.bbox?.x0 || 0);
      const bx = Number(b.line.bbox?.x0 || 0);
      if (ax !== bx) return ax - bx;
      return a.index - b.index;
    });

  const kept: OCRLine[] = [];
  const keptKeys: string[] = [];

  const lineScore = (line: OCRLine): number => {
    const confidence = Number(line.confidence || 0);
    const textLength = String(line.text || '').trim().length;
    const coverage = computePanelLineWordUnionCoverage(line);
    return (confidence * 2.2) + textLength + (Math.log10(panelLineArea(line)) * 2.8) + (coverage * 28);
  };

  for (const item of orderedLines) {
    const candidateLine = item.line;
    const candidateKey = normalizePanelDedupTextKey(candidateLine.text || '');
    if (!candidateKey) {
      kept.push(candidateLine);
      keptKeys.push('');
      continue;
    }

    const existingIndex = kept.findIndex((existingLine, index) =>
      shouldCollapsePanelSafetyDuplicate(existingLine, keptKeys[index], candidateLine, candidateKey)
    );
    if (existingIndex < 0) {
      kept.push(candidateLine);
      keptKeys.push(candidateKey);
      continue;
    }

    const existingLine = kept[existingIndex];
    const existingKey = keptKeys[existingIndex];
    const repairedLine = mergePanelRicherTextWithCleanerDuplicateGeometry(
      existingLine,
      existingKey,
      candidateLine,
      candidateKey,
    );
    if (repairedLine) {
      const loserLine = candidateKey.length > existingKey.length ? candidateLine : existingLine;
      dropped.push({
        filter: 'panelSafetyDedup',
        reason: 'samePositionDuplicateLineTextGeometryRepair',
        text: String(loserLine.text || '').trim(),
        confidence: Number(loserLine.confidence || 0),
        bbox: loserLine.bbox,
      });
      kept[existingIndex] = repairedLine;
      keptKeys[existingIndex] = normalizePanelDedupTextKey(repairedLine.text || '');
      continue;
    }

    const keepCandidate = lineScore(candidateLine) > lineScore(existingLine);
    const loserLine = keepCandidate ? existingLine : candidateLine;
    dropped.push({
      filter: 'panelSafetyDedup',
      reason: 'samePositionDuplicateLine',
      text: String(loserLine.text || '').trim(),
      confidence: Number(loserLine.confidence || 0),
      bbox: loserLine.bbox,
    });

    if (keepCandidate) {
      kept[existingIndex] = candidateLine;
      keptKeys[existingIndex] = candidateKey;
    }
  }

  if (dropped.length === 0 && normalizedTextChanges === 0 && normalizedGeometryChanges === 0 && preparedLines.length === inputLines.length) {
    return markPanelSafetyNormalized(result);
  }

  const originalOrder = new Map<OCRLine, number>();
  dedupInputLines.forEach(({ line, index }) => {
    originalOrder.set(line, index);
  });

  const dedupedLines = kept.sort((a, b) => {
    const ay = Number(a.bbox?.y0 || 0);
    const by = Number(b.bbox?.y0 || 0);
    const minHeight = Math.max(8, Math.min(panelLineHeight(a), panelLineHeight(b)));
    if (Math.abs(ay - by) > minHeight * 0.55) return ay - by;

    const overlapX = panelOverlapRatioX(a, b);
    const minWidth = Math.max(24, Math.min(panelLineWidth(a), panelLineWidth(b)));
    const centerDeltaX = Math.abs(panelLineCenterX(a) - panelLineCenterX(b));
    const sameColumnLike = overlapX >= 0.64 || centerDeltaX <= minWidth * 0.45;
    if (sameColumnLike && ay !== by) {
      return ay - by;
    }

    const orderDelta = (originalOrder.get(a) || 0) - (originalOrder.get(b) || 0);
    if (orderDelta !== 0) return orderDelta;
    const ax = Number(a.bbox?.x0 || 0);
    const bx = Number(b.bbox?.x0 || 0);
    if (ax !== bx) return ax - bx;
    return 0;
  });

  const dedupedWords = dedupedLines.flatMap((line) => line.words || []);
  const confidenceSource = dedupedWords.length > 0
    ? dedupedWords.map((word) => Number(word.confidence || 0))
    : dedupedLines.map((line) => Number(line.confidence || 0));
  const dedupedConfidence = confidenceSource.length > 0
    ? (confidenceSource.reduce((sum, value) => sum + value, 0) / confidenceSource.length)
    : Number(result.confidence || 0);

  const dropCounts = {
    ...(result.debug?.dropCounts || {}),
    panelSafetyDuplicate: ((result.debug?.dropCounts?.panelSafetyDuplicate || 0) + dropped.length),
  };
  const droppedWords = [
    ...(result.debug?.droppedWords || []),
    ...dropped,
  ];

  return markPanelSafetyNormalized({
    ...result,
    lines: dedupedLines,
    words: dedupedWords,
    text: dedupedLines.map((line) => String(line.text || '')).filter(Boolean).join('\n').trim(),
    confidence: dedupedConfidence,
    debug: {
      ...(result.debug || {}),
      dropCounts,
      droppedWords,
    },
  });
};

export const collectResidualRepeatedPanelKeys = (lines: OCRLine[]): Array<{ key: string; count: number; samples: string[] }> => {
  const grouped = new Map<string, OCRLine[]>();
  for (const line of lines) {
    const key = normalizePanelDedupTextKey(line.text || '');
    if (!key) continue;
    const current = grouped.get(key) || [];
    current.push(line);
    grouped.set(key, current);
  }
  const suspicious = Array.from(grouped.entries())
    .map(([key, keyLines]) => {
      if (keyLines.length <= 1) {
        return null;
      }

      const ordered = [...keyLines].sort((a, b) => {
        if (a.bbox.y0 !== b.bbox.y0) return a.bbox.y0 - b.bbox.y0;
        if (a.bbox.x0 !== b.bbox.x0) return a.bbox.x0 - b.bbox.x0;
        return 0;
      });
      const involved = new Set<number>();

      for (let i = 0; i < ordered.length; i += 1) {
        for (let j = i + 1; j < ordered.length; j += 1) {
          const a = ordered[i];
          const b = ordered[j];
          const minHeight = Math.max(8, Math.min(panelLineHeight(a), panelLineHeight(b)));
          const minWidth = Math.max(24, Math.min(panelLineWidth(a), panelLineWidth(b)));
          const centerDeltaY = Math.abs(panelLineCenterY(a) - panelLineCenterY(b));
          const centerDeltaX = Math.abs(panelLineCenterX(a) - panelLineCenterX(b));
          if (centerDeltaY > Math.max(110, minHeight * 2.8)) {
            break;
          }
          if (centerDeltaX > Math.max(120, minWidth * 2.2)) {
            continue;
          }

          const overlapX = panelOverlapRatioX(a, b);
          const overlapY = panelOverlapRatioY(a, b);
          const iou = panelIoURatio(a, b);
          const likelyResidualDuplicate = (
            iou >= 0.3
            || (overlapY >= 0.42 && overlapX >= 0.52)
            || (overlapX >= 0.6 && centerDeltaY <= minHeight * 1.8)
          );
          if (!likelyResidualDuplicate) {
            continue;
          }

          involved.add(i);
          involved.add(j);
        }
      }

      if (involved.size <= 1) {
        return null;
      }

      const samples = Array.from(involved)
        .slice(0, 3)
        .map((index) => {
          const line = ordered[index];
          const bbox = line.bbox;
          return `${String(line.text || '').trim()} @ (${Math.round(Number(bbox?.x0 || 0))},${Math.round(Number(bbox?.y0 || 0))})-(${Math.round(Number(bbox?.x1 || 0))},${Math.round(Number(bbox?.y1 || 0))})`;
        });

      return {
        key,
        count: involved.size,
        samples,
      };
    })
    .filter((item): item is { key: string; count: number; samples: string[] } => Boolean(item));

  return suspicious
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((item) => ({ key: item.key, count: item.count, samples: item.samples }));
};
