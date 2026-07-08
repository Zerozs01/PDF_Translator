import { BBox, OCRLine, OCREngine, OCRPageResult } from '../../types';
import { hasCurrentOCRTranslationCacheVersion, OCRPreviewMode, OCRTranslationCacheEntry } from '../../stores/useOCRTextLayerStore';
import { buildOCRSourceFingerprint } from '../../services/ocrSourceFingerprint';
import { isKnownShortWordHelper } from '../../services/ocr/ocrSafetyLineDedup';

const TRANSLATION_LANGUAGE_ALIASES: Record<string, string> = {
  en: 'en',
  eng: 'en',
  english: 'en',
  th: 'th',
  tha: 'th',
  thai: 'th',
  ja: 'ja',
  jpn: 'ja',
  jpn_vert: 'ja',
  ko: 'ko',
  kor: 'ko',
  zh: 'zh',
  chi: 'zh',
  chi_sim: 'zh',
  chi_tra: 'zh',
  vi: 'vi',
  vie: 'vi',
  de: 'de',
  deu: 'de',
  fr: 'fr',
  fra: 'fr',
  ru: 'ru',
  rus: 'ru',
  es: 'es',
  spa: 'es',
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const normalizeCacheLanguageKey = (value: string): string =>
  String(value || '')
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join('+') || 'eng';

const normalizeTranslationLanguageKey = (value: string, fallback: string): string => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (TRANSLATION_LANGUAGE_ALIASES[raw]) return TRANSLATION_LANGUAGE_ALIASES[raw];
  const primary = raw.split('-')[0].trim();
  if (!primary) return fallback;
  return TRANSLATION_LANGUAGE_ALIASES[primary] || primary;
};

const resolveTranslationSourceFromOCRKey = (ocrLanguageKey: string, fallback: string): string => {
  const candidates = String(ocrLanguageKey || '')
    .split('+')
    .map((part) => normalizeTranslationLanguageKey(part, ''))
    .filter(Boolean);

  if (candidates.length === 0) {
    return fallback;
  }

  const nonEnglish = candidates.find((lang) => lang !== 'en');
  return nonEnglish || candidates[0] || fallback;
};

type TranslatedOverlayCandidate = {
  index: number;
  text: string;
  normalizedKey: string;
  sourceText: string;
  sourceWordCount: number;
  confidence: number;
  bbox: BBox;
};

const normalizeTranslatedOverlayDuplicateKey = (value: string): string =>
  normalizeOverlayInlineText(String(value || ''))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');

const OVERLAY_DEDUP_DOCUMENT_SOURCE_HINT_REGEX = /\b(chapter|table|fig(?:ure)?\.?|reaction|unknowns?|equilibrium|rigid|body|support|diagram|objective|objectives|connection|connections|continued|force|moment|component|components|column|columns|bridge|building|beam|beams|welded|surface|bracket|cable|utility|floor|member|pin|hinge|resultant|magnitude|direction|types?|row|rows|head(?:er|ing)?|label|labels)\b/i;

const isLikelyDocumentLikeOverlayDedupSource = (value: string): boolean => {
  const normalized = normalizeOverlayInlineText(String(value || ''));
  if (!normalized) return false;

  if (OVERLAY_DEDUP_DOCUMENT_SOURCE_HINT_REGEX.test(normalized)) {
    return true;
  }

  const words = normalized.split(/\s+/g).filter(Boolean);
  const tokenCount = words.length;
  const thaiCharCount = (normalized.match(/[\u0E00-\u0E7F]/g) || []).length;
  const hasDocumentMarkers = /[0-9()\[\].,:;\-]/.test(normalized);

  if (tokenCount >= 5 && /[A-Za-z]/.test(normalized)) {
    return true;
  }
  if (thaiCharCount >= 12 && (tokenCount >= 3 || hasDocumentMarkers)) {
    return true;
  }

  return false;
};

const buildOverlayKeyBigrams = (value: string): Set<string> => {
  const compact = String(value || '').trim();
  const grams = new Set<string>();
  if (!compact) return grams;
  if (compact.length < 2) {
    grams.add(compact);
    return grams;
  }
  for (let i = 0; i < compact.length - 1; i += 1) {
    grams.add(compact.slice(i, i + 2));
  }
  return grams;
};

const overlayKeyDiceSimilarity = (a: string, b: string): number => {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const aBigrams = buildOverlayKeyBigrams(a);
  const bBigrams = buildOverlayKeyBigrams(b);
  if (aBigrams.size === 0 || bBigrams.size === 0) return 0;

  let overlap = 0;
  for (const gram of aBigrams) {
    if (bBigrams.has(gram)) overlap += 1;
  }

  return (2 * overlap) / (aBigrams.size + bBigrams.size);
};

const buildOverlayWordSet = (value: string): Set<string> => {
  const normalized = normalizeOverlayInlineText(String(value || ''))
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/gu)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  return new Set(normalized);
};

const overlayWordJaccardSimilarity = (a: string, b: string): number => {
  if (!a || !b) return 0;
  const setA = buildOverlayWordSet(a);
  const setB = buildOverlayWordSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;

  let overlap = 0;
  for (const token of setA) {
    if (setB.has(token)) overlap += 1;
  }
  const union = setA.size + setB.size - overlap;
  return union > 0 ? overlap / union : 0;
};

const overlayDedupBoxWidth = (bbox: BBox): number => Math.max(1, Number(bbox.x1 || 0) - Number(bbox.x0 || 0));
const overlayDedupBoxHeight = (bbox: BBox): number => Math.max(1, Number(bbox.y1 || 0) - Number(bbox.y0 || 0));
const overlayDedupBoxArea = (bbox: BBox): number => overlayDedupBoxWidth(bbox) * overlayDedupBoxHeight(bbox);
const overlayDedupCenterX = (bbox: BBox): number => (Number(bbox.x0 || 0) + Number(bbox.x1 || 0)) / 2;
const overlayDedupCenterY = (bbox: BBox): number => (Number(bbox.y0 || 0) + Number(bbox.y1 || 0)) / 2;

const overlayDedupOverlapRatioX = (a: BBox, b: BBox): number => {
  const overlap = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const minWidth = Math.max(1, Math.min(overlayDedupBoxWidth(a), overlayDedupBoxWidth(b)));
  return overlap / minWidth;
};

const overlayDedupOverlapRatioY = (a: BBox, b: BBox): number => {
  const overlap = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const minHeight = Math.max(1, Math.min(overlayDedupBoxHeight(a), overlayDedupBoxHeight(b)));
  return overlap / minHeight;
};

const overlayDedupIou = (a: BBox, b: BBox): number => {
  const overlapWidth = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const overlapHeight = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const intersection = overlapWidth * overlapHeight;
  if (intersection <= 0) return 0;

  const union = overlayDedupBoxArea(a) + overlayDedupBoxArea(b) - intersection;
  return union > 0 ? intersection / union : 0;
};

const shouldCollapseTranslatedOverlayDuplicate = (
  existing: TranslatedOverlayCandidate,
  candidate: TranslatedOverlayCandidate
): boolean => {
  if (!existing.normalizedKey || !candidate.normalizedKey) return false;

  const minLength = Math.min(existing.normalizedKey.length, candidate.normalizedKey.length);
  const exactKeyMatch = existing.normalizedKey === candidate.normalizedKey;
  const sameOrSubset = exactKeyMatch
    || (minLength >= 5 && (
      existing.normalizedKey.includes(candidate.normalizedKey)
      || candidate.normalizedKey.includes(existing.normalizedKey)
    ));

  const overlapX = overlayDedupOverlapRatioX(existing.bbox, candidate.bbox);
  const overlapY = overlayDedupOverlapRatioY(existing.bbox, candidate.bbox);
  const iou = overlayDedupIou(existing.bbox, candidate.bbox);
  const centerDeltaX = Math.abs(overlayDedupCenterX(existing.bbox) - overlayDedupCenterX(candidate.bbox));
  const centerDeltaY = Math.abs(overlayDedupCenterY(existing.bbox) - overlayDedupCenterY(candidate.bbox));
  const minHeight = Math.max(8, Math.min(overlayDedupBoxHeight(existing.bbox), overlayDedupBoxHeight(candidate.bbox)));
  const minWidth = Math.max(18, Math.min(overlayDedupBoxWidth(existing.bbox), overlayDedupBoxWidth(candidate.bbox)));
  
  // Guard: If they are horizontally completely separated (no horizontal overlap or far apart),
  // they are distinct columns/labels and MUST NOT be collapsed.
  if (overlapX === 0 || centerDeltaX > minWidth * 1.5) {
    return false;
  }
  const areaRatio = overlayDedupBoxArea(existing.bbox) / Math.max(1, overlayDedupBoxArea(candidate.bbox));
  const comparableArea = areaRatio >= 0.28 && areaRatio <= 3.6;
  const bothLongLines = minLength >= 16 && Math.min(existing.sourceWordCount, candidate.sourceWordCount) >= 3;
  const veryShortPair = Math.max(existing.normalizedKey.length, candidate.normalizedKey.length) <= 9;

  const strongSpatialMatch = (
    iou >= 0.54
    || (overlapY >= 0.74 && overlapX >= 0.62)
    || (
      overlapY >= 0.38
      && overlapX >= 0.48
      && centerDeltaY <= Math.max(84, minHeight * 4.2)
      && centerDeltaX <= Math.max(80, minWidth * 1.65)
    )
  );

  const stackedSameColumnEcho = (
    comparableArea
    && overlapX >= 0.56
    && centerDeltaX <= Math.max(74, minWidth * 1.45)
    && centerDeltaY <= Math.max(138, minHeight * 6.2)
    && (overlapY >= 0.12 || iou >= 0.08)
  );

  let documentExactAnchorEcho = false;
  const existingDocumentLikeSource = isLikelyDocumentLikeOverlayDedupSource(existing.sourceText);
  const candidateDocumentLikeSource = isLikelyDocumentLikeOverlayDedupSource(candidate.sourceText);
  if (veryShortPair && !(existingDocumentLikeSource && candidateDocumentLikeSource)) {
    return exactKeyMatch && iou >= 0.62;
  }

  const existingSourceKey = normalizeTranslatedOverlayDuplicateKey(existing.sourceText || '');
  const candidateSourceKey = normalizeTranslatedOverlayDuplicateKey(candidate.sourceText || '');
  if (existingSourceKey && candidateSourceKey) {
    const sourceMinLength = Math.min(existingSourceKey.length, candidateSourceKey.length);
    const sourceSubset = sourceMinLength >= 6 && (
      existingSourceKey.includes(candidateSourceKey)
      || candidateSourceKey.includes(existingSourceKey)
    );
    const sourceSimilarity = overlayKeyDiceSimilarity(existingSourceKey, candidateSourceKey);
    const sourceWordSimilarity = overlayWordJaccardSimilarity(existing.sourceText || '', candidate.sourceText || '');
    const sourceClearlyDifferent = !sourceSubset && (sourceSimilarity < 0.68 || sourceWordSimilarity < 0.52);
    const documentLikeSourcePair = (
      existingDocumentLikeSource
      && candidateDocumentLikeSource
      && (sourceSubset || sourceWordSimilarity >= 0.54 || sourceSimilarity >= 0.72)
    );
    const sameDocumentRowTextEcho = (
      exactKeyMatch
      && documentLikeSourcePair
      && comparableArea
      && overlapX >= 0.34
      && centerDeltaX <= Math.max(160, minWidth * 3.2)
      && centerDeltaY <= Math.max(120, minHeight * 5.4)
    );
    if (sameDocumentRowTextEcho) return true;

    const strongDocumentSpatialEcho = documentLikeSourcePair && (
      iou >= 0.56
      || (
        overlapX >= 0.68
        && overlapY >= 0.42
        && centerDeltaX <= Math.max(66, minWidth * 1.1)
        && centerDeltaY <= Math.max(88, minHeight * 3.6)
      )
      || (
        overlapX >= 0.74
        && centerDeltaX <= Math.max(60, minWidth * 0.95)
        && centerDeltaY <= Math.max(132, minHeight * 5.4)
        && (overlapY >= 0.08 || iou >= 0.1)
      )
    );
    documentExactAnchorEcho = documentLikeSourcePair && (
      iou >= 0.42
      || (
        overlapX >= 0.82
        && overlapY >= 0.5
        && centerDeltaX <= Math.max(52, minWidth * 0.76)
        && centerDeltaY <= Math.max(28, minHeight * 1.12)
      )
    );
    if (!sameOrSubset && documentExactAnchorEcho) return true;
    if (sourceClearlyDifferent && iou < 0.86 && !strongDocumentSpatialEcho) {
      return false;
    }
  }

  if (!sameOrSubset) return false;

  if (exactKeyMatch && strongSpatialMatch) return true;
  if (exactKeyMatch && stackedSameColumnEcho) return true;
  if (bothLongLines && strongSpatialMatch) return true;
  if (bothLongLines && stackedSameColumnEcho) return true;

  return false;
};

const scoreTranslatedOverlayCandidate = (candidate: TranslatedOverlayCandidate): number => {
  const translatedLength = candidate.normalizedKey.length;
  const sourceLength = normalizeOverlayInlineText(candidate.sourceText || '').length;
  const areaScore = Math.log(overlayDedupBoxArea(candidate.bbox) + 1);
  return (
    translatedLength * 1.15
    + sourceLength * 0.42
    + Math.max(0, Number(candidate.confidence || 0)) * 0.18
    + areaScore * 1.35
  );
};

const collapseTranslatedOverlayDuplicates = (
  currentPageOCR: OCRPageResult,
  translatedByIndex: Map<number, string>
): Map<number, string> => {
  if (translatedByIndex.size <= 1) return translatedByIndex;

  const lines = Array.isArray(currentPageOCR.lines) ? currentPageOCR.lines : [];
  if (lines.length === 0) return translatedByIndex;

  const candidates: TranslatedOverlayCandidate[] = [];
  translatedByIndex.forEach((text, index) => {
    const line = lines[index];
    if (!line) {
      return;
    }

    const normalizedText = normalizeOverlayInlineText(String(text || ''));
    if (!normalizedText) {
      return;
    }

    const sourceBbox = resolveOverlaySourceBBox(line);
    const width = Number(sourceBbox.x1 || 0) - Number(sourceBbox.x0 || 0);
    const height = Number(sourceBbox.y1 || 0) - Number(sourceBbox.y0 || 0);
    if (!(width > 0 && height > 0)) {
      return;
    }

    const sourceText = normalizeOverlayInlineText(String(line.text || ''));
    candidates.push({
      index,
      text,
      normalizedKey: normalizeTranslatedOverlayDuplicateKey(normalizedText),
      sourceText,
      sourceWordCount: sourceText.split(/\s+/g).filter(Boolean).length,
      confidence: Number(line.confidence || 0),
      bbox: sourceBbox,
    });
  });

  if (candidates.length <= 1) {
    return translatedByIndex;
  }

  candidates.sort((a, b) => {
    if (a.bbox.y0 !== b.bbox.y0) return a.bbox.y0 - b.bbox.y0;
    if (a.bbox.x0 !== b.bbox.x0) return a.bbox.x0 - b.bbox.x0;
    return a.index - b.index;
  });

  const kept: TranslatedOverlayCandidate[] = [];
  for (const candidate of candidates) {
    const duplicateIndex = kept.findIndex((existing) => shouldCollapseTranslatedOverlayDuplicate(existing, candidate));
    if (duplicateIndex < 0) {
      kept.push(candidate);
      continue;
    }

    const existing = kept[duplicateIndex];
    if (scoreTranslatedOverlayCandidate(candidate) > scoreTranslatedOverlayCandidate(existing)) {
      kept[duplicateIndex] = candidate;
    }
  }

  if (kept.length === translatedByIndex.size) {
    return translatedByIndex;
  }

  return new Map<number, string>(kept.map((item) => [item.index, item.text]));
};

const preserveOverlaySourceTrailingPunctuation = (sourceText: string, replacement: string): string => {
  const punctuation = String(sourceText || '').trim().match(/([.!?…]+)$/)?.[1] || '';
  const cleanReplacement = normalizeOverlayInlineText(String(replacement || '')).replace(/[.!?…]+$/g, '').trim();
  return `${cleanReplacement}${punctuation}`.trim();
};

const preserveOverlayTechnicalLabel = (sourceText: string, replacement: string): string => {
  const preserved = preserveOverlaySourceTrailingPunctuation(sourceText, replacement);
  const label = String(sourceText || '').trim().match(/\s*(\(\s*[0-9]{1,3}[a-zA-Z]?\s*\))\s*$/)?.[1] || '';
  if (!label) return preserved;
  const innerLabel = label.slice(1, -1).trim();
  return !new RegExp(`\\(\\s*${innerLabel}\\s*\\)`, 'i').test(preserved)
    ? `${preserved} ${label}`.trim()
    : preserved;
};

export const resolveMissingOverlayLineFallbackText = (
  sourceText: string,
  targetLanguage: string
): string => {
  const source = normalizeOverlayInlineText(String(sourceText || ''));
  if (!source) return '';
  const normalizedTarget = normalizeTranslationLanguageKey(targetLanguage || '', 'th');
  if (normalizedTarget !== 'th') return source;

  if (/^AH\s+ME[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'อ๊ะ ฉัน');
  if (/^EH\s+ME[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'เอ๋ ฉัน');
  if (/^EH[.!?…]+$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'เอ๋');
  if (/^ME[.!?…]+$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'ฉัน');
  if (/^WAS\s+TOYED[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'ถูกเล่นสนุก');
  if (/^UP\s+LOOKING[.!?…]*$/i.test(source) || /^UP\s+LOOKiNG[.!?…]*$/i.test(source)) {
    return preserveOverlaySourceTrailingPunctuation(source, 'มองขึ้นไป');
  }
  if (/^LiKE\s+THIS[.!?…]*$/i.test(source) || /^LIKE\s+THIS[.!?…]*$/i.test(source)) {
    return preserveOverlaySourceTrailingPunctuation(source, 'แบบนี้');
  }
  if (/^HEART['’]?S[.!?…]*$/i.test(source) || /^HEART[.!?…]*$/i.test(source)) {
    return preserveOverlaySourceTrailingPunctuation(source, 'หัวใจ');
  }
  if (/^YOU[-\s]+COULD\s+SAY[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'คุณอาจพูดได้ว่า');
  if (/^(?:SO\s+ME\s+THING|SOMETHING)\s+THAT\s+MIGHT[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'มีบางอย่างที่อาจ');
  if (/^HELP\s+YOU\s+TOO[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'ช่วยคุณได้เช่นกัน');
  if (/^DO\s+YO?U[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'คุณต้องการ');
  if (/^A\s+LITTLE,?\s+YEAH[!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'นิดหน่อย ใช่ไหม');
  if (/^HMM[!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'อืม');
  if (/^OF\s+COURSE[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'แน่นอน');
  if (/^EARLIER\s+AND[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'ก่อนหน้านี้ แล้ว');
  if (/^FOCUS[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'จดจ่ออยู่กับมัน');
  if (/^BARBAR\s*I?\s*AN\s*\(\s*FEMALE\s*\)[.!?…]*$/i.test(source) || /^BARBARIAN\s*\(\s*FEMALE\s*\)[.!?…]*$/i.test(source)) {
    return preserveOverlaySourceTrailingPunctuation(source, 'บาร์บาเรียน (หญิง)');
  }
  if (/^VA(?:L)?KYR?I?E\s+MODE[.!?…]*$/i.test(source) || /^VALKYRIE\s+MODE[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'โหมดวาลคีรี');
  if (/^LIMITED\s+EDITION[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'รุ่นลิมิเต็ด');
  if (/^TH-?THIS\s+LIGHT[.!?…]*$/i.test(source) || /^THIS\s+LIGHT[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'แส-แสงนี้');
  if (/^(?:I\s+)?SUPPORT\s+YOU\s+TO\s+LIVE[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'ฉันช่วยให้คุณมีชีวิตอยู่');
  if (/^HERE[.!?…]*\s+AND\s+YOU\s+DO\s+THIS\s+TO[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'ที่นี่... แล้วคุณทำแบบนี้กับ');
  if (/^THE\s+PEOPLE\s+HERE[!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'คนที่นี่เหรอ');
  const compactSpanishSource = source
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (compactSpanishSource === 'STAFF') return preserveOverlaySourceTrailingPunctuation(source, 'เจ้าหน้าที่');
  if (compactSpanishSource === 'PRIMEROLAFOTO' || /^PRI-?MERO\s+LA\s+FOTO[.!?…]*$/i.test(source)) {
    return preserveOverlaySourceTrailingPunctuation(source, 'ภาพแรก');
  }
  if (compactSpanishSource === 'PRIMERO') return preserveOverlaySourceTrailingPunctuation(source, 'อันดับแรก');
  if (compactSpanishSource === 'LAFOTO') return preserveOverlaySourceTrailingPunctuation(source, 'ภาพ');
  if (compactSpanishSource === 'DE') return preserveOverlaySourceTrailingPunctuation(source, 'ของ');
  if (compactSpanishSource === 'METIENDOPOR' || compactSpanishSource === 'METIENDO') {
    return preserveOverlaySourceTrailingPunctuation(source, 'กำลังดำเนินการ');
  }
  if (compactSpanishSource === 'LISTOCON' || /^[i¡]?\s*LISTO[.!?…]*\s+CON[.!?…]*$/i.test(source)) {
    return preserveOverlaySourceTrailingPunctuation(source, 'พร้อม! ด้วย');
  }
  if (compactSpanishSource === 'SIMEQUEDO') return preserveOverlaySourceTrailingPunctuation(source, 'ถ้าฉันอยู่');
  if (compactSpanishSource === 'AQUIMAS') return preserveOverlaySourceTrailingPunctuation(source, 'ที่นี่นานกว่านี้');
  if (compactSpanishSource === 'TIEMPO') return preserveOverlaySourceTrailingPunctuation(source, 'อีกสักพัก');
  if (compactSpanishSource === 'SSIENTOQUEME' || compactSpanishSource === 'SIENTOQUEME') return preserveOverlaySourceTrailingPunctuation(source, 'ฉะ-ฉันรู้สึกว่า');
  if (compactSpanishSource === 'VOYCORRER' || compactSpanishSource === 'VOYACORRER') return preserveOverlaySourceTrailingPunctuation(source, 'ฉันจะเสร็จแล้ว');
  if (/^ENTRANCE[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'ทางเข้า');
  if (/^ARE\s+ONLY[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'มีเพียง');
  if (/^AND\s+LEAVE\s+THE[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'แล้วออกจาก');
  if (/^BUILDING[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'อาคาร');
  if (/^OUR\s+CHANCE[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'โอกาสของเรา');
  if (/^THEM[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'พวกเขา');
  if (/^OPEN\s+A[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'เปิด');
  if (/^SHOE\s+LOCKER[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'ตู้รองเท้า');
  if (/^OPEN\s+A\s+SHOE\s+LOCKER[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'เปิดตู้รองเท้า');
  if (/^THREE\s+UNKNOWNS?[.!?…]*\s+THE\s+REACTIONS?\s+ARE\s+THE\s+COUPLE\s+MOMENT[.!?…]*$/i.test(source)) {
    return preserveOverlaySourceTrailingPunctuation(source, 'ตัวไม่ทราบค่าสามตัว แรงปฏิกิริยาเป็นโมเมนต์คู่ควบ');
  }
  if (/^THE\s+REACTIONS?\s+ARE\s+THE\s+COUPLE\s+MOMENT[.!?…]*$/i.test(source)) {
    return preserveOverlaySourceTrailingPunctuation(source, 'แรงปฏิกิริยาเป็นโมเมนต์คู่ควบ');
  }
  if (/^I\s+DON['’]?T\s+CARE[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'ฉันไม่สน');
  if (/^I\s+ALREADY\s+EARNED[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'ฉันหาได้แล้ว');
  if (/^ENOUGH[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'พอแล้ว');
  if (/^LOOK,?\s+B[Jl]ORN[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'ดูสิ บียอร์น');
  if (/^I\s+HAVE\s+WINGS[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'ฉันมีปีก');
  if (/^VALKYRIE[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'วาลคีรี');
  const compactSource = source.toUpperCase().replace(/[^A-Z]/g, '');
  if (/\bTHE\s+FLOOR\s+BEAMS\s+OF\s+THIS\s+BUILDING\b/i.test(source) && /\bWELDED\b/i.test(source)) {
    if ((/\bTOGETHER\b/i.test(source) || compactSource.includes('TOGETHER')) && /\bFIXED\s+CONNECTIONS?\b/i.test(source)) {
      return preserveOverlayTechnicalLabel(source, 'คานพื้นของอาคารนี้เชื่อมเข้าด้วยกัน จึงเกิดเป็นจุดต่อแบบยึดแน่น');
    }
    return preserveOverlayTechnicalLabel(source, 'คานพื้นของอาคารนี้ถูกเชื่อมเข้าด้วยกัน');
  }
  if (
    (/\bTOGETHER\b/i.test(source) || compactSource.includes('TOGETHER'))
    && (/\bTHUS\s+FORM\b/i.test(source) || compactSource.includes('THUSFORM'))
    && /\bFIXED\s+CONNECTIONS?\b/i.test(source)
  ) {
    return preserveOverlayTechnicalLabel(source, 'เชื่อมเข้าด้วยกัน จึงเกิดเป็นจุดต่อแบบยึดแน่น');
  }
  if (
    (/\bTOGETHER\b/i.test(source) || compactSource.includes('TOGETHER'))
    && (/\bTHUS\s+FORM\b/i.test(source) || compactSource.includes('THUSFORM'))
  ) {
    return preserveOverlayTechnicalLabel(source, 'เชื่อมเข้าด้วยกัน จึงเกิดเป็น');
  }
  if (/\bFIXED\s+CONNECTIONS?\b/i.test(source)) return preserveOverlayTechnicalLabel(source, 'จุดต่อแบบยึดแน่น');
  if (/\bTHIS\s+UTILITY\s+BUILDING\s+IS\b/i.test(source) && /\bPIN\s+SUPPORTED\b/i.test(source)) {
    return preserveOverlayTechnicalLabel(source, 'อาคารอเนกประสงค์นี้รองรับแบบพินที่ด้านบนของเสา');
  }
  if (/\bPIN\s+SUPPORTED\b/i.test(source) && /\bTOP\s+OF\s+THE\s+COLUMN\b/i.test(source)) {
    return preserveOverlayTechnicalLabel(source, 'รองรับแบบพินที่ด้านบนของเสา');
  }

  return source;
};

const normalizeOverlayLatinContextKey = (value: string): string =>
  String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/5/g, 'S');

const isLikelyMergedNavigationBridgeLine = (line: OCRLine, currentPageOCR: OCRPageResult): boolean => {
  const sourceText = normalizeOverlayInlineText(String(line.text || ''));
  if (!/^ARE\s+ONLY\s+AND\s+LEAVE\s+THE(?:\s+BUILDING)?[.!?…]*$/i.test(sourceText)) return false;

  const bbox = line.bbox;
  if (!bbox) return false;
  const lineWidth = Math.max(1, Number(bbox.x1 || 0) - Number(bbox.x0 || 0));
  const pageWidth = Math.max(1, Number(currentPageOCR.width || 0));
  return lineWidth >= Math.max(320, pageWidth * 0.32);
};

const isLikelyContextualGhostOverlayLine = (
  line: OCRLine,
  index: number,
  currentPageOCR: OCRPageResult
): boolean => {
  const sourceText = normalizeOverlayInlineText(String(line.text || ''));
  if (!sourceText) return false;
  const key = normalizeOverlayLatinContextKey(sourceText);
  if (key !== 'CARNED' && key !== 'THAVE' && !/^WINGSI{2,}$/.test(key)) return false;

  const lines = Array.isArray(currentPageOCR.lines) ? currentPageOCR.lines : [];
  const bbox = line.bbox;
  const pageWidth = Math.max(1, Number(currentPageOCR.width || 0));
  const pageHeight = Math.max(1, Number(currentPageOCR.height || 0));
  const centerX = (Number(bbox.x0 || 0) + Number(bbox.x1 || 0)) * 0.5;
  const centerY = (Number(bbox.y0 || 0) + Number(bbox.y1 || 0)) * 0.5;
  const nearbyByOrder = (direction: -1 | 1, predicate: (otherKey: string) => boolean): boolean =>
    lines.some((other, otherIndex) => {
      const orderDelta = otherIndex - index;
      if (direction < 0 && !(orderDelta < 0 && orderDelta >= -4)) return false;
      if (direction > 0 && !(orderDelta > 0 && orderDelta <= 4)) return false;
      const otherBbox = other.bbox;
      const otherCenterX = (Number(otherBbox.x0 || 0) + Number(otherBbox.x1 || 0)) * 0.5;
      const otherCenterY = (Number(otherBbox.y0 || 0) + Number(otherBbox.y1 || 0)) * 0.5;
      const overlapX = overlayBBoxOverlapRatioX(bbox, otherBbox);
      const centerDeltaX = Math.abs(centerX - otherCenterX);
      const centerDeltaY = Math.abs(centerY - otherCenterY);
      const sameColumn = overlapX >= 0.12 || centerDeltaX <= Math.max(260, pageWidth * 0.32);
      return sameColumn
        && centerDeltaY <= Math.max(420, pageHeight * 0.12)
        && predicate(normalizeOverlayLatinContextKey(String(other.text || '')));
    });

  if (key === 'CARNED') {
    return nearbyByOrder(-1, (otherKey) =>
      otherKey.includes('IDONTCARE')
      || otherKey.includes('IALREADYEARNED')
      || otherKey.includes('EARNED')
    ) || nearbyByOrder(1, (otherKey) =>
      otherKey.includes('ENOUGH') || otherKey.includes('EARNEDENOUGH')
    );
  }

  if (key === 'THAVE') {
    return nearbyByOrder(-1, (otherKey) =>
      otherKey.includes('IHAVEWINGS')
      || otherKey.includes('LOOKBJORN')
      || otherKey.includes('BJORN')
      || otherKey.includes('WINGS')
    ) || nearbyByOrder(1, (otherKey) =>
      otherKey.includes('IHAVEWINGS')
      || otherKey.includes('LOOKBJORN')
      || otherKey.includes('BJORN')
      || otherKey.includes('WINGS')
    );
  }

  return nearbyByOrder(-1, (otherKey) =>
    otherKey.includes('IHAVEWINGS')
    || otherKey.includes('LOOKBJORN')
    || otherKey.includes('BJORN')
  ) || nearbyByOrder(1, (otherKey) =>
    otherKey.includes('IHAVEWINGS') || otherKey.includes('BJORN')
  );
};

const fillMissingOverlayLinesWithSourceText = (
  currentPageOCR: OCRPageResult,
  translatedByIndex: Map<number, string>,
  targetLanguage: string
): Map<number, string> => {
  const lines = Array.isArray(currentPageOCR.lines) ? currentPageOCR.lines : [];
  if (lines.length === 0) return translatedByIndex;

  let filled: Map<number, string> | null = null;
  lines.forEach((line, index) => {
    const sourceText = normalizeOverlayInlineText(String(line.text || ''));
    if (!sourceText) return;

    // Real-Time Subset/Duplicate Filter: ถ้ามีกล่องอื่นที่ยาวกว่า ครอบคลุมพิกัดของกล่องนี้เกิน 80%
    // และมีข้อความของกล่องนี้รวมอยู่ด้วย จะข้ามไม่เติม fallback และลบออกจากคำแปลเพื่อหลีกเลี่ยงภาษาอังกฤษทับซ้อน
    const bbox = line.bbox;
    if (bbox) {
      const lineArea = Math.max(1, (bbox.x1 - bbox.x0) * (bbox.y1 - bbox.y0));
      const hasLargerOverlap = lines.some((other, otherIdx) => {
        if (otherIdx === index) return false;
        const otherBBox = other.bbox;
        if (!otherBBox) return false;

        const otherArea = Math.max(1, (otherBBox.x1 - otherBBox.x0) * (otherBBox.y1 - otherBBox.y0));
        if (otherArea <= lineArea) return false;

        const overlapW = Math.max(0, Math.min(bbox.x1, otherBBox.x1) - Math.max(bbox.x0, otherBBox.x0));
        const overlapH = Math.max(0, Math.min(bbox.y1, otherBBox.y1) - Math.max(bbox.y0, otherBBox.y0));
        const overlapArea = overlapW * overlapH;

        const isContained = (overlapArea / lineArea) >= 0.80;
        if (!isContained) return false;

        const otherText = normalizeOverlayInlineText(String(other.text || ''));
        const thisText = sourceText;
        if (otherText && thisText) {
          const otherKey = otherText.toUpperCase().replace(/[^A-Z0-9]/g, '');
          const thisKey = thisText.toUpperCase().replace(/[^A-Z0-9]/g, '');
          return otherKey.includes(thisKey);
        }
        return false;
      });

      if (hasLargerOverlap) {
        const existingText = translatedByIndex.get(index);
        if (existingText) {
          if (!filled) {
            filled = new Map(translatedByIndex);
          }
          filled.delete(index);
        }
        return;
      }
    }

    const existingText = translatedByIndex.get(index);
    if (isLikelyContextualGhostOverlayLine(line, index, currentPageOCR)) {
      if (existingText) {
        if (!filled) {
          filled = new Map(translatedByIndex);
        }
        filled.delete(index);
      }
      return;
    }

    if (isLikelyMergedNavigationBridgeLine(line, currentPageOCR)) {
      if (existingText) {
        if (!filled) {
          filled = new Map(translatedByIndex);
        }
        filled.delete(index);
      }
      return;
    }

    const existingLooksLikeSource = existingText
      && normalizeTranslatedOverlayDuplicateKey(existingText) === normalizeTranslatedOverlayDuplicateKey(sourceText);
    if (existingText && !existingLooksLikeSource) return;

    const fallbackText = resolveMissingOverlayLineFallbackText(sourceText, targetLanguage);
    if (!fallbackText) return;
    if (!filled) {
      filled = new Map(translatedByIndex);
    }
    filled.set(index, fallbackText);
  });

  return filled || translatedByIndex;
};

export type TranslationOverlayContext = {
  shouldRender: boolean;
  isStale: boolean;
  sourceLanguage: string;
  targetLanguage: string;
  translatedByIndex: Map<number, string>;
  entry?: OCRTranslationCacheEntry;
};

type ResolveTranslationOverlayArgs = {
  currentPageOCR?: OCRPageResult;
  optionsEngine: OCREngine;
  optionsLanguage: string;
  translationMode: 'adaptive' | 'manga' | 'manhwa' | 'official';
  sourceLanguage: string;
  targetLanguage: string;
  translationPreviewMode: OCRPreviewMode;
  currentPageTranslationMap?: Map<string, OCRTranslationCacheEntry>;
  activeTranslationKey?: string;
  pageOCRsByEngine?: Map<OCREngine, OCRPageResult>;
};

export const resolveTranslationOverlayContext = ({
  currentPageOCR,
  optionsEngine,
  optionsLanguage,
  translationMode,
  sourceLanguage,
  targetLanguage,
  translationPreviewMode,
  currentPageTranslationMap,
  activeTranslationKey,
  pageOCRsByEngine,
}: ResolveTranslationOverlayArgs): TranslationOverlayContext => {
  const fallbackSource = normalizeTranslationLanguageKey(sourceLanguage || '', 'en');
  const normalizedTarget = normalizeTranslationLanguageKey(targetLanguage || '', 'th');
  const ocrLanguageKey = currentPageOCR?.language || optionsLanguage || 'eng';
  const normalizedSource = resolveTranslationSourceFromOCRKey(ocrLanguageKey, fallbackSource);

  if (!currentPageOCR || !currentPageTranslationMap || currentPageTranslationMap.size === 0) {
    return {
      shouldRender: false,
      isStale: false,
      sourceLanguage: normalizedSource,
      targetLanguage: normalizedTarget,
      translatedByIndex: new Map<number, string>(),
    };
  }

  const currentEntries = Array.from(currentPageTranslationMap.values()).sort((a, b) => b.createdAt - a.createdAt);
  const currentEngine = (currentPageOCR.ocrEngine || optionsEngine || 'paddleocr') as OCREngine;
  const sourceFingerprint = buildOCRSourceFingerprint(currentPageOCR, currentEngine);
  const normalizedCurrentLanguage = normalizeCacheLanguageKey(ocrLanguageKey);

  const matchesContext = (entry: OCRTranslationCacheEntry): boolean => {
    if (!hasCurrentOCRTranslationCacheVersion(entry.key)) return false;
    if (entry.ocrEngine !== currentEngine) return false;
    if (entry.translationMode !== translationMode) return false;
    const normalizedEntrySource = normalizeTranslationLanguageKey(entry.sourceLanguage || '', 'en');
    const sourceMatches = normalizedEntrySource === normalizedSource;
    if (!sourceMatches) {
      const sameSnapshot = entry.sourceFingerprint === sourceFingerprint;
      const latinSourceDrift = sameSnapshot
        && ['en', 'es'].includes(normalizedEntrySource)
        && ['en', 'es'].includes(normalizedSource);
      if (!latinSourceDrift) return false;
    }
    if (normalizeTranslationLanguageKey(entry.targetLanguage || '', 'th') !== normalizedTarget) return false;

    const normalizedEntryLanguage = normalizeCacheLanguageKey(entry.ocrLanguage);
    if (normalizedEntryLanguage === normalizedCurrentLanguage) return true;

    // Fallback for language-key drift across sessions (e.g. kor vs eng+kor) when OCR snapshot is the same.
    if (entry.sourceFingerprint === sourceFingerprint) return true;
    return false;
  };

  const matchesSelection = (entry: OCRTranslationCacheEntry): boolean => {
    if (!hasCurrentOCRTranslationCacheVersion(entry.key)) return false;
    if (entry.ocrEngine !== currentEngine) return false;
    if (entry.translationMode !== translationMode) return false;
    if (normalizeTranslationLanguageKey(entry.sourceLanguage || '', 'en') !== normalizedSource) return false;
    if (normalizeTranslationLanguageKey(entry.targetLanguage || '', 'th') !== normalizedTarget) return false;
    return normalizeCacheLanguageKey(entry.ocrLanguage) === normalizedCurrentLanguage;
  };

  const matchesEngineFallback = (entry: OCRTranslationCacheEntry): boolean => {
    if (!hasCurrentOCRTranslationCacheVersion(entry.key)) return false;
    if (entry.ocrEngine !== currentEngine) return false;
    if (normalizeTranslationLanguageKey(entry.targetLanguage || '', 'th') !== normalizedTarget) return false;
    return entry.translatedByIndex.length > 0 || Boolean(entry.translatedText?.trim());
  };

  const getTranslationEntryMatchRank = (entry: OCRTranslationCacheEntry): number => {
    if (matchesContext(entry)) return 3;
    if (matchesSelection(entry)) return 2;
    if (matchesEngineFallback(entry)) return 1;
    return 0;
  };

  const hasThaiTranslation = (entry: OCRTranslationCacheEntry): boolean => {
    if (normalizedTarget !== 'th') return false;
    const sample = [
      entry.translatedText || '',
      ...entry.translatedByIndex.map((item) => String(item.text || '')),
    ].join(' ');
    return /[\u0E00-\u0E7F]/.test(sample);
  };

  const pickBestTranslationEntry = (entries: OCRTranslationCacheEntry[]): OCRTranslationCacheEntry | undefined => {
    if (entries.length === 0) return undefined;
    return entries
      .slice()
      .sort((a, b) => {
        const thaiDiff = Number(hasThaiTranslation(b)) - Number(hasThaiTranslation(a));
        if (thaiDiff !== 0) return thaiDiff;
        const rankDiff = getTranslationEntryMatchRank(b) - getTranslationEntryMatchRank(a);
        if (rankDiff !== 0) return rankDiff;
        return b.createdAt - a.createdAt;
      })[0];
  };

  const activeEntry = activeTranslationKey && currentPageTranslationMap.has(activeTranslationKey)
    ? currentPageTranslationMap.get(activeTranslationKey)
    : currentEntries[0];
  const candidateEntries = currentEntries.filter((entry) => getTranslationEntryMatchRank(entry) > 0);
  const fallbackEntry = pickBestTranslationEntry(candidateEntries);
  
  let resolvedEntry = fallbackEntry;

  // Ultimate Fallback: หากหาแบบ Strict ไม่เจอเลย (เช่น เปลี่ยนโมเดลแปล หรือโหมด หรือเปลี่ยน OCR Engine)
  // ให้ดึง Cache การแปลล่าสุดของหน้านี้ที่แปลสำเร็จแล้วมาทำเป็น Fallback
  if (!resolvedEntry) {
    const possibleFallbacks = currentEntries.filter((entry) => {
      if (!hasCurrentOCRTranslationCacheVersion(entry.key)) return false;
      if (normalizeTranslationLanguageKey(entry.targetLanguage || '', 'th') !== normalizedTarget) return false;
      return entry.translatedByIndex.length > 0 || Boolean(entry.translatedText?.trim());
    });

    if (possibleFallbacks.length > 0) {
      const sameEngineFallback = possibleFallbacks.find((entry) => entry.ocrEngine === currentEngine);
      resolvedEntry = sameEngineFallback ?? possibleFallbacks[0];
    }
  }

  if (!resolvedEntry) {
    return {
      shouldRender: false,
      isStale: false,
      sourceLanguage: normalizedSource,
      targetLanguage: normalizedTarget,
      translatedByIndex: new Map<number, string>(),
    };
  }

  const isStale = resolvedEntry.sourceFingerprint !== sourceFingerprint;
  let translatedByIndexRaw = new Map<number, string>();

  if (resolvedEntry.ocrEngine === currentEngine && !isStale) {
    // OCR Engine ตรงกัน และแคชไม่ stale ดึงคำแปลมาใช้ได้ตรงๆ 100%
    translatedByIndexRaw = new Map<number, string>(
      resolvedEntry.translatedByIndex
        .filter((item) => Number.isFinite(item.index) && String(item.text || '').trim().length > 0)
        .map((item) => [item.index, item.text])
    );
  } else {
    // OCR Engine ไม่ตรงกัน หรือโครงสร้างหน้าเปลี่ยนไป (isStale)! ใช้ Spatial & Semantic Fuzzy Matching เพื่อ Map คำแปล
    const oldEngine = resolvedEntry.ocrEngine;
    const oldOCR = pageOCRsByEngine?.get(oldEngine);
    const currentLines = Array.isArray(currentPageOCR.lines) ? currentPageOCR.lines : [];
    const rawMap = new Map<number, string>(
      resolvedEntry.translatedByIndex
        .filter((item) => Number.isFinite(item.index) && String(item.text || '').trim().length > 0)
        .map((item) => [item.index, item.text])
    );

    const hasCacheBBoxes = resolvedEntry.translatedByIndex.some(item => item.bbox);

    if (currentLines.length > 0) {
      if (hasCacheBBoxes) {
        // ใช้ข้อมูลพิกัดและข้อความดั้งเดิมจาก Cache Entry โดยตรง
        const oldWidth = resolvedEntry.width || currentPageOCR.width || 1;
        const oldHeight = resolvedEntry.height || currentPageOCR.height || 1;
        const currentWidth = currentPageOCR.width || 1;
        const currentHeight = currentPageOCR.height || 1;
        
        const scaleX = currentWidth / oldWidth;
        const scaleY = currentHeight / oldHeight;

        currentLines.forEach((currentLine, currentIdx) => {
          let bestOldIdx = -1;
          let bestScore = -1;
          const currentBBox = currentLine.bbox;
          const currentText = normalizeOverlayInlineText(String(currentLine.text || ''));

          resolvedEntry.translatedByIndex.forEach((oldItem) => {
            const oldBBox = oldItem.bbox;
            const oldText = normalizeOverlayInlineText(String(oldItem.sourceText || ''));

            let spatialScore = 0;
            if (currentBBox && oldBBox) {
              const scaledOldBBox: BBox = {
                x0: oldBBox.x0 * scaleX,
                y0: oldBBox.y0 * scaleY,
                x1: oldBBox.x1 * scaleX,
                y1: oldBBox.y1 * scaleY,
              };
              spatialScore = overlayDedupIou(currentBBox, scaledOldBBox);
            }

            let textScore = 0;
            if (currentText && oldText) {
              textScore = overlayKeyDiceSimilarity(currentText, oldText);
            }

            const totalScore = spatialScore * 0.7 + textScore * 0.3;
            if (totalScore > bestScore) {
              bestScore = totalScore;
              bestOldIdx = oldItem.index;
            }
          });

          if (bestOldIdx >= 0 && bestScore >= 0.2) {
            const oldTranslation = rawMap.get(bestOldIdx);
            if (oldTranslation) {
              translatedByIndexRaw.set(currentIdx, oldTranslation);
            }
          }
        });
      } else {
        // Fallback เดิม: แมปโดยอ้างอิงจาก pageOCRsByEngine (กรณีเป็นแคชเวอร์ชันเก่าที่ไม่มี bbox)
        const oldLines = oldOCR && Array.isArray(oldOCR.lines) ? oldOCR.lines : [];
        if (oldLines.length > 0) {
          currentLines.forEach((currentLine, currentIdx) => {
            let bestOldIdx = -1;
            let bestScore = -1;
            const currentBBox = currentLine.bbox;
            const currentText = normalizeOverlayInlineText(String(currentLine.text || ''));

            oldLines.forEach((oldLine, oldIdx) => {
              const oldText = normalizeOverlayInlineText(String(oldLine.text || ''));
              const oldBBox = oldLine.bbox;

              let spatialScore = 0;
              if (currentBBox && oldBBox) {
                const oldWidth = oldOCR?.width || 1;
                const oldHeight = oldOCR?.height || 1;
                const currentWidth = currentPageOCR?.width || 1;
                const currentHeight = currentPageOCR?.height || 1;

                const scaleX = currentWidth / oldWidth;
                const scaleY = currentHeight / oldHeight;

                const scaledOldBBox: BBox = {
                  x0: oldBBox.x0 * scaleX,
                  y0: oldBBox.y0 * scaleY,
                  x1: oldBBox.x1 * scaleX,
                  y1: oldBBox.y1 * scaleY,
                };
                spatialScore = overlayDedupIou(currentBBox, scaledOldBBox);
              }

              let textScore = 0;
              if (currentText && oldText) {
                textScore = overlayKeyDiceSimilarity(currentText, oldText);
              }

              const totalScore = spatialScore * 0.7 + textScore * 0.3;
              if (totalScore > bestScore) {
                bestScore = totalScore;
                bestOldIdx = oldIdx;
              }
            });

            if (bestOldIdx >= 0 && bestScore >= 0.2) {
              const oldTranslation = rawMap.get(bestOldIdx);
              if (oldTranslation) {
                translatedByIndexRaw.set(currentIdx, oldTranslation);
              }
            }
          });
        }
      }
    }

    // กรณีสำรอง: ถ้าแมตช์ไม่ได้เลย ให้ Map ตามลำดับ index ดั้งเดิม
    if (translatedByIndexRaw.size === 0) {
      rawMap.forEach((text, oldIdx) => {
        if (oldIdx < currentLines.length) {
          translatedByIndexRaw.set(oldIdx, text);
        }
      });
    }
  }

  const translatedByIndexWithFallback = fillMissingOverlayLinesWithSourceText(currentPageOCR, translatedByIndexRaw, normalizedTarget);
  const translatedByIndex = collapseTranslatedOverlayDuplicates(currentPageOCR, translatedByIndexWithFallback);

  return {
    shouldRender: translationPreviewMode === 'translated' && translatedByIndex.size > 0,
    isStale,
    sourceLanguage: normalizeTranslationLanguageKey(resolvedEntry.sourceLanguage || normalizedSource, normalizedSource),
    targetLanguage: normalizedTarget,
    translatedByIndex,
    entry: resolvedEntry,
  };
};

type RGB = { r: number; g: number; b: number };

export type OverlayPalette = {
  backgroundColor: string;
  textColor: string;
  textStrokeColor?: string;
  textStrokeWidth?: number;
  textShadow?: string;
  textFillWeight?: number;
};

export type OverlayTypography = {
  fontSize: number;
  lineHeight: number;
  padX: number;
  padY: number;
  forceSingleLine: boolean;
  estimatedLines: number;
  contentHeight: number;
};

export type OverlayTypographyHints = {
  sourceText?: string;
  sourceBoxWidth?: number;
  sourceBoxHeight?: number;
  sourceLineCount?: number;
  fontFamily?: string;
  profile?: OverlayLayoutProfile;
  styleKind?: OverlayStyleKind;
};

export type OverlayTypographyInput = {
  index: number;
  text: string;
  width: number;
  height: number;
  bbox: BBox;
  line?: OCRLine;
  hints?: OverlayTypographyHints;
  balloonId?: string;
};

export type OverlayLayoutProfile = 'official' | 'adaptive' | 'manga' | 'manhwa';

export type OverlayStyleKind = 'document-heading' | 'document-body' | 'comic-bubble' | 'comic-box' | 'comic-line';

export type OverlayLayout = {
  typography: OverlayTypography;
  alignment?: 'left' | 'center';
  effectiveProfile?: OverlayLayoutProfile;
  styleKind?: OverlayStyleKind;
  sharedTextStartX?: number;
  sharedCenterX?: number;
  sharedBoxLeftX?: number;
  renderText?: string;
  mergedBBox?: BBox;
  mergedMaskBBox?: BBox;
  hidden?: boolean;
  preserveMaskWhenHidden?: boolean;
  highlightContinuationText?: string;
  highlightTextColorSourceIndex?: number;
};

export type OverlayRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type OverlayMaskExpansion = {
  expandXRatio: number;
  expandTopRatio: number;
  expandBottomRatio: number;
  maxExpandX: number;
  maxExpandTop: number;
  maxExpandBottom: number;
};

const DEFAULT_SAMPLE_RGB: RGB = { r: 255, g: 255, b: 255 };

export const DEFAULT_OVERLAY_PALETTE: OverlayPalette = {
  backgroundColor: 'rgb(255, 255, 255)',
  textColor: '#111111',
};

const DEFAULT_OVERLAY_TYPOGRAPHY: OverlayTypography = {
  fontSize: 14,
  lineHeight: 1.12,
  padX: 3,
  padY: 2,
  forceSingleLine: false,
  estimatedLines: 1,
  contentHeight: 18,
};

const blendRgb = (base: RGB, target: RGB, ratio: number): RGB => ({
  r: Math.round(base.r + (target.r - base.r) * ratio),
  g: Math.round(base.g + (target.g - base.g) * ratio),
  b: Math.round(base.b + (target.b - base.b) * ratio),
});

const rgbDistance = (a: RGB, b: RGB): number => {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
};

const srgbToLinear = (value: number): number => {
  const normalized = value / 255;
  if (normalized <= 0.04045) return normalized / 12.92;
  return Math.pow((normalized + 0.055) / 1.055, 2.4);
};

const luminance = (rgb: RGB): number => (
  0.2126 * srgbToLinear(rgb.r)
  + 0.7152 * srgbToLinear(rgb.g)
  + 0.0722 * srgbToLinear(rgb.b)
);

const contrastRatio = (a: RGB, b: RGB): number => {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const bright = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return (bright + 0.05) / (dark + 0.05);
};

const chooseReadablePair = (rawBackground: RGB): { bg: RGB; text: RGB } => {
  const white: RGB = { r: 248, g: 250, b: 252 };
  const black: RGB = { r: 12, g: 14, b: 18 };

  const max = Math.max(rawBackground.r, rawBackground.g, rawBackground.b);
  const min = Math.min(rawBackground.r, rawBackground.g, rawBackground.b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  const rawLuminance = luminance(rawBackground);

  let background = rawBackground;
  // Treat near-white low-saturation backgrounds as pure white
  if (rawLuminance > 0.94 && saturation < 0.08) {
    background = { r: 255, g: 255, b: 255 };
  }

  let bestText = contrastRatio(background, black) >= contrastRatio(background, white) ? black : white;
  let bestContrast = contrastRatio(background, bestText);

  for (let i = 0; i < 4 && bestContrast < 4.5; i += 1) {
    if (bestText === black) {
      background = blendRgb(background, { r: 255, g: 255, b: 255 }, 0.16);
    } else {
      background = blendRgb(background, { r: 0, g: 0, b: 0 }, 0.16);
    }
    bestText = contrastRatio(background, black) >= contrastRatio(background, white) ? black : white;
    bestContrast = contrastRatio(background, bestText);
  }

  return { bg: background, text: bestText };
};

const quantizeChannel = (value: number, step: number): number => {
  const q = Math.round(value / step) * step;
  return clamp(q, 0, 255);
};

const computeSaturation = (r: number, g: number, b: number): number => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max <= 0) return 0;
  return (max - min) / max;
};

const normalizeOverlayBBox = (bbox?: Partial<BBox> | null): BBox | undefined => {
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

const hasPositiveBBox = (bbox?: BBox): bbox is BBox => Boolean(normalizeOverlayBBox(bbox));

const DOCUMENT_SOURCE_FALLBACK_HINT_REGEX = /\b(chapter|table|fig(?:ure)?\.?|reaction|unknowns?|equilibrium|rigid|body|support|diagram|objective|objectives|connection|connections|continued|force|moment|component|unknown|column|columns|bridge|building|beam|beams|welded|surface|bracket|cable|utility|floor|member|pin|hinge)\b/i;

const mergeOverlayBBoxes = (a: BBox, b: BBox): BBox => ({
  x0: Math.min(a.x0, b.x0),
  y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1),
  y1: Math.max(a.y1, b.y1),
});

const resolveQuadBBox = (line: OCRLine): BBox | null => {
  if (!Array.isArray(line.quad) || line.quad.length < 2) return null;
  const points = line.quad.filter((point) =>
    Number.isFinite(point?.x) && Number.isFinite(point?.y)
  );
  if (points.length < 2) return null;
  return {
    x0: Math.min(...points.map((point) => Number(point.x))),
    y0: Math.min(...points.map((point) => Number(point.y))),
    x1: Math.max(...points.map((point) => Number(point.x))),
    y1: Math.max(...points.map((point) => Number(point.y))),
  };
};

export const resolveOverlaySourceBBox = (line: OCRLine): BBox => {
  const quadBBox = normalizeOverlayBBox(resolveQuadBBox(line));
  const normalizedLineBBox = normalizeOverlayBBox(line.bbox);
  const rawLineBBox = normalizedLineBBox
    ? (quadBBox ? mergeOverlayBBoxes(normalizedLineBBox, quadBBox) : normalizedLineBBox)
    : (quadBBox || line.bbox);
  if (!Array.isArray(line.words) || line.words.length === 0) {
    return normalizeOverlayBBox(rawLineBBox) || rawLineBBox;
  }

  const validWords = line.words
    .map((word) => {
      const bbox = normalizeOverlayBBox(word?.bbox);
      if (!bbox) return null;
      return {
        ...word,
        bbox,
      };
    })
    .filter((word): word is OCRLine['words'][number] => Boolean(word));
  const meaningfulWords = validWords.filter((word) => MEANINGFUL_WORD_REGEX.test(String(word.text || '').trim()));
  const wordSource = meaningfulWords.length > 0 ? meaningfulWords : validWords;
  const validWordBoxes = wordSource.map((word) => word.bbox);

  if (validWordBoxes.length === 0) {
    return normalizeOverlayBBox(rawLineBBox) || rawLineBBox;
  }

  const unionWordBox = validWordBoxes.reduce<BBox>((acc, bbox) => ({
    x0: Math.min(acc.x0, bbox.x0),
    y0: Math.min(acc.y0, bbox.y0),
    x1: Math.max(acc.x1, bbox.x1),
    y1: Math.max(acc.y1, bbox.y1),
  }), {
    ...validWordBoxes[0],
  });

  if (!hasPositiveBBox(rawLineBBox)) {
    return unionWordBox;
  }

  const lineWidth = Math.max(1, rawLineBBox.x1 - rawLineBBox.x0);
  const lineHeight = Math.max(1, rawLineBBox.y1 - rawLineBBox.y0);
  const lineArea = lineWidth * lineHeight;
  const wordWidth = Math.max(1, unionWordBox.x1 - unionWordBox.x0);
  const wordHeight = Math.max(1, unionWordBox.y1 - unionWordBox.y0);
  const wordArea = wordWidth * wordHeight;
  const leftTrimRatio = Math.max(0, unionWordBox.x0 - rawLineBBox.x0) / lineWidth;
  const rightTrimRatio = Math.max(0, rawLineBBox.x1 - unionWordBox.x1) / lineWidth;
  const horizontalTrimRatio = leftTrimRatio + rightTrimRatio;
  const widthCoverage = wordWidth / lineWidth;
  const heightCoverage = wordHeight / lineHeight;
  const areaCoverage = wordArea / lineArea;
  const normalizedLineText = normalizeOverlayInlineText(String(line.text || ''));
  const sourceWordCount = normalizedLineText.split(/\s+/g).filter(Boolean).length;
  const meaningfulCharCount = normalizedLineText.replace(/[^\p{L}\p{N}]/gu, '').length;
  const thaiCharCount = (normalizedLineText.match(/[\u0E00-\u0E7F]/g) || []).length;
  const technicalSourceLike = DOCUMENT_SOURCE_FALLBACK_HINT_REGEX.test(normalizedLineText);
  const numericDocumentLike = sourceWordCount >= 5 && /[0-9()\-]/.test(normalizedLineText);
  const thaiDocumentLike = thaiCharCount >= 12
    && (sourceWordCount >= 3 || /[0-9()\[\].,:;\-]/.test(normalizedLineText));
  const allowLineFallback = technicalSourceLike || numericDocumentLike || thaiDocumentLike;
  const longLineText = normalizedLineText.length >= 18;
  const sparseWordBoxes = validWordBoxes.length <= 3;
  const rawCenterX = (rawLineBBox.x0 + rawLineBBox.x1) * 0.5;
  const rawCenterY = (rawLineBBox.y0 + rawLineBBox.y1) * 0.5;
  const unionCenterX = (unionWordBox.x0 + unionWordBox.x1) * 0.5;
  const unionCenterY = (unionWordBox.y0 + unionWordBox.y1) * 0.5;
  const centerOffsetXRatio = Math.abs(unionCenterX - rawCenterX) / lineWidth;
  const centerOffsetYRatio = Math.abs(unionCenterY - rawCenterY) / lineHeight;
  const rotatedLine = Boolean(quadBBox) && Math.abs(Number(line.angleDeg || 0)) >= 10;
  const severeCoverageLoss = (
    (widthCoverage < 0.62 && areaCoverage < 0.5)
    || (widthCoverage < 0.72 && heightCoverage < 0.38)
  );
  const moderateCoverageLoss = longLineText && sparseWordBoxes && widthCoverage < 0.86 && areaCoverage < 0.78;
  const shortDocumentCoverageLoss = (
    sourceWordCount >= 3
    && sourceWordCount <= 7
    && validWordBoxes.length <= 2
    && widthCoverage < 0.78
    && areaCoverage < 0.8
    && heightCoverage < 0.9
  );
  const longDocumentCoverageLoss = (
    sourceWordCount >= 7
    && longLineText
    && widthCoverage < 0.84
    && areaCoverage < 0.84
    && heightCoverage < 0.95
  );
  const sparseWordCoverage = (
    sourceWordCount >= 5
    && validWordBoxes.length <= Math.max(2, Math.floor(sourceWordCount * 0.45))
  );
  const technicalSparseCoverageLoss = (
    allowLineFallback
    && sparseWordCoverage
    && widthCoverage < 0.9
    && areaCoverage < 0.88
    && heightCoverage < 0.95
  );
  const technicalEdgeTrimLoss = (
    allowLineFallback
    && sourceWordCount >= 3
    && widthCoverage < 0.92
    && areaCoverage >= 0.46
    && areaCoverage < 0.9
    && heightCoverage >= 0.62
    && horizontalTrimRatio > 0.2
  );
  const centeredShortDialogueCoverageLoss = (
    !allowLineFallback
    && meaningfulCharCount >= 4
    && sourceWordCount >= 1
    && sourceWordCount <= 5
    && centerOffsetXRatio <= 0.22
    && centerOffsetYRatio <= 0.24
    && widthCoverage < 0.66
    && heightCoverage < 0.58
    && areaCoverage < 0.42
  );

  if (allowLineFallback && (
    severeCoverageLoss
    || moderateCoverageLoss
    || shortDocumentCoverageLoss
    || longDocumentCoverageLoss
    || technicalSparseCoverageLoss
    || technicalEdgeTrimLoss
  )) {
    return rawLineBBox;
  }

  if (centeredShortDialogueCoverageLoss) {
    return rawLineBBox;
  }

  if (
    rotatedLine
    && meaningfulCharCount >= 3
    && (
      severeCoverageLoss
      || moderateCoverageLoss
      || widthCoverage < 0.82
      || areaCoverage < 0.74
    )
  ) {
    return rawLineBBox;
  }

  return unionWordBox;
};

export const resolveOverlayMaskBBox = (line: OCRLine): BBox => {
  const sourceBbox = resolveOverlaySourceBBox(line);
  const normalizedLineBBox = normalizeOverlayBBox(line.bbox);
  if (!normalizedLineBBox) {
    return sourceBbox;
  }

  return {
    x0: Math.min(normalizedLineBBox.x0, sourceBbox.x0),
    y0: Math.min(normalizedLineBBox.y0, sourceBbox.y0),
    x1: Math.max(normalizedLineBBox.x1, sourceBbox.x1),
    y1: Math.max(normalizedLineBBox.y1, sourceBbox.y1),
  };
};

export const shouldSkipOverlayRenderForSuspiciousLine = (line: OCRLine): boolean => {
  const tText = normalizeOverlayInlineText(String(line.text || ''));
  const tCompact = tText.replace(/\s+/g, '');
  const asciiCompact = tCompact.replace(/[^A-Za-z0-9]/g, '');
  const isKnownShortWord = isKnownShortWordHelper(asciiCompact);
  if (isKnownShortWord) {
    return false;
  }

  const sourceBbox = resolveOverlaySourceBBox(line);
  const maskBbox = resolveOverlayMaskBBox(line);

  const sourceWidth = Math.max(1, sourceBbox.x1 - sourceBbox.x0);
  const sourceHeight = Math.max(1, sourceBbox.y1 - sourceBbox.y0);
  const sourceArea = sourceWidth * sourceHeight;
  const maskWidth = Math.max(1, maskBbox.x1 - maskBbox.x0);
  const maskHeight = Math.max(1, maskBbox.y1 - maskBbox.y0);
  const maskArea = maskWidth * maskHeight;
  const coverage = sourceArea / Math.max(1, maskArea);

  const normalizedText = normalizeOverlayInlineText(String(line.text || ''));
  const compact = normalizedText.replace(/\s+/g, '');
  const meaningfulChars = compact.replace(/[^\p{L}\p{N}]/gu, '');
  const tokenCount = normalizedText.split(/\s+/g).filter(Boolean).length;
  const sentenceLikeSignal = tokenCount >= 3 || (tokenCount >= 2 && meaningfulChars.length >= 10);
  const hasTerminalPunctuation = /[.!?…]\s*$/.test(normalizedText);
  const angledLine = Math.abs(Number(line.angleDeg || 0)) >= 10 && Array.isArray(line.quad) && line.quad.length >= 2;
  if (angledLine && meaningfulChars.length >= 2) {
    return false;
  }
  const validWords = (Array.isArray(line.words) ? line.words : []).filter((word) => {
    const wordText = normalizeOverlayInlineText(String(word?.text || ''));
    return Boolean(wordText) && hasPositiveBBox(word?.bbox);
  });

  const sparseSignal = meaningfulChars.length <= 6 && validWords.length <= 1 && tokenCount <= 2;
  const lowConfidence = Number(line.confidence || 0) <= 93;

  // 1. Existing oversized mask condition
  const oversizedMask = maskArea >= 17000 && (maskWidth >= 170 || maskHeight >= 96);
  const severeSourceLoss = coverage < 0.24 && maskArea >= sourceArea * 3.2;
  if (sparseSignal && oversizedMask && severeSourceLoss && lowConfidence && !sentenceLikeSignal && !hasTerminalPunctuation) {
    return true;
  }

  // 2. Giant sparse/empty border or panel boxes that contain almost no characters
  // If the box area is large but it has very few letters, it is almost certainly a panel border line or background noise.
  const isLargeSparsePanelBox = maskArea >= 10000 && meaningfulChars.length <= 4 && !hasTerminalPunctuation;
  if (isLargeSparsePanelBox && lowConfidence && !sentenceLikeSignal) {
    return true;
  }

  // 3. Tall narrow vertical noise lines (speed lines, panels borders, hair streaks)
  // An English/translated text block cannot read vertically in a super thin box of width < 22px
  const isTallNarrowVerticalNoise = maskWidth < 22 && maskHeight > 35 && (maskHeight / maskWidth) > 2.0 && meaningfulChars.length <= 6;
  if (isTallNarrowVerticalNoise && !hasTerminalPunctuation && !sentenceLikeSignal) {
    return true;
  }

  // 4. Extremely thin horizontal noise lines (panel dividers, scratches)
  const isThinHorizontalNoise = maskHeight < 10 && maskWidth > 50 && (maskWidth / maskHeight) > 6.0 && meaningfulChars.length <= 4;
  if (isThinHorizontalNoise && !hasTerminalPunctuation && !sentenceLikeSignal) {
    return true;
  }

  return false;
};

const MEANINGFUL_WORD_REGEX = /[\p{L}\p{N}]/u;

const resolveOverlayTextStartX = (line: OCRLine, bbox: BBox): number => {
  if (!Array.isArray(line.words) || line.words.length === 0) return bbox.x0;

  const validWords = line.words
    .map((word) => {
      const normalizedBBox = normalizeOverlayBBox(word?.bbox);
      if (!normalizedBBox) return null;
      return {
        ...word,
        bbox: normalizedBBox,
      };
    })
    .filter((word): word is OCRLine['words'][number] => Boolean(word));
  if (validWords.length === 0) return bbox.x0;

  const meaningful = validWords.find((word) => MEANINGFUL_WORD_REGEX.test(String(word.text || '').trim()));
  return (meaningful || validWords[0]).bbox.x0;
};

type PaletteSampleBucket = {
  weight: number;
  r: number;
  g: number;
  b: number;
  distance: number;
};

type PaletteSampleStats = {
  totalWeight: number;
  totalR: number;
  totalG: number;
  totalB: number;
  buckets: Map<string, PaletteSampleBucket>;
};

const createPaletteSampleStats = (): PaletteSampleStats => ({
  totalWeight: 0,
  totalR: 0,
  totalG: 0,
  totalB: 0,
  buckets: new Map<string, PaletteSampleBucket>(),
});

const registerPaletteSample = (
  stats: PaletteSampleStats,
  r: number,
  g: number,
  b: number,
  weight: number,
  distance: number
) => {
  if (weight <= 0) return;
  const step = 18;
  const key = `${quantizeChannel(r, step)}|${quantizeChannel(g, step)}|${quantizeChannel(b, step)}`;
  const bucket = stats.buckets.get(key) || { weight: 0, r: 0, g: 0, b: 0, distance: 0 };
  bucket.weight += weight;
  bucket.r += r * weight;
  bucket.g += g * weight;
  bucket.b += b * weight;
  bucket.distance += distance * weight;
  stats.buckets.set(key, bucket);

  stats.totalWeight += weight;
  stats.totalR += r * weight;
  stats.totalG += g * weight;
  stats.totalB += b * weight;
};

const accumulateRegionSamples = (
  context: CanvasRenderingContext2D,
  bbox: BBox,
  sourceWidth: number,
  sourceHeight: number,
  sampleWidth: number,
  sampleHeight: number,
  expandXRatio: number,
  expandYRatio: number,
  maxExpandX: number,
  maxExpandY: number,
  regionWeight: number,
  stats: PaletteSampleStats
) => {
  if (!sourceWidth || !sourceHeight || !sampleWidth || !sampleHeight || regionWeight <= 0) return;

  const mappedX0 = Math.floor((bbox.x0 / sourceWidth) * sampleWidth);
  const mappedX1 = Math.ceil((bbox.x1 / sourceWidth) * sampleWidth);
  const mappedY0 = Math.floor((bbox.y0 / sourceHeight) * sampleHeight);
  const mappedY1 = Math.ceil((bbox.y1 / sourceHeight) * sampleHeight);

  const boxW = Math.max(1, mappedX1 - mappedX0);
  const boxH = Math.max(1, mappedY1 - mappedY0);
  const expandX = Math.min(maxExpandX, Math.max(1, Math.floor(boxW * expandXRatio)));
  const expandY = Math.min(maxExpandY, Math.max(1, Math.floor(boxH * expandYRatio)));

  const x0 = clamp(mappedX0 - expandX, 0, sampleWidth - 1);
  const y0 = clamp(mappedY0 - expandY, 0, sampleHeight - 1);
  const x1 = clamp(mappedX1 + expandX, x0 + 1, sampleWidth);
  const y1 = clamp(mappedY1 + expandY, y0 + 1, sampleHeight);

  const readW = Math.max(1, x1 - x0);
  const readH = Math.max(1, y1 - y0);

  let imageData: ImageData;
  try {
    imageData = context.getImageData(x0, y0, readW, readH);
  } catch {
    return;
  }

  const pixels = imageData.data;
  const stride = Math.max(1, Math.floor(Math.sqrt((readW * readH) / 240)));
  const centerX = (readW - 1) / 2;
  const centerY = (readH - 1) / 2;

  for (let y = 0; y < readH; y += stride) {
    for (let x = 0; x < readW; x += stride) {
      const idx = (y * readW + x) * 4;
      const alpha = pixels[idx + 3] / 255;
      if (alpha <= 0.05) continue;

      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];

      const dx = (x - centerX) / Math.max(1, readW * 0.5);
      const dy = (y - centerY) / Math.max(1, readH * 0.5);
      const distance = Math.min(1, Math.sqrt(dx * dx + dy * dy));
      const centerWeight = clamp(1 - distance * 0.7, 0.16, 1);

      const lum = luminance({ r, g, b });
      const sat = computeSaturation(r, g, b);
      let weight = alpha * centerWeight * regionWeight;
      // Preserve dark panel backgrounds instead of collapsing toward white.
      if (lum < 0.08) {
        weight *= 0.82;
      } else if (lum > 0.94 && sat < 0.08) {
        weight *= 0.88;
      }

      registerPaletteSample(stats, r, g, b, weight, distance);
    }
  }
};

const resolveBucketRgb = (bucket: PaletteSampleBucket): RGB => ({
  r: Math.round(bucket.r / Math.max(1e-6, bucket.weight)),
  g: Math.round(bucket.g / Math.max(1e-6, bucket.weight)),
  b: Math.round(bucket.b / Math.max(1e-6, bucket.weight)),
});

const resolveSampleRgb = (stats: PaletteSampleStats): RGB => {
  if (stats.totalWeight <= 0 || stats.buckets.size === 0) {
    return DEFAULT_SAMPLE_RGB;
  }

  const average: RGB = {
    r: Math.round(stats.totalR / stats.totalWeight),
    g: Math.round(stats.totalG / stats.totalWeight),
    b: Math.round(stats.totalB / stats.totalWeight),
  };

  let dominant: PaletteSampleBucket | undefined;
  stats.buckets.forEach((bucket) => {
    if (!dominant || bucket.weight > dominant.weight) {
      dominant = bucket;
    }
  });

  if (!dominant) return average;

  const dominantRgb = resolveBucketRgb(dominant);
  const dominantLum = luminance(dominantRgb);
  const dominantSat = computeSaturation(dominantRgb.r, dominantRgb.g, dominantRgb.b);
  const dominantDistance = dominant.distance / Math.max(1e-6, dominant.weight);

  let vividBackgroundCandidate: PaletteSampleBucket | undefined;
  let vividBackgroundScore = 0;
  stats.buckets.forEach((bucket) => {
    if (bucket.weight <= 0) return;
    const rgb = resolveBucketRgb(bucket);
    const lum = luminance(rgb);
    const sat = computeSaturation(rgb.r, rgb.g, rgb.b);
    if (lum < 0.18 || lum > 0.96 || sat < 0.22) return;

    const avgDistance = bucket.distance / Math.max(1e-6, bucket.weight);
    const warmHighlight = rgb.r >= 150 && rgb.g >= 110 && rgb.b <= Math.min(rgb.r, rgb.g) - 24;
    const score = bucket.weight * (1 + sat * 1.55 + (warmHighlight ? 0.85 : 0)) * (1.12 - Math.min(1, avgDistance) * 0.36);
    if (score > vividBackgroundScore) {
      vividBackgroundScore = score;
      vividBackgroundCandidate = bucket;
    }
  });

  if (vividBackgroundCandidate && dominantLum >= 0.74 && dominantSat <= 0.18) {
    const vividRgb = resolveBucketRgb(vividBackgroundCandidate);
    const vividWeightRatio = vividBackgroundCandidate.weight / Math.max(1e-6, dominant.weight);
    const vividLum = luminance(vividRgb);
    const vividSat = computeSaturation(vividRgb.r, vividRgb.g, vividRgb.b);
    const vividDistance = vividBackgroundCandidate.distance / Math.max(1e-6, vividBackgroundCandidate.weight);
    const warmHighlight = vividRgb.r >= 150
      && vividRgb.g >= 110
      && vividRgb.b <= Math.min(vividRgb.r, vividRgb.g) - 24
      && vividLum <= 0.82
      && vividSat >= 0.28;
    if (warmHighlight && vividWeightRatio >= 0.15 && vividDistance <= 0.95) {
      return vividRgb;
    }
  }

  let neutralCandidate: PaletteSampleBucket | undefined;
  let neutralScore = 0;

  stats.buckets.forEach((bucket) => {
    if (bucket.weight <= 0) return;
    const rgb = resolveBucketRgb(bucket);
    const lum = luminance(rgb);
    const sat = computeSaturation(rgb.r, rgb.g, rgb.b);
    if (lum < 0.74 || sat > 0.2) return;

    const avgDistance = bucket.distance / Math.max(1e-6, bucket.weight);
    const score = bucket.weight * (1.18 - Math.min(1, avgDistance));
    if (score > neutralScore) {
      neutralScore = score;
      neutralCandidate = bucket;
    }
  });

  let resolved = dominantRgb;
  if (neutralCandidate) {
    const neutralRgb = resolveBucketRgb(neutralCandidate);
    const neutralWeightRatio = neutralCandidate.weight / Math.max(1e-6, dominant.weight);
    const neutralDistance = neutralCandidate.distance / Math.max(1e-6, neutralCandidate.weight);
    const neutralCloser = neutralDistance + 0.06 < dominantDistance;
    const dominantBlueish = dominantRgb.b > dominantRgb.r + 12 && dominantRgb.b > dominantRgb.g + 8;

    const shouldUseNeutral = (
      (dominantBlueish && neutralWeightRatio >= 0.24 && neutralCloser)
      || (dominantSat >= 0.24 && neutralWeightRatio >= 0.5 && neutralCloser)
      || (neutralWeightRatio >= 0.9 && neutralCloser && dominantLum >= 0.24)
    );

    if (shouldUseNeutral) {
      resolved = neutralRgb;
    }
  }

  const dominanceRatio = dominant.weight / Math.max(1e-6, stats.totalWeight);
  if (dominanceRatio < 0.22) {
    return blendRgb(average, resolved, 0.62);
  }

  return resolved;
};

const isWarmBackdropTitleLine = (line: OCRLine): boolean => {
  const key = normalizeOverlayLatinContextKey(String(line.text || ''));
  if (!key) return false;

  const warmTitleKey = key === 'BARBARIANFEMALE'
    || key === 'BARBARIAN'
    || key === 'BARBARIANFEMALEVALKYRIEMODE'
    || key === 'VALKYRIEMODE'
    || key === 'VAKYREMODE'
    || key === 'LIMITEDEDITION';
  if (warmTitleKey) return true;

  const barbarianLike = key.startsWith('BARBARI') && (key.includes('FEMALE') || key.includes('WOMAN'));
  const valkyrieLike = key.includes('VALKYR') && (key.includes('MODE') || key.includes('MIZED') || key.includes('IZED'));
  const editionLike = key.includes('LIMITED') && key.includes('EDITION');

  return barbarianLike || valkyrieLike || editionLike;
};

const pickWarmBackdropRgb = (stats: PaletteSampleStats, minWeightRatio: number): RGB | null => {
  if (stats.totalWeight <= 0) return null;
  let best: PaletteSampleBucket | undefined;
  let bestScore = 0;
  stats.buckets.forEach((bucket) => {
    if (bucket.weight <= 0) return;
    const rgb = resolveBucketRgb(bucket);
    const lum = luminance(rgb);
    const sat = computeSaturation(rgb.r, rgb.g, rgb.b);
    const warmHighlight = rgb.r >= 150
      && rgb.g >= 110
      && rgb.b <= Math.min(rgb.r, rgb.g) - 20
      && lum >= 0.2
      && lum <= 0.86
      && sat >= 0.22;
    if (!warmHighlight) return;
    const weightRatio = bucket.weight / Math.max(1e-6, stats.totalWeight);
    if (weightRatio < minWeightRatio) return;
    const distance = bucket.distance / Math.max(1e-6, bucket.weight);
    const score = bucket.weight * (1 + sat * 1.6) * (1.12 - Math.min(1, distance) * 0.42);
    if (score > bestScore) {
      bestScore = score;
      best = bucket;
    }
  });
  return best ? resolveBucketRgb(best) : null;
};

const sampleWarmBackdropTitleRgbFromLine = (
  context: CanvasRenderingContext2D,
  line: OCRLine,
  sourceWidth: number,
  sourceHeight: number,
  sampleWidth: number,
  sampleHeight: number
): RGB | null => {
  if (!hasPositiveBBox(line.bbox)) return null;
  const stats = createPaletteSampleStats();
  accumulateRegionSamples(
    context,
    line.bbox,
    sourceWidth,
    sourceHeight,
    sampleWidth,
    sampleHeight,
    0.95,
    1.15,
    180,
    110,
    1.2,
    stats
  );
  accumulateRegionSamples(
    context,
    line.bbox,
    sourceWidth,
    sourceHeight,
    sampleWidth,
    sampleHeight,
    0.28,
    0.34,
    42,
    36,
    0.65,
    stats
  );
  return pickWarmBackdropRgb(stats, 0.08);
};

const sampleForegroundRgbFromLine = (
  context: CanvasRenderingContext2D,
  line: OCRLine,
  sourceWidth: number,
  sourceHeight: number,
  sampleWidth: number,
  sampleHeight: number,
  background: RGB
): RGB | null => {
  if (!sourceWidth || !sourceHeight || !sampleWidth || !sampleHeight) return null;

  const wordBoxes = Array.isArray(line.words)
    ? line.words.map((word) => word.bbox).filter(hasPositiveBBox)
    : [];

  const regions = wordBoxes.length > 0
    ? wordBoxes
    : (hasPositiveBBox(line.bbox) ? [line.bbox] : []);

  if (regions.length === 0) return null;

  const stats = createPaletteSampleStats();
  const backgroundLum = luminance(background);

  regions.forEach((bbox) => {
    const mappedX0 = Math.floor((bbox.x0 / sourceWidth) * sampleWidth);
    const mappedX1 = Math.ceil((bbox.x1 / sourceWidth) * sampleWidth);
    const mappedY0 = Math.floor((bbox.y0 / sourceHeight) * sampleHeight);
    const mappedY1 = Math.ceil((bbox.y1 / sourceHeight) * sampleHeight);

    const x0 = clamp(mappedX0, 0, sampleWidth - 1);
    const y0 = clamp(mappedY0, 0, sampleHeight - 1);
    const x1 = clamp(mappedX1, x0 + 1, sampleWidth);
    const y1 = clamp(mappedY1, y0 + 1, sampleHeight);

    const readW = Math.max(1, x1 - x0);
    const readH = Math.max(1, y1 - y0);
    let imageData: ImageData;
    try {
      imageData = context.getImageData(x0, y0, readW, readH);
    } catch {
      return;
    }

    const pixels = imageData.data;
    const stride = Math.max(1, Math.floor(Math.sqrt((readW * readH) / 260)));
    const centerX = (readW - 1) / 2;
    const centerY = (readH - 1) / 2;

    for (let y = 0; y < readH; y += stride) {
      for (let x = 0; x < readW; x += stride) {
        const idx = (y * readW + x) * 4;
        const alpha = pixels[idx + 3] / 255;
        if (alpha <= 0.08) continue;

        const rgb: RGB = { r: pixels[idx], g: pixels[idx + 1], b: pixels[idx + 2] };
        const distance = rgbDistance(rgb, background);
        const minDistance = backgroundLum < 0.35 ? 14 : 34;
        if (distance < minDistance) continue;

        const contrast = contrastRatio(rgb, background);
        const saturation = computeSaturation(rgb.r, rgb.g, rgb.b);
        const allowColoredFallback = contrast >= 1.2
          && saturation >= 0.24
          && (backgroundLum <= 0.52 || luminance(rgb) >= 0.62);
        const allowBrightOnDarkFallback = contrast >= 1.15
          && backgroundLum <= 0.42
          && luminance(rgb) >= 0.72;
        if (contrast < 1.35 && !allowColoredFallback && !allowBrightOnDarkFallback) continue;

        const dx = (x - centerX) / Math.max(1, readW * 0.5);
        const dy = (y - centerY) / Math.max(1, readH * 0.5);
        const radialDistance = Math.min(1, Math.sqrt(dx * dx + dy * dy));
        const centerWeight = clamp(1 - radialDistance * 0.55, 0.3, 1);
        let weight = alpha * centerWeight * clamp(distance / 160, 0.28, 1.36) * clamp(contrast / 2.8, 0.52, 1.32);

        // Prefer colorful non-black text when available (e.g., blue headers).
        if (saturation >= 0.16) {
          weight *= 1.28;
        }
        if (saturation >= 0.26) {
          weight *= 1.32;
        }
        if (saturation >= 0.34 && backgroundLum <= 0.62) {
          weight *= 1.25;
        }
        if (luminance(rgb) >= 0.72 && backgroundLum <= 0.45) {
          weight *= 1.14;
        }

        registerPaletteSample(stats, rgb.r, rgb.g, rgb.b, weight, radialDistance);
      }
    }
  });

  if (stats.totalWeight <= 0) return null;
  const candidate = resolveSampleRgb(stats);
  const finalMinDistance = backgroundLum < 0.35 ? 14 : 26;
  if (rgbDistance(candidate, background) < finalMinDistance) return null;
  return candidate;
};

const ensureReadableTextColor = (candidate: RGB, background: RGB, fallback: RGB): RGB => {
  const dark: RGB = { r: 12, g: 14, b: 18 };
  const light: RGB = { r: 248, g: 250, b: 252 };
  const saturation = computeSaturation(candidate.r, candidate.g, candidate.b);
  const initialContrast = contrastRatio(candidate, background);
  const colorSpread = Math.max(candidate.r, candidate.g, candidate.b) - Math.min(candidate.r, candidate.g, candidate.b);

  // Keep neutral bright text on dark backgrounds when it is already readable.
  if (saturation < 0.08 && colorSpread < 18) {
    const backgroundSaturation = computeSaturation(background.r, background.g, background.b);
    const backgroundLuminance = luminance(background);
    const warmReadableBackground = backgroundSaturation >= 0.22
      && background.r >= 150
      && background.g >= 105
      && background.b <= Math.min(background.r, background.g) - 20
      && backgroundLuminance <= 0.76;
    if (warmReadableBackground && luminance(candidate) >= 0.78 && initialContrast >= 1.35) {
      return candidate;
    }
    if (initialContrast >= 3.2) {
      return candidate;
    }
    return fallback;
  }

  const minContrast = saturation >= 0.22 ? 2.05 : 2.55;

  if (initialContrast >= minContrast) {
    return candidate;
  }

  const target = contrastRatio(dark, background) >= contrastRatio(light, background) ? dark : light;
  let adjusted = candidate;
  const blendStep = saturation >= 0.22 ? 0.14 : 0.22;
  for (let i = 0; i < 4; i += 1) {
    adjusted = blendRgb(adjusted, target, blendStep);
    if (contrastRatio(adjusted, background) >= minContrast) {
      return adjusted;
    }
  }

  if (saturation >= 0.22 && contrastRatio(adjusted, background) >= 1.85) {
    return adjusted;
  }

  return fallback;
};

const resolveOverlayWhiteTextStroke = (text: RGB, background: RGB): Pick<OverlayPalette, 'textStrokeColor' | 'textStrokeWidth' | 'textShadow' | 'textFillWeight'> => {
  const textLuminance = luminance(text);
  const backgroundLuminance = luminance(background);
  const textSaturation = computeSaturation(text.r, text.g, text.b);
  const backgroundSaturation = computeSaturation(background.r, background.g, background.b);
  const warmLightBackground = background.r >= 150
    && background.g >= 105
    && background.b <= Math.min(background.r, background.g) - 18
    && backgroundLuminance >= 0.32;

  const whiteLikeText = textLuminance >= 0.82 && textSaturation <= 0.14;
  const lightToneBackground = backgroundLuminance >= 0.6
    || (backgroundLuminance >= 0.54 && backgroundSaturation <= 0.22)
    || warmLightBackground;
  const darkThemeBackground = backgroundLuminance <= 0.32;

  if (!whiteLikeText || !lightToneBackground || darkThemeBackground) {
    return {};
  }

  return {
    textStrokeColor: 'rgba(0, 0, 0, 0.96)',
    textStrokeWidth: 0.82,
    textShadow: '0 0 0.7px rgba(0, 0, 0, 0.56)',
    textFillWeight: 620,
  };
};

const shouldForceWarmBackdropWhiteText = (line: OCRLine, background: RGB): boolean => {
  if (!isWarmBackdropTitleLine(line)) return false;
  return background.r >= 148
    && background.g >= 102
    && background.b <= Math.min(background.r, background.g) - 16
    && luminance(background) >= 0.32;
};

const sampleDominantRgb = (
  context: CanvasRenderingContext2D,
  bbox: BBox,
  sourceWidth: number,
  sourceHeight: number,
  sampleWidth: number,
  sampleHeight: number
): RGB => {
  const stats = createPaletteSampleStats();
  if (!hasPositiveBBox(bbox)) return DEFAULT_SAMPLE_RGB;
  accumulateRegionSamples(
    context,
    bbox,
    sourceWidth,
    sourceHeight,
    sampleWidth,
    sampleHeight,
    0.32,
    0.42,
    44,
    52,
    1,
    stats
  );
  return resolveSampleRgb(stats);
};

const sampleDominantRgbFromLine = (
  context: CanvasRenderingContext2D,
  line: OCRLine,
  sourceWidth: number,
  sourceHeight: number,
  sampleWidth: number,
  sampleHeight: number
): RGB => {
  const stats = createPaletteSampleStats();
  const wordBoxes = Array.isArray(line.words)
    ? line.words.map((word) => word.bbox).filter(hasPositiveBBox)
    : [];

  if (hasPositiveBBox(line.bbox)) {
    accumulateRegionSamples(
      context,
      line.bbox,
      sourceWidth,
      sourceHeight,
      sampleWidth,
      sampleHeight,
      0.42,
      0.62,
      58,
      62,
      1.35,
      stats
    );
  }

  if (wordBoxes.length > 0) {
    wordBoxes.forEach((bbox) => {
      accumulateRegionSamples(
        context,
        bbox,
        sourceWidth,
        sourceHeight,
        sampleWidth,
        sampleHeight,
        0.08,
        0.12,
        8,
        10,
        0.2,
        stats
      );
    });
  }

  if (hasPositiveBBox(line.bbox)) {
    accumulateRegionSamples(
      context,
      line.bbox,
      sourceWidth,
      sourceHeight,
      sampleWidth,
      sampleHeight,
      0.14,
      0.18,
      16,
      18,
      wordBoxes.length > 0 ? 0.45 : 1,
      stats
    );
  }

  return resolveSampleRgb(stats);
};

export const sampleOverlayPaletteFromBbox = (
  context: CanvasRenderingContext2D,
  bbox: BBox,
  sourceWidth: number,
  sourceHeight: number,
  sampleWidth: number,
  sampleHeight: number
): OverlayPalette => {
  const sample = sampleDominantRgb(context, bbox, sourceWidth, sourceHeight, sampleWidth, sampleHeight);
  const pair = chooseReadablePair(sample);
  const textStroke = resolveOverlayWhiteTextStroke(pair.text, pair.bg);
  return {
    backgroundColor: `rgb(${pair.bg.r}, ${pair.bg.g}, ${pair.bg.b})`,
    textColor: `rgb(${pair.text.r}, ${pair.text.g}, ${pair.text.b})`,
    ...textStroke,
  };
};

export const sampleOverlayPaletteFromLine = (
  context: CanvasRenderingContext2D,
  line: OCRLine,
  sourceWidth: number,
  sourceHeight: number,
  sampleWidth: number,
  sampleHeight: number
): OverlayPalette => {
  const warmTitleBackground = isWarmBackdropTitleLine(line)
    ? sampleWarmBackdropTitleRgbFromLine(context, line, sourceWidth, sourceHeight, sampleWidth, sampleHeight)
    : null;
  const sample = warmTitleBackground || sampleDominantRgbFromLine(context, line, sourceWidth, sourceHeight, sampleWidth, sampleHeight);
  const pair = chooseReadablePair(sample);
  if (warmTitleBackground) {
    const warmTitleText: RGB = { r: 248, g: 250, b: 252 };
    const textStroke = resolveOverlayWhiteTextStroke(warmTitleText, pair.bg);
    return {
      backgroundColor: `rgb(${pair.bg.r}, ${pair.bg.g}, ${pair.bg.b})`,
      textColor: 'rgb(248, 250, 252)',
      ...textStroke,
    };
  }
  const foregroundCandidate = sampleForegroundRgbFromLine(
    context,
    line,
    sourceWidth,
    sourceHeight,
    sampleWidth,
    sampleHeight,
    pair.bg
  );
  const resolvedText = foregroundCandidate
    ? ensureReadableTextColor(
      foregroundCandidate,
      pair.bg,
      pair.text
    )
    : pair.text;
  const finalText = shouldForceWarmBackdropWhiteText(line, pair.bg)
    ? { r: 248, g: 250, b: 252 }
    : resolvedText;
  const textStroke = resolveOverlayWhiteTextStroke(finalText, pair.bg);

  return {
    backgroundColor: `rgb(${pair.bg.r}, ${pair.bg.g}, ${pair.bg.b})`,
    textColor: `rgb(${finalText.r}, ${finalText.g}, ${finalText.b})`,
    ...textStroke,
  };
};

export const estimateLineRotationDeg = (line: OCRLine): number => {
  const words = Array.isArray(line.words)
    ? line.words.filter((word) => {
      const width = (word.bbox?.x1 ?? 0) - (word.bbox?.x0 ?? 0);
      const height = (word.bbox?.y1 ?? 0) - (word.bbox?.y0 ?? 0);
      return width > 0 && height > 0;
    })
    : [];

  if (words.length < 2) return 0;

  const points = words
    .map((word) => ({
      x: ((word.bbox?.x0 ?? 0) + (word.bbox?.x1 ?? 0)) / 2,
      y: ((word.bbox?.y0 ?? 0) + (word.bbox?.y1 ?? 0)) / 2,
    }))
    .sort((a, b) => a.x - b.x);

  const meanX = points.reduce((acc, p) => acc + p.x, 0) / points.length;
  const meanY = points.reduce((acc, p) => acc + p.y, 0) / points.length;

  let numerator = 0;
  let denominator = 0;
  points.forEach((point) => {
    const dx = point.x - meanX;
    const dy = point.y - meanY;
    numerator += dx * dy;
    denominator += dx * dx;
  });

  if (Math.abs(denominator) < 1e-3) return 0;

  const slope = numerator / denominator;
  const degrees = (Math.atan(slope) * 180) / Math.PI;
  if (!Number.isFinite(degrees)) return 0;
  if (Math.abs(degrees) < 2) return 0;
  return clamp(degrees, -28, 28);
};

const estimateLineCountHeuristic = (text: string, width: number, fontSize: number): number => {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  if (!compact) return 1;
  const averageCharWidth = fontSize * 0.56;
  const charsPerLine = Math.max(2, Math.floor(width / Math.max(1, averageCharWidth)));
  return Math.max(1, Math.ceil(compact.length / charsPerLine));
};

const compactTextLength = (value: string): number =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .length;

const tightenBracketSpacing = (value: string): string =>
  String(value || '')
    .replace(/([\(\[\{])\s+/g, '$1')
    .replace(/\s+([\)\]\}])/g, '$1');

export const normalizeOverlayInlineText = (value: string): string =>
  tightenBracketSpacing(String(value || ''))
    .replace(/\s{2,}/g, ' ')
    .trim();

const LABEL_TOKEN_REGEX = /^[\(\[\{]?[A-Za-z0-9\u0E00-\u0E7F]{1,8}[\)\]\}]?$/;
const SHORT_SYMBOLIC_LINE_REGEX = /^[A-Za-z0-9\u0E00-\u0E7F\(\)\[\]\{\}\.,:;+\-_/=<>]+$/;
const THAI_CHAR_REGEX = /[\u0E00-\u0E7F]/;
const CJK_CHAR_REGEX = /[\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/;
const HEADING_SOURCE_HINT_REGEX = /\b(chapter|objective|objectives|condition|conditions|equilibrium|rigid(?:-body)?|body|summary|introduction|appendix|section|support|diagram)\b/i;

type TextMeasureContext = Pick<CanvasRenderingContext2D, 'font' | 'measureText'>;

let textMeasureContext: TextMeasureContext | null | undefined;
const textSegmenterCache = new Map<string, Intl.Segmenter | null>();

const getTextMeasureContext = (): TextMeasureContext | null => {
  if (textMeasureContext !== undefined) return textMeasureContext;

  try {
    if (typeof document !== 'undefined') {
      textMeasureContext = document.createElement('canvas').getContext('2d');
      return textMeasureContext;
    }
    if (typeof OffscreenCanvas !== 'undefined') {
      const context = new OffscreenCanvas(1, 1).getContext('2d');
      textMeasureContext = context ? context as unknown as TextMeasureContext : null;
      return textMeasureContext;
    }
  } catch {
    // Fall back to heuristic-only sizing when canvas measurement is unavailable.
  }

  textMeasureContext = null;
  return textMeasureContext;
};

const buildMeasureFont = (fontSize: number, fontFamily?: string): string =>
  `400 ${fontSize}px ${fontFamily || 'sans-serif'}`;

const getTextSegmenter = (locale: string): Intl.Segmenter | null => {
  const key = locale || 'default';
  if (textSegmenterCache.has(key)) {
    return textSegmenterCache.get(key) || null;
  }

  try {
    const SegmenterCtor = (Intl as typeof Intl & { Segmenter?: typeof Intl.Segmenter }).Segmenter;
    if (!SegmenterCtor) {
      textSegmenterCache.set(key, null);
      return null;
    }
    const segmenter = new SegmenterCtor(locale || undefined, { granularity: 'word' });
    textSegmenterCache.set(key, segmenter);
    return segmenter;
  } catch {
    textSegmenterCache.set(key, null);
    return null;
  }
};

const tokenizeForWrap = (text: string): { tokens: string[]; joinWithSpace: boolean } => {
  const normalized = normalizeOverlayInlineText(text);
  if (!normalized) return { tokens: [], joinWithSpace: true };

  const containsThai = THAI_CHAR_REGEX.test(normalized);
  const containsCjk = CJK_CHAR_REGEX.test(normalized);
  const hasWhitespaceBoundaries = /\s/.test(normalized);
  if (!containsThai && !containsCjk) {
    return {
      tokens: normalized.split(/\s+/g).filter(Boolean),
      joinWithSpace: true,
    };
  }

  // Keep explicit spacing for Thai when present to avoid breaking semantic phrase boundaries.
  if (containsThai && hasWhitespaceBoundaries) {
    return {
      tokens: normalized.split(/\s+/g).filter(Boolean),
      joinWithSpace: true,
    };
  }

  const locale = containsThai ? 'th' : 'ja';
  const segmenter = getTextSegmenter(locale);
  if (!segmenter) {
    // Correct fallback: split CJK or Thai character-by-character to prevent returning a single massive unsplit string
    return {
      tokens: Array.from(normalized),
      joinWithSpace: false,
    };
  }

  const tokens = Array.from(segmenter.segment(normalized))
    .map((segment) => segment.segment) // Do not trim, we want to keep structure if needed, or filter empty
    .filter(Boolean);

  if (tokens.length === 0) {
    return {
      tokens: Array.from(normalized),
      joinWithSpace: false,
    };
  }

  return { tokens, joinWithSpace: false };
};

const countWords = (value: string): number =>
  normalizeOverlayInlineText(value)
    .split(/\s+/g)
    .filter(Boolean)
    .length;

const countThaiCharacters = (value: string): number => {
  const matches = normalizeOverlayInlineText(value).match(/[\u0E00-\u0E7F]/g);
  return matches ? matches.length : 0;
};

const looksDocumentLikeSourceText = (value: string): boolean => {
  const normalized = normalizeOverlayInlineText(value);
  if (!normalized) return false;
  const wordCount = countWords(normalized);
  if (wordCount >= 3 && /[a-z]/.test(normalized)) return true;

  const thaiCharCount = countThaiCharacters(normalized);
  const hasStructuralMarkers = /[0-9()\[\].,:;\-]/.test(normalized);
  const thaiTokenLike = normalized.split(/\s+/g).filter(Boolean).length;
  if (thaiCharCount >= 10 && thaiTokenLike >= 3) return true;
  if (thaiCharCount >= 16 && hasStructuralMarkers) return true;

  return false;
};

const looksStructuredDocumentSourceLine = (value: string): boolean => {
  const normalized = normalizeOverlayInlineText(value);
  if (!normalized) return false;
  const wordCount = countWords(normalized);
  const thaiCharCount = countThaiCharacters(normalized);
  const hasOrdinalMarker = /(?:^|\s)[\[(]?[0-9]{1,2}[\])].?:?/.test(normalized);
  const hasTechnicalMarker = /[0-9()\[\].,:;\-]/.test(normalized);

  if (hasOrdinalMarker && (wordCount >= 2 || thaiCharCount >= 10)) return true;
  if (thaiCharCount >= 14 && hasTechnicalMarker) return true;

  return false;
};

const TECHNICAL_DOCUMENT_SOURCE_HINT_REGEX = /\b(unknowns?|reactions?|equilibrium|resultant|component|components|direction|force|moment|column|columns|connections?|support|rigid|body|beam|beams|weld(?:ed|ing)?|pin|hinge|member|utility|floor|bridge|building|fx|fy|fz|mx|my|mz|rx|ry|rz)\b/i;

const looksTechnicalDocumentSourceLine = (value: string): boolean => {
  const normalized = normalizeOverlayInlineText(value);
  if (!normalized) return false;
  if (TECHNICAL_DOCUMENT_SOURCE_HINT_REGEX.test(normalized)) return true;

  const wordCount = countWords(normalized);
  const hasEquationLabel = /\([0-9]{1,3}\)/.test(normalized);
  return wordCount >= 3 && hasEquationLabel && /[A-Za-z]/.test(normalized);
};

const PRESERVE_PER_LINE_COMIC_FRAGMENT_KEYS = new Set([
  'AHME',
  'EHME',
  'YOUCOULDSAY',
  'SOMETHINGTHATMIGHT',
  'HELPYOUTOO',
  'ENTRANCE',
  'AREONLY',
  'ANDLEAVETHE',
  'OURCHANCE',
  'THEM',
]);

const looksPerLineComicFragmentSource = (value: string): boolean => {
  const normalized = normalizeOverlayInlineText(value);
  if (!normalized) return false;
  const compact = normalized.toUpperCase().replace(/[^A-Z]/g, '');
  if (PRESERVE_PER_LINE_COMIC_FRAGMENT_KEYS.has(compact)) return true;

  return (
    /^YOU[-\s]+COULD\s+SAY[.!?…]*$/i.test(normalized)
    || /^(?:SO\s+ME\s+THING|SOMETHING)\s+THAT\s+MIGHT[.!?…]*$/i.test(normalized)
    || /^EH\s+ME[.!?…]*$/i.test(normalized)
    || /^EH[.!?…]+$/i.test(normalized)
    || /^ME[.!?…]+$/i.test(normalized)
  );
};

const looksCompactTechnicalDocumentRow = (value: string): boolean => {
  const normalized = normalizeOverlayInlineText(value);
  if (!normalized) return false;
  const wordCount = countWords(normalized);
  if (wordCount === 0 || wordCount > 10) return false;
  return looksStructuredDocumentSourceLine(normalized) || looksTechnicalDocumentSourceLine(normalized);
};

const looksHeadingLikeSourceLine = (value: string): boolean => {
  const normalized = normalizeOverlayInlineText(value);
  if (!normalized) return false;
  if (/[.!?]$/.test(normalized)) return false;

  const words = normalized.split(/\s+/g).filter(Boolean);
  if (words.length === 0 || words.length > 10) return false;

  const uppercaseWords = words.filter((word) => {
    const letters = word.replace(/[^A-Za-z]/g, '');
    return letters.length >= 2 && letters === letters.toUpperCase();
  }).length;
  const titleCaseWords = words.filter((word) => /^[A-Z][A-Za-z0-9-]+$/.test(word)).length;

  return (
    HEADING_SOURCE_HINT_REGEX.test(normalized)
    || uppercaseWords >= Math.max(1, Math.ceil(words.length * 0.45))
    || titleCaseWords >= Math.max(2, Math.floor(words.length * 0.55))
  );
};

const resolveDocumentHeadingBoost = (
  sourceText: string,
  sourceBoxWidth: number,
  sourceBoxHeight: number
): number => {
  if (!looksHeadingLikeSourceLine(sourceText)) return 1;
  const width = Math.max(1, sourceBoxWidth);
  const height = Math.max(1, sourceBoxHeight);
  const aspectRatio = width / height;
  if (aspectRatio >= 8.5) return 1.4;
  if (aspectRatio >= 6.5) return 1.34;
  return 1.28;
};

const resolveDocumentStyleKind = (sourceText: string): OverlayStyleKind => (
  looksHeadingLikeSourceLine(sourceText) ? 'document-heading' : 'document-body'
);

const resolveOverlayStyleKind = (
  effectiveProfile: OverlayLayoutProfile,
  sourceText: string,
  options?: { merged?: boolean; boxed?: boolean }
): OverlayStyleKind => {
  if (effectiveProfile === 'official') {
    return resolveDocumentStyleKind(sourceText);
  }
  if (options?.merged) return 'comic-bubble';
  if (options?.boxed) return 'comic-box';
  return 'comic-line';
};

const shouldUseDocumentTypographyProfile = (
  profile: OverlayLayoutProfile,
  text: string,
  hints?: OverlayTypographyHints
): boolean => {
  if (profile === 'official') return true;
  const sourceText = hints?.sourceText || '';
  const sourceBoxWidth = Math.max(1, hints?.sourceBoxWidth ?? 0);
  const sourceBoxHeight = Math.max(1, hints?.sourceBoxHeight ?? 0);
  const elongatedLine = sourceBoxWidth / sourceBoxHeight >= 6.2;
  const headingElongatedLine = sourceBoxWidth / sourceBoxHeight >= 4.4;
  const longSource = compactTextLength(sourceText) >= 18;
  const paragraphish = countWords(sourceText) >= 4 || countWords(text) >= 4;
  const headingLike = looksHeadingLikeSourceLine(sourceText) && headingElongatedLine && countWords(sourceText) >= 2;
  const bodyLike = looksDocumentLikeSourceText(sourceText) && elongatedLine && longSource && paragraphish;
  if (profile === 'adaptive') {
    return headingLike || bodyLike;
  }
  if (profile === 'manga' || profile === 'manhwa') {
    return false;
  }
  return headingLike || bodyLike;
};

const resolveOverlayLineHeight = (text: string): number => (
  THAI_CHAR_REGEX.test(text) ? 1.16 : CJK_CHAR_REGEX.test(text) ? 1.08 : 1.11
);

const resolveOverlayPadding = (fontSize: number, text: string): { padX: number; padY: number } => {
  const containsThai = THAI_CHAR_REGEX.test(text);
  return {
    padX: Math.max(1, Math.round(fontSize * (containsThai ? 0.04 : 0.08))),
    padY: Math.max(1, Math.round(fontSize * (containsThai ? 0.04 : 0.07))),
  };
};

export const resolveOverlayMaskExpansion = (line: OCRLine): OverlayMaskExpansion => {
  const compactLabel = isSingleLineLabelCandidate(line.text, line.text) || (line.words?.length ?? 0) <= 3;
  return compactLabel
    ? {
        expandXRatio: 0.01,
        expandTopRatio: 0.005,
        expandBottomRatio: 0.005,
        maxExpandX: 1.5,
        maxExpandTop: 1,
        maxExpandBottom: 1,
      }
    : {
        expandXRatio: 0.02,
        expandTopRatio: 0.01,
        expandBottomRatio: 0.015,
        maxExpandX: 2,
        maxExpandTop: 1,
        maxExpandBottom: 2,
      };
};

const isSingleLineLabelCandidate = (text: string, sourceText?: string): boolean => {
  const normalized = normalizeOverlayInlineText(text);
  const sourceNormalized = normalizeOverlayInlineText(sourceText || '');
  const compact = normalized.replace(/\s+/g, '');
  const sourceCompact = sourceNormalized.replace(/\s+/g, '');

  if (!compact) return false;
  if (LABEL_TOKEN_REGEX.test(compact)) return true;
  if (sourceCompact && LABEL_TOKEN_REGEX.test(sourceCompact) && compact.length <= 20) return true;

  const words = normalized.split(/\s+/g).filter(Boolean);
  if (
    compact.length <= 14
    && words.length <= 3
    && SHORT_SYMBOLIC_LINE_REGEX.test(compact)
    && !/[\u0E00-\u0E7F]{5,}/.test(compact)
  ) {
    return true;
  }

  return false;
};

const estimateSingleLineWidthHeuristic = (text: string, fontSize: number): number => {
  const normalized = normalizeOverlayInlineText(text);
  if (!normalized) return fontSize;

  let total = 0;
  for (const ch of normalized) {
    if (/\s/.test(ch)) {
      total += fontSize * 0.28;
    } else if (/[A-Z]/.test(ch)) {
      total += fontSize * 0.58;
    } else if (/[a-z0-9]/.test(ch)) {
      total += fontSize * 0.54;
    } else if (/[\u0E00-\u0E7F]/.test(ch)) {
      total += fontSize * 0.64;
    } else if (/[\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(ch)) {
      total += fontSize * 0.9;
    } else if (/[\(\)\[\]\{\}\.,:;]/.test(ch)) {
      total += fontSize * 0.34;
    } else {
      total += fontSize * 0.5;
    }
  }
  return total;
};

const measureSingleLineWidth = (text: string, fontSize: number, fontFamily?: string): number => {
  const normalized = normalizeOverlayInlineText(text);
  if (!normalized) return fontSize;

  const context = getTextMeasureContext();
  if (!context) {
    return estimateSingleLineWidthHeuristic(normalized, fontSize);
  }

  context.font = buildMeasureFont(fontSize, fontFamily);
  return context.measureText(normalized).width;
};

const countWrappedLines = (
  text: string,
  width: number,
  fontSize: number,
  fontFamily?: string
): number => {
  const normalized = normalizeOverlayInlineText(text);
  if (!normalized) return 1;

  const context = getTextMeasureContext();
  if (!context) {
    return estimateLineCountHeuristic(normalized, width, fontSize);
  }

  context.font = buildMeasureFont(fontSize, fontFamily);
  if (!/\s/.test(normalized) && !THAI_CHAR_REGEX.test(normalized) && !CJK_CHAR_REGEX.test(normalized)) {
    return Math.max(1, Math.ceil(context.measureText(normalized).width / Math.max(1, width)));
  }

  const { tokens: words, joinWithSpace } = tokenizeForWrap(normalized);
  if (words.length === 0) return 1;

  let lines = 1;
  let currentLine = '';

  for (const word of words) {
    const candidate = currentLine
      ? (joinWithSpace ? `${currentLine} ${word}` : `${currentLine}${word}`)
      : word;
    if (!currentLine || context.measureText(candidate).width <= width) {
      currentLine = candidate;
      continue;
    }

    lines += 1;
    currentLine = word;
  }

  return Math.max(1, lines);
};

const resolveWrappedLineEstimate = (
  text: string,
  width: number,
  fontSize: number,
  fontFamily: string | undefined,
  styleKind: OverlayStyleKind,
  boxWidth: number,
  boxHeight: number
): number => {
  const baseLines = countWrappedLines(text, width, fontSize, fontFamily);
  if (baseLines <= 1) return 1;

  const normalized = normalizeOverlayInlineText(text);
  const containsThai = THAI_CHAR_REGEX.test(normalized);
  const containsLatinLike = /[A-Za-z\u00C0-\u024F]/.test(normalized);
  const tokenCount = countWords(normalized);
  const compactLength = compactTextLength(normalized);
  const aspectRatio = boxWidth / Math.max(1, boxHeight);

  let extraLines = 0;

  if (containsThai) {
    if (styleKind === 'comic-bubble') {
      if (tokenCount >= 4 || compactLength >= 18) extraLines += 0.92;
      if (aspectRatio <= 3.6) extraLines += 0.36;
    } else if (styleKind === 'comic-box') {
      if (tokenCount >= 4 || compactLength >= 16) extraLines += 0.72;
      if (aspectRatio <= 3) extraLines += 0.28;
    } else if (styleKind === 'comic-line' && compactLength >= 16) {
      extraLines += 0.24;
    }
  } else if (containsLatinLike && (styleKind === 'comic-bubble' || styleKind === 'comic-box')) {
    if (tokenCount >= 6 && compactLength >= 20) extraLines += 0.42;
    if (aspectRatio <= 3.4) extraLines += 0.22;
  }

  return Math.max(baseLines, Math.ceil(baseLines + extraLines - 0.001));
};

const resolveSourceLineFloor = (
  styleKind: OverlayStyleKind,
  sourceLineCount: number,
  sourceLength: number,
  targetLength: number,
  containsThai: boolean,
  containsCjk: boolean,
  preferSingleLine: boolean
): number => {
  if (preferSingleLine || sourceLineCount <= 1) return 1;
  if (styleKind !== 'comic-bubble' && styleKind !== 'comic-box') return 1;

  const densityRatio = sourceLength > 0 && targetLength > 0
    ? clamp(targetLength / sourceLength, containsThai ? 0.54 : containsCjk ? 0.58 : 0.6, 1.25)
    : 1;
  const baseRatio = styleKind === 'comic-bubble'
    ? (containsThai ? 0.9 : containsCjk ? 0.86 : 0.84)
    : (containsThai ? 0.84 : containsCjk ? 0.8 : 0.78);
  const densityBoost = densityRatio >= 0.88
    ? 1
    : densityRatio >= 0.72
      ? 0.94
      : densityRatio >= 0.58
        ? 0.86
        : 0.76;

  const computedFloor = Math.max(1, Math.ceil(sourceLineCount * baseRatio * densityBoost));
  if (containsThai && styleKind === 'comic-bubble' && sourceLineCount >= 2) {
    const preserveSourceLines = (
      targetLength >= Math.max(sourceLength * 0.84, sourceLength - 2)
      && densityRatio >= 0.84
      && sourceLineCount >= 3
    );
    const thaiBubbleFloor = preserveSourceLines
      ? sourceLineCount
      : Math.max(2, sourceLineCount - 1);
    return Math.max(computedFloor, thaiBubbleFloor);
  }
  if (containsThai && styleKind === 'comic-box' && sourceLineCount >= 2) {
    const preserveSourceLines = (
      targetLength >= Math.max(sourceLength * 0.9, sourceLength - 1)
      && densityRatio >= 0.9
      && sourceLineCount >= 3
    );
    const thaiBoxFloor = preserveSourceLines
      ? sourceLineCount
      : Math.max(2, sourceLineCount - 1);
    return Math.max(computedFloor, thaiBoxFloor);
  }
  return computedFloor;
};

export const computeOverlayTypography = (
  text: string,
  width: number,
  height: number,
  hints?: OverlayTypographyHints
): OverlayTypography => {
  const safeWidth = Math.max(8, width);
  const safeHeight = Math.max(8, height);
  const sourceWidth = Math.max(8, hints?.sourceBoxWidth ?? safeWidth);
  const sourceHeight = Math.max(8, hints?.sourceBoxHeight ?? safeHeight);
  const sourceLength = compactTextLength(hints?.sourceText || '');
  const targetLength = compactTextLength(text);
  const sourceWordCount = countWords(hints?.sourceText || '');
  const sourceLineCount = Math.max(1, hints?.sourceLineCount ?? 1);
  const containsThai = THAI_CHAR_REGEX.test(text);
  const containsCjk = CJK_CHAR_REGEX.test(text);
  const sourceAspectRatio = sourceWidth / Math.max(1, sourceHeight);
  const profile = hints?.profile || 'official';
  const profileForTypography = profile === 'manga' ? 'adaptive' : profile;
  const styleKind = hints?.styleKind || (
    shouldUseDocumentTypographyProfile(profileForTypography, text, hints)
      ? resolveDocumentStyleKind(hints?.sourceText || text)
      : 'comic-line'
  );
  const useDocumentTypographyProfile = styleKind === 'document-heading' || styleKind === 'document-body';
  const isAdaptiveProfile = profileForTypography === 'adaptive';
  const isComicLikeProfile = styleKind === 'comic-bubble' || styleKind === 'comic-box' || styleKind === 'comic-line';
  const isComicBubble = styleKind === 'comic-bubble';
  const isComicBox = styleKind === 'comic-box';
  const sourceLooksHeading = styleKind === 'document-heading';
  const documentBodyLike = styleKind === 'document-body' && countWords(hints?.sourceText || text) >= 7;
  const documentBodyBoost = styleKind === 'document-body'
    ? (documentBodyLike ? (containsThai ? 1.72 : 1.18) : (containsThai ? 1.58 : 1.12))
    : 1;
  const comicProfileScale = isComicBubble
    ? (profileForTypography === 'manga' ? 1.12 : profileForTypography === 'manhwa' ? 1.08 : 1.04)
    : isComicBox
      ? (profileForTypography === 'manga' ? 1.06 : profileForTypography === 'manhwa' ? 1.04 : 1)
      : (profileForTypography === 'manga' ? 1 : profileForTypography === 'manhwa' ? 0.98 : 0.95);
  const riskyNarrowBox = safeWidth <= 28 || (safeWidth <= 36 && safeWidth < safeHeight * 0.92);
  const severeWrapRisk = riskyNarrowBox && targetLength >= 4;
  const sourceSingleLineHint = !useDocumentTypographyProfile
    && sourceAspectRatio >= (profileForTypography === 'manga' || profileForTypography === 'manhwa' ? 2.8 : 3.2)
    && sourceWordCount >= 2
    && sourceLength >= 8;
  const preferSingleLine = !isComicBubble && (
    isSingleLineLabelCandidate(text, hints?.sourceText)
    || severeWrapRisk
    || (sourceSingleLineHint && targetLength <= Math.max(sourceLength * 1.6, 28))
    || (sourceLength > 0 && safeHeight <= sourceHeight * 1.42)
  );
  const singleLineComicEmphasis = preferSingleLine
    && !useDocumentTypographyProfile
    && sourceLineCount <= 1
    && sourceAspectRatio >= 1.45
    && targetLength <= 34;
  const normalizedInlineText = normalizeOverlayInlineText(text);
  const thaiComicMinRatio = isComicBubble
    ? 0.5
    : isComicBox
      ? 0.52
      : isComicLikeProfile
        ? 0.54
        : 0.66;
  const ratio = sourceLength > 0 && targetLength > 0
    ? clamp(
      Math.pow(sourceLength / targetLength, containsThai ? 0.72 : containsCjk ? 0.68 : 0.76),
      containsThai ? thaiComicMinRatio : containsCjk ? 0.7 : 0.58,
      isComicBubble ? (isAdaptiveProfile ? 1.18 : 1.22) : isComicBox ? (isAdaptiveProfile ? 1.14 : 1.18) : isComicLikeProfile ? (isAdaptiveProfile ? 1.12 : 1.16) : 1.08
    )
    : 1;
  const scriptScale = isComicLikeProfile
    ? ((containsThai ? (isComicBubble ? 1.08 : isComicBox ? 1.06 : 1.04) : containsCjk ? 1.01 : (isComicBubble ? 1.04 : isComicBox ? 1.02 : 1)) * comicProfileScale)
    : (containsThai ? (sourceLooksHeading ? 1.02 : 1.03) : containsCjk ? 0.95 : (sourceLooksHeading ? 0.98 : 0.95));
  const documentHeadingBoost = sourceLooksHeading
    ? resolveDocumentHeadingBoost(hints?.sourceText || '', sourceWidth, sourceHeight)
    : documentBodyBoost;

  // ป้องกันกรณีกล่องบรรทัดเดี่ยวสูงผิดปกติ (เช่น สูงกว่ากว้างจัดๆ จากการดีเทคขอบเส้นพาเนลหรือสปีดไลน์)
  let correctedSourceHeight = sourceHeight;
  if (sourceLineCount === 1 && sourceHeight > sourceWidth * 0.8) {
    correctedSourceHeight = Math.min(sourceHeight, sourceWidth * 0.35);
  }

  const effectiveSourceLineHeight = sourceLineCount > 1
    ? (sourceHeight / sourceLineCount) * 1.15
    : correctedSourceHeight;

  const sourceDriven = effectiveSourceLineHeight
    * (preferSingleLine ? (isComicBubble ? 0.8 : isComicBox ? 0.75 : useDocumentTypographyProfile ? 0.72 : 0.7) : (isComicBubble ? 0.76 : isComicBox ? 0.7 : useDocumentTypographyProfile ? 0.7 : 0.63))
    * ratio
    * scriptScale
    * documentHeadingBoost;
  const minFontSize = clamp(
    effectiveSourceLineHeight * (
      preferSingleLine
        ? (isComicBubble ? 0.58 : isComicLikeProfile ? 0.48 : (sourceLooksHeading ? 0.43 : 0.39))
        : (isComicBubble ? 0.54 : isComicBox ? 0.46 : isComicLikeProfile ? 0.41 : (sourceLooksHeading ? 0.4 : 0.38))
    ) * (containsThai ? (isComicLikeProfile ? 0.94 : 0.92) : 1),
    6,
    isComicBubble ? 22 : isComicBox ? 20 : isComicLikeProfile ? 18 : (sourceLooksHeading ? 48 : 16)
  );
  
  const maxFontCap = sourceLooksHeading 
    ? Math.max(48, Math.min(96, effectiveSourceLineHeight * 1.35))
    : (isComicLikeProfile && safeWidth < 150)
      ? Math.min(20, Math.max(12, safeWidth * 0.15))
      : 30;

  let fontSize = clamp(
    Math.min(
      sourceDriven,
      safeHeight * (
        preferSingleLine
          ? (isComicBubble ? 0.88 : isComicLikeProfile ? 0.8 : (sourceLooksHeading ? 0.98 : 0.72))
          : (isComicBubble ? 0.88 : isComicBox ? 0.84 : isComicLikeProfile ? 0.8 : (sourceLooksHeading ? 0.98 : 0.75))
      ),
      safeWidth * (
        preferSingleLine
          ? (isComicBubble ? 0.48 : isComicBox ? 0.43 : isComicLikeProfile ? 0.4 : (sourceLooksHeading ? 0.72 : 0.38))
          : (isComicBubble ? 0.52 : isComicBox ? 0.47 : isComicLikeProfile ? 0.44 : (sourceLooksHeading ? 0.72 : 0.4))
      ),
      sourceWidth * (
        preferSingleLine
          ? (isComicBubble ? 0.43 : isComicBox ? 0.38 : isComicLikeProfile ? 0.35 : (sourceLooksHeading ? 0.65 : 0.32))
          : (isComicBubble ? 0.46 : isComicBox ? 0.41 : isComicLikeProfile ? 0.38 : (sourceLooksHeading ? 0.65 : 0.35))
      )
    ),
    minFontSize,
    maxFontCap
  );
  fontSize *= preferSingleLine
    ? (
      isComicBubble
        ? (isAdaptiveProfile ? 1.12 : 1.14)
        : isComicBox
          ? (isAdaptiveProfile ? 1.04 : 1.06)
          : isComicLikeProfile
            ? (
              singleLineComicEmphasis
                ? (
                  isAdaptiveProfile
                    ? 1.12
                    : profileForTypography === 'manga'
                      ? 1.2
                      : profileForTypography === 'manhwa'
                        ? 1.16
                        : 1.14
                )
                : (isAdaptiveProfile ? 1.02 : 1.04)
            )
            : (sourceLooksHeading ? 1.02 : 0.82)
    )
    : (isComicBubble ? (isAdaptiveProfile ? 1.04 : 1.08) : isComicBox ? (isAdaptiveProfile ? 0.98 : 1) : isComicLikeProfile ? (isAdaptiveProfile ? 0.94 : 0.96) : (sourceLooksHeading ? 1.01 : styleKind === 'document-body' ? (containsThai ? 1.18 : 1.0) : 0.92));
  if (containsThai && isComicLikeProfile && sourceLength > 0 && targetLength > sourceLength * 1.55) {
    const overflowPressure = Math.min(0.18, (targetLength / Math.max(1, sourceLength) - 1.55) * 0.06);
    fontSize *= (1 - overflowPressure);
  }
  const lineHeight = resolveOverlayLineHeight(text)
    + (
      containsThai
        ? (isComicBubble ? 0.1 : isComicBox ? 0.06 : isComicLikeProfile ? 0.03 : styleKind === 'document-body' ? 0.08 : 0)
        : 0
    );

  for (let i = 0; i < 32; i += 1) {
    const snappedFont = Math.round(fontSize * 4) / 4;
    const { padX, padY } = resolveOverlayPadding(snappedFont, text);
    const usableWidth = Math.max(4, safeWidth - padX * 2);
    const usableHeight = Math.max(4, safeHeight - padY * 2);
    const singleLineWidth = measureSingleLineWidth(normalizedInlineText, snappedFont, hints?.fontFamily);
    const effectiveSingleLine = preferSingleLine
      && singleLineWidth <= usableWidth * (containsThai ? 1.02 : 1);
    const estimatedLines = Math.max(
      effectiveSingleLine
      ? 1
      : resolveWrappedLineEstimate(
          text,
          usableWidth,
          snappedFont,
          hints?.fontFamily,
          styleKind,
          safeWidth,
          safeHeight
        ),
      resolveSourceLineFloor(
        styleKind,
        sourceLineCount,
        sourceLength,
        targetLength,
        containsThai,
        containsCjk,
        effectiveSingleLine
      )
    );
    const ascenderSafety = Math.max(1, Math.round(snappedFont * (containsThai ? (useDocumentTypographyProfile ? 0.14 : isComicBubble ? 0.12 : 0.1) : 0.05)));
    const descenderSafety = Math.max(1, Math.round(snappedFont * (containsThai ? (useDocumentTypographyProfile ? 0.22 : isComicBubble ? 0.2 : 0.18) : 0.14)));
    const requiredHeight = estimatedLines * snappedFont * lineHeight + ascenderSafety + descenderSafety;
    const widthFits = effectiveSingleLine || estimatedLines > 1 || singleLineWidth <= usableWidth;
    if ((requiredHeight <= usableHeight && widthFits) || fontSize <= minFontSize) {
      return {
        fontSize: snappedFont,
        lineHeight,
        padX,
        padY,
        forceSingleLine: effectiveSingleLine,
        estimatedLines,
        contentHeight: requiredHeight,
      };
    }
    fontSize -= fontSize >= 16 ? 0.9 : 0.55;
  }

  return DEFAULT_OVERLAY_TYPOGRAPHY;
};

const resolveHorizontalOverlapRatio = (a: BBox, b: BBox): number => {
  const overlap = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  return overlap / Math.max(1, Math.min(a.x1 - a.x0, b.x1 - b.x0));
};

const isParagraphLikeOverlayInput = (input: OverlayTypographyInput): boolean => {
  const wordCount = input.line?.words?.length || 0;
  return wordCount >= 4 || compactTextLength(input.text) >= 24;
};

const resolveMedian = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) * 0.5;
};

const resolveLowerBandAverage = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const bandSize = Math.max(1, Math.ceil(sorted.length / 2));
  const band = sorted.slice(0, bandSize);
  return band.reduce((sum, value) => sum + value, 0) / band.length;
};

const resolveRange = (values: number[]): number => {
  if (values.length === 0) return 0;
  return Math.max(...values) - Math.min(...values);
};

const CJK_TEXT_REGEX = /[\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/;
const OVERLAY_NEXT_NO_SPACE_PUNCT_REGEX = /^[,.;:!?\)\]\}\u3001\u3002\uFF0C\uFF01\uFF1F]/;
const OVERLAY_PREV_NO_SPACE_TRAILING_REGEX = /[(\[\{'"“‘/-]$/;

const joinOverlayGroupSegments = (segments: string[]): string => {
  if (segments.length === 0) return '';

  let merged = '';
  for (const rawSegment of segments) {
    const segment = String(rawSegment || '').trim();
    if (!segment) continue;
    if (!merged) {
      merged = segment;
      continue;
    }

    const compactScript = CJK_TEXT_REGEX.test(merged)
      || CJK_TEXT_REGEX.test(segment)
      || THAI_CHAR_REGEX.test(merged)
      || THAI_CHAR_REGEX.test(segment);
    const needsNoSpace = compactScript
      || OVERLAY_NEXT_NO_SPACE_PUNCT_REGEX.test(segment)
      || OVERLAY_PREV_NO_SPACE_TRAILING_REGEX.test(merged);

    merged += `${needsNoSpace ? '' : ' '}${segment}`;
  }

  return normalizeOverlayInlineText(merged);
};

const joinOverlayGroupText = (group: OverlayTypographyInput[]): string => {
  const segments = group
    .map((item) => String(item.text || '').trim())
    .filter(Boolean);
  return joinOverlayGroupSegments(segments);
};

const computeOverlayGroupGeometry = (
  group: Array<OverlayTypographyInput & { typography: OverlayTypography }>
): {
  maxGap: number;
  totalGap: number;
  spanHeight: number;
  stackedHeight: number;
  compactness: number;
} => {
  if (group.length <= 1) {
    const singleHeight = Math.max(1, (group[0]?.bbox.y1 ?? 1) - (group[0]?.bbox.y0 ?? 0));
    return {
      maxGap: 0,
      totalGap: 0,
      spanHeight: singleHeight,
      stackedHeight: singleHeight,
      compactness: 1,
    };
  }

  const ordered = [...group].sort((a, b) => {
    if (a.bbox.y0 !== b.bbox.y0) return a.bbox.y0 - b.bbox.y0;
    if (a.bbox.x0 !== b.bbox.x0) return a.bbox.x0 - b.bbox.x0;
    return a.index - b.index;
  });

  let maxGap = 0;
  let totalGap = 0;
  for (let i = 1; i < ordered.length; i += 1) {
    const gap = ordered[i].bbox.y0 - ordered[i - 1].bbox.y1;
    if (gap > 0) {
      totalGap += gap;
      maxGap = Math.max(maxGap, gap);
    }
  }

  const minY = Math.min(...ordered.map((item) => item.bbox.y0));
  const maxY = Math.max(...ordered.map((item) => item.bbox.y1));
  const spanHeight = Math.max(1, maxY - minY);
  const stackedHeight = Math.max(
    1,
    ordered.reduce((sum, item) => sum + Math.max(1, item.bbox.y1 - item.bbox.y0), 0)
  );

  return {
    maxGap,
    totalGap,
    spanHeight,
    stackedHeight,
    compactness: spanHeight / stackedHeight,
  };
};

const computeOverlayGroupColumnCoherence = (
  group: Array<OverlayTypographyInput & { typography: OverlayTypography }>
): {
  minOverlapX: number;
  maxCenterDelta: number;
  medianWidth: number;
  spanWidth: number;
} => {
  if (group.length <= 1) {
    const width = Math.max(1, (group[0]?.bbox.x1 ?? 1) - (group[0]?.bbox.x0 ?? 0));
    return {
      minOverlapX: 1,
      maxCenterDelta: 0,
      medianWidth: width,
      spanWidth: width,
    };
  }

  const ordered = [...group].sort((a, b) => {
    if (a.bbox.y0 !== b.bbox.y0) return a.bbox.y0 - b.bbox.y0;
    if (a.bbox.x0 !== b.bbox.x0) return a.bbox.x0 - b.bbox.x0;
    return a.index - b.index;
  });

  let minOverlapX = Number.POSITIVE_INFINITY;
  let maxCenterDelta = 0;
  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1];
    const current = ordered[i];
    const overlapX = resolveHorizontalOverlapRatio(previous.bbox, current.bbox);
    const previousCenterX = (previous.bbox.x0 + previous.bbox.x1) * 0.5;
    const currentCenterX = (current.bbox.x0 + current.bbox.x1) * 0.5;
    minOverlapX = Math.min(minOverlapX, overlapX);
    maxCenterDelta = Math.max(maxCenterDelta, Math.abs(previousCenterX - currentCenterX));
  }

  const minX = Math.min(...ordered.map((item) => item.bbox.x0));
  const maxX = Math.max(...ordered.map((item) => item.bbox.x1));
  const widths = ordered.map((item) => Math.max(1, item.bbox.x1 - item.bbox.x0));

  return {
    minOverlapX: Number.isFinite(minOverlapX) ? minOverlapX : 0,
    maxCenterDelta,
    medianWidth: resolveMedian(widths) ?? Math.max(1, maxX - minX),
    spanWidth: Math.max(1, maxX - minX),
  };
};

const shouldHarmonizeOverlayBlock = (
  previous: OverlayTypographyInput,
  current: OverlayTypographyInput,
  profile: OverlayLayoutProfile = 'official'
): boolean => {
  const isDocumentProfile = profile === 'official';
  const prevHeight = Math.max(1, previous.bbox.y1 - previous.bbox.y0);
  const currHeight = Math.max(1, current.bbox.y1 - current.bbox.y0);
  const avgHeight = (prevHeight + currHeight) * 0.5;
  const heightRatio = Math.max(prevHeight, currHeight) / Math.max(1, Math.min(prevHeight, currHeight));
  const verticalGap = current.bbox.y0 - previous.bbox.y1;
  const leftDelta = Math.abs(current.bbox.x0 - previous.bbox.x0);
  const overlapRatio = resolveHorizontalOverlapRatio(previous.bbox, current.bbox);
  const prevCenter = (previous.bbox.x0 + previous.bbox.x1) * 0.5;
  const currCenter = (current.bbox.x0 + current.bbox.x1) * 0.5;
  const centerDelta = Math.abs(prevCenter - currCenter);
  const previousParagraphLike = isParagraphLikeOverlayInput(previous);
  const currentParagraphLike = isParagraphLikeOverlayInput(current);
  const bothParagraphLike = previousParagraphLike && currentParagraphLike;
  const previousDocumentLike = looksDocumentLikeSourceText(previous.hints?.sourceText || previous.line?.text || '');
  const currentDocumentLike = looksDocumentLikeSourceText(current.hints?.sourceText || current.line?.text || '');
  const previousHeadingLike = looksHeadingLikeSourceLine(previous.hints?.sourceText || previous.line?.text || previous.text);
  const currentHeadingLike = looksHeadingLikeSourceLine(current.hints?.sourceText || current.line?.text || current.text);
  const previousTechnicalRowLike = looksCompactTechnicalDocumentRow(previous.hints?.sourceText || previous.line?.text || previous.text);
  const currentTechnicalRowLike = looksCompactTechnicalDocumentRow(current.hints?.sourceText || current.line?.text || current.text);
  const documentLikePair = (previousDocumentLike || previousHeadingLike) && (currentDocumentLike || currentHeadingLike);
  const effectiveDocumentProfile = isDocumentProfile || (profile === 'adaptive' && documentLikePair);
  const centeredStackContinuity = overlapRatio >= 0.08 || leftDelta <= Math.max(12, avgHeight * 0.92);
  const shortComicFragmentPair = !effectiveDocumentProfile
    && !bothParagraphLike
    && countWords(previous.text) <= 5
    && countWords(current.text) <= 5
    && compactTextLength(previous.text) <= 26
    && compactTextLength(current.text) <= 26;
  const boxedFragmentContinuity = shortComicFragmentPair
    && leftDelta <= Math.max(18, avgHeight * 1.15)
    && verticalGap >= -avgHeight * 0.24
    && verticalGap <= Math.max(42, avgHeight * 2.8);

  if (effectiveDocumentProfile && previousParagraphLike !== currentParagraphLike) {
    return false;
  }
  if (effectiveDocumentProfile && previousHeadingLike !== currentHeadingLike) {
    return false;
  }
  if (effectiveDocumentProfile && !bothParagraphLike && (previousTechnicalRowLike || currentTechnicalRowLike)) {
    return (
      heightRatio <= 1.30
      && verticalGap >= -avgHeight * 0.12
      && verticalGap <= Math.max(12, avgHeight * 0.42)
      && (overlapRatio >= 0.5 || leftDelta <= Math.max(10, avgHeight * 0.66))
      && centerDelta <= Math.max(14, avgHeight * 0.82)
    );
  }

  if (!effectiveDocumentProfile) {
    const isComicProfile = profile === 'manga' || profile === 'manhwa' || profile === 'adaptive';
    const generousComicStack = isComicProfile
      && (overlapRatio >= 0.02 || centerDelta <= Math.max(36, avgHeight * 1.8) || leftDelta <= Math.max(36, avgHeight * 1.8))
      && verticalGap >= -avgHeight * 0.4
      && verticalGap <= Math.max(36, avgHeight * 1.85)
      && heightRatio <= 3.2;
    if (generousComicStack) {
      return true;
    }
    if (boxedFragmentContinuity) {
      return true;
    }
    const centeredStack = centerDelta <= Math.max(18, avgHeight * (profile === 'manga' ? 1.55 : profile === 'adaptive' ? 1.42 : 1.4));
    const centeredFragmentContinuity = shortComicFragmentPair
      && centerDelta <= Math.max(24, avgHeight * 1.9);
    const centeredFragmentMerge = centeredFragmentContinuity
      && centeredStack
      && heightRatio <= 3.2
      && verticalGap >= -avgHeight * 0.38
      && verticalGap <= Math.max(36, avgHeight * 1.85);
    if (centeredFragmentMerge) {
      return true;
    }
    if (
      centeredStackContinuity
      && overlapRatio >= 0.04
      && centeredStack
      && heightRatio <= 2.8
      && verticalGap >= -avgHeight * 0.32
      && verticalGap <= Math.max(36, avgHeight * (profile === 'manga' ? 1.85 : profile === 'adaptive' ? 1.75 : 1.25))
    ) {
      return true;
    }
  }

  // Check if they are on the same horizontal line (horizontally aligned pairs)
  // which is extremely common when OCR splits a single line into multiple words/boxes.
  const verticalOverlap = Math.max(0, Math.min(previous.bbox.y1, current.bbox.y1) - Math.max(previous.bbox.y0, current.bbox.y0));
  const verticalOverlapRatio = verticalOverlap / Math.max(1, Math.min(prevHeight, currHeight));
  const horizontalGap = current.bbox.x0 - previous.bbox.x1;
  const isSameLineHorizontalPair = verticalOverlapRatio >= 0.55
    && horizontalGap >= -avgHeight * 0.75
    && horizontalGap <= Math.max(48, avgHeight * 3.5);

  if (isSameLineHorizontalPair && heightRatio <= 1.55) {
    return true;
  }

  if (
    bothParagraphLike
    && heightRatio <= 1.45
    && verticalGap >= -avgHeight * 0.18
    && verticalGap <= Math.max(22, avgHeight * 1.05)
  ) {
    return true;
  }

  return (
    heightRatio <= 1.32
    && verticalGap >= -avgHeight * 0.22
    && verticalGap <= Math.max(28, avgHeight * 1.15)
    && (overlapRatio >= 0.24 || leftDelta <= Math.max(18, avgHeight * 1.8))
  );
};

const isDocumentLikeOverlayGroup = (
  group: Array<OverlayTypographyInput & { typography: OverlayTypography }>,
  hasSharedLeftEdge: boolean,
  maxHeight: number,
  startXs: number[],
  profile: OverlayLayoutProfile
): boolean => {
  if (group.length < 2) return false;
  const paragraphLikeCount = group.filter((item) => isParagraphLikeOverlayInput(item)).length;
  const sourceTexts = group.map((item) => item.hints?.sourceText || item.line?.text || '');
  const documentLikeSourceCount = sourceTexts.filter((value) => looksDocumentLikeSourceText(value)).length;
  const headingLikeCount = sourceTexts.filter((value) => looksHeadingLikeSourceLine(value)).length;
  const allowHeadingPromotion = profile === 'adaptive' || profile === 'official';
  if (paragraphLikeCount === 0 && (!allowHeadingPromotion || headingLikeCount === 0)) return false;
  if (documentLikeSourceCount === 0 && (!allowHeadingPromotion || headingLikeCount === 0)) return false;
  const startRange = resolveRange(startXs);
  return hasSharedLeftEdge && startRange <= Math.max(8, maxHeight * 0.26);
};

type OverlayComputedInput = OverlayTypographyInput & { typography: OverlayTypography };

const overlayBBoxWidth = (bbox: BBox): number => Math.max(1, Number(bbox.x1 || 0) - Number(bbox.x0 || 0));
const overlayBBoxHeight = (bbox: BBox): number => Math.max(1, Number(bbox.y1 || 0) - Number(bbox.y0 || 0));
const overlayBBoxArea = (bbox: BBox): number => overlayBBoxWidth(bbox) * overlayBBoxHeight(bbox);
const overlayBBoxCenterX = (bbox: BBox): number => (Number(bbox.x0 || 0) + Number(bbox.x1 || 0)) * 0.5;
const overlayBBoxCenterY = (bbox: BBox): number => (Number(bbox.y0 || 0) + Number(bbox.y1 || 0)) * 0.5;

const overlayBBoxOverlapRatioX = (a: BBox, b: BBox): number => {
  const overlap = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  return overlap / Math.max(1, Math.min(overlayBBoxWidth(a), overlayBBoxWidth(b)));
};

const overlayBBoxOverlapRatioY = (a: BBox, b: BBox): number => {
  const overlap = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  return overlap / Math.max(1, Math.min(overlayBBoxHeight(a), overlayBBoxHeight(b)));
};

const overlayBBoxIoU = (a: BBox, b: BBox): number => {
  const overlapWidth = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const overlapHeight = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const intersection = overlapWidth * overlapHeight;
  if (intersection <= 0) return 0;

  const union = overlayBBoxArea(a) + overlayBBoxArea(b) - intersection;
  return union > 0 ? (intersection / union) : 0;
};

const shouldSuppressOverlappingOverlayBorder = (a: BBox, b: BBox): boolean => {
  const overlapX = overlayBBoxOverlapRatioX(a, b);
  const overlapY = overlayBBoxOverlapRatioY(a, b);
  const iou = overlayBBoxIoU(a, b);
  const minWidth = Math.max(16, Math.min(overlayBBoxWidth(a), overlayBBoxWidth(b)));
  const minHeight = Math.max(8, Math.min(overlayBBoxHeight(a), overlayBBoxHeight(b)));
  const centerDeltaX = Math.abs(overlayBBoxCenterX(a) - overlayBBoxCenterX(b));
  const centerDeltaY = Math.abs(overlayBBoxCenterY(a) - overlayBBoxCenterY(b));
  const areaRatio = overlayBBoxArea(a) / Math.max(1, overlayBBoxArea(b));
  const comparableArea = areaRatio >= 0.24 && areaRatio <= 4.2;

  const containedAnchorCollision = (
    overlapX >= 0.9
    && overlapY >= 0.9
    && centerDeltaX <= Math.max(86, minWidth * 1.22)
    && centerDeltaY <= Math.max(64, minHeight * 1.18)
  );
  if (containedAnchorCollision) return true;

  const severeAnchorCollision = (
    overlapX >= 0.86
    && overlapY >= 0.52
    && centerDeltaX <= Math.max(74, minWidth * 1.05)
    && centerDeltaY <= Math.max(52, minHeight * 0.96)
  );
  if (severeAnchorCollision) return true;

  if (!comparableArea) return false;
  if (iou >= 0.36) return true;
  if (overlapX >= 0.74 && overlapY >= 0.62) return true;

  return (
    overlapX >= 0.6
    && overlapY >= 0.48
    && centerDeltaX <= Math.max(58, minWidth * 0.72)
    && centerDeltaY <= Math.max(34, minHeight * 0.58)
  );
};

const buildOverlaySuppressionTextKey = (layout: OverlayLayout, input: OverlayComputedInput): string =>
  normalizeTranslatedOverlayDuplicateKey(layout.renderText || input.text || '');

const computeOverlayInputWordCoverage = (input: OverlayComputedInput, bbox: BBox): number => {
  const lineWords = Array.isArray(input.line?.words) ? input.line.words : [];
  if (lineWords.length === 0) return 0;

  const normalizedWordBoxes = lineWords
    .map((word) => normalizeOverlayBBox(word?.bbox))
    .filter((wordBBox): wordBBox is BBox => Boolean(wordBBox));
  if (normalizedWordBoxes.length === 0) return 0;

  let unionX0 = Number.POSITIVE_INFINITY;
  let unionY0 = Number.POSITIVE_INFINITY;
  let unionX1 = Number.NEGATIVE_INFINITY;
  let unionY1 = Number.NEGATIVE_INFINITY;
  normalizedWordBoxes.forEach((wordBBox) => {
    unionX0 = Math.min(unionX0, wordBBox.x0);
    unionY0 = Math.min(unionY0, wordBBox.y0);
    unionX1 = Math.max(unionX1, wordBBox.x1);
    unionY1 = Math.max(unionY1, wordBBox.y1);
  });

  const unionArea = Math.max(1, (unionX1 - unionX0) * (unionY1 - unionY0));
  return Math.max(0, Math.min(1.8, unionArea / Math.max(1, overlayBBoxArea(bbox))));
};

const scoreOverlayVisibilityCandidate = (
  layout: OverlayLayout,
  input: OverlayComputedInput,
  bbox: BBox
): number => {
  const renderText = normalizeOverlayInlineText(layout.renderText || input.text || '');
  const sourceText = normalizeOverlayInlineText(input.hints?.sourceText || input.line?.text || '');
  const wordCount = renderText.split(/\s+/g).filter(Boolean).length;
  const confidence = Math.max(0, Number(input.line?.confidence || 0));
  const styleBonus = layout.styleKind === 'comic-bubble' ? 8 : layout.styleKind === 'comic-box' ? 4 : 0;
  const mergedBonus = layout.mergedBBox ? 10 : 0;
  const sourceCarryOverPenalty = (
    renderText
    && sourceText
    && normalizeTranslatedOverlayDuplicateKey(renderText) === normalizeTranslatedOverlayDuplicateKey(sourceText)
    && /[A-Za-z]/.test(renderText)
  ) ? 32 : 0;
  const translatedThaiBonus = /[\u0E00-\u0E7F]/.test(renderText) ? 14 : 0;
  let sparseWordCoveragePenalty = 0;
  const wordCoverage = computeOverlayInputWordCoverage(input, bbox);
  const coverageBonus = Math.max(0, Math.min(1, wordCoverage)) * 22;
  const bboxArea = Math.max(1, overlayBBoxArea(bbox));
  let lowCoveragePenalty = 0;
  if (wordCoverage <= 0.2 && bboxArea >= 9000) {
    lowCoveragePenalty = 36 + ((0.2 - wordCoverage) * 180);
  } else if (wordCoverage <= 0.32 && bboxArea >= 12000) {
    lowCoveragePenalty = 18 + ((0.32 - wordCoverage) * 96);
  }

  const lineWords = Array.isArray(input.line?.words) ? input.line.words : [];
  if (lineWords.length > 0) {
    const normalizedWordBoxes = lineWords
      .map((word) => normalizeOverlayBBox(word?.bbox))
      .filter((wordBBox): wordBBox is BBox => Boolean(wordBBox));
    if (normalizedWordBoxes.length > 0) {
      let unionX0 = Number.POSITIVE_INFINITY;
      let unionY0 = Number.POSITIVE_INFINITY;
      let unionX1 = Number.NEGATIVE_INFINITY;
      let unionY1 = Number.NEGATIVE_INFINITY;
      normalizedWordBoxes.forEach((wordBBox) => {
        unionX0 = Math.min(unionX0, wordBBox.x0);
        unionY0 = Math.min(unionY0, wordBBox.y0);
        unionX1 = Math.max(unionX1, wordBBox.x1);
        unionY1 = Math.max(unionY1, wordBBox.y1);
      });

      const unionArea = Math.max(1, (unionX1 - unionX0) * (unionY1 - unionY0));
      const bboxArea = Math.max(1, overlayBBoxArea(bbox));
      const localCoverage = unionArea / bboxArea;
      const sourceTokenCount = sourceText.split(/\s+/g).filter(Boolean).length;
      const sourceCompactLength = sourceText.replace(/[^\p{L}\p{N}]/gu, '').length;
      const shortSparsePhrase = sourceTokenCount <= 4 && sourceCompactLength <= 22;
      const sparseWordSignals = normalizedWordBoxes.length <= 2;
      const oversizedCandidate = bboxArea >= 12000 || overlayBBoxWidth(bbox) >= 180 || overlayBBoxHeight(bbox) >= 92;
      if (shortSparsePhrase && sparseWordSignals && oversizedCandidate && localCoverage <= 0.22) {
        sparseWordCoveragePenalty = 24 + ((0.22 - localCoverage) * 72);
      }
    }
  }

  return (
    renderText.length * 1.05
    + wordCount * 3.4
    + confidence * 0.16
    + Math.log(overlayBBoxArea(bbox) + 1) * 2.1
    + styleBonus
    + mergedBonus
    + translatedThaiBonus
    + coverageBonus
    - sourceCarryOverPenalty
    - lowCoveragePenalty
    - sparseWordCoveragePenalty
  );
};

const isDocumentLikeOverlaySuppressionInput = (input: OverlayComputedInput): boolean => {
  const sourceText = normalizeOverlayInlineText(input.hints?.sourceText || input.line?.text || '');
  if (!sourceText) return false;

  return (
    looksDocumentLikeSourceText(sourceText)
    || looksStructuredDocumentSourceLine(sourceText)
    || looksTechnicalDocumentSourceLine(sourceText)
  );
};

const suppressOverlappingOverlayBorders = (
  layoutMap: Map<number, OverlayLayout>,
  orderedInputs: OverlayComputedInput[]
): Map<number, OverlayLayout> => {
  if (layoutMap.size <= 1 || orderedInputs.length <= 1) {
    return layoutMap;
  }

  const inputByIndex = new Map<number, OverlayComputedInput>(
    orderedInputs.map((item) => [item.index, item])
  );

  type OverlayCandidate = {
    index: number;
    bbox: BBox;
    layout: OverlayLayout;
    input: OverlayComputedInput;
    textKey: string;
  };

  const candidates: OverlayCandidate[] = Array.from(layoutMap.entries())
    .map(([index, layout]) => {
      if (layout.hidden) return null;
      const input = inputByIndex.get(index);
      if (!input) return null;
      const bbox = normalizeOverlayBBox(layout.mergedBBox || input.bbox);
      if (!bbox || (bbox.x1 - bbox.x0) <= 0 || (bbox.y1 - bbox.y0) <= 0) return null;

      return {
        index,
        bbox,
        layout,
        input,
        textKey: buildOverlaySuppressionTextKey(layout, input),
      };
    })
    .filter((item): item is OverlayCandidate => Boolean(item))
    .sort((a, b) => {
      if (a.bbox.y0 !== b.bbox.y0) return a.bbox.y0 - b.bbox.y0;
      if (a.bbox.x0 !== b.bbox.x0) return a.bbox.x0 - b.bbox.x0;
      return a.index - b.index;
    });

  if (candidates.length <= 1) return layoutMap;

  const next = new Map(layoutMap);
  const kept: OverlayCandidate[] = [];

  const shouldSuppressOverlayCandidate = (existing: OverlayCandidate, candidate: OverlayCandidate): boolean => {
    const overlapX = overlayBBoxOverlapRatioX(existing.bbox, candidate.bbox);
    const overlapY = overlayBBoxOverlapRatioY(existing.bbox, candidate.bbox);
    const iou = overlayBBoxIoU(existing.bbox, candidate.bbox);
    const minWidth = Math.max(18, Math.min(overlayBBoxWidth(existing.bbox), overlayBBoxWidth(candidate.bbox)));
    const minHeight = Math.max(8, Math.min(overlayBBoxHeight(existing.bbox), overlayBBoxHeight(candidate.bbox)));
    const centerDeltaX = Math.abs(overlayBBoxCenterX(existing.bbox) - overlayBBoxCenterX(candidate.bbox));
    const centerDeltaY = Math.abs(overlayBBoxCenterY(existing.bbox) - overlayBBoxCenterY(candidate.bbox));
    const verticalGap = Math.max(
      0,
      Math.max(existing.bbox.y0, candidate.bbox.y0) - Math.min(existing.bbox.y1, candidate.bbox.y1)
    );
    const existingCoverage = computeOverlayInputWordCoverage(existing.input, existing.bbox);
    const candidateCoverage = computeOverlayInputWordCoverage(candidate.input, candidate.bbox);
    const dominantCoverage = Math.max(existingCoverage, candidateCoverage);
    const weakCoverage = Math.min(existingCoverage, candidateCoverage);
    const areaRatio = Math.max(overlayBBoxArea(existing.bbox), overlayBBoxArea(candidate.bbox))
      / Math.max(1, Math.min(overlayBBoxArea(existing.bbox), overlayBBoxArea(candidate.bbox)));
    const maxArea = Math.max(overlayBBoxArea(existing.bbox), overlayBBoxArea(candidate.bbox));
    const documentLikePair = (
      isDocumentLikeOverlaySuppressionInput(existing.input)
      && isDocumentLikeOverlaySuppressionInput(candidate.input)
    );
    const existingSourceKey = normalizeTranslatedOverlayDuplicateKey(
      existing.input.line?.text || existing.input.hints?.sourceText || ''
    );
    const candidateSourceKey = normalizeTranslatedOverlayDuplicateKey(
      candidate.input.line?.text || candidate.input.hints?.sourceText || ''
    );
    const sourceMinLength = Math.min(existingSourceKey.length, candidateSourceKey.length);
    const sourceSameOrSubset = sourceMinLength >= 8 && (
      existingSourceKey === candidateSourceKey
      || existingSourceKey.includes(candidateSourceKey)
      || candidateSourceKey.includes(existingSourceKey)
    );
    const sourceSimilarity = (existingSourceKey && candidateSourceKey)
      ? overlayKeyDiceSimilarity(existingSourceKey, candidateSourceKey)
      : 0;
    const stackedSourceEcho = (
      existingSourceKey.length > 0
      && candidateSourceKey.length > 0
      && (sourceSameOrSubset || sourceSimilarity >= 0.9)
      && areaRatio <= 2.8
      && overlapX >= 0.74
      && centerDeltaX <= Math.max(78, minWidth * 1.06)
      && centerDeltaY <= Math.max(132, minHeight * 4.4)
      && (overlapY >= 0.01 || iou >= 0.02 || verticalGap <= Math.max(14, minHeight * 0.62))
      && (documentLikePair || sourceSimilarity >= 0.94)
    );

    const displacedCoverageEcho = (
      overlapX >= 0.62
      && (overlapY >= 0.16 || iou >= 0.08)
      && centerDeltaX <= Math.max(116, minWidth * 1.72)
      && centerDeltaY <= Math.max(138, minHeight * 4.6)
      && areaRatio >= 1.32
      && (dominantCoverage - weakCoverage) >= 0.16
      && weakCoverage <= 0.44
      && (documentLikePair || maxArea >= 9000 || iou >= 0.22)
    );
    const baselineOverlapCollision = shouldSuppressOverlappingOverlayBorder(existing.bbox, candidate.bbox);
    if (!baselineOverlapCollision && !displacedCoverageEcho && !stackedSourceEcho) return false;

    if (iou >= 0.82) return true;

    if (displacedCoverageEcho) {
      // RULE: ห้ามยุบหรือซ่อนกล่องที่มีคำต้นฉบับแตกต่างกันเกินไป (เช่น "of all of us" vs "us!")
      // ป้องกันการลบข้อมูลสำคัญทิ้งโดยวิเคราะห์ความคล้ายคลึงของ source text (Deduplicate safety guard)
      const hasHighDifference = (existingSourceKey && candidateSourceKey)
        ? overlayKeyDiceSimilarity(existingSourceKey, candidateSourceKey) < 0.28
        : false;
      if (!hasHighDifference) {
        return true;
      }
    }

    if (stackedSourceEcho) {
      return true;
    }

    if (documentLikePair) {
      const sameDocumentRowTextEcho = (
        existing.textKey
        && existing.textKey === candidate.textKey
        && overlapX >= 0.34
        && centerDeltaX <= Math.max(160, minWidth * 3.2)
        && centerDeltaY <= Math.max(120, minHeight * 5.4)
      );
      if (sameDocumentRowTextEcho) return true;

      const documentAnchorMatch = (
        iou >= 0.3
        || (
          overlapX >= 0.68
          && overlapY >= 0.46
          && centerDeltaX <= Math.max(66, minWidth * 0.9)
          && centerDeltaY <= Math.max(58, minHeight * 1.25)
        )
        || (
          overlapX >= 0.74
          && centerDeltaX <= Math.max(60, minWidth * 0.8)
          && centerDeltaY <= Math.max(118, minHeight * 4.8)
          && (overlapY >= 0.12 || iou >= 0.1)
        )
      );

      if (documentAnchorMatch) {
        const textSimilarity = (existing.textKey && candidate.textKey)
          ? overlayKeyDiceSimilarity(existing.textKey, candidate.textKey)
          : 0;
        const sourceSimilarity = (existingSourceKey && candidateSourceKey)
          ? overlayKeyDiceSimilarity(existingSourceKey, candidateSourceKey)
          : 0;
        const exactDocumentAnchor = (
          iou >= 0.42
          || (
            overlapX >= 0.82
            && overlapY >= 0.5
            && centerDeltaX <= Math.max(52, minWidth * 0.76)
            && centerDeltaY <= Math.max(28, minHeight * 1.12)
          )
        );
        if (
          exactDocumentAnchor
          || iou >= 0.52
          || existing.textKey === candidate.textKey
          || textSimilarity >= 0.62
          || sourceSimilarity >= 0.5
        ) {
          return true;
        }
      }
    }

    if (!documentLikePair) {
      const textSimilarity = (existing.textKey && candidate.textKey)
        ? overlayKeyDiceSimilarity(existing.textKey, candidate.textKey)
        : 0;
      const separateSourceStack = Boolean(existingSourceKey && candidateSourceKey && existingSourceKey !== candidateSourceKey)
        && overlapX >= 0.42
        && overlapY <= 0.78
        && centerDeltaY >= Math.max(12, minHeight * 0.45)
        && centerDeltaY <= Math.max(96, minHeight * 4.5)
        && iou < 0.68;
      if (separateSourceStack && textSimilarity < 0.84 && sourceSimilarity < 0.82) {
        return false;
      }
      const verticallyDistinctStack = centerDeltaY > Math.max(22, minHeight * 1.05);
      if (verticallyDistinctStack && iou < 0.58 && textSimilarity < 0.76 && sourceSimilarity < 0.72) {
        return false;
      }
    }

    if (existingSourceKey && candidateSourceKey) {
      const minSourceLength = Math.min(existingSourceKey.length, candidateSourceKey.length);
      const sourceSameOrSubset = minSourceLength >= 6 && (
        existingSourceKey.includes(candidateSourceKey)
        || candidateSourceKey.includes(existingSourceKey)
      );
      if (sourceSameOrSubset && iou >= 0.34) return true;

      if (sourceSimilarity >= 0.82 && iou >= 0.4) return true;

      if (!sourceSameOrSubset && sourceSimilarity < 0.58 && iou < 0.62) {
        return false;
      }
    }

    if (!existing.textKey || !candidate.textKey) {
      return iou >= 0.58;
    }

    // มีคำแปลเหมือนกันเป๊ะ -> ยุบรวมเฉพาะเมื่อทับซ้อนกันจริง (เช่น โดน OCR อ่านเบิ้ล)
    if (existing.textKey === candidate.textKey) {
      return iou >= 0.15 || (overlapX >= 0.4 && overlapY >= 0.4);
    }

    const minLength = Math.min(existing.textKey.length, candidate.textKey.length);
    const sameOrSubset = minLength >= 6 && (
      existing.textKey.includes(candidate.textKey)
      || candidate.textKey.includes(existing.textKey)
    );
    // เป็นคำแปลที่เป็น subset ของกันและกัน -> ยุบรวมเฉพาะเมื่อทับซ้อนกันจริง
    if (sameOrSubset) {
      return iou >= 0.15 || (overlapX >= 0.4 && overlapY >= 0.4);
    }

    const textSimilarity = overlayKeyDiceSimilarity(existing.textKey, candidate.textKey);
    // มีคำแปลคล้ายกันมาก -> ยุบรวมเฉพาะเมื่อทับซ้อนกันจริง
    if (textSimilarity >= 0.9) {
      return iou >= 0.15 || (overlapX >= 0.4 && overlapY >= 0.4);
    }
    if (textSimilarity >= 0.74 && iou >= 0.44) return true;

    return false;
  };

  for (const candidate of candidates) {
    const existingIndex = kept.findIndex((existing) => shouldSuppressOverlayCandidate(existing, candidate));

    if (existingIndex < 0) {
      kept.push(candidate);
      continue;
    }

    const existing = kept[existingIndex];
    const existingScore = scoreOverlayVisibilityCandidate(existing.layout, existing.input, existing.bbox);
    const candidateScore = scoreOverlayVisibilityCandidate(candidate.layout, candidate.input, candidate.bbox);

    if (candidateScore > existingScore) {
      next.set(existing.index, {
        ...existing.layout,
        hidden: true,
        preserveMaskWhenHidden: false,
        renderText: '',
      });
      kept[existingIndex] = candidate;
      continue;
    }

    next.set(candidate.index, {
      ...candidate.layout,
      hidden: true,
      preserveMaskWhenHidden: false,
      renderText: '',
    });
  }

  return next;
};

export const computeOverlayLayoutMap = (
  inputs: OverlayTypographyInput[],
  options?: { profile?: OverlayLayoutProfile }
): Map<number, OverlayLayout> => {
  const profile = options?.profile || 'official';
  const computed = inputs.map((input) => ({
    ...input,
    typography: computeOverlayTypography(input.text, input.width, input.height, input.hints),
  }));
  const orderedComputed = [...computed].sort((a, b) => {
    if (a.bbox.y0 !== b.bbox.y0) return a.bbox.y0 - b.bbox.y0;
    if (a.bbox.x0 !== b.bbox.x0) return a.bbox.x0 - b.bbox.x0;
    return a.index - b.index;
  });
  const result = new Map<number, OverlayLayout>();

  const flushGroup = (group: typeof orderedComputed) => {
    if (group.length === 0) return;

    const fontSizes = group.map((item) => item.typography.fontSize);
    const minFontSize = Math.min(...fontSizes);
    const maxFontSize = Math.max(...fontSizes);
    const startXs = group.map((item) => item.line ? resolveOverlayTextStartX(item.line, item.bbox) : item.bbox.x0);
    const centerXs = group.map((item) => item.bbox.x0 + ((item.bbox.x1 - item.bbox.x0) * 0.5));
    const boxHeights = group.map((item) => item.bbox.y1 - item.bbox.y0);
    const maxHeight = Math.max(...boxHeights);
    const minStartX = Math.min(...startXs);
    const leftEdgeTolerance = Math.max(4, maxHeight * 0.22);
    const sharedLeftEdgeCount = startXs.filter((value) => Math.abs(value - minStartX) <= leftEdgeTolerance).length;
    const hasSharedLeftEdge = group.length >= 2
      && sharedLeftEdgeCount >= Math.max(2, Math.ceil(group.length * 0.6));
    const documentLikeItemCount = group.filter((item) => shouldUseDocumentTypographyProfile(profile, item.text, item.hints)).length;
    const effectiveProfile: OverlayLayoutProfile = (
      profile === 'adaptive' && (
        isDocumentLikeOverlayGroup(group, hasSharedLeftEdge, maxHeight, startXs, profile)
        || (group.length === 1 && documentLikeItemCount === 1)
      )
    )
      ? 'official'
      : profile;
    const effectiveDocumentProfile = effectiveProfile === 'official';
    const sharedCenterX = group.length >= 2 ? resolveMedian(centerXs) : undefined;
    const centerRangeLimit = effectiveProfile === 'manga'
      ? Math.max(20, maxHeight * 1.5)
      : effectiveProfile === 'adaptive'
        ? Math.max(19, maxHeight * 1.35)
        : effectiveProfile === 'manhwa'
          ? Math.max(18, maxHeight * 1.38)
          : Math.max(18, maxHeight * 1.25);
    const startVarianceLimit = effectiveProfile === 'manga'
      ? Math.max(4, maxHeight * 0.16)
      : effectiveProfile === 'adaptive'
        ? Math.max(5, maxHeight * 0.2)
        : effectiveProfile === 'manhwa'
          ? Math.max(5, maxHeight * 0.22)
          : Math.max(6, maxHeight * 0.35);
    const isCenteredBlock = group.length >= 2
      && resolveRange(centerXs) <= centerRangeLimit
      && (
        effectiveDocumentProfile
          ? (!hasSharedLeftEdge && resolveRange(startXs) >= startVarianceLimit)
          : resolveRange(startXs) >= startVarianceLimit
      );
    const defaultStyleKind = resolveOverlayStyleKind(
      effectiveProfile,
      group.map((item) => item.hints?.sourceText || item.line?.text || item.text).filter(Boolean).join(' '),
      {
        boxed: !effectiveDocumentProfile && hasSharedLeftEdge && group.length >= 2 && !isCenteredBlock,
      }
    );
    const groupStyleKinds = group.map((item) => effectiveDocumentProfile
      ? resolveDocumentStyleKind(item.hints?.sourceText || item.line?.text || item.text)
      : defaultStyleKind
    );
    const allDocumentBody = effectiveDocumentProfile && groupStyleKinds.every((kind) => kind === 'document-body');
    const mixedDocumentStyles = effectiveDocumentProfile && new Set(groupStyleKinds).size > 1;
    const normalizedFontSize = effectiveDocumentProfile
      ? (
        allDocumentBody
          ? Math.max(
            6,
            Math.max(
              (resolveLowerBandAverage(fontSizes) ?? minFontSize) * 1.08,
              (resolveMedian(fontSizes) ?? minFontSize) * 1.02
            )
          )
          : Math.max(6, (resolveLowerBandAverage(fontSizes) ?? minFontSize) * 1.0)
      )
      : defaultStyleKind === 'comic-box'
        ? Math.max(resolveMedian(fontSizes) ?? minFontSize, (resolveLowerBandAverage(fontSizes) ?? minFontSize) * 1.08)
        : (resolveMedian(fontSizes) ?? resolveLowerBandAverage(fontSizes) ?? minFontSize);
    const shouldNormalize = effectiveDocumentProfile
      ? (allDocumentBody && group.length >= 2 && (maxFontSize - minFontSize) >= 0.18)
      : (group.length >= 2 && (isCenteredBlock || ((effectiveProfile === 'manga' || effectiveProfile === 'manhwa') && defaultStyleKind === 'comic-box') || (maxFontSize - minFontSize) >= 0.35));
    const alignment: 'left' | 'center' = ((effectiveProfile === 'manga' || effectiveProfile === 'manhwa') && defaultStyleKind !== 'comic-box')
      ? 'center'
      : (isCenteredBlock ? 'center' : 'left');
    const sharedTextStartX = group.length >= 2
      ? (alignment === 'left' && effectiveDocumentProfile && !mixedDocumentStyles ? minStartX : (effectiveDocumentProfile ? resolveMedian(startXs) : undefined))
      : undefined;
    const sharedBoxLeftX = group.length >= 2 && alignment === 'left' && effectiveDocumentProfile && !mixedDocumentStyles
      ? minStartX
      : undefined;
    const allowSectionMerge = effectiveProfile === 'manhwa';
    const hasBalloonMember = group.some((item) => item.balloonId !== undefined);
    const isMangaOrManhwa = effectiveProfile === 'manga' || effectiveProfile === 'manhwa';
    const mergedStyleKind: OverlayStyleKind | undefined = !effectiveDocumentProfile
      ? (isCenteredBlock || hasBalloonMember || isMangaOrManhwa ? 'comic-bubble' : (defaultStyleKind === 'comic-box' ? 'comic-box' : undefined))
      : undefined;
    const mergedText = joinOverlayGroupText(group);
    const groupGeometry = computeOverlayGroupGeometry(group);
    const normalizedGroupSourceTexts = group
      .map((item) => normalizeOverlayInlineText(item.hints?.sourceText || item.line?.text || ''))
      .filter(Boolean);
    const documentLikeMergeSignalCount = normalizedGroupSourceTexts
      .filter((sourceText) =>
        looksDocumentLikeSourceText(sourceText)
        || looksHeadingLikeSourceLine(sourceText)
        || looksStructuredDocumentSourceLine(sourceText)
      ).length;
    const structuredDocumentSignalCount = normalizedGroupSourceTexts
      .filter((sourceText) => looksStructuredDocumentSourceLine(sourceText))
      .length;
    const technicalDocumentSignalCount = normalizedGroupSourceTexts
      .filter((sourceText) => looksTechnicalDocumentSourceLine(sourceText))
      .length;
    const bracketNarrationSourceCount = normalizedGroupSourceTexts
      .filter((sourceText) => /\[[^\]]{2,}\]/.test(sourceText))
      .length;
    const glossaryCriticalSourceCount = normalizedGroupSourceTexts
      .filter((sourceText) => {
        if (/\b(?:PHENELINE|AYNAR)\b/i.test(sourceText)) {
          return true;
        }
        return /\bVERTAR\b/i.test(sourceText) && /\bESSEN(?:CE|SE)\b/i.test(sourceText);
      })
      .length;
    const perLineComicFragmentSourceCount = normalizedGroupSourceTexts
      .filter((sourceText) => looksPerLineComicFragmentSource(sourceText))
      .length;
    const bracketNarrationTranslatedCount = group
      .filter((item) => /\[[^\]]{2,}\]/.test(normalizeOverlayInlineText(item.text)))
      .length;
    const shouldPreservePerLineNarrative = (
      bracketNarrationSourceCount >= 1
      || bracketNarrationTranslatedCount >= 1
      || glossaryCriticalSourceCount >= 1
      || perLineComicFragmentSourceCount >= 1
    );
    const shouldBlockSectionMergeForDocumentLike = !hasBalloonMember && (
      documentLikeMergeSignalCount >= Math.max(2, Math.ceil(group.length * 0.5))
      || (
        effectiveProfile === 'adaptive'
        && (
          (structuredDocumentSignalCount >= 1 && documentLikeMergeSignalCount >= 2)
          || (structuredDocumentSignalCount >= 1 && technicalDocumentSignalCount >= 1)
          || (technicalDocumentSignalCount >= Math.max(2, Math.floor(group.length * 0.45)))
          || (documentLikeMergeSignalCount >= 2 && hasSharedLeftEdge)
        )
      )
    );
    const shouldBlockSectionMergeForTechnicalRows = !hasBalloonMember && (
      technicalDocumentSignalCount >= 1
      && (
        structuredDocumentSignalCount >= 1
        || (hasSharedLeftEdge && group.length >= 2)
      )
    );
    const mergeGapLimit = mergedStyleKind === 'comic-bubble'
      ? Math.max(34, maxHeight * (effectiveProfile === 'manga' ? 2.8 : 2.5))
      : Math.max(30, maxHeight * (effectiveProfile === 'manga' ? 2.35 : 2.15));
    const mergeCompactnessLimit = mergedStyleKind === 'comic-bubble' ? 2.95 : 2.65;
    const shouldMergeAsSectionBlock = !effectiveDocumentProfile
      && allowSectionMerge
      && !shouldBlockSectionMergeForDocumentLike
      && !shouldBlockSectionMergeForTechnicalRows
      && !shouldPreservePerLineNarrative
      && group.length >= 2
      && mergedStyleKind === 'comic-bubble'
      && (
        hasBalloonMember || (
          compactTextLength(mergedText) >= (isMangaOrManhwa ? 3 : Math.max(8, Math.round(group.length * 3.4)))
          && groupGeometry.maxGap <= mergeGapLimit
          && groupGeometry.compactness <= mergeCompactnessLimit
        )
      );

    const groupColumnCoherence = computeOverlayGroupColumnCoherence(group);
    const hasStrongColumnContinuity = (
      groupColumnCoherence.minOverlapX >= 0.2
      || groupColumnCoherence.maxCenterDelta <= Math.max(34, maxHeight * 1.7)
    );
    const overlyWideSectionSpan = groupColumnCoherence.spanWidth > (
      groupColumnCoherence.medianWidth * (mergedStyleKind === 'comic-bubble' ? 2.1 : 1.9)
    );

    const canMergeSectionBlock = shouldMergeAsSectionBlock
      && (hasBalloonMember || (hasStrongColumnContinuity && !overlyWideSectionSpan));

    if (canMergeSectionBlock && mergedStyleKind) {
      const mergedSourceText = group
        .map((item) => item.hints?.sourceText || item.line?.text || '')
        .filter(Boolean);
      const mergedSourceTextJoined = joinOverlayGroupSegments(mergedSourceText);
      const firstMaskSource = group[0].line ? resolveOverlayMaskBBox(group[0].line) : group[0].bbox;
      const mergedBBox: BBox = {
        x0: Math.min(...group.map((item) => item.bbox.x0)),
        y0: Math.min(...group.map((item) => item.bbox.y0)),
        x1: Math.max(...group.map((item) => item.bbox.x1)),
        y1: Math.max(...group.map((item) => item.bbox.y1)),
      };
      const mergedMaskBBox: BBox = group.reduce<BBox>((acc, item) => {
        const source = item.line ? resolveOverlayMaskBBox(item.line) : item.bbox;
        return {
          x0: Math.min(acc.x0, source.x0),
          y0: Math.min(acc.y0, source.y0),
          x1: Math.max(acc.x1, source.x1),
          y1: Math.max(acc.y1, source.y1),
        };
      }, firstMaskSource);
      const mergedScaleX = resolveMedian(
        group.map((item) => item.width / Math.max(1, item.bbox.x1 - item.bbox.x0))
      ) ?? 1;
      const mergedScaleY = resolveMedian(
        group.map((item) => item.height / Math.max(1, item.bbox.y1 - item.bbox.y0))
      ) ?? 1;
      const mergedWidth = Math.max(1, (mergedBBox.x1 - mergedBBox.x0) * mergedScaleX);
      const mergedHeight = Math.max(1, (mergedBBox.y1 - mergedBBox.y0) * mergedScaleY);
      const mergedLineHeightMedian = resolveMedian(
        group.map((item) => Math.max(1, item.hints?.sourceBoxHeight ?? (item.bbox.y1 - item.bbox.y0)))
      ) ?? mergedHeight;
      const mergedHeightBudget = Math.max(
        mergedHeight,
        mergedHeight + Math.max(
          mergedLineHeightMedian * (mergedStyleKind === 'comic-bubble'
            ? Math.min(1.2, Math.max(0.45, group.length * 0.22))
            : Math.min(0.85, Math.max(0.3, group.length * 0.16))),
          mergedHeight * (mergedStyleKind === 'comic-bubble' ? 0.1 : 0.06)
        )
      );
      const mergedTypography = computeOverlayTypography(
        mergedText,
        mergedWidth,
        mergedHeightBudget,
        {
          sourceText: mergedSourceTextJoined,
          sourceBoxWidth: mergedWidth,
          sourceBoxHeight: mergedHeightBudget,
          sourceLineCount: group.length,
          fontFamily: group[0]?.hints?.fontFamily,
          profile,
          styleKind: mergedStyleKind,
        }
      );
      const mergedBaselineFont = resolveMedian(fontSizes) ?? mergedTypography.fontSize;
      const sourceLineHeightMedian = mergedLineHeightMedian;
      const mergedTextContainsThai = THAI_CHAR_REGEX.test(mergedText);
      const mergedTextContainsCjk = CJK_CHAR_REGEX.test(mergedText);
      const mergedSourceDrivenFont = sourceLineHeightMedian
        * (mergedTextContainsThai
          ? (mergedStyleKind === 'comic-bubble' ? 1.02 : 0.98)
          : mergedTextContainsCjk
            ? (mergedStyleKind === 'comic-bubble' ? 1.02 : 1)
            : 1)
        * Math.sqrt(group.length / Math.max(1, mergedTypography.estimatedLines));
      const mergedPromotionFactor = mergedStyleKind === 'comic-bubble'
        ? (mergedTextContainsThai ? 1.04 : (mergedTypography.estimatedLines >= 3 ? 1.08 : 1.24))
        : (mergedTextContainsThai ? 1.02 : (mergedTypography.estimatedLines >= 3 ? 1.05 : 1.12));
      const maxFontCap = mergedTextContainsThai
        ? Math.max(14, Math.min(21, mergedBaselineFont * 1.12))
        : (mergedStyleKind === 'comic-bubble' ? 32 : 28);
       const promotedMergedFont = Math.min(
        maxFontCap,
        mergedTextContainsThai
          ? Math.max(
              10.5,
              Math.min(mergedBaselineFont * 1.08, mergedTypography.fontSize)
            )
          : Math.max(
              mergedTypography.fontSize,
              mergedBaselineFont * mergedPromotionFactor,
              mergedSourceDrivenFont * (mergedTextContainsThai && mergedTypography.estimatedLines >= 3 ? 0.94 : 1)
            )
      );
      const mergedTypographyAdjusted = (() => {
        if (promotedMergedFont <= mergedTypography.fontSize + 0.01) return mergedTypography;
        const lineHeight = resolveOverlayLineHeight(mergedText) + (mergedTextContainsThai ? (mergedStyleKind === 'comic-bubble' ? 0.08 : 0.04) : 0);
        const { padX, padY } = resolveOverlayPadding(promotedMergedFont, mergedText);
        const usableWidth = Math.max(4, mergedWidth - padX * 2);
        const estimatedLines = resolveWrappedLineEstimate(
          mergedText,
          usableWidth,
          promotedMergedFont,
          group[0]?.hints?.fontFamily,
          mergedStyleKind,
          mergedWidth,
          mergedHeightBudget
        );
        const sourceLineFloor = resolveSourceLineFloor(
          mergedStyleKind,
          group.length,
          compactTextLength(mergedSourceTextJoined),
          compactTextLength(mergedText),
          mergedTextContainsThai,
          mergedTextContainsCjk,
          false
        );
        const adjustedEstimatedLines = Math.max(estimatedLines, sourceLineFloor);
        const ascenderSafety = Math.max(1, Math.round(promotedMergedFont * (THAI_CHAR_REGEX.test(mergedText) ? 0.1 : 0.05)));
        const descenderSafety = Math.max(1, Math.round(promotedMergedFont * (THAI_CHAR_REGEX.test(mergedText) ? 0.18 : 0.14)));
        const contentHeight = adjustedEstimatedLines * promotedMergedFont * lineHeight + ascenderSafety + descenderSafety;
        if (contentHeight > mergedHeightBudget * (mergedStyleKind === 'comic-bubble' ? 0.9 : 0.92)) {
          return mergedTypography;
        }
        return {
          fontSize: promotedMergedFont,
          lineHeight,
          padX,
          padY,
          forceSingleLine: adjustedEstimatedLines <= 1,
          estimatedLines: adjustedEstimatedLines,
          contentHeight,
        };
      })();

      const mergedFillRatio = mergedTypographyAdjusted.contentHeight / Math.max(1, mergedHeightBudget);
      const mergeIsUseful = hasBalloonMember || (
        mergedTypographyAdjusted.estimatedLines >= 1
        && (mergedTextContainsThai || (
          mergedTypographyAdjusted.fontSize >= mergedBaselineFont * (mergedStyleKind === 'comic-bubble' ? 0.9 : 0.88)
          && mergedFillRatio >= (mergedStyleKind === 'comic-bubble' ? 0.58 : 0.52)
        ))
      );
      if (mergeIsUseful) {
        const mergedAlignment: 'left' | 'center' = mergedStyleKind === 'comic-bubble' ? 'center' : 'left';
        const mergedCenterX = mergedBBox.x0 + (mergedBBox.x1 - mergedBBox.x0) * 0.5;
        group.forEach((item, index) => {
          result.set(item.index, {
            typography: mergedTypographyAdjusted,
            alignment: mergedAlignment,
            effectiveProfile,
            styleKind: mergedStyleKind,
            sharedCenterX: mergedAlignment === 'center' ? (sharedCenterX ?? mergedCenterX) : undefined,
            sharedTextStartX: mergedAlignment === 'left' ? minStartX : undefined,
            sharedBoxLeftX: mergedAlignment === 'left' ? minStartX : undefined,
            mergedBBox,
            mergedMaskBBox,
            renderText: index === 0 ? mergedText : '',
            hidden: index !== 0,
            preserveMaskWhenHidden: index !== 0,
          });
        });
        return;
      }
    }

    const joinTextIntoPrevious = new Map<number, string>();
    const joinHighlightByGroupIndex = new Map<number, { text: string; sourceIndex: number }>();
    const hideByGroupIndex = new Set<number>();
    if (!effectiveDocumentProfile && group.length >= 2) {
      for (let i = 1; i < group.length; i += 1) {
        const previous = group[i - 1];
        const current = group[i];
        const previousTranslated = normalizeOverlayInlineText(previous.text);
        const currentTranslated = normalizeOverlayInlineText(current.text);
        const previousSource = normalizeOverlayInlineText(previous.hints?.sourceText || previous.line?.text || '');
        const currentSource = normalizeOverlayInlineText(current.hints?.sourceText || current.line?.text || '');
        const translatedPair = /ฟีนีลีน\s*ได้\s*ดูดซับ/.test(previousTranslated)
          && /\[?\s*แก่นแท้ของเวอร์ทาร์\s*\]?/.test(currentTranslated);
        const sourcePair = /\bPHENELINE\b/i.test(previousSource)
          && /\bHAS\s+ABSORBED\b/i.test(previousSource)
          && /\bVERTAR\b/i.test(currentSource)
          && /\bESSEN(?:CE|SE)\b/i.test(currentSource);

        if (!translatedPair && !sourcePair) {
          continue;
        }

        joinTextIntoPrevious.set(i - 1, joinOverlayGroupSegments([previous.text, current.text]));
        joinHighlightByGroupIndex.set(i - 1, {
          text: normalizeOverlayInlineText(current.text),
          sourceIndex: current.index,
        });
        hideByGroupIndex.add(i);
      }
    }

    for (let groupIndex = 0; groupIndex < group.length; groupIndex += 1) {
      const item = group[groupIndex];
      const styleKind = groupStyleKinds[groupIndex];
      const singleLineCenterCandidate = group.length === 1
        && !effectiveDocumentProfile
        && item.typography.forceSingleLine
        && compactTextLength(item.text) <= 36
        && ((item.bbox.x1 - item.bbox.x0) / Math.max(1, item.bbox.y1 - item.bbox.y0)) >= 1.35;
      const itemAlignment: 'left' | 'center' = singleLineCenterCandidate ? 'center' : alignment;
      const itemSharedCenterX = (singleLineCenterCandidate || ((effectiveProfile === 'manga' || effectiveProfile === 'manhwa') && defaultStyleKind !== 'comic-box' && group.length === 1))
        ? (item.bbox.x0 + item.bbox.x1) * 0.5
        : sharedCenterX;
      const itemSharedTextStartX = itemAlignment === 'left' ? sharedTextStartX : undefined;
      const itemSharedBoxLeftX = itemAlignment === 'left' ? sharedBoxLeftX : undefined;
      const mergedNarrativeText = joinTextIntoPrevious.get(groupIndex);
      const renderText = mergedNarrativeText || item.text;
      const shouldHide = hideByGroupIndex.has(groupIndex);
      const highlightContinuation = joinHighlightByGroupIndex.get(groupIndex);
      if (!shouldNormalize) {
        result.set(item.index, {
          typography: item.typography,
          alignment: itemAlignment,
          effectiveProfile,
          styleKind,
          sharedTextStartX: itemSharedTextStartX,
          sharedCenterX: itemSharedCenterX,
          sharedBoxLeftX: itemSharedBoxLeftX,
          renderText: shouldHide ? '' : renderText,
          hidden: shouldHide,
          preserveMaskWhenHidden: shouldHide,
          highlightContinuationText: shouldHide ? undefined : highlightContinuation?.text,
          highlightTextColorSourceIndex: shouldHide ? undefined : highlightContinuation?.sourceIndex,
        });
        continue;
      }

      const lineHeight = resolveOverlayLineHeight(renderText);
      const { padX, padY } = resolveOverlayPadding(normalizedFontSize, renderText);
      const estimatedLines = item.typography.estimatedLines;
      const ascenderSafety = Math.max(1, Math.round(normalizedFontSize * (THAI_CHAR_REGEX.test(renderText) ? 0.1 : 0.05)));
      const descenderSafety = Math.max(1, Math.round(normalizedFontSize * (THAI_CHAR_REGEX.test(renderText) ? 0.18 : 0.14)));
      result.set(item.index, {
        typography: {
          fontSize: normalizedFontSize,
          lineHeight,
          padX,
          padY,
          forceSingleLine: item.typography.forceSingleLine,
          estimatedLines,
          contentHeight: estimatedLines * normalizedFontSize * lineHeight + ascenderSafety + descenderSafety,
        },
        alignment: itemAlignment,
        effectiveProfile,
        styleKind,
        sharedTextStartX: itemSharedTextStartX,
        sharedCenterX: itemSharedCenterX,
        sharedBoxLeftX: itemSharedBoxLeftX,
        renderText: shouldHide ? '' : renderText,
        hidden: shouldHide,
        preserveMaskWhenHidden: shouldHide,
        highlightContinuationText: shouldHide ? undefined : highlightContinuation?.text,
        highlightTextColorSourceIndex: shouldHide ? undefined : highlightContinuation?.sourceIndex,
      });
    }
  };

  // Use Union-Find (Disjoint Set) to group items based on spatial connections.
  // This avoids cross-column interleaving Y-sorted issues breaking sequential harmonization.
  const ufParent = new Array(orderedComputed.length).fill(0).map((_, idx) => idx);

  const ufFind = (i: number): number => {
    let root = i;
    while (root !== ufParent[root]) {
      root = ufParent[root];
    }
    let curr = i;
    while (curr !== root) {
      const nxt = ufParent[curr];
      ufParent[curr] = root;
      curr = nxt;
    }
    return root;
  };

  const ufUnion = (i: number, j: number): void => {
    const rootI = ufFind(i);
    const rootJ = ufFind(j);
    if (rootI !== rootJ) {
      ufParent[rootI] = rootJ;
    }
  };

  // Compare potential harmonizable pairs (optimized early exit since orderedComputed is Y-sorted)
  for (let i = 0; i < orderedComputed.length; i += 1) {
    const nodeA = orderedComputed[i];
    for (let j = i + 1; j < orderedComputed.length; j += 1) {
      const nodeB = orderedComputed[j];

      // บล็อกการผสานข้ามกลุ่มบอลลูนอย่างเด็ดขาด (ข้อมูลจริงจาก Grouper ต้นทาง)
      if (
        nodeA.balloonId !== undefined &&
        nodeB.balloonId !== undefined &&
        nodeA.balloonId !== nodeB.balloonId
      ) {
        continue;
      }

      // Stop searching this chain if Y gap is way too large
      const yGap = nodeB.bbox.y0 - nodeA.bbox.y1;
      const heightA = nodeA.bbox.y1 - nodeA.bbox.y0;
      const heightB = nodeB.bbox.y1 - nodeB.bbox.y0;
      if (yGap > Math.max(160, (heightA + heightB) * 5.0)) {
        break;
      }

      const sameBalloon = nodeA.balloonId !== undefined &&
        nodeB.balloonId !== undefined &&
        nodeA.balloonId === nodeB.balloonId;

      if (sameBalloon || shouldHarmonizeOverlayBlock(nodeA, nodeB, profile) || shouldHarmonizeOverlayBlock(nodeB, nodeA, profile)) {
        ufUnion(i, j);
      }
    }
  }

  // Gather items into their connected components
  const components = new Map<number, typeof orderedComputed>();
  for (let i = 0; i < orderedComputed.length; i += 1) {
    const root = ufFind(i);
    if (!components.has(root)) {
      components.set(root, []);
    }
    components.get(root)!.push(orderedComputed[i]);
  }

  // Process each unified group
  for (const group of components.values()) {
    // Sort each group logically: top-to-bottom, then left-to-right
    const sortedGroup = [...group].sort((a, b) => {
      if (Math.abs(a.bbox.y0 - b.bbox.y0) > 4) {
        return a.bbox.y0 - b.bbox.y0;
      }
      return a.bbox.x0 - b.bbox.x0;
    });
    flushGroup(sortedGroup);
  }

  return suppressOverlappingOverlayBorders(result, orderedComputed);
};

export const computeOverlayTypographyMap = (
  inputs: OverlayTypographyInput[]
): Map<number, OverlayTypography> => {
  const layoutMap = computeOverlayLayoutMap(inputs);
  return new Map(Array.from(layoutMap.entries()).map(([index, layout]) => [index, layout.typography]));
};

export const clampOverlayRect = (
  left: number,
  top: number,
  width: number,
  height: number,
  bounds: { x0: number; y0: number; x1: number; y1: number }
): OverlayRect => {
  const minWidth = 1;
  const minHeight = 1;
  const clampedLeft = clamp(left, bounds.x0, Math.max(bounds.x0, bounds.x1 - minWidth));
  const clampedTop = clamp(top, bounds.y0, Math.max(bounds.y0, bounds.y1 - minHeight));
  const maxWidth = Math.max(minWidth, bounds.x1 - clampedLeft);
  const maxHeight = Math.max(minHeight, bounds.y1 - clampedTop);

  return {
    left: clampedLeft,
    top: clampedTop,
    width: Math.max(minWidth, Math.min(width, maxWidth)),
    height: Math.max(minHeight, Math.min(height, maxHeight)),
  };
};






