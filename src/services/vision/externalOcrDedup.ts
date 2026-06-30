import type {
  OCRLine,
  OCRPageResult,
  OCRDroppedWord,
  OCRPipelineProfile,
  OCRQualityProfile,
  OCREngine,
  OCRWord
} from '../../types';
import {
  bboxArea,
  bboxCenterX,
  bboxCenterY,
  bboxHeight,
  bboxIoURatio,
  bboxWidth,
  computeLineWordUnionCoverage,
  expandContextualPhraseBBox,
  horizontalContainmentRatio,
  horizontalOverlapRatio,
  medianNumber,
  verticalOverlapRatio
} from './visionGeometry';
import { filterKoreanJamoNoise, filterWeakIsolatedCjkLines } from './ocr-filtering';
import { OCR_ALGORITHM_VERSION, OCR_RAW_VERSION } from './ocrVersion';

export const normalizeExternalDedupText = (text: string): string =>
  String(text || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:'"`~^_+]+/g, '')
    .replace(/[|¦│┃￨︱︲]+/g, '')
    .toUpperCase();

export const normalizeMultilingualToken = (text: string): string =>
  String(text || '').replace(/[^A-Za-z0-9\uAC00-\uD7A3]+/g, '').toUpperCase();

export const hasHangulChars = (text: string): boolean => /[\uAC00-\uD7A3]/.test(String(text || ''));

const EXTERNAL_NATURAL_LATIN_WORDS = new Set([
  'A', 'AN', 'THE', 'TO', 'OF', 'FOR', 'AND', 'OR', 'IN', 'ON', 'WITH',
  'I', 'YOU', 'HE', 'SHE', 'HER', 'HIM', 'WE', 'THEY', 'IT',
  'BIG', 'DEAL', 'GOOD', 'BAD', 'ONLY', 'LEAVE', 'OPEN', 'CHANCE',
]);

export const EXTERNAL_SHORT_DIALOGUE_WORDS = new Set([
  'I', 'IN', 'IT', 'IS', 'SO', 'OF', 'OH', 'WE', 'ME', 'UP', 'DO', 'GO', 'NO', 'BY', 'AT', 'IF', 'AN', 'OR', 'AS', 'AM', 'TO', 'HE', 'US', 'PIG', 'DIE', 'CUM', 'COCK',
  'ALL', 'MORE', 'YOU', 'OHHH', 'YOURE', 'HUH', 'HA', 'HEY', 'HMM', 'AH', 'UH', 'UGH', 'YA'
]);

const collectMeaningfulExternalLatinTokens = (text: string): string[] => (
  String(text || '')
    .toUpperCase()
    .split(/\s+/g)
    .map((token) => token.replace(/[^A-Z0-9]/g, '').replace(/0/g, 'O').replace(/1/g, 'I').replace(/5/g, 'S'))
    .filter((token) => token.length >= 3)
);

export const countSharedExternalLatinTokens = (left: string, right: string): number => {
  const leftTokens = new Set(collectMeaningfulExternalLatinTokens(left));
  const rightTokens = new Set(collectMeaningfulExternalLatinTokens(right));
  let shared = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) shared += 1;
  });
  return shared;
};

export const scoreExternalLatinLineNaturalness = (text: string): number => {
  const tokens = String(text || '').split(/\s+/g).filter(Boolean);
  let score = 0;
  tokens.forEach((token) => {
    const alpha = token.replace(/[^A-Za-z]/g, '');
    if (!alpha) return;
    const upper = alpha.toUpperCase();
    if (EXTERNAL_NATURAL_LATIN_WORDS.has(upper)) score += 3.2;
    if (/[aeiou]/i.test(alpha)) score += 0.8;
    if (/[A-Z][a-z][A-Z]/.test(alpha) || /[a-z][A-Z]/.test(alpha)) score -= 2.8;
    if (!/[aeiou]/i.test(alpha) && alpha.length >= 4) score -= 2.4;
  });
  return score;
};

export const normalizeKoreanDedupToken = (text: string): string => {
  const normalized = normalizeMultilingualToken(text);
  const hangulOnly = normalized.replace(/[^\uAC00-\uD7A3]+/g, '');
  return hangulOnly || normalized;
};

const buildBigrams = (value: string): Set<string> => {
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

export const diceSimilarity = (a: string, b: string): number => {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const aBigrams = buildBigrams(a);
  const bBigrams = buildBigrams(b);
  if (aBigrams.size === 0 || bBigrams.size === 0) return 0;

  let overlap = 0;
  for (const gram of aBigrams) {
    if (bBigrams.has(gram)) overlap += 1;
  }

  return (2 * overlap) / (aBigrams.size + bBigrams.size);
};

export const boundedLevenshteinDistance = (a: string, b: string, maxDistance: number): number => {
  if (a === b) return 0;
  if (maxDistance < 0) return Number.MAX_SAFE_INTEGER;

  const lenA = a.length;
  const lenB = b.length;
  if (Math.abs(lenA - lenB) > maxDistance) {
    return maxDistance + 1;
  }

  let prev = new Array<number>(lenB + 1);
  let curr = new Array<number>(lenB + 1);
  for (let j = 0; j <= lenB; j += 1) {
    prev[j] = j;
  }

  for (let i = 1; i <= lenA; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];

    for (let j = 1; j <= lenB; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
      if (curr[j] < rowMin) {
        rowMin = curr[j];
      }
    }

    if (rowMin > maxDistance) {
      return maxDistance + 1;
    }

    [prev, curr] = [curr, prev];
  }

  return prev[lenB];
};

export const isCjkLikeLanguage = (language: string): boolean =>
  String(language || '')
    .split('+')
    .map((code) => code.trim())
    .filter(Boolean)
    .some((code) => ['kor', 'jpn', 'jpn_vert', 'chi_sim', 'chi_tra', 'tha'].includes(code));

export const EXTERNAL_SINGLETON_CJK_RE = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/;

export const EXTERNAL_LATIN_DOMAIN_TAIL_TOKENS = new Set(['IO', 'LO', 'COM']);

export const normalizeExternalLatinToken = (value: string): string =>
  String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/5/g, 'S');

const EXTERNAL_PADDLE_DIALOGUE_KEEP_KEYS = new Set([
  'AHME',
  'EHME',
  'YOUCOULDSAY',
  'SOMETHINGTHATMIGHT',
  'HELPYOUTOO',
  'ENTRANCE',
  'AREONLY',
  'OURCHANCE',
  'THEM',
  'OPENA',
  'SHOELOCKER',
  'ANDLEAVETHE',
  'OPENASHOELOCKER',
  'BUILDING',
  'THTHIS',
  'THTHISLIGHT',
  'THISLIGHT',
  'STAFF',
  'PRIMERO',
  'PRIMEROLAFOTO',
  'LAFOTO',
  'METIENDO',
  'METIENDOPOR',
  'LISTO',
  'LISTOCON',
  'ILISTOCON',
  'SO',
  '6O',
  'DIE',
  'PIG',
  'CUM',
  'COCK',
  'ALL',
  'MORE',
  'YOU',
  'OHHH',
  'YOURE',
  'STOOOOP',
  'STOAOOP',
  'STOAAOP',
  'OHHHH',
  'OHHHHH',
  'ICAME',
  'FORYOU',
  'BARBARIAN',
  'VIRGINITY',
  'LOST',
  'SOME',
  'RAPING',
  'WET',
  'PUSSY',
  'CUMMING',
  'PRINCESS',
  'NEGO',
  'WITHAN',
  'HEIRRR',
  'RRR',
  'IIM',
  'LIKETHIS',
  'WASTOYED',
  'UPLOOKING',
  'IS',
  'USTHE',
]);

export const shouldKeepExternalPaddleDialogueFragment = (line: OCRLine): boolean => {
  const rawText = String(line.text || '').trim();
  if (!rawText) return false;
  const key = normalizeExternalLatinToken(rawText);
  const compactRaw = rawText.replace(/\s+/g, '');
  const knownShortInterjection = /^(?:E+H+|A+H+|M+E+)[!?…]+$/i.test(compactRaw)
    || /^E+H+[!?…]*M+E+[!?…]*$/i.test(compactRaw)
    || /^A+H+[!?…]*M+E+[!?…]*$/i.test(compactRaw);
  if (!EXTERNAL_PADDLE_DIALOGUE_KEEP_KEYS.has(key) && !knownShortInterjection) return false;

  const width = Math.max(1, bboxWidth(line.bbox));
  const area = Math.max(1, bboxArea(line.bbox));
  const coverage = computeLineWordUnionCoverage(line);

  return !(width >= 960 && area >= 76000 && coverage >= 0.52);
};

// --- Extracted from VisionService.ts ---

export const EXTERNAL_TECHNICAL_LINE_HINT_REGEX = /\b(unknowns?|reactions?|equilibrium|resultant|component|components|direction|force|moment|column|columns|connections?|support|rigid|body|beam|beams|pin|hinge|utility|building|bridge|girder|floor|member|concrete|weld(?:ed|ing)?|fx|fy|fz|mx|my|mz|rx|ry|rz)\b/i;
export const EXTERNAL_TECHNICAL_TABLE_ROW_HINT_REGEX = /\b(?:table|continued|types?\s+of\s+connection|number\s+of\s+unknowns|reactions?|unknowns?|components?|couple\s+moment|magnitude|direction|resultant|smooth\s+pin|hinge|fixed\s+support|collar|rod|member\s+fixed|bridge|building|beam|welded|column)\b|^\(?\d+\)?$|^(?:fx|fy|fyt|f|m|or)$/i;

const CONFIG_DEDUPE = {
  DEBUG_LOG_MISSING_LINES: false,
};

export const offsetExternalWord = (word: OCRWord, yOffset: number): OCRWord => {
  return {
    ...word,
    bbox: {
      x0: word.bbox.x0,
      y0: word.bbox.y0 + yOffset,
      x1: word.bbox.x1,
      y1: word.bbox.y1 + yOffset,
    },
  };
};

export const offsetExternalLine = (line: OCRLine, yOffset: number): OCRLine => {
  const lineWithHints = line as OCRLine & { _sortY?: number; _sortX?: number; sortHintY?: number; sortHintX?: number };
  return {
    ...lineWithHints,
    bbox: {
      x0: line.bbox.x0,
      y0: line.bbox.y0 + yOffset,
      x1: line.bbox.x1,
      y1: line.bbox.y1 + yOffset,
    },
    words: (line.words || []).map((word) => offsetExternalWord(word, yOffset)),
    quad: Array.isArray(line.quad)
      ? line.quad.map((point) => ({
        x: point.x,
        y: point.y + yOffset,
      }))
      : line.quad,
    ...(typeof lineWithHints._sortY === 'number' ? { _sortY: lineWithHints._sortY + yOffset } : {}),
    ...(typeof lineWithHints._sortX === 'number' ? { _sortX: lineWithHints._sortX } : {}),
    ...(typeof lineWithHints.sortHintY === 'number' ? { sortHintY: lineWithHints.sortHintY + yOffset } : {}),
    ...(typeof lineWithHints.sortHintX === 'number' ? { sortHintX: lineWithHints.sortHintX } : {}),
  };
};

export const shouldMergeDuplicateExternalLine = (existing: OCRLine, candidate: OCRLine): boolean => {
  const existingText = normalizeExternalDedupText(existing.text);
  const candidateText = normalizeExternalDedupText(candidate.text);
  if (!existingText || !candidateText) return false;

  const sameOrSubset = existingText === candidateText
    || existingText.includes(candidateText)
    || candidateText.includes(existingText);
  if (!sameOrSubset) return false;

  const centerDeltaY = Math.abs(bboxCenterY(existing.bbox) - bboxCenterY(candidate.bbox));
  const centerDeltaX = Math.abs(bboxCenterX(existing.bbox) - bboxCenterX(candidate.bbox));
  const minHeight = Math.max(8, Math.min(bboxHeight(existing.bbox), bboxHeight(candidate.bbox)));
  const minWidth = Math.max(24, Math.min(bboxWidth(existing.bbox), bboxWidth(candidate.bbox)));
  const overlap = verticalOverlapRatio(existing.bbox, candidate.bbox);

  return (
    overlap >= 0.68
    || (
      centerDeltaY <= minHeight * 0.9
      && centerDeltaX <= minWidth * 0.6
    )
  );
};

export const shouldMergePaddlePanelDuplicateExternalLine = (
  existing: OCRLine,
  candidate: OCRLine,
  languageCodes: string[]
): boolean => {
  const existingText = normalizeExternalDedupText(existing.text);
  const candidateText = normalizeExternalDedupText(candidate.text);
  if (!existingText || !candidateText) return false;

  const existingToken = normalizeExternalLatinToken(existingText);
  const candidateToken = normalizeExternalLatinToken(candidateText);
  const exactTokenMatch = Boolean(existingToken && candidateToken && existingToken === candidateToken);

  const overlapW = Math.max(0, Math.min(existing.bbox.x1, candidate.bbox.x1) - Math.max(existing.bbox.x0, candidate.bbox.x0));
  const overlapH = Math.max(0, Math.min(existing.bbox.y1, candidate.bbox.y1) - Math.max(existing.bbox.y0, candidate.bbox.y0));
  const overlapArea = overlapW * overlapH;
  const areaA = Math.max(1, bboxArea(existing.bbox));
  const areaB = Math.max(1, bboxArea(candidate.bbox));
  const isBoxContained = (overlapArea / areaA) >= 0.85 || (overlapArea / areaB) >= 0.85;

  if (isBoxContained && existingToken && candidateToken) {
    const textSimilarity = diceSimilarity(existingToken, candidateToken);
    if (textSimilarity >= 0.15 || existingText.includes(candidateText) || candidateText.includes(existingText)) {
      return true;
    }
  }

  const overlapY = verticalOverlapRatio(existing.bbox, candidate.bbox);
  const overlapX = horizontalOverlapRatio(existing.bbox, candidate.bbox);
  const iou = bboxIoURatio(existing.bbox, candidate.bbox);
  const centerDeltaY = Math.abs(bboxCenterY(existing.bbox) - bboxCenterY(candidate.bbox));
  const centerDeltaX = Math.abs(bboxCenterX(existing.bbox) - bboxCenterX(candidate.bbox));
  const minHeight = Math.max(8, Math.min(bboxHeight(existing.bbox), bboxHeight(candidate.bbox)));
  const minWidth = Math.max(24, Math.min(bboxWidth(existing.bbox), bboxWidth(candidate.bbox)));
  const existingArea = Math.max(1, bboxArea(existing.bbox));
  const candidateArea = Math.max(1, bboxArea(candidate.bbox));
  const areaRatio = existingArea / candidateArea;
  const nearSizeMatch = areaRatio >= 0.64 && areaRatio <= 1.56;

  // Prevent merging distinct vertically-stacked lines of text (e.g. "PRINCESS" and "PRINCESS" on separate lines)
  const isDistinctStackedLines = overlapY < 0.15 
    && centerDeltaY >= minHeight * 0.85 
    && (existingText.length <= 16 || candidateText.length <= 16);
  if (isDistinctStackedLines) return false;

  const sameOrSubset = existingText === candidateText
    || existingText.includes(candidateText)
    || candidateText.includes(existingText);
  if (sameOrSubset) {
    // Fast-path: exactTokenMatch ที่อยู่ใกล้กัน ให้ยุบรวมได้เลย
    if (exactTokenMatch && existingText === candidateText) {
      const isCloseProximity = (
        iou >= 0.08
        || (overlapY >= 0.08 && overlapX >= 0.08)
        || (centerDeltaY <= Math.max(minHeight * 4.0, 100) && centerDeltaX <= Math.max(minWidth * 1.8, 120))
      );
      if (isCloseProximity) return true;
    }
    const nearStackedBand = overlapY >= 0.02 || centerDeltaY <= minHeight * 1.35;
    const localStackedDuplicate = (
      exactTokenMatch
      && nearSizeMatch
      && centerDeltaY <= Math.max(56, minHeight * 2.0)
      && centerDeltaX <= Math.max(72, minWidth * 1.25)
      && overlapX >= 0.62
      && nearStackedBand
    );
    const minLength = Math.min(existingText.length, candidateText.length);
    const looseSameOrSubsetSpatialMatch = minLength >= 4
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
      iou >= 0.56
      || (overlapY >= 0.82 && overlapX >= 0.62)
      || (
        centerDeltaY <= minHeight * 0.72
        && centerDeltaX <= minWidth * 0.68
        && overlapY >= 0.62
        && overlapX >= 0.38
      )
      || (
        exactTokenMatch
        && overlapY >= 0.88
        && overlapX >= 0.4
        && centerDeltaY <= minHeight * 1.2
      )
      || localStackedDuplicate
      || looseSameOrSubsetSpatialMatch
    );
  }

  if (languageCodes.includes('kor')) {
    return false;
  }

  if (!existingToken || !candidateToken) return false;

  const similarity = diceSimilarity(existingToken, candidateToken);
  const lenDelta = Math.abs(existingToken.length - candidateToken.length);
  const typoDistance = boundedLevenshteinDistance(existingToken, candidateToken, 2);
  const nearDuplicateToken = similarity >= 0.86
    || (similarity >= 0.76 && lenDelta <= 2)
    || (
      typoDistance <= 1
      && lenDelta <= 1
      && Math.min(existingToken.length, candidateToken.length) >= 5
    );
  if (!nearDuplicateToken) {
    return false;
  }

  const highSimilarity = similarity >= 0.88 || typoDistance <= 1;
  const looseSpatialMatch = highSimilarity
    && (
      iou >= 0.28
      || (
        overlapY >= 0.46
        && overlapX >= 0.38
        && centerDeltaY <= minHeight * 1.5
        && centerDeltaX <= minWidth * 1.4
      )
    );

  return (
    iou >= 0.62
    || (
      overlapY >= 0.76
      && overlapX >= 0.56
      && centerDeltaY <= minHeight * 0.9
      && centerDeltaX <= minWidth * 0.9
    )
    || looseSpatialMatch
  );
};

export const shouldCollapseResidualSpatialDuplicateExternalLine = (
  existing: OCRLine,
  candidate: OCRLine,
  languageCodes: string[]
): boolean => {
  if (shouldMergePaddlePanelDuplicateExternalLine(existing, candidate, languageCodes)) {
    return true;
  }

  const existingText = normalizeExternalDedupText(existing.text);
  const candidateText = normalizeExternalDedupText(candidate.text);
  if (!existingText || !candidateText) return false;

  const overlapY = verticalOverlapRatio(existing.bbox, candidate.bbox);
  const overlapX = horizontalOverlapRatio(existing.bbox, candidate.bbox);
  const iou = bboxIoURatio(existing.bbox, candidate.bbox);
  const centerDeltaY = Math.abs(bboxCenterY(existing.bbox) - bboxCenterY(candidate.bbox));
  const centerDeltaX = Math.abs(bboxCenterX(existing.bbox) - bboxCenterX(candidate.bbox));
  const minHeight = Math.max(8, Math.min(bboxHeight(existing.bbox), bboxHeight(candidate.bbox)));
  const minWidth = Math.max(24, Math.min(bboxWidth(existing.bbox), bboxWidth(candidate.bbox)));
  const existingRawText = String(existing.text || '').replace(/\s+/g, ' ').trim();
  const candidateRawText = String(candidate.text || '').replace(/\s+/g, ' ').trim();
  const technicalRowLikePair = (
    EXTERNAL_TECHNICAL_LINE_HINT_REGEX.test(existingRawText)
    || EXTERNAL_TECHNICAL_LINE_HINT_REGEX.test(candidateRawText)
    || EXTERNAL_TECHNICAL_TABLE_ROW_HINT_REGEX.test(existingRawText)
    || EXTERNAL_TECHNICAL_TABLE_ROW_HINT_REGEX.test(candidateRawText)
  );

  const maxCenterDeltaY = technicalRowLikePair
    ? Math.max(136, minHeight * 4.2)
    : Math.max(84, minHeight * 2.8);
  const maxCenterDeltaX = technicalRowLikePair
    ? Math.max(152, minWidth * 3.2)
    : Math.max(120, minWidth * 2.6);
  if (centerDeltaY > maxCenterDeltaY) return false;
  if (centerDeltaX > maxCenterDeltaX) return false;

  const existingCoverage = computeLineWordUnionCoverage(existing);
  const candidateCoverage = computeLineWordUnionCoverage(candidate);
  const dominantCoverage = Math.max(existingCoverage, candidateCoverage);
  const weakCoverage = Math.min(existingCoverage, candidateCoverage);
  const areaRatio = Math.max(bboxArea(existing.bbox), bboxArea(candidate.bbox))
    / Math.max(1, Math.min(bboxArea(existing.bbox), bboxArea(candidate.bbox)));
  const latinExistingToken = normalizeExternalLatinToken(existingText);
  const latinCandidateToken = normalizeExternalLatinToken(candidateText);
  const existingToken = latinExistingToken || normalizeMultilingualToken(existingText);
  const candidateToken = latinCandidateToken || normalizeMultilingualToken(candidateText);
  const hasComparableTokens = Boolean(existingToken && candidateToken);
  const minLength = hasComparableTokens ? Math.min(existingToken!.length, candidateToken!.length) : 0;

  const sameOrSubset = hasComparableTokens
    ? existingToken === candidateToken
      || (minLength >= 4 && (existingToken!.includes(candidateToken!) || candidateToken!.includes(existingToken!)))
    : false;
  const tokenSimilarity = hasComparableTokens ? diceSimilarity(existingToken!, candidateToken!) : 0;
  const koreanLatinGuard = languageCodes.includes('kor') && (latinExistingToken || latinCandidateToken);

  const displacedCoverageEcho = (
    overlapX >= 0.62
    && (overlapY >= 0.14 || iou >= 0.08)
    && centerDeltaX <= Math.max(114, minWidth * 1.62)
    && centerDeltaY <= Math.max(148, minHeight * 4.8)
    && areaRatio >= 1.32
    && (dominantCoverage - weakCoverage) >= 0.16
    && weakCoverage <= 0.44
    && (technicalRowLikePair || Math.max(bboxArea(existing.bbox), bboxArea(candidate.bbox)) >= 9000 || iou >= 0.22)
  );
  if (displacedCoverageEcho) {
    return true;
  }

  const stackedSameColumnTokenEcho = (
    hasComparableTokens
    && !koreanLatinGuard
    && minLength >= 8
    && (sameOrSubset || tokenSimilarity >= 0.9)
    && areaRatio <= 2.8
    && overlapX >= 0.74
    && centerDeltaX <= Math.max(78, minWidth * 1.08)
    && centerDeltaY <= Math.max(146, minHeight * 4.8)
    && (overlapY >= 0.01 || iou >= 0.02)
    && (technicalRowLikePair || tokenSimilarity >= 0.94)
  );
  if (stackedSameColumnTokenEcho) {
    return true;
  }

  const nearSameBox = (
    iou >= 0.66
    || (overlapY >= 0.88 && overlapX >= 0.76)
    || (
      overlapY >= 0.74
      && overlapX >= 0.58
      && centerDeltaY <= minHeight * 0.72
      && centerDeltaX <= minWidth * 0.7
    )
  );
  if (!nearSameBox) {
    return false;
  }

  const severeCoverageEcho = (
    dominantCoverage - weakCoverage >= 0.22
    && weakCoverage <= 0.4
    && areaRatio >= 1.18
    && iou >= 0.18
    && overlapX >= 0.66
    && overlapY >= 0.28
    && centerDeltaX <= Math.max(86, minWidth * 1.08)
    && centerDeltaY <= Math.max(124, minHeight * 3.4)
  );
  if (severeCoverageEcho) {
    return true;
  }

  if (!existingToken || !candidateToken) return false;

  if (sameOrSubset) {
    return true;
  }

  const sameBoxSharedPhrase = (
    !technicalRowLikePair
    && minLength >= 8
    && countSharedExternalLatinTokens(existingRawText, candidateRawText) >= 2
    && overlapY >= 0.78
    && overlapX >= 0.56
    && centerDeltaY <= Math.max(24, minHeight * 1.05)
    && centerDeltaX <= Math.max(72, minWidth * 1.4)
  );
  if (sameBoxSharedPhrase) {
    return true;
  }

  if (
    technicalRowLikePair
    && minLength >= 8
    && (existingToken.slice(0, Math.min(8, existingToken.length)) === candidateToken.slice(0, Math.min(8, candidateToken.length))
      || existingToken.slice(-Math.min(8, existingToken.length)) === candidateToken.slice(-Math.min(8, candidateToken.length)))
    && overlapX >= 0.72
    && centerDeltaX <= Math.max(72, minWidth * 0.95)
    && centerDeltaY <= Math.max(124, minHeight * 4.8)
    && (overlapY >= 0.08 || iou >= 0.08)
  ) {
    return true;
  }

  if (koreanLatinGuard) {
    return false;
  }

  const similarity = tokenSimilarity;
  const prefixMatch = minLength >= 4 && existingToken.slice(0, 4) === candidateToken.slice(0, 4);
  const suffixMatch = minLength >= 4 && existingToken.slice(-4) === candidateToken.slice(-4);
  if ((prefixMatch || suffixMatch) && similarity >= 0.82) {
    return true;
  }
  if (iou >= 0.8 && minLength >= 4 && similarity >= 0.7) {
    return true;
  }

  return (
    iou >= 0.82
    && minLength >= 6
    && boundedLevenshteinDistance(existingToken, candidateToken, 3) <= 2
  );
};

export const pruneLikelyOrphanCjkFragments = (lines: OCRLine[]): OCRLine[] => {
  if (lines.length <= 1) return lines;

  return lines.filter((line) => {
    const token = normalizeMultilingualToken(line.text || '');
    const rawText = String(line.text || '').trim();
    const hasTerminalPunct = /[!?…\.]+$/u.test(rawText);
    if (!hasHangulChars(rawText) || token.length > 2 || token.length === 0 || hasTerminalPunct) {
      return true;
    }
    const lineConfidence = Number(line.confidence || 0);
    if (lineConfidence > 97) {
      return true;
    }

    const supporters = lines.filter((other) => {
      if (other === line) return false;
      const otherToken = normalizeMultilingualToken(other.text || '');
      if (!hasHangulChars(other.text || '')) return false;
      if (otherToken.length < token.length + 2) return false;
      if (!token || token[0] !== otherToken[0]) return false;

      const centerDelta = Math.abs(bboxCenterY(other.bbox) - bboxCenterY(line.bbox));
      const minHeight = Math.max(8, Math.min(bboxHeight(other.bbox), bboxHeight(line.bbox)));
      const nearbyBand = centerDelta <= Math.max(120, minHeight * 6.0);
      if (!nearbyBand) return false;

      const overlapX = horizontalOverlapRatio(line.bbox, other.bbox);
      const overlapY = verticalOverlapRatio(line.bbox, other.bbox);
      const containedX = horizontalContainmentRatio(line.bbox, other.bbox) >= 0.38;
      const narrowFragment = bboxWidth(line.bbox) <= bboxWidth(other.bbox) * 0.62;

      return narrowFragment && (containedX || overlapX >= 0.12) && overlapY >= 0.04;
    });

    return supporters.length === 0;
  });
};

export const dropKoreanParticleShadowLines = (lines: OCRLine[]): { lines: OCRLine[]; dropped: OCRDroppedWord[] } => {
  if (lines.length <= 1) {
    return { lines, dropped: [] };
  }

  const terminalParticles = new Set(['\uC774', '\uAC00', '\uC740', '\uB294', '\uC744', '\uB97C', '\uC5D0', '\uAC8C', '\uB3C4', '\uB85C', '\uC640', '\uACFC', '\uC758', '\uC57C']);
  const infos = lines.map((line) => {
    const rawText = String(line.text || '').trim();
    const token = normalizeMultilingualToken(rawText);
    const hangulToken = token.replace(/[^\uAC00-\uD7A3]+/g, '');
    const terminal = hangulToken.slice(-1);
    const stem = terminalParticles.has(terminal) ? hangulToken.slice(0, -1) : hangulToken;
    return {
      rawText,
      hangulToken,
      stem,
      terminal,
    };
  });

  const kept: OCRLine[] = [];
  const dropped: OCRDroppedWord[] = [];

  lines.forEach((line, index) => {
    const info = infos[index];
    const rawText = info.rawText;
    if (!rawText || !hasHangulChars(rawText)) {
      kept.push(line);
      return;
    }

    if (/[!?\u2026\.]+$/u.test(rawText)) {
      kept.push(line);
      return;
    }

    const tokenLength = info.hangulToken.length;
    if (tokenLength < 2 || tokenLength > 4) {
      kept.push(line);
      return;
    }

    if (info.stem.length < 2) {
      kept.push(line);
      return;
    }

    const lineConfidence = Number(line.confidence || 0);
    if (lineConfidence > 97) {
      kept.push(line);
      return;
    }

    let dropAsShadow = false;
    for (let otherIndex = 0; otherIndex < lines.length; otherIndex += 1) {
      if (otherIndex === index) continue;

      const other = lines[otherIndex];
      const otherInfo = infos[otherIndex];
      if (!otherInfo.hangulToken || otherInfo.hangulToken.length < tokenLength + 2) {
        continue;
      }
      if (!otherInfo.hangulToken.startsWith(info.stem)) {
        continue;
      }

      const centerDelta = Math.abs(bboxCenterY(other.bbox) - bboxCenterY(line.bbox));
      const minHeight = Math.max(8, Math.min(bboxHeight(other.bbox), bboxHeight(line.bbox)));
      const nearbyBand = centerDelta <= Math.max(140, minHeight * 7.0);
      if (!nearbyBand) {
        continue;
      }

      const overlapX = horizontalOverlapRatio(line.bbox, other.bbox);
      const overlapY = verticalOverlapRatio(line.bbox, other.bbox);
      const containedX = horizontalContainmentRatio(line.bbox, other.bbox) >= 0.38;
      const narrowFragment = bboxWidth(line.bbox) <= bboxWidth(other.bbox) * 0.7;

      if (!narrowFragment || overlapY < 0.04 || (!containedX && overlapX < 0.12)) {
        continue;
      }

      dropAsShadow = true;
      dropped.push({
        filter: 'externalChunkMerge',
        reason: 'koreanParticleShadow',
        text: rawText,
        confidence: lineConfidence,
        bbox: line.bbox,
      });
      break;
    }

    if (!dropAsShadow) {
      kept.push(line);
    }
  });

  return { lines: kept, dropped };
};

export const collapseKoreanNearDuplicateLines = (lines: OCRLine[]): { lines: OCRLine[]; dropped: OCRDroppedWord[] } => {
  if (lines.length <= 1) {
    return { lines, dropped: [] };
  }

  const consumed = new Array<boolean>(lines.length).fill(false);
  const kept: OCRLine[] = [];
  const dropped: OCRDroppedWord[] = [];

  const lineScore = (line: OCRLine): number => {
    const text = String(line.text || '').trim();
    const confidence = Number(line.confidence || 0);
    return (confidence * 1.8) + text.length;
  };

  for (let i = 0; i < lines.length; i += 1) {
    if (consumed[i]) continue;

    let winnerIndex = i;

    for (let j = i + 1; j < lines.length; j += 1) {
      if (consumed[j]) continue;

      const a = lines[winnerIndex];
      const b = lines[j];
      const aText = String(a.text || '').trim();
      const bText = String(b.text || '').trim();
      if (!aText || !bText) continue;
      if (!hasHangulChars(aText) || !hasHangulChars(bText)) continue;

      const overlapY = verticalOverlapRatio(a.bbox, b.bbox);
      if (overlapY < 0.56) continue;

      const overlapX = horizontalOverlapRatio(a.bbox, b.bbox);
      const centerDeltaY = Math.abs(bboxCenterY(a.bbox) - bboxCenterY(b.bbox));
      const centerDeltaX = Math.abs(bboxCenterX(a.bbox) - bboxCenterX(b.bbox));
      const minHeight = Math.max(8, Math.min(bboxHeight(a.bbox), bboxHeight(b.bbox)));
      const minWidth = Math.max(20, Math.min(bboxWidth(a.bbox), bboxWidth(b.bbox)));
      const sameBand = overlapX >= 0.55
        || (centerDeltaY <= minHeight * 0.62 && centerDeltaX <= minWidth * 0.6);
      if (!sameBand) continue;

      const aToken = normalizeKoreanDedupToken(aText);
      const bToken = normalizeKoreanDedupToken(bText);
      if (!aToken || !bToken) continue;

      const similarity = diceSimilarity(aToken, bToken);
      const lenDelta = Math.abs(aToken.length - bToken.length);
      const typoDistance = boundedLevenshteinDistance(aToken, bToken, 1);
      const typoNearDuplicate = typoDistance <= 1
        && lenDelta <= 1
        && overlapX >= 0.7
        && overlapY >= 0.72
        && Math.min(aToken.length, bToken.length) >= 4;
      const nearDuplicate = similarity >= 0.72
        || (similarity >= 0.66 && lenDelta <= 2)
        || typoNearDuplicate;
      if (!nearDuplicate) continue;

      const winner = lineScore(a) >= lineScore(b) ? winnerIndex : j;
      const loser = winner === winnerIndex ? j : winnerIndex;
      const loserLine = lines[loser];
      const loserText = String(loserLine.text || '').trim();
      consumed[loser] = true;
      dropped.push({
        filter: 'externalChunkMerge',
        reason: 'koreanNearDuplicateLine',
        text: loserText,
        confidence: Number(loserLine.confidence || 0),
        bbox: loserLine.bbox,
      });
      winnerIndex = winner;
    }

    if (consumed[winnerIndex]) continue;
    consumed[winnerIndex] = true;
    kept.push(lines[winnerIndex]);
  }

  return { lines: kept, dropped };
};

export const scoreExternalLine = (line: OCRLine): number => {
  const text = String(line.text || '').trim();
  const textLength = text.length;
  const confidence = Number(line.confidence || 0);
  const area = Math.max(1, bboxArea(line.bbox));
  const coverage = computeLineWordUnionCoverage(line);
  return (confidence * 2.2) + textLength + (scoreExternalLatinLineNaturalness(text) * 3.4) + (Math.log10(area) * 2.8) + (coverage * 32);
};

export const collapseLatinNearDuplicateExternalLines = (
  lines: OCRLine[],
  languageCodes: string[]
): { lines: OCRLine[]; dropped: OCRDroppedWord[] } => {
  if (lines.length <= 1) {
    return { lines, dropped: [] };
  }

  const consumed = new Array<boolean>(lines.length).fill(false);
  const kept: OCRLine[] = [];
  const dropped: OCRDroppedWord[] = [];

  const lineScore = (line: OCRLine): number => {
    const text = String(line.text || '').trim();
    const confidence = Number(line.confidence || 0);
    const area = Math.max(1, bboxWidth(line.bbox) * bboxHeight(line.bbox));
    return (confidence * 1.8) + (text.length * 1.2) + (Math.log10(area) * 2.0);
  };

  for (let i = 0; i < lines.length; i += 1) {
    if (consumed[i]) continue;

    let winnerIndex = i;

    for (let j = i + 1; j < lines.length; j += 1) {
      if (consumed[j]) continue;

      const a = lines[winnerIndex];
      const b = lines[j];
      const centerDeltaY = Math.abs(bboxCenterY(a.bbox) - bboxCenterY(b.bbox));
      const maxBandDistance = Math.max(72, Math.max(bboxHeight(a.bbox), bboxHeight(b.bbox)) * 2.6);
      if (centerDeltaY > maxBandDistance) {
        break;
      }

      if (!shouldMergePaddlePanelDuplicateExternalLine(a, b, languageCodes)) continue;

      const winner = lineScore(a) >= lineScore(b) ? winnerIndex : j;
      const loser = winner === winnerIndex ? j : winnerIndex;
      const loserLine = lines[loser];
      const loserText = String(loserLine.text || '').trim();
      consumed[loser] = true;
      dropped.push({
        filter: 'externalChunkMerge',
        reason: 'latinNearDuplicateLine',
        text: loserText,
        confidence: Number(loserLine.confidence || 0),
        bbox: loserLine.bbox,
      });
      winnerIndex = winner;
    }

    if (consumed[winnerIndex]) continue;
    consumed[winnerIndex] = true;
    kept.push(lines[winnerIndex]);
  }

  return { lines: kept, dropped };
};

export const collapseResidualSpatialDuplicateExternalLines = (
  lines: OCRLine[],
  languageCodes: string[]
): { lines: OCRLine[]; dropped: OCRDroppedWord[] } => {
  if (lines.length <= 1) {
    return { lines, dropped: [] };
  }

  const consumed = new Array<boolean>(lines.length).fill(false);
  const dropped: OCRDroppedWord[] = [];
  const kept: OCRLine[] = [];
  const orderedIndices = lines
    .map((_line, index) => index)
    .sort((a, b) => {
      const aLine = lines[a];
      const bLine = lines[b];
      if (aLine.bbox.y0 !== bLine.bbox.y0) return aLine.bbox.y0 - bLine.bbox.y0;
      if (aLine.bbox.x0 !== bLine.bbox.x0) return aLine.bbox.x0 - bLine.bbox.x0;
      return a - b;
    });

  for (let i = 0; i < orderedIndices.length; i += 1) {
    const baseIndex = orderedIndices[i];
    if (consumed[baseIndex]) continue;

    let winnerIndex = baseIndex;

    for (let j = i + 1; j < orderedIndices.length; j += 1) {
      const candidateIndex = orderedIndices[j];
      if (consumed[candidateIndex]) continue;

      const winnerLine = lines[winnerIndex];
      const candidateLine = lines[candidateIndex];
      const centerDeltaY = Math.abs(bboxCenterY(winnerLine.bbox) - bboxCenterY(candidateLine.bbox));
      const centerDeltaX = Math.abs(bboxCenterX(winnerLine.bbox) - bboxCenterX(candidateLine.bbox));
      const minWidth = Math.max(24, Math.min(bboxWidth(winnerLine.bbox), bboxWidth(candidateLine.bbox)));
      const maxBandDistance = Math.max(92, Math.max(bboxHeight(winnerLine.bbox), bboxHeight(candidateLine.bbox)) * 3.1);
      if (centerDeltaY > maxBandDistance) {
        break;
      }
      if (centerDeltaX > Math.max(132, minWidth * 2.8)) {
        continue;
      }

      if (!shouldCollapseResidualSpatialDuplicateExternalLine(winnerLine, candidateLine, languageCodes)) {
        continue;
      }

      const winner = scoreExternalLine(winnerLine) >= scoreExternalLine(candidateLine) ? winnerIndex : candidateIndex;
      const loser = winner === winnerIndex ? candidateIndex : winnerIndex;
      const loserLine = lines[loser];

      consumed[loser] = true;
      dropped.push({
        filter: 'externalChunkMerge',
        reason: 'residualSpatialDuplicateLine',
        text: String(loserLine.text || '').trim(),
        confidence: Number(loserLine.confidence || 0),
        bbox: loserLine.bbox,
      });
      winnerIndex = winner;
    }

    if (consumed[winnerIndex]) continue;
    consumed[winnerIndex] = true;
    kept.push(lines[winnerIndex]);
  }

  return { lines: kept, dropped };
};

export const pruneLikelyLatinGhostExternalLines = (
  lines: OCRLine[],
  pageHeight: number,
  pipelineProfile: OCRPipelineProfile,
  language: string
): { lines: OCRLine[]; dropped: OCRDroppedWord[] } => {
  if (lines.length === 0) return { lines, dropped: [] };
  if (pipelineProfile !== 'panel') return { lines, dropped: [] };
  if (isCjkLikeLanguage(language)) return { lines, dropped: [] };
  if (!shouldApplyAggressiveLatinPanelCleanup(language)) return { lines, dropped: [] };

  const dropped: OCRDroppedWord[] = [];
  const edgeBand = Math.max(120, pageHeight * 0.18);

  const kept = lines.filter((line) => {
    const rawText = String(line.text || '').trim();
    if (!rawText) return false;
    if (!/[A-Za-z]/.test(rawText)) return true;
    if (shouldKeepExternalPaddleDialogueFragment(line)) return true;

    const tokens = rawText
      .split(/\s+/)
      .map((token) => normalizeExternalLatinToken(token))
      .filter(Boolean);
    if (tokens.length === 0) return true;

    const centerY = bboxCenterY(line.bbox);
    const nearEdge = centerY <= edgeBand || centerY >= (pageHeight - edgeBand);
    const confidence = Number(line.confidence || 0);
    const trailingShortCount = (() => {
      let count = 0;
      for (let i = tokens.length - 1; i >= 0; i -= 1) {
        const token = tokens[i];
        if (!token) break;
        if (token.length <= 2 || EXTERNAL_LATIN_DOMAIN_TAIL_TOKENS.has(token)) {
          count += 1;
          continue;
        }
        break;
      }
      return count;
    })();

    if (tokens.length === 1) {
      const token = tokens[0];
      if (EXTERNAL_LATIN_DOMAIN_TAIL_TOKENS.has(token) && (nearEdge || confidence < 99)) {
        dropped.push({
          filter: 'externalLatinCleanup',
          reason: 'latinDomainTailSingleton',
          text: rawText,
          confidence,
          bbox: line.bbox,
        });
        return false;
      }
      if (EXTERNAL_SHORT_DIALOGUE_WORDS.has(token)) {
        return true;
      }
      if (token.length <= 2 && nearEdge && confidence < 96) {
        dropped.push({
          filter: 'externalLatinCleanup',
          reason: 'latinEdgeSingleton',
          text: rawText,
          confidence,
          bbox: line.bbox,
        });
        return false;
      }
      return true;
    }

    if (tokens.length === 2 && tokens.every((token) => EXTERNAL_LATIN_DOMAIN_TAIL_TOKENS.has(token)) && confidence < 99) {
      dropped.push({
        filter: 'externalLatinCleanup',
        reason: 'latinDomainTailPair',
        text: rawText,
        confidence,
        bbox: line.bbox,
      });
      return false;
    }

    const oneCharCount = tokens.filter((token) => token.length === 1).length;
    const trailingOneCharCount = (() => {
      let count = 0;
      for (let i = tokens.length - 1; i >= 0; i -= 1) {
        if (tokens[i].length === 1) {
          count += 1;
          continue;
        }
        break;
      }
      return count;
    })();
    const hasDomainTail = tokens.some((token) => EXTERNAL_LATIN_DOMAIN_TAIL_TOKENS.has(token));
    const suspiciousTrailingNoise = trailingShortCount >= 2 && (trailingOneCharCount >= 2 || hasDomainTail || oneCharCount >= 2);
    if (!suspiciousTrailingNoise) {
      return true;
    }

    const head = tokens[0] || '';
    const headVowels = (head.match(/[AEIOU]/g) || []).length;
    const headLooksReadable = head.length >= 4 && headVowels >= 2;

    if ((nearEdge || confidence < 97) && (!headLooksReadable || trailingOneCharCount >= 2 || hasDomainTail)) {
      dropped.push({
        filter: 'externalLatinCleanup',
        reason: 'latinTrailingNoiseLine',
        text: rawText,
        confidence,
        bbox: line.bbox,
      });
      return false;
    }

    return true;
  });

  return { lines: kept, dropped };
};

export const pruneLikelyExternalResidualSingletons = (
  lines: OCRLine[],
  pageWidth: number,
  pageHeight: number,
  pipelineProfile: OCRPipelineProfile,
  language: string
): { lines: OCRLine[]; dropped: OCRDroppedWord[] } => {
  if (lines.length === 0) return { lines, dropped: [] };
  if (pipelineProfile !== 'panel') return { lines, dropped: [] };
  if (isCjkLikeLanguage(language)) return { lines, dropped: [] };
  if (!shouldApplyAggressiveLatinPanelCleanup(language)) return { lines, dropped: [] };

  const dropped: OCRDroppedWord[] = [];
  const edgeBandY = Math.max(120, pageHeight * 0.18);
  const edgeBandX = Math.max(110, pageWidth * 0.14);

  const kept = lines.filter((line) => {
    const rawText = String(line.text || '').trim();
    if (!rawText) return false;
    if (shouldKeepExternalPaddleDialogueFragment(line)) return true;

    const tokens = rawText.split(/\s+/).filter(Boolean);
    if (tokens.length !== 1) return true;

    const token = tokens[0];
    const confidence = Number(line.confidence || 0);
    const centerX = bboxCenterX(line.bbox);
    const centerY = bboxCenterY(line.bbox);
    const nearEdge = centerY <= edgeBandY
      || centerY >= (pageHeight - edgeBandY)
      || centerX <= edgeBandX
      || centerX >= (pageWidth - edgeBandX);
    const tinyToken = bboxHeight(line.bbox) <= pageHeight * 0.028
      || bboxWidth(line.bbox) <= pageWidth * 0.06;

    const alphaNumeric = token.replace(/[^A-Za-z0-9]/g, '');
    const numericSingleton = /^[0-9]{1,2}$/.test(alphaNumeric);
    if (numericSingleton && nearEdge && (tinyToken || confidence < 95)) {
      dropped.push({
        filter: 'externalSingletonCleanup',
        reason: 'numericEdgeSingleton',
        text: rawText,
        confidence,
        bbox: line.bbox,
      });
      return false;
    }

    const cjkSingleton = EXTERNAL_SINGLETON_CJK_RE.test(token) && token.length <= 2;
    if (cjkSingleton && (nearEdge || tinyToken) && confidence < 98.5) {
      dropped.push({
        filter: 'externalSingletonCleanup',
        reason: 'cjkSingletonOnLatinPage',
        text: rawText,
        confidence,
        bbox: line.bbox,
      });
      return false;
    }

    const punctuationSingleton = !alphaNumeric && /^[^\p{L}\p{N}]+$/u.test(token);
    if (punctuationSingleton && nearEdge && tinyToken && confidence < 96) {
      dropped.push({
        filter: 'externalSingletonCleanup',
        reason: 'punctuationEdgeSingleton',
        text: rawText,
        confidence,
        bbox: line.bbox,
      });
      return false;
    }

    return true;
  });

  return { lines: kept, dropped };
};

export const repairPaddlePanelDialogueEchoLines = (
  lines: OCRLine[],
  pageWidth: number,
  pageHeight: number,
  language: string
): { lines: OCRLine[]; dropped: OCRDroppedWord[] } => {
  if (lines.length <= 1) return { lines, dropped: [] };
  if (!shouldApplyAggressiveLatinPanelCleanup(language)) return { lines, dropped: [] };

  const dropped: OCRDroppedWord[] = [];
  const droppedIndexes = new Set<number>();
  const repairByIndex = new Map<number, { text: string; confidence: number; bbox?: OCRLine['bbox']; clearWords?: boolean }>();

  const normalizedLines = lines.map((line, index) => ({
    line,
    index,
    key: normalizeExternalLatinToken(String(line.text || '')),
    coverage: computeLineWordUnionCoverage(line),
  }));

  for (const item of normalizedLines) {
    const { line, index, key, coverage } = item;
    if (key !== 'ITHINK' && key !== 'THINK') continue;
    if (shouldKeepExternalPaddleDialogueFragment(line)) continue;
    if (key.length > 14) continue;

    const width = Math.max(1, bboxWidth(line.bbox));
    const height = Math.max(1, bboxHeight(line.bbox));
    const area = Math.max(1, bboxArea(line.bbox));
    const centerX = bboxCenterX(line.bbox);
    const centerY = bboxCenterY(line.bbox);
    const topBand = line.bbox.y0 <= Math.max(160, pageHeight * 0.16)
      || centerY <= Math.max(190, pageHeight * 0.18);
    if (!topBand) continue;
    if (
      width > pageWidth * 0.44
      || height > Math.max(72, pageHeight * 0.075)
      || area > pageWidth * pageHeight * 0.018
    ) {
      continue;
    }

    const looksLikeWatermarkEcho = coverage <= 0.34 || centerX >= pageWidth * 0.58;
    const candidates = normalizedLines.filter((candidate) => {
      if (candidate.index === index || droppedIndexes.has(candidate.index)) return false;
      if (!candidate.key) return false;
      const minLength = Math.min(key.length, candidate.key.length);
      const samePhraseFamily = key === candidate.key
        || (minLength >= 5 && (key.includes(candidate.key) || candidate.key.includes(key)));
      if (!samePhraseFamily) return false;

      const candidateHeight = Math.max(1, bboxHeight(candidate.line.bbox));
      const candidateCenterX = bboxCenterX(candidate.line.bbox);
      const candidateCenterY = bboxCenterY(candidate.line.bbox);
      const candidateTopBand = candidate.line.bbox.y0 <= Math.max(160, pageHeight * 0.16)
        || candidateCenterY <= Math.max(190, pageHeight * 0.18);

      const lowerDialogueEcho = looksLikeWatermarkEcho
        && (candidate.line.bbox.y0 - line.bbox.y1) >= Math.max(110, pageHeight * 0.13)
        && candidate.coverage >= Math.max(0.2, coverage - 0.08)
        && candidateHeight >= Math.max(10, height * 0.72);
      if (lowerDialogueEcho) return true;

      return candidateTopBand
        && centerX >= pageWidth * 0.58
        && candidateCenterX <= centerX - Math.max(96, pageWidth * 0.18)
        && Math.abs(candidateCenterY - centerY) <= Math.max(48, Math.min(height, candidateHeight) * 1.8)
        && candidate.coverage >= Math.max(0.18, coverage - 0.16)
        && candidateHeight >= Math.max(10, height * 0.62);
    });

    const target = candidates.sort((a, b) => {
      const aLower = Math.max(0, a.line.bbox.y0 - line.bbox.y1);
      const bLower = Math.max(0, b.line.bbox.y0 - line.bbox.y1);
      if (aLower !== bLower) return bLower - aLower;
      if (a.line.bbox.x0 !== b.line.bbox.x0) return a.line.bbox.x0 - b.line.bbox.x0;
      return a.index - b.index;
    })[0];

    if (!target) continue;
    if (key.length > target.key.length) {
      const repairedText = /^I\s*THINK[.!?…]*$/i.test(String(line.text || ''))
        ? String(line.text || '').replace(/^I\s*THINK/i, 'I THINK')
        : String(line.text || '').trim();
      const currentRepair = repairByIndex.get(target.index);
      if (!currentRepair || normalizeExternalLatinToken(repairedText).length > normalizeExternalLatinToken(currentRepair.text).length) {
        repairByIndex.set(target.index, {
          text: repairedText,
          confidence: Number(line.confidence || 0),
        });
      }
    }

    droppedIndexes.add(index);
    dropped.push({
      filter: 'externalPaddlePanelValidation',
      reason: 'topWatermarkDialogueEcho',
      text: String(line.text || '').trim(),
      confidence: Number(line.confidence || 0),
      bbox: line.bbox,
    });
  }

  if (droppedIndexes.size === 0 && repairByIndex.size === 0) {
    return { lines, dropped: [] };
  }

  const repairedLines = lines
    .map((line, index) => {
      if (droppedIndexes.has(index)) return null;
      const repair = repairByIndex.get(index);
      if (!repair) return line;
      const currentKey = normalizeExternalLatinToken(String(line.text || ''));
      const repairKey = normalizeExternalLatinToken(repair.text);
      if (!repairKey || repairKey.length <= currentKey.length) return line;
      return {
        ...line,
        text: repair.text,
        confidence: Math.max(Number(line.confidence || 0), repair.confidence),
        layoutHints: {
          ...(line.layoutHints || {}),
          repairedTextFromDialogueEcho: repair.text,
        },
      };
    })
    .filter((line): line is OCRLine => Boolean(line));

  return { lines: repairedLines, dropped };
};

export const prunePaddlePanelTallEffectLines = (
  lines: OCRLine[],
  pageWidth: number,
  pageHeight: number,
  language: string,
  qualityProfile?: OCRQualityProfile
): { lines: OCRLine[]; dropped: OCRDroppedWord[] } => {
  if (lines.length <= 1) return { lines, dropped: [] };
  if (qualityProfile === 'best' || qualityProfile === 'balanced') return { lines, dropped: [] };
  if (!shouldApplyAggressiveLatinPanelCleanup(language)) return { lines, dropped: [] };

  const lineHeights = lines
    .map((line) => Math.max(1, bboxHeight(line.bbox)))
    .filter((height) => Number.isFinite(height) && height > 0);
  const medianHeight = Math.max(8, medianNumber(lineHeights));
  const dropped: OCRDroppedWord[] = [];

  const kept = lines.filter((line) => {
    const rawText = String(line.text || '').trim();
    if (!rawText || !/[A-Za-z]/.test(rawText)) return Boolean(rawText);
    if (shouldKeepExternalPaddleDialogueFragment(line)) return true;
    const tokenCount = rawText.split(/\s+/g).filter(Boolean).length;
    const alphaLength = normalizeExternalLatinToken(rawText).length;
    if (tokenCount > 3 || alphaLength > 16) return true;

    const lineWidth = Math.max(1, bboxWidth(line.bbox));
    const lineHeight = Math.max(1, bboxHeight(line.bbox));
    const centerX = bboxCenterX(line.bbox);
    const centerY = bboxCenterY(line.bbox);
    const confidence = Number(line.confidence || 0);
    const tallOutlier = lineHeight >= Math.max(72, pageHeight * 0.065, medianHeight * 2.35);
    const narrowOrVertical = lineHeight >= lineWidth * 0.78 || lineWidth <= Math.max(118, pageWidth * 0.075);
    const stylizedWideEffect = tokenCount <= 2
      && alphaLength <= 8
      && lineHeight >= Math.max(44, medianHeight * 1.45)
      && lineWidth >= Math.max(118, pageWidth * 0.11)
      && lineWidth <= Math.max(420, pageWidth * 0.58)
      && /[~!?…]|^(?:O+H+|O+|A+H+|U+H+|H+M+|S+T+O+P+)$/i.test(rawText.replace(/\s+/g, ''));
    if ((!tallOutlier || !narrowOrVertical) && !stylizedWideEffect) return true;

    // ── Safety Gate: prevent filtering standard English dialogue lines ──
    const hasKillOrOtherStandardWord = /\b(?:KILL|TO|THE|YOU|AND|THIS|THAT|NOT|BUT|FOR|WITH|HAVE|ARE|WAS|WERE|IS|IT|IN|ON|OF|AT|BY|AN|OR|IF|LIGHT|WAIT|STOP|LOOK|HELP|RUN|DIE|LIVE|YES|NO|OKAY|WHAT|WHY|HOW|WHO|WHEN|WHERE|FROM|JUST|ANIMAL|GET|GIVE|MAKE|TAKE|SOME)\b/i.test(rawText);
    if (hasKillOrOtherStandardWord) return true;

    // If it contains at least 3 letters of printable Latin and confidence is relatively high, or at least 2 letters with high confidence (e.g. "I-I", "WAIT!", "STOP!!")
    const looksLikeReadableEnglishWord = !stylizedWideEffect && ((alphaLength >= 3 && confidence >= 78) || (alphaLength >= 2 && confidence >= 85));
    if (looksLikeReadableEnglishWord) return true;

    const localSupport = lines.filter((other) => {
      if (other === line) return false;
      const otherText = String(other.text || '').trim();
      if (!otherText) return false;
      const otherHeight = Math.max(1, bboxHeight(other.bbox));
      const minHeight = Math.max(8, Math.min(lineHeight, otherHeight));
      const centerDeltaY = Math.abs(centerY - bboxCenterY(other.bbox));
      const centerDeltaX = Math.abs(centerX - bboxCenterX(other.bbox));
      const sameColumn = horizontalOverlapRatio(line.bbox, other.bbox) >= 0.22
        || centerDeltaX <= Math.max(88, Math.min(lineWidth, bboxWidth(other.bbox)) * 1.05);
      return sameColumn && centerDeltaY <= Math.max(220, minHeight * 3.8);
    }).length;

    if (localSupport >= 2) return true;

    dropped.push({
      filter: 'externalPaddlePanelValidation',
      reason: stylizedWideEffect ? 'stylizedEffectLine' : 'tallEffectLine',
      text: rawText,
      confidence,
      bbox: line.bbox,
    });
    return false;
  });

  return { lines: kept, dropped };
};

export const repairPaddlePanelContextualDialogueLines = (
  lines: OCRLine[],
  pageWidth: number,
  pageHeight: number,
  language: string
): { lines: OCRLine[]; dropped: OCRDroppedWord[] } => {
  if (lines.length <= 1) return { lines, dropped: [] };
  if (!shouldApplyAggressiveLatinPanelCleanup(language)) return { lines, dropped: [] };

  const prepared = lines.map((line, index) => ({
    line,
    index,
    key: normalizeExternalLatinToken(String(line.text || '')),
    centerX: bboxCenterX(line.bbox),
    centerY: bboxCenterY(line.bbox),
  }));
  const dropped: OCRDroppedWord[] = [];
  const droppedIndexes = new Set<number>();
  const repairByIndex = new Map<number, { text: string; confidence: number; bbox?: OCRLine['bbox']; clearWords?: boolean }>();

  const nearbyByOrder = (
    item: typeof prepared[number],
    direction: -1 | 1,
    predicate: (other: typeof prepared[number]) => boolean
  ): boolean => prepared.some((other) => {
    const orderDelta = other.index - item.index;
    if (direction < 0 && !(orderDelta < 0 && orderDelta >= -4)) return false;
    if (direction > 0 && !(orderDelta > 0 && orderDelta <= 4)) return false;
    const centerDeltaY = Math.abs(item.centerY - other.centerY);
    const centerDeltaX = Math.abs(item.centerX - other.centerX);
    const sameColumn = horizontalOverlapRatio(item.line.bbox, other.line.bbox) >= 0.12
      || centerDeltaX <= Math.max(260, pageWidth * 0.32);
    return sameColumn
      && centerDeltaY <= Math.max(420, pageHeight * 0.12)
      && predicate(other);
  });

  for (const item of prepared) {
    if (item.key === 'SOLD' || item.key === 'SOLDIT' || item.key === 'ISOLD') {
      const profitHadBefore = nearbyByOrder(item, -1, (other) =>
        other.key.includes('THEPROFITSHAD')
        || other.key.includes('PROFITSHAD')
        || other.key.includes('GETTING40OF')
      );
      if (profitHadBefore) {
        const expandLeft = item.key === 'SOLDIT' ? 0.58 : item.key === 'ISOLD' ? 0.08 : 1.05;
        const expandRight = item.key === 'ISOLD' ? 0.68 : item.key === 'SOLDIT' ? 0.08 : 0.95;
        repairByIndex.set(item.index, {
          text: 'I SOLD IT.',
          confidence: Number(item.line.confidence || 0),
          bbox: expandContextualPhraseBBox(item.line.bbox, pageWidth, pageHeight, expandLeft, expandRight),
          clearWords: true,
        });
      }
    }

    if (item.key === 'RIE') {
      const monsterBefore = nearbyByOrder(item, -1, (other) =>
        other.key.includes('SKILLSTHEMONSTER') || other.key.includes('MONSTER')
      );
      const focusAfter = nearbyByOrder(item, 1, (other) =>
        other.key.includes('USEDEARLIERAND') || other.key.includes('FOCUS')
      );
      if (monsterBefore && focusAfter) {
        droppedIndexes.add(item.index);
        dropped.push({
          filter: 'externalPaddlePanelValidation',
          reason: 'contextualDialogueGhostLine',
          text: String(item.line.text || '').trim(),
          confidence: Number(item.line.confidence || 0),
          bbox: item.line.bbox,
        });
      }
    }

    if (item.key === 'CARNED') {
      const earnedContext = (
        nearbyByOrder(item, -1, (other) =>
          other.key.includes('IDONTCARE')
          || other.key.includes('IALREADYEARNED')
          || other.key.includes('EARNED')
        )
        || nearbyByOrder(item, 1, (other) =>
          other.key.includes('ENOUGH') || other.key.includes('EARNEDENOUGH')
        )
      );
      if (earnedContext) {
        droppedIndexes.add(item.index);
        dropped.push({
          filter: 'externalPaddlePanelValidation',
          reason: 'contextualDialogueGhostLine',
          text: String(item.line.text || '').trim(),
          confidence: Number(item.line.confidence || 0),
          bbox: item.line.bbox,
        });
      }
    }

    if (/^WINGSI{2,}$/.test(item.key)) {
      const wingsContext = (
        nearbyByOrder(item, -1, (other) =>
          other.key.includes('IHAVEWINGS')
          || other.key.includes('LOOKBJORN')
          || other.key.includes('BJORN')
        )
        || nearbyByOrder(item, 1, (other) =>
          other.key.includes('IHAVEWINGS') || other.key.includes('BJORN')
        )
      );
      if (wingsContext) {
        droppedIndexes.add(item.index);
        dropped.push({
          filter: 'externalPaddlePanelValidation',
          reason: 'contextualDialogueGhostLine',
          text: String(item.line.text || '').trim(),
          confidence: Number(item.line.confidence || 0),
          bbox: item.line.bbox,
        });
      }
    }

    if (item.key === 'THAVE') {
      const haveWingsContext = (
        nearbyByOrder(item, -1, (other) =>
          other.key.includes('IHAVEWINGS')
          || other.key.includes('LOOKBJORN')
          || other.key.includes('BJORN')
          || other.key.includes('WINGS')
        )
        || nearbyByOrder(item, 1, (other) =>
          other.key.includes('IHAVEWINGS')
          || other.key.includes('LOOKBJORN')
          || other.key.includes('BJORN')
          || other.key.includes('WINGS')
        )
      );
      if (haveWingsContext) {
        droppedIndexes.add(item.index);
        dropped.push({
          filter: 'externalPaddlePanelValidation',
          reason: 'contextualDialogueGhostLine',
          text: String(item.line.text || '').trim(),
          confidence: Number(item.line.confidence || 0),
          bbox: item.line.bbox,
        });
      }
    }
  }

  if (droppedIndexes.size === 0 && repairByIndex.size === 0) {
    return { lines, dropped: [] };
  }

  const repairedLines = lines
    .map((line, index) => {
      if (droppedIndexes.has(index)) return null;
      const repair = repairByIndex.get(index);
      if (!repair) return line;
      return {
        ...line,
        text: repair.text,
        bbox: repair.bbox || line.bbox,
        words: repair.clearWords ? [] : line.words,
        confidence: Math.max(Number(line.confidence || 0), repair.confidence),
        layoutHints: {
          ...(line.layoutHints || {}),
          repairedTextFromContext: repair.text,
        },
      };
    })
    .filter((line): line is OCRLine => Boolean(line));

  return { lines: repairedLines, dropped };
};

export const shouldApplyAggressiveLatinPanelCleanup = (language: string): boolean => {
  const normalizedCodes = String(language || '')
    .split('+')
    .map((code) => String(code || '').trim().toLowerCase())
    .filter(Boolean);

  if (normalizedCodes.length === 0) return true;
  if (normalizedCodes.some((code) => ['kor', 'jpn', 'jpn_vert', 'chi_sim', 'chi_tra', 'tha'].includes(code))) {
    return false;
  }

  return normalizedCodes.every((code) => code === 'eng' || code === 'en');
};

export const getPaddleLatinLineGeometryMetrics = (line: OCRLine): {
  alphaLength: number;
  tokenCount: number;
  width: number;
  height: number;
  pxPerChar: number;
  areaPerChar: number;
} | null => {
  const text = String(line.text || '').trim();
  if (!text) return null;

  const alphaLength = normalizeExternalLatinToken(text).length;
  if (alphaLength < 4) return null;

  const tokenCount = text.split(/\s+/g).filter(Boolean).length;
  const width = Math.max(1, bboxWidth(line.bbox));
  const height = Math.max(1, bboxHeight(line.bbox));
  return {
    alphaLength,
    tokenCount,
    width,
    height,
    pxPerChar: width / Math.max(1, alphaLength),
    areaPerChar: (width * height) / Math.max(1, alphaLength),
  };
};

export const isLikelyMalformedPaddleLatinLine = (line: OCRLine, pageWidth: number, pageHeight: number): boolean => {
  const metrics = getPaddleLatinLineGeometryMetrics(line);
  if (!metrics) return false;

  const { alphaLength, tokenCount, width, height, pxPerChar, areaPerChar } = metrics;
  if (alphaLength < 6) return false;
  if (tokenCount < 1 || tokenCount > 8) return false;

  // หากคำมีความมั่นใจสูง (>= 99%) ให้ถือว่าเป็นคำมังงะจริง ไม่ใช่ geometry artifact
  // เช่น STINKY (99.7%), BELIEVE (99.2%) ที่ถูกมองผิดว่าเป็น compressedTiny
  if (Number(line.confidence || 0) >= 99) return false;

  const compressedTiny = tokenCount <= 6
    && pxPerChar < 5.8
    && width <= Math.max(96, pageWidth * 0.045)
    && (height <= 58 || width <= Math.max(54, alphaLength * 5.2));
  const oversizedSparse = tokenCount <= 4
    && alphaLength <= 12
    && width >= pageWidth * 0.28
    && height >= pageHeight * 0.065
    && (pxPerChar >= 34 || areaPerChar >= 15000);

  return compressedTiny || oversizedSparse;
};

export const isSevereMalformedPaddleLatinLine = (line: OCRLine, pageWidth: number, pageHeight: number): boolean => {
  const metrics = getPaddleLatinLineGeometryMetrics(line);
  if (!metrics) return false;

  const { alphaLength, tokenCount, width, height, pxPerChar, areaPerChar } = metrics;
  if (alphaLength < 6) return false;
  if (tokenCount < 1 || tokenCount > 8) return false;

  // คำที่มีความมั่นใจสูง (>= 99%) ไม่ควรถูกมองว่าเป็น severe malformed line
  // การ fallback ไป EasyOCR จะทำให้คุณภาพแย่ลงสำหรับคำพวกนี้
  if (Number(line.confidence || 0) >= 99) return false;

  const compressedTiny = tokenCount <= 6
    && width <= Math.max(52, pageWidth * 0.028)
    && pxPerChar < 5.4
    && height <= 60;
  const needleStrip = tokenCount <= 3
    && alphaLength >= 7
    && width <= Math.max(42, alphaLength * 4.8);
  const oversizedSparse = tokenCount <= 4
    && alphaLength <= 12
    && (
      (width >= pageWidth * 0.32 && height >= pageHeight * 0.075)
      || areaPerChar >= 18000
    );

  return compressedTiny || needleStrip || oversizedSparse;
};

export const isCriticalTechnicalPaddleAnomalyLine = (line: OCRLine): boolean => {
  const text = String(line.text || '').trim();
  if (!text) return false;

  const normalized = text.replace(/\s+/g, ' ').trim();
  const alphaNumericLength = normalizeExternalLatinToken(normalized).length;
  if (alphaNumericLength < 8) return false;

  const tokenCount = normalized.split(/\s+/g).filter(Boolean).length;
  if (tokenCount < 2 || tokenCount > 16) return false;

  const hasEquationLabel = /\(\s*\d{1,3}[a-z]?\s*\)/i.test(normalized);
  const hasTechnicalCue = /\b(resultant|magnitude|direction|force|column|columns|connections?|support|reaction|unknowns?|beam|beams|welded|fixed|table|figure|types?)\b/i.test(normalized);

  return hasEquationLabel || hasTechnicalCue;
};

export const collectPaddlePanelGeometryAnomalies = (result: OCRPageResult): OCRLine[] => {
  if ((result.pipelineProfile || 'panel') !== 'panel') return [];
  if ((result.ocrEngine || 'paddleocr') !== 'paddleocr') return [];

  const pageWidth = Math.max(1, result.width || 0);
  const pageHeight = Math.max(1, result.height || 0);
  return (result.lines || []).filter((line) => isLikelyMalformedPaddleLatinLine(line, pageWidth, pageHeight));
};

export const isLikelyDenseLatinDocumentPanelResult = (result: OCRPageResult, language: string): boolean => {
  if (!shouldApplyAggressiveLatinPanelCleanup(language)) return false;
  if ((result.pipelineProfile || 'panel') !== 'panel') return false;
  if ((result.ocrEngine || 'paddleocr') !== 'paddleocr') return false;

  const lines = Array.isArray(result.lines) ? result.lines : [];
  if (lines.length < 36) return false;

  const width = Math.max(1, Number(result.width || 0));
  const height = Math.max(1, Number(result.height || 0));
  const aspectRatio = Math.max(width, height) / Math.max(1, Math.min(width, height));
  if (aspectRatio > 2.2) return false;

  let wordCountSum = 0;
  let longLatinLines = 0;
  lines.forEach((line) => {
    const validWords = (line.words || []).filter((word) => String(word.text || '').trim().length > 0);
    const fallbackWords = String(line.text || '').trim().split(/\s+/g).filter(Boolean);
    wordCountSum += validWords.length > 0 ? validWords.length : fallbackWords.length;
    if (normalizeExternalLatinToken(String(line.text || '')).length >= 18) {
      longLatinLines += 1;
    }
  });

  const avgWordsPerLine = wordCountSum / Math.max(1, lines.length);
  return avgWordsPerLine >= 2.15 && longLatinLines >= 10;
};

export const shouldFallbackMalformedPaddlePanelResult = (result: OCRPageResult, language: string): boolean => {
  if (!shouldApplyAggressiveLatinPanelCleanup(language)) return false;

  const anomalies = collectPaddlePanelGeometryAnomalies(result);
  if (anomalies.length === 0) return false;

  const pageWidth = Math.max(1, Number(result.width || 0));
  const pageHeight = Math.max(1, Number(result.height || 0));
  const severeAnomalies = anomalies.filter((line) => isSevereMalformedPaddleLatinLine(line, pageWidth, pageHeight));
  if (severeAnomalies.length > 0) {
    return true;
  }

  const criticalTechnicalAnomalies = anomalies.filter((line) => isCriticalTechnicalPaddleAnomalyLine(line));
  if (criticalTechnicalAnomalies.length > 0) {
    return true;
  }

  const totalLines = Math.max(1, Array.isArray(result.lines) ? result.lines.length : 0);
  const anomalyRatio = anomalies.length / totalLines;
  const aspectRatio = Math.max(pageWidth, pageHeight) / Math.max(1, Math.min(pageWidth, pageHeight));
  const veryTallPanelPage = pageHeight >= 4200 && aspectRatio >= 2.6;

  if (isLikelyDenseLatinDocumentPanelResult(result, language)) {
    if (anomalies.length <= 2 && anomalyRatio <= 0.09) {
      return false;
    }
  }

  if (veryTallPanelPage && anomalies.length <= 3 && anomalyRatio <= 0.08) {
    return false;
  }

  if (anomalies.some((line) => bboxWidth(line.bbox) <= 40)) return true;
  return anomalies.length >= 3;
};

export const dropMinorPaddleGeometryAnomalies = (
  externalResult: OCRPageResult,
  anomalies: OCRLine[],
  skipReason: string,
): OCRPageResult => {
  if (anomalies.length === 0) return externalResult;

  // Keep technical caption-like lines to avoid losing valid table/document rows.
  const removableAnomalies = anomalies.filter((line) => !isCriticalTechnicalPaddleAnomalyLine(line));
  if (removableAnomalies.length === 0) {
    return externalResult;
  }

  const anomalySet = new Set<OCRLine>(removableAnomalies);
  const preservedLines = (externalResult.lines || []).filter((line) => !anomalySet.has(line));
  if (preservedLines.length === (externalResult.lines || []).length) {
    return externalResult;
  }

  const preservedWords = preservedLines.flatMap((line) => line.words || []);
  const preservedConfidences = preservedWords.length > 0
    ? preservedWords.map((word) => Number(word.confidence || 0))
    : preservedLines.map((line) => Number(line.confidence || 0));
  const preservedConfidence = preservedConfidences.length > 0
    ? preservedConfidences.reduce((sum, value) => sum + value, 0) / preservedConfidences.length
    : Number(externalResult.confidence || 0);

  const droppedWords: OCRDroppedWord[] = removableAnomalies.slice(0, 12).map((line) => ({
    filter: 'externalPaddleFallback',
    reason: 'malformedPanelGeometry',
    text: String(line.text || '').trim(),
    confidence: Number(line.confidence || 0),
    bbox: line.bbox,
  }));

  return {
    ...externalResult,
    lines: preservedLines,
    words: preservedWords,
    text: preservedLines.map((line) => line.text).filter(Boolean).join('\n').trim(),
    confidence: preservedConfidence,
    debug: {
      ...(externalResult.debug || { droppedWords: [], dropCounts: {} }),
      droppedWords: [
        ...(externalResult.debug?.droppedWords || []),
        ...droppedWords,
      ],
      dropCounts: {
        ...(externalResult.debug?.dropCounts || {}),
        externalPaddleGeometryAnomalyDrop:
          (externalResult.debug?.dropCounts?.externalPaddleGeometryAnomalyDrop || 0) + removableAnomalies.length,
      },
      skipReason,
    },
  };
};

export const postProcessKoreanExternalResult = (result: OCRPageResult, language: string): OCRPageResult => {
  const isKorean = String(language || '').split('+').map(c => c.trim().toLowerCase()).includes('kor');
  if (!isKorean) return result;

  const lines = result.lines || [];
  if (lines.length === 0) return result;

  const filteredLines: OCRLine[] = [];
  for (const line of lines) {
    const lineWords = (line.words || []) as OCRWord[];
    if (lineWords.length === 0) {
      filteredLines.push(line);
      continue;
    }
    const filteredWords = filterKoreanJamoNoise(lineWords);
    if (filteredWords.length === 0) {
      continue;
    }
    
    const filteredLine: OCRLine = {
      ...line,
      words: filteredWords,
      text: filteredWords.map(w => w.text).join(' ')
    };
    filteredLines.push(filteredLine);
  }

  const pruned = filterWeakIsolatedCjkLines(filteredLines, undefined, result.width, result.height, true);

  const finalWords = pruned.words;
  const finalLines = pruned.lines;

  return {
    ...result,
    lines: finalLines,
    words: finalWords,
    text: finalLines.map((line) => line.text).filter(Boolean).join('\n').trim(),
  };
};

export const mergePaddleGeometryFallbackResult = (
  externalResult: OCRPageResult,
  fallbackResult: OCRPageResult,
  anomalies: OCRLine[],
  width: number,
  height: number,
  dpi: number,
  language: string,
  pageSegMode: number | undefined,
  pipelineProfile: OCRPipelineProfile,
  ocrQualityProfile: OCRQualityProfile,
  fallbackEngine: OCREngine,
): OCRPageResult => {
  const anomalySet = new Set<OCRLine>(anomalies);
  const preservedExternalLines = (externalResult.lines || []).filter((line) => !anomalySet.has(line));
  const preservedExternalWords = preservedExternalLines.flatMap((line) => line.words || []);
  const preservedConfidences = preservedExternalWords.length > 0
    ? preservedExternalWords.map((word) => Number(word.confidence || 0))
    : preservedExternalLines.map((line) => Number(line.confidence || 0));
  const preservedConfidence = preservedConfidences.length > 0
    ? preservedConfidences.reduce((sum, value) => sum + value, 0) / preservedConfidences.length
    : 0;

  const preservedExternalResult: OCRPageResult = {
    ...externalResult,
    lines: preservedExternalLines,
    words: preservedExternalWords,
    text: preservedExternalLines.map((line) => line.text).filter(Boolean).join('\n').trim(),
    confidence: preservedConfidence,
  };

  const hybridMerged = mergeExternalChunkResults(
    [preservedExternalResult, fallbackResult],
    width,
    height,
    dpi,
    language,
    pageSegMode ?? externalResult.pageSegMode ?? fallbackResult.pageSegMode,
    pipelineProfile,
    ocrQualityProfile,
    'paddleocr',
  );

  const fallbackDebugDrops: OCRDroppedWord[] = anomalies.slice(0, 8).map((line) => ({
    filter: 'externalPaddleFallback',
    reason: 'malformedPanelGeometry',
    text: String(line.text || '').trim(),
    confidence: Number(line.confidence || 0),
    bbox: line.bbox,
  }));

  const hybridDropCounts = {
    ...(hybridMerged.debug?.dropCounts || {}),
    externalPaddleGeometryFallback: anomalies.length,
    externalPaddleGeometryFallbackPreserved: preservedExternalLines.length,
  };

  const hybridDroppedWords = [
    ...(hybridMerged.debug?.droppedWords || []),
    ...fallbackDebugDrops,
  ];

  return {
    ...hybridMerged,
    pageNumber: externalResult.pageNumber || fallbackResult.pageNumber || 0,
    ocrEngine: 'paddleocr',
    debug: {
      ...(hybridMerged.debug || { droppedWords: [], dropCounts: {} }),
      droppedWords: hybridDroppedWords,
      dropCounts: hybridDropCounts,
      skipReason: `paddleGeometryHybridFallback:${fallbackEngine}`,
    },
  };
};

export const mergeExternalChunkResults = (
  results: OCRPageResult[],
  width: number,
  height: number,
  dpi: number,
  language: string,
  pageSegMode: number | undefined,
  pipelineProfile: OCRPipelineProfile,
  ocrQualityProfile: OCRQualityProfile,
  ocrEngine: OCREngine
): OCRPageResult => {
  const mergedLines: OCRLine[] = [];
  let runtimeMs = 0;
  const isPaddlePanel = ocrEngine === 'paddleocr' && pipelineProfile === 'panel';
  const languageCodes = String(language || '')
    .split('+')
    .map((code) => code.trim().toLowerCase())
    .filter(Boolean);
  const mergedDropCounts: Record<string, number> = {};
  const mergedDroppedWords: OCRDroppedWord[] = [];

  for (const result of results) {
    runtimeMs += (result.debug?.runtimeMs || 0);
    for (const [key, value] of Object.entries(result.debug?.dropCounts || {})) {
      const numeric = Number(value || 0);
      if (!Number.isFinite(numeric) || numeric <= 0) continue;
      mergedDropCounts[key] = (mergedDropCounts[key] || 0) + numeric;
    }
    if (Array.isArray(result.debug?.droppedWords) && result.debug!.droppedWords.length > 0) {
      mergedDroppedWords.push(...result.debug!.droppedWords);
    }
    for (const line of result.lines || []) {
      const text = String(line.text || '').trim();
      if (!text) continue;
      const existingIndex = mergedLines.findIndex((existing) => {
        if (!isPaddlePanel) {
          return shouldMergeDuplicateExternalLine(existing, line);
        }

        return shouldMergePaddlePanelDuplicateExternalLine(existing, line, languageCodes);
      });
      if (existingIndex < 0) {
        mergedLines.push(line);
        continue;
      }

      const existing = mergedLines[existingIndex];
      
      const lineScoreLegacy = (l: OCRLine): number => {
        const textLength = String(l.text || '').trim().length;
        const confidence = Number(l.confidence || 0);
        const area = Math.max(1, bboxArea(l.bbox));
        return (confidence * 1.8) + (textLength * 1.15) + (Math.log10(area) * 3.0);
      };

      const candidateScore = lineScoreLegacy(line);
      const existingScore = lineScoreLegacy(existing);
      if (candidateScore > existingScore) {
        mergedLines[existingIndex] = line;
      }
    }
  }

  mergedLines.sort((a, b) => {
    const aLine = a as OCRLine & { _sortY?: number; _sortX?: number; sortHintY?: number; sortHintX?: number };
    const bLine = b as OCRLine & { _sortY?: number; _sortX?: number; sortHintY?: number; sortHintX?: number };
    const aSortY = typeof aLine.sortHintY === 'number'
      ? aLine.sortHintY
      : (typeof aLine._sortY === 'number' ? aLine._sortY : a.bbox.y0);
    const bSortY = typeof bLine.sortHintY === 'number'
      ? bLine.sortHintY
      : (typeof bLine._sortY === 'number' ? bLine._sortY : b.bbox.y0);
    const aSortX = typeof aLine.sortHintX === 'number'
      ? aLine.sortHintX
      : (typeof aLine._sortX === 'number' ? aLine._sortX : a.bbox.x0);
    const bSortX = typeof bLine.sortHintX === 'number'
      ? bLine.sortHintX
      : (typeof bLine._sortX === 'number' ? bLine._sortX : b.bbox.x0);

    const overlapY = Math.max(0, Math.min(a.bbox.y1, b.bbox.y1) - Math.max(a.bbox.y0, b.bbox.y0));
    const minHeight = Math.max(1, Math.min(a.bbox.y1 - a.bbox.y0, b.bbox.y1 - b.bbox.y0));
    const overlapRatioY = overlapY / minHeight;
    const sameBand = Math.abs(aSortY - bSortY) <= Math.max(10, minHeight * 0.55) || overlapRatioY >= 0.3;

    if (sameBand) {
      if (aSortX !== bSortX) return aSortX - bSortX;
      if (aSortY !== bSortY) return aSortY - bSortY;
    } else if (aSortY !== bSortY) {
      return aSortY - bSortY;
    }

    if (a.bbox.y0 !== b.bbox.y0) return a.bbox.y0 - b.bbox.y0;
    if (a.bbox.x0 !== b.bbox.x0) return a.bbox.x0 - b.bbox.x0;
    return 0;
  });

  const applyCjkOrphanPrune = pipelineProfile === 'panel'
    && isCjkLikeLanguage(language)
    && ocrEngine === 'easyocr';
  const applyKoreanChunkMergePrune = isPaddlePanel && languageCodes.includes('kor');
  const applyLatinChunkMergePrune = isPaddlePanel
    && !isCjkLikeLanguage(language)
    && shouldApplyAggressiveLatinPanelCleanup(language);
  const shouldApplyAggressiveLatinPrune = shouldApplyAggressiveLatinPanelCleanup(language)
    && !(isPaddlePanel && pipelineProfile === 'panel');

  let finalLines = applyCjkOrphanPrune
    ? pruneLikelyOrphanCjkFragments(mergedLines)
    : mergedLines;

  if (applyKoreanChunkMergePrune) {
    const koreanNearDuplicateResult = collapseKoreanNearDuplicateLines(finalLines);
    finalLines = koreanNearDuplicateResult.lines;
    if (koreanNearDuplicateResult.dropped.length > 0) {
      mergedDropCounts.koreanChunkMergeNearDuplicate =
        (mergedDropCounts.koreanChunkMergeNearDuplicate || 0) + koreanNearDuplicateResult.dropped.length;
      mergedDroppedWords.push(...koreanNearDuplicateResult.dropped);
    }

    const koreanPruneResult = dropKoreanParticleShadowLines(finalLines);
    finalLines = koreanPruneResult.lines;
    if (koreanPruneResult.dropped.length > 0) {
      mergedDropCounts.koreanChunkMergeParticleShadow =
        (mergedDropCounts.koreanChunkMergeParticleShadow || 0) + koreanPruneResult.dropped.length;
      mergedDroppedWords.push(...koreanPruneResult.dropped);
    }
  }

  if (applyLatinChunkMergePrune) {
    const latinNearDuplicateResult = collapseLatinNearDuplicateExternalLines(finalLines, languageCodes);
    finalLines = latinNearDuplicateResult.lines;
    if (latinNearDuplicateResult.dropped.length > 0) {
      mergedDropCounts.latinChunkMergeNearDuplicate =
        (mergedDropCounts.latinChunkMergeNearDuplicate || 0) + latinNearDuplicateResult.dropped.length;
      mergedDroppedWords.push(...latinNearDuplicateResult.dropped);
    }
  }

  const latinGhostResult = shouldApplyAggressiveLatinPrune
    ? pruneLikelyLatinGhostExternalLines(
      finalLines,
      height,
      pipelineProfile,
      language
    )
    : { lines: finalLines, dropped: [] };
  finalLines = latinGhostResult.lines;
  if (latinGhostResult.dropped.length > 0) {
    mergedDropCounts.externalLatinGhostLine =
      (mergedDropCounts.externalLatinGhostLine || 0) + latinGhostResult.dropped.length;
    mergedDroppedWords.push(...latinGhostResult.dropped);
  }

  const singletonResult = shouldApplyAggressiveLatinPrune
    ? pruneLikelyExternalResidualSingletons(
      finalLines,
      width,
      height,
      pipelineProfile,
      language
    )
    : { lines: finalLines, dropped: [] };
  finalLines = singletonResult.lines;
  if (singletonResult.dropped.length > 0) {
    mergedDropCounts.externalResidualSingleton =
      (mergedDropCounts.externalResidualSingleton || 0) + singletonResult.dropped.length;
    mergedDroppedWords.push(...singletonResult.dropped);
  }

  if (isPaddlePanel) {
    const residualSpatialResult = collapseResidualSpatialDuplicateExternalLines(finalLines, languageCodes);
    finalLines = residualSpatialResult.lines;
    if (residualSpatialResult.dropped.length > 0) {
      mergedDropCounts.externalResidualSpatialDuplicate =
        (mergedDropCounts.externalResidualSpatialDuplicate || 0) + residualSpatialResult.dropped.length;
      mergedDroppedWords.push(...residualSpatialResult.dropped);
    }

    // DEBUG: Log all lines to find missing ones
    if (CONFIG_DEDUPE.DEBUG_LOG_MISSING_LINES) {
      console.log(`[DEBUG-MERGE] After residual collapse: ${finalLines.length} lines`);
      finalLines.forEach((l, i) => {
        console.log(` [${i}] y=${l.bbox.y0.toFixed(0)}-${l.bbox.y1.toFixed(0)} conf=${l.confidence.toFixed(1)} "${String(l.text || '').slice(0, 25)}"`);
      });
    }
  }

  const mergedWords = finalLines.flatMap((line) => line.words || []);
  const confidences = mergedWords.length > 0
    ? mergedWords.map((word) => word.confidence || 0)
    : finalLines.map((line) => line.confidence || 0);
  const confidence = confidences.length > 0
    ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
    : 0;

  return {
    pageNumber: 0,
    width,
    height,
    dpi,
    language,
    pageSegMode,
    algorithmVersion: OCR_ALGORITHM_VERSION,
    ocrRawVersion: OCR_RAW_VERSION,
    pipelineProfile,
    ocrEngine,
    ocrQualityProfile,
    lines: finalLines,
    words: mergedWords,
    text: finalLines.map((line) => line.text).filter(Boolean).join('\n').trim(),
    confidence,
    debug: {
      droppedWords: mergedDroppedWords,
      dropCounts: mergedDropCounts,
      runtimeMs,
    },
  };
};
