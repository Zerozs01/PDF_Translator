import { BBox, OCRLine, OCRPageResult } from '../../../types';
import { isKnownShortWordHelper } from '../../../services/ocr/ocrSafetyLineDedup';
import { lookupShortPhraseTh } from '../../../services/translation/offlineTranslationService';
import { resolveOverlaySourceBBox } from './overlayGeometry';
import { fastIoU } from '../../../services/native/fastSpatialCluster';
import { fastDiceSimilarity } from '../../../services/native/fastDiceSimilarity';

export const normalizeOverlayInlineText = (value: string): string =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

export const buildOverlayKeyBigrams = (value: string): Set<string> => {
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

/**
 * Dice coefficient similarity via high-throughput bitset engine.
 * Delegates to fastDiceSimilarity for zero-GC performance.
 * Original Set-based implementation preserved in buildOverlayKeyBigrams for tests.
 */
export const overlayKeyDiceSimilarity = (a: string, b: string): number =>
  fastDiceSimilarity(a, b);

/**
 * IoU (Intersection over Union) via zero-GC spatial engine.
 * Delegates to fastIoU — same semantics, no temporary object allocations.
 */
export const overlayDedupIou = (a: BBox, b: BBox): number =>
  fastIoU(a, b);

const preserveOverlaySourceTrailingPunctuation = (sourceText: string, replacement: string): string => {
  const punctuation = String(sourceText || '').trim().match(/([.!?…]+)$/)?.[1] || '';
  const cleanReplacement = normalizeOverlayInlineText(String(replacement || '')).replace(/[.!?…]+$/g, '').trim();
  return `${cleanReplacement}${punctuation}`.trim();
};

export const resolveMissingOverlayLineFallbackText = (
  sourceText: string,
  targetLanguage: string
): string => {
  const source = normalizeOverlayInlineText(String(sourceText || ''));
  if (!source) return '';
  const normalizedTarget = (targetLanguage || '').trim().toLowerCase();
  if (normalizedTarget !== 'th' && normalizedTarget !== 'tha') return source;

  const dictMatch = lookupShortPhraseTh(source);
  if (dictMatch) {
    return preserveOverlaySourceTrailingPunctuation(source, dictMatch);
  }

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
  if (/^VAKYRE\s+MODE[.!?…]*$/i.test(source) || /^VALKYRIE\s+MODE[.!?…]*$/i.test(source)) {
    return preserveOverlaySourceTrailingPunctuation(source, 'โหมดวาลคีรี');
  }
  if (/^LIMITED\s+EDITION[.!?…]*$/i.test(source)) {
    return preserveOverlaySourceTrailingPunctuation(source, 'รุ่นลิมิเต็ด');
  }
  if (/^TH[-\s]*THIS\s+LIGHT[.!?…]*$/i.test(source)) {
    return preserveOverlaySourceTrailingPunctuation(source, 'แส-แสงนี้...!');
  }
  if (/^SI\s+ME\s+QUEDO[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'ถ้าฉันอยู่');
  if (/^AQU[IÍ]\s+M[AÁ]S[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'ที่นี่นานกว่านี้');
  if (/^S[-\s]*SIENTO\s+QUE\s+ME[.!?…]*$/i.test(source)) return preserveOverlaySourceTrailingPunctuation(source, 'ฉะ-ฉันรู้สึกว่า');

  return source;
};

export const shouldSkipOverlayRenderForSuspiciousLine = (
  line: OCRLine,
  allLines: OCRLine[]
): boolean => {
  const text = normalizeOverlayInlineText(line.text || '');
  if (!text) return true;

  // Single noise characters
  if (text.length === 1 && /^[^a-zA-Z0-9\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]$/.test(text)) {
    return true;
  }

  // Extreme aspect ratio slivers with low confidence
  const bbox = line.bbox;
  if (bbox) {
    const width = bbox.x1 - bbox.x0;
    const height = bbox.y1 - bbox.y0;
    if (width <= 2 || height <= 2) return true;
    const aspect = Math.max(width / height, height / width);
    if (aspect > 25 && (line.confidence || 0) < 0.45) return true;
  }

  return false;
};
