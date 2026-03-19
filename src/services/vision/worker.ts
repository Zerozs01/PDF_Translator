/**
 * Enhanced Vision Worker - Smart OCR & Segmentation
 *
 * Refactored: 2026-02-12
 * - Split 2636-line monolith into focused modules
 * - Applied Phase A accuracy fixes (relaxed filters, higher fallback budget)
 * - Added debug logging (DEBUG_LOG_DROPS flag in ocr-config.ts)
 *
 * Module structure:
 *   ocr-config.ts        – CONFIG thresholds & logDrop utility
 *   ocr-types.ts         – shared type definitions
 *   ocr-text-utils.ts    – character detection, text joining, language helpers
 *   ocr-preprocessing.ts – image loading, binarization
 *   ocr-parsing.ts       – TSV parsing, word sorting, line/bbox utilities
 *   ocr-filtering.ts     – noise, image tiles, background variance filters
 *   ocr-fallback.ts      – region recognition, chunking, vertical gap detection
 *   ocr-region.ts        – region classification & grouping
 */

import { createWorker, PSM, OEM } from 'tesseract.js';
import { OCR_ALGORITHM_VERSION } from './ocrVersion';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const self: any;

// ── Extracted modules ──
import { CONFIG, finishDropCollection, logDrop, startDropCollection } from './ocr-config';
import type {
  BBox,
  OCRWord,
  OCRLine,
  TesseractResult,
  DocumentType,
  OCRPipelineProfile,
  OCRStageMetric,
  OCRCandidateDebug,
} from './ocr-types';
import { hasLangCode, isCjkLanguage, isThaiLanguage, getAlphaNum, isNonLatinToken } from './ocr-text-utils';
import { preprocessImage, getImageDimensions } from './ocr-preprocessing';
import {
  parseTSV, buildLinesFromWordsByY, clampBBox,
  makeLineFromWords, mergeWordsIntoLine, findBestLineForBox,
  findBestLineBoxForLine, appendUniqueWords, rebuildLinesFromWords,
  computeLineCoverageRatio, findLargeGaps, normalizeFinalLines,
} from './ocr-parsing';
import {
  cleanLineNoise, buildProtectedWordSet, buildImageTileMask,
  filterWordsByImageTiles, filterWordsByBackground, filterIsolatedCjkNoise,
  filterKoreanJamoNoise, filterWeakIsolatedCjkLines,
  analyzeRegionTextLikeness, isLikelyTextRegion,
} from './ocr-filtering';
import { findVerticalGapRegions, recognizeRegion, recognizeInChunks } from './ocr-fallback';
import { classifyRegion, groupWordsIntoRegions } from './ocr-region';
import {
  cleanNoiseWordsWithinLatinLines,
  correctApproxLatinWords,
  countCaseTransitions,
  normalizeLatinTokenForLexicon,
  pruneResidualLatinNoiseLines,
  splitMergedLatinWords,
} from './ocr-latin-heuristics';
import { createOCRLogger, ensureWorkerForLanguage, sendOCRProgress } from './ocr-worker-shared';

// ── Crash diagnostic: report if module loaded successfully ──
try {
  console.log('[Worker-Primary] Module loaded OK – all imports resolved.');
  self.postMessage({ type: 'WORKER_BOOT', payload: { status: 'ok', ts: Date.now() } });
} catch (e) {
  console.error('[Worker-Primary] Boot postMessage failed:', e);
}

// ============================================
// Tesseract Worker State
// ============================================

let tesseractWorker: Awaited<ReturnType<typeof createWorker>> | null = null;
let currentLang = 'eng';
let workerInitPromise: Promise<void> | null = null;
const KOR_SYLLABLE_RE = /[\uAC00-\uD7AF]/;
const LATIN_SHORT_KEEP_FOR_LINE = new Set([
  'I', 'A', 'EH', 'ME', 'OH', 'AH', 'NO', 'GO',
  'IT', 'TO', 'DO', 'IN', 'ON', 'OF', 'IF', 'IS', 'BE', 'WE',
  'US', 'MY', 'OR', 'AN', 'AT', 'AS', 'AM', 'UP'
]);
const LATIN_COMMON_WORDS = new Set([
  'THE', 'A', 'I', 'YOU', 'HE', 'SHE', 'WE', 'THEY', 'IT', 'TO', 'OF', 'IN', 'ON', 'AT', 'FOR', 'AND', 'OR', 'IS', 'ARE', 'BE',
  'THAT', 'THIS', 'THOSE', 'THESE', 'PAST', 'ONLY', 'FOUND', 'TOP', 'GIRLS', 'CITY', 'BUT', 'NOW', 'CAN', 'MAKE', 'WITH', 'KIND',
  'STUFF', 'ROOM', 'DOOR', 'LOCK', 'TAKE', 'LOOK', 'OVER', 'GO', 'STUDENTS', 'MAY', 'DOING', 'BAD', 'THINGS', 'ELDERLY', 'WEAK',
  'WOMEN', 'CHILDREN', 'TOWN', 'XUJIA', 'SIN', 'NOT', 'JUST', 'ALL', 'COME', 'ACROSS', 'POSSIBILITY', 'WHAT', 'THINK', 'BEST', 'ITS', 'ILL',
  'HERE', 'PEOPLE', 'LIVE', 'THERE', 'TIANHAIL', 'TIANHAI'
]);

function normalizeLatinLineText(text: string): string {
  return normalizeLatinTokenForLexicon(getAlphaNum(text || ''));
}

interface LatinAnchorProbe {
  id: string;
  anchorLineIndex: number;
  bbox: BBox;
  probeType: 'anchorSecondLine' | 'anchorTopSparse' | 'anchorBottomSparse';
  minConf: number;
  psmOrder: number[];
}

function normalizePipelineProfile(profile: unknown): OCRPipelineProfile {
  return profile === 'export' ? 'export' : 'panel';
}

function makeWordDebugKey(word: OCRWord): string {
  const text = normalizeLatinTokenForLexicon(getAlphaNum((word.text || '').trim())) || (word.text || '').trim().toUpperCase();
  return [
    text,
    Math.round(word.bbox.x0),
    Math.round(word.bbox.y0),
    Math.round(word.bbox.x1),
    Math.round(word.bbox.y1),
  ].join(':');
}

function protectWords(wordSet: Set<string>, words: OCRWord[]): void {
  for (const word of words) {
    wordSet.add(makeWordDebugKey(word));
  }
}

function lineHasProtectedWord(
  line: { words: OCRWord[] },
  protectedWordKeys?: Set<string>
): boolean {
  if (!protectedWordKeys || protectedWordKeys.size === 0) return false;
  const lineWords = (line.words as OCRWord[]) || [];
  return lineWords.some((word) => protectedWordKeys.has(makeWordDebugKey(word)));
}

function recordStageMetric(
  stageMetrics: OCRStageMetric[],
  stage: OCRStageMetric['stage'],
  wordsBefore: OCRWord[],
  wordsAfter: OCRWord[],
  linesBefore: Array<{ words: OCRWord[] }>,
  linesAfter: Array<{ words: OCRWord[] }>
): void {
  stageMetrics.push({
    stage,
    wordsBefore: wordsBefore.length,
    wordsAfter: wordsAfter.length,
    linesBefore: linesBefore.length,
    linesAfter: linesAfter.length,
  });
}

function recordCandidateDebug(
  candidates: OCRCandidateDebug[],
  candidate: OCRCandidateDebug
): void {
  candidates.push(candidate);
}

function getLatinLexicalHits(lineWords: OCRWord[]): number {
  return lineWords
    .map((w) => normalizeLatinTokenForLexicon(getAlphaNum((w.text || '').trim())))
    .filter((token) => LATIN_COMMON_WORDS.has(token) || LATIN_SHORT_KEEP_FOR_LINE.has(token))
    .length;
}

function isLikelyLatinSpeechPage(
  lines: Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }>,
  words: OCRWord[],
  pageHeight: number
): boolean {
  if (lines.length === 0 || words.length === 0) return false;
  if (lines.length > CONFIG.LATIN_SPEECH_FASTPATH_MAX_LINES) return false;
  if (words.length > CONFIG.LATIN_SPEECH_FASTPATH_MAX_WORDS) return false;

  return lines.some((line) => {
    const lineWords = (line.words as OCRWord[]) || [];
    const centerY = (line.bbox.y0 + line.bbox.y1) / 2;
    if (centerY > pageHeight * CONFIG.LATIN_SPEECH_FASTPATH_TOP_CENTER_Y_RATIO) return false;
    const readableHits = lineWords.reduce((sum, word) => {
      return sum + (scoreLatinTokenReadability(word) >= 0.56 ? 1 : 0);
    }, 0);
    return readableHits >= 2 || normalizeLatinLineText(line.text || '').length >= 4;
  });
}

function analyzeTextLikeProbe(
  gray: Uint8ClampedArray | undefined,
  pageWidth: number,
  pageHeight: number,
  bbox: BBox
): { allowed: boolean; score: number; reason: string } {
  if (!gray || gray.length < pageWidth * pageHeight) {
    return { allowed: true, score: 1, reason: 'gray-unavailable' };
  }

  const metrics = analyzeRegionTextLikeness(gray, pageWidth, pageHeight, bbox);
  if (isLikelyTextRegion(metrics)) {
    return { allowed: true, score: metrics.textLikeScore, reason: 'text-like' };
  }

  const reasonParts: string[] = [];
  if (metrics.edgeDarkRatio >= metrics.interiorDarkRatio * CONFIG.BORDER_ARTIFACT_EDGE_BAND_RATIO) {
    reasonParts.push('borderArtifact');
  }
  if (metrics.centerBandDarkRatio < CONFIG.BORDER_ARTIFACT_CENTER_DARK_RATIO_MIN) {
    reasonParts.push('weakCenterBand');
  }
  if (metrics.connectedComponentCount < CONFIG.BORDER_ARTIFACT_COMPONENT_MIN) {
    reasonParts.push('fewComponents');
  }
  if (metrics.horizontalPeakCount < CONFIG.BORDER_ARTIFACT_HORIZONTAL_PEAKS_MIN) {
    reasonParts.push('flatProjection');
  }

  return {
    allowed: false,
    score: metrics.textLikeScore,
    reason: reasonParts.join('+') || 'nonTextRescueBox',
  };
}

function buildLatinAnchorProbes(
  lines: Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }>,
  actualWidth: number,
  actualHeight: number
): LatinAnchorProbe[] {
  const probes: LatinAnchorProbe[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineWords = (line.words as OCRWord[]) || [];
    if (lineWords.length === 0) continue;
    const centerY = (line.bbox.y0 + line.bbox.y1) / 2;
    if (centerY > actualHeight * CONFIG.LATIN_ANCHOR_PROBE_TOP_CENTER_Y_RATIO_MAX) continue;
    const quality = scoreLatinLineReadability(lineWords);
    if (quality < CONFIG.LATIN_ANCHOR_PROBE_MIN_LINE_QUALITY) continue;
    const lexicalHits = getLatinLexicalHits(lineWords);
    const normalizedText = normalizeLatinLineText(line.text || '');
    if (lexicalHits < 1 && normalizedText.length < 6) continue;

    const lineHeight = Math.max(1, line.bbox.y1 - line.bbox.y0);
    const medianHeight = getMedianHeight(lineWords);
    const isTopLine = !lines.some(other => {
      if (other === line) return false;
      const verticalGap = line.bbox.y0 - other.bbox.y1;
      const xOverlap = Math.max(0, Math.min(line.bbox.x1, other.bbox.x1) - Math.max(line.bbox.x0, other.bbox.x0));
      return verticalGap >= -medianHeight * 0.5 && verticalGap <= medianHeight * 3.5 && xOverlap > medianHeight * 0.5;
    });

    const isBottomLine = !lines.some(other => {
      if (other === line) return false;
      const verticalGap = other.bbox.y0 - line.bbox.y1;
      const xOverlap = Math.max(0, Math.min(line.bbox.x1, other.bbox.x1) - Math.max(line.bbox.x0, other.bbox.x0));
      return verticalGap >= -medianHeight * 0.5 && verticalGap <= medianHeight * 3.5 && xOverlap > medianHeight * 0.5;
    });

    const xPad = medianHeight * CONFIG.LATIN_ANCHOR_PROBE_X_PAD_MULT;
    
    if (isBottomLine) {
      const secondLineProbe = clampBBox({
        x0: line.bbox.x0 - xPad,
        x1: line.bbox.x1 + xPad,
        y0: line.bbox.y0 - medianHeight * CONFIG.LATIN_ANCHOR_PROBE_Y_PAD_ABOVE,
        y1: line.bbox.y1 + medianHeight * CONFIG.LATIN_ANCHOR_PROBE_Y_PAD_BELOW,
      }, actualWidth, actualHeight);
  
      const freeBandHeight = Math.max(0, secondLineProbe.y1 - line.bbox.y1);
      const minFreeBand = lineHeight * 0.7;
      const maxFreeBand = lineHeight * 3.8;
      if (freeBandHeight >= minFreeBand && freeBandHeight <= maxFreeBand) {
        probes.push({
          id: `anchor-second-${index}`,
          anchorLineIndex: index,
          bbox: secondLineProbe,
          probeType: 'anchorSecondLine',
          minConf: Math.max(36, CONFIG.LATIN_LINE_RESCAN_CONF - 12),
          psmOrder: [Number(PSM.SINGLE_BLOCK), Number(PSM.SPARSE_TEXT)],
        });
      }
    }

    if (isTopLine) {
      const topSparseProbe = clampBBox({
        x0: line.bbox.x0 - xPad,
        x1: line.bbox.x1 + xPad,
        y0: Math.max(0, line.bbox.y0 - medianHeight * 1.8),
        y1: line.bbox.y1 + medianHeight * 0.85,
      }, actualWidth, actualHeight);
  
      if (line.bbox.y0 > medianHeight * 0.75) {
        probes.push({
          id: `anchor-top-${index}`,
          anchorLineIndex: index,
          bbox: topSparseProbe,
          probeType: 'anchorTopSparse',
          minConf: Math.max(34, CONFIG.LATIN_TOP_PROBE_MIN_CONF - 18),
          psmOrder: [Number(PSM.SPARSE_TEXT)],
        });
      }
    }

    if (isBottomLine && CONFIG.LATIN_BOTTOM_PROBE_ENABLE) {
      const bottomXPad = medianHeight * CONFIG.LATIN_BOTTOM_PROBE_X_PAD_MULT;
      const bottomProbe = clampBBox({
        x0: line.bbox.x0 - bottomXPad,
        x1: line.bbox.x1 + bottomXPad,
        y0: line.bbox.y0 - medianHeight * CONFIG.LATIN_BOTTOM_PROBE_Y_PAD_ABOVE,
        y1: line.bbox.y1 + medianHeight * CONFIG.LATIN_BOTTOM_PROBE_Y_PAD_BELOW,
      }, actualWidth, actualHeight);

      const lowerFreeBand = Math.max(0, bottomProbe.y1 - line.bbox.y1);
      const minLowerFreeBand = lineHeight * CONFIG.LATIN_BOTTOM_PROBE_MIN_FREE_BAND_MULT;
      const maxLowerFreeBand = lineHeight * CONFIG.LATIN_BOTTOM_PROBE_MAX_FREE_BAND_MULT;
      if (
        lowerFreeBand >= minLowerFreeBand
        && lowerFreeBand <= maxLowerFreeBand
        && line.bbox.y1 < actualHeight - medianHeight * 0.6
      ) {
        probes.push({
          id: `anchor-bottom-${index}`,
          anchorLineIndex: index,
          bbox: bottomProbe,
          probeType: 'anchorBottomSparse',
          minConf: CONFIG.LATIN_BOTTOM_PROBE_MIN_CONF,
          psmOrder: [Number(PSM.SINGLE_BLOCK), Number(PSM.SPARSE_TEXT)],
        });
      }
    }
  }

  return probes;
}

function sendProgress(status: string, progress: number, workerId?: string): void {
  sendOCRProgress({ status, progress, workerId });
}

function getLangPath(): string | undefined {
  if (!CONFIG.LANG_PATH) return undefined;
  try {
    if (typeof self !== 'undefined' && 'location' in self) {
      const base = self.location.origin;
      return new URL(CONFIG.LANG_PATH, base).toString().replace(/\/$/, '');
    }
  } catch { /* ignore */ }
  return CONFIG.LANG_PATH;
}

async function createWorkerWithLanguage(
  lang: string,
  sendUpdates = false
): Promise<Awaited<ReturnType<typeof createWorker>>> {
  console.log(`[Worker] Creating Tesseract worker for: ${lang}`);
  try {
    const langPath = getLangPath();
    const worker = await createWorker(lang, OEM.LSTM_ONLY, {
      corePath: CONFIG.CORE_PATH,
      langPath,
      logger: createOCRLogger(sendUpdates, ({ status, progress, workerId }) => {
        sendProgress(status, progress, workerId);
      })
    });
    console.log(`[Worker] Tesseract initialized for: ${lang}${langPath ? ` (langPath=${langPath})` : ''}`);
    return worker;
  } catch (err) {
    console.warn(`[Worker] Failed with local langPath, retrying CDN...`, err);
    const worker = await createWorker(lang, OEM.LSTM_ONLY, {
      corePath: CONFIG.CORE_PATH,
      logger: createOCRLogger(sendUpdates, ({ status, progress, workerId }) => {
        sendProgress(status, progress, workerId);
      })
    });
    console.log(`[Worker] Tesseract initialized for: ${lang} (CDN fallback)`);
    return worker;
  }
}

async function getOrCreateWorker(targetLang: string): Promise<Awaited<ReturnType<typeof createWorker>>> {
  return ensureWorkerForLanguage(
    targetLang,
    () => ({ worker: tesseractWorker, lang: currentLang }),
    (next) => {
      tesseractWorker = next.worker;
      currentLang = next.lang;
    },
    () => workerInitPromise,
    (promise) => {
      workerInitPromise = promise;
    },
    async (lang, previous) => {
      if (previous.worker) {
        console.log(`[Worker] Switching language ${previous.lang} → ${lang}`);
        await previous.worker.terminate();
      }
      return createWorkerWithLanguage(lang, false);
    }
  );
}

function getMedianHeight(words: OCRWord[]): number {
  const heights = words
    .map(w => Math.max(1, w.bbox.y1 - w.bbox.y0))
    .sort((a, b) => a - b);
  return heights[Math.floor(heights.length / 2)] || heights[0] || 1;
}

function getVerticalOverlapRatio(a: BBox, b: BBox): number {
  const overlap = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const minH = Math.max(1, Math.min(a.y1 - a.y0, b.y1 - b.y0));
  return overlap / minH;
}

function getMinHorizontalGap(candidate: OCRWord, lineWords: OCRWord[]): number {
  let minGap = Number.POSITIVE_INFINITY;
  for (const existing of lineWords) {
    const gap = existing.bbox.x0 > candidate.bbox.x1
      ? existing.bbox.x0 - candidate.bbox.x1
      : (candidate.bbox.x0 > existing.bbox.x1 ? candidate.bbox.x0 - existing.bbox.x1 : 0);
    if (gap < minGap) minGap = gap;
    if (minGap === 0) break;
  }
  return Number.isFinite(minGap) ? minGap : 0;
}

function countMeaningfulLatinWords(words: OCRWord[]): number {
  let count = 0;
  for (const word of words) {
    const alpha = getAlphaNum((word.text || '').trim());
    if (!alpha) continue;
    const normalized = normalizeLatinTokenForLexicon(alpha);
    if (!normalized) continue;
    if (LATIN_COMMON_WORDS.has(normalized) || LATIN_SHORT_KEEP_FOR_LINE.has(normalized)) {
      count += 1;
      continue;
    }
    const hasVowel = /[AEIOU]/.test(normalized);
    const longConsonantRun = /[BCDFGHJKLMNPQRSTVWXYZ]{5,}/.test(normalized);
    if (normalized.length >= 3 && hasVowel && !longConsonantRun && word.confidence >= 62) {
      count += 1;
    }
  }
  return count;
}

function isMeaningfulLatinToken(token: string): boolean {
  if (!token) return false;
  if (LATIN_COMMON_WORDS.has(token)) return true;
  if (LATIN_SHORT_KEEP_FOR_LINE.has(token)) return true;
  if (token.length >= 3) {
    return /[AEIOU]/.test(token);
  }
  return false;
}

function shouldUseLatinRawTextFallback(rawText: string): boolean {
  if (!rawText || rawText.trim().length === 0) return false;
  const rawLines = rawText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 140);
  if (rawLines.length === 0) return false;

  let totalTokens = 0;
  let meaningfulTokens = 0;
  let shortNoiseTokens = 0;
  let noVowelLongTokens = 0;
  let strongLines = 0;

  for (const line of rawLines) {
    const tokens = line
      .split(/\s+/)
      .map((part) => normalizeLatinTokenForLexicon(getAlphaNum(part)))
      .filter(Boolean);
    if (tokens.length === 0) continue;
    totalTokens += tokens.length;

    let lineMeaningful = 0;
    for (const token of tokens) {
      const meaningful = isMeaningfulLatinToken(token);
      if (meaningful) {
        meaningfulTokens += 1;
        lineMeaningful += 1;
      }

      if (token.length <= 2 && !LATIN_SHORT_KEEP_FOR_LINE.has(token)) {
        shortNoiseTokens += 1;
      }

      if (
        token.length >= 4
        && !/[AEIOU]/.test(token)
        && !LATIN_COMMON_WORDS.has(token)
      ) {
        noVowelLongTokens += 1;
      }
    }

    if (tokens.length >= 3 && lineMeaningful >= 2) {
      strongLines += 1;
    }
  }

  if (totalTokens < 3) return false;

  const meaningfulRatio = meaningfulTokens / totalTokens;
  const shortNoiseRatio = shortNoiseTokens / totalTokens;
  const noVowelLongRatio = noVowelLongTokens / totalTokens;

  return meaningfulTokens >= 3
    && strongLines >= 1
    && meaningfulRatio >= 0.44
    && shortNoiseRatio <= 0.48
    && noVowelLongRatio <= 0.38;
}

function getRecoveredCjkMinConfidence(alphaNum: string): number {
  if (alphaNum.length <= 1) return CONFIG.CJK_RECOVER_SINGLE_CONF;
  if (alphaNum.length <= 2) return CONFIG.CJK_RECOVER_SHORT_CONF;
  return CONFIG.CJK_RECOVER_MEDIUM_CONF;
}

function filterRecoveredCjkWords(
  candidateWords: OCRWord[],
  {
    source,
    minConf,
    lineWords,
    lineBox,
    isKorean,
  }: {
    source: string;
    minConf: number;
    lineWords?: OCRWord[];
    lineBox?: BBox;
    isKorean: boolean;
  }
): OCRWord[] {
  const medianHeight = lineWords && lineWords.length > 0 ? getMedianHeight(lineWords) : 0;
  const maxGap = medianHeight > 0 ? medianHeight * CONFIG.CJK_RECOVER_MAX_GAP_MULT : 0;

  return candidateWords.filter((word) => {
    const raw = (word.text || '').trim();
    if (!raw) {
      logDrop('recoverCjk', word, `${source}: empty`);
      return false;
    }

    const alphaNum = getAlphaNum(raw);
    if (!alphaNum) {
      logDrop('recoverCjk', word, `${source}: non-alnum`);
      return false;
    }

    const localHeight = Math.max(1, word.bbox.y1 - word.bbox.y0);
    const edgeMargin = lineBox
      ? Math.max(8, (medianHeight || localHeight) * CONFIG.CJK_RECOVER_EDGE_MARGIN_MULT)
      : 0;
    const nearLineEdge = Boolean(
      lineBox && (
        word.bbox.x0 <= lineBox.x0 + edgeMargin
        || word.bbox.x1 >= lineBox.x1 - edgeMargin
      )
    );

    if (word.confidence < minConf) {
      logDrop('recoverCjk', word, `${source}: conf<${minConf}`);
      return false;
    }

    const dynMin = Math.max(
      minConf,
      getRecoveredCjkMinConfidence(alphaNum) - (nearLineEdge ? CONFIG.CJK_RECOVER_EDGE_RELAX : 0)
    );
    if (word.confidence < dynMin) {
      logDrop('recoverCjk', word, `${source}: short token conf<${dynMin}`);
      return false;
    }

    if (isKorean && !KOR_SYLLABLE_RE.test(alphaNum)) {
      const hasDigit = /[0-9]/.test(alphaNum);
      const hasAscii = /[A-Za-z]/.test(alphaNum);
      if (hasDigit && alphaNum.length <= 3 && word.confidence < CONFIG.KOR_NONSYLLABLE_DIGIT_CONF) {
        logDrop('recoverCjk', word, `${source}: digit non-syllable`);
        return false;
      }
      if (hasAscii && alphaNum.length <= CONFIG.KOR_NONSYLLABLE_SHORT_MAX_LEN
        && word.confidence < CONFIG.KOR_NONSYLLABLE_ASCII_SHORT_CONF) {
        logDrop('recoverCjk', word, `${source}: ascii non-syllable`);
        return false;
      }
    }

    if (lineBox) {
      const yOverlap = getVerticalOverlapRatio(word.bbox, lineBox);
      const overlapStrictConf = nearLineEdge
        ? CONFIG.CJK_RECOVER_ISOLATED_SHORT_CONF - 5
        : CONFIG.CJK_RECOVER_ISOLATED_SHORT_CONF;
      if (yOverlap < CONFIG.CJK_RECOVER_Y_OVERLAP_MIN && word.confidence < overlapStrictConf) {
        logDrop('recoverCjk', word, `${source}: low y-overlap ${yOverlap.toFixed(2)}`);
        return false;
      }
    }

    if (lineWords && lineWords.length > 0 && medianHeight > 0) {
      const h = Math.max(1, word.bbox.y1 - word.bbox.y0);
      const hRatio = h / medianHeight;
      if (
        (hRatio < CONFIG.CJK_RECOVER_HEIGHT_RATIO_MIN || hRatio > CONFIG.CJK_RECOVER_HEIGHT_RATIO_MAX)
        && word.confidence < CONFIG.CJK_RECOVER_ISOLATED_SHORT_CONF
      ) {
        logDrop('recoverCjk', word, `${source}: abnormal height ratio ${hRatio.toFixed(2)}`);
        return false;
      }

      if (alphaNum.length <= 2) {
        const minGap = getMinHorizontalGap(word, lineWords);
        if (!nearLineEdge && minGap > maxGap && word.confidence < CONFIG.CJK_RECOVER_ISOLATED_SHORT_CONF) {
          logDrop('recoverCjk', word, `${source}: isolated short gap=${minGap.toFixed(1)}`);
          return false;
        }
      }
    }

    return true;
  });
}

function takeRecoveryCandidates(
  candidates: OCRWord[],
  remainingBudget: number,
  source: string
): OCRWord[] {
  if (remainingBudget <= 0 || candidates.length === 0) return [];
  if (candidates.length <= remainingBudget) return candidates;

  const sorted = candidates.slice().sort((a, b) => b.confidence - a.confidence);
  const kept = sorted.slice(0, remainingBudget);
  const dropped = sorted.slice(remainingBudget);
  for (const word of dropped) {
    logDrop('recoveryBudget', word, `${source}: budget exceeded`);
  }
  return kept;
}

function isLikelyWatermarkToken(word: OCRWord, pageWidth: number, pageHeight: number): boolean {
  const alpha = getAlphaNum((word.text || '').trim()).toUpperCase();
  if (!alpha) return false;

  const cx = (word.bbox.x0 + word.bbox.x1) / 2;
  const cy = (word.bbox.y0 + word.bbox.y1) / 2;
  const h = Math.max(1, word.bbox.y1 - word.bbox.y0);
  const heightRatio = h / Math.max(1, pageHeight);
  const nearTop = cy <= pageHeight * 0.14;
  const nearBottom = cy >= pageHeight * 0.84;
  const inEdgeBand = nearTop || nearBottom;

  if (
    alpha.includes('LIKEMANGA')
    || alpha.includes('MANGA')
    || alpha.includes('MANGAIO')
    || (alpha.includes('MANG') && alpha.includes('IO'))
    || alpha.includes('CLOUDMERGE')
    || alpha.includes('ACLOUDMERGE')
    || alpha.includes('CLOUD')
    || alpha.includes('MERGE')
  ) {
    return true;
  }

  if (!inEdgeBand) return false;

  if (/^LIKE?[A-Z0-9]{3,}$/.test(alpha) && heightRatio <= 0.02) {
    return true;
  }

  if (/^[A-Z]{6,}[0-9]{0,3}$/.test(alpha) && (nearTop || nearBottom) && heightRatio <= 0.02 && word.confidence < 88) {
    return true;
  }

  if ((alpha === 'IO' || alpha === 'COM') && heightRatio <= 0.02 && cx >= pageWidth * 0.2 && cx <= pageWidth * 0.95) {
    return true;
  }

  // Fix 1.2: Catch watermark fragments like "MZ", "INGi" from LIKEMANGA.IO
  const raw = (word.text || '').trim();
  const hasMixedCase = /[A-Z]/.test(raw) && /[a-z]/.test(raw);
  const normalized = normalizeLatinTokenForLexicon(alpha);
  const isLexical = LATIN_COMMON_WORDS.has(normalized) || LATIN_SHORT_KEEP_FOR_LINE.has(normalized);
  const inCorner = (nearTop || nearBottom) && (cx >= pageWidth * 0.6 || cx <= pageWidth * 0.4);

  // Mixed-case fragment (e.g. "INGi") in edge band that isn't a known word
  if (hasMixedCase && !isLexical && alpha.length <= 5 && heightRatio <= 0.025 && word.confidence < 90) {
    return true;
  }

  // Short non-dictionary word in corner with small height
  if (inCorner && !isLexical && alpha.length <= 3 && heightRatio <= 0.025 && word.confidence < 92) {
    return true;
  }

  return false;
}

function stripLikelyWatermarkWords(words: OCRWord[], pageWidth: number, pageHeight: number): OCRWord[] {
  if (words.length === 0) return words;
  const anchors = words.filter(word => isLikelyWatermarkToken(word, pageWidth, pageHeight));
  if (anchors.length === 0) return words;

  return words.filter(word => {
    const alpha = getAlphaNum((word.text || '').trim());
    if (!alpha) return false;

    if (isLikelyWatermarkToken(word, pageWidth, pageHeight)) {
      logDrop('watermark', word, 'watermark signature');
      return false;
    }

    const h = Math.max(1, word.bbox.y1 - word.bbox.y0);
    const cy = (word.bbox.y0 + word.bbox.y1) / 2;
    const nearTop = cy <= pageHeight * 0.14;
    const nearBottom = cy >= pageHeight * 0.84;
    if (!nearTop && !nearBottom) return true;

    for (const anchor of anchors) {
      const ah = Math.max(1, anchor.bbox.y1 - anchor.bbox.y0);
      const acy = (anchor.bbox.y0 + anchor.bbox.y1) / 2;
      const sameEdgeBand = (acy <= pageHeight * 0.14 && nearTop) || (acy >= pageHeight * 0.84 && nearBottom);
      if (!sameEdgeBand) continue;

      const yClose = Math.abs(cy - acy) <= Math.max(h, ah) * 1.35;
      const xOverlap = Math.max(0, Math.min(word.bbox.x1, anchor.bbox.x1) - Math.max(word.bbox.x0, anchor.bbox.x0));
      const xNear = xOverlap > 0 || Math.abs(word.bbox.x0 - anchor.bbox.x1) <= ah * 2.2 || Math.abs(anchor.bbox.x0 - word.bbox.x1) <= ah * 2.2;
      if (yClose && xNear && (alpha.length <= 3 || word.confidence < 82)) {
        logDrop('watermark', word, 'adjacent to watermark signature');
        return false;
      }
    }

    return true;
  });
}

function filterLatinRescueWords(
  candidates: OCRWord[],
  pageWidth: number,
  pageHeight: number,
  minConf: number,
  source: string
): OCRWord[] {
  return candidates.filter((word) => {
    const raw = (word.text || '').trim();
    if (!raw) return false;

    const alpha = getAlphaNum(raw);
    if (!alpha) return false;
    const upper = alpha.toUpperCase();
    const normalized = normalizeLatinTokenForLexicon(alpha);
    const strictShortKeep = LATIN_SHORT_KEEP_FOR_LINE.has(upper);
    const lexicalToken = LATIN_COMMON_WORDS.has(normalized) || LATIN_SHORT_KEEP_FOR_LINE.has(normalized);
    const postPruneSource = source.startsWith('postPruneLine');
    const anchorSource = source === 'anchorSecondLine' || source === 'anchorTopSparse' || source === 'anchorBottomSparse';
    const lexicalRelax = (postPruneSource || anchorSource) && lexicalToken;
    const effectiveMinConf = lexicalRelax
      ? Math.max(30, minConf - (anchorSource ? 12 : (strictShortKeep ? 14 : 10)))
      : minConf;

    if (isLikelyWatermarkToken(word, pageWidth, pageHeight)) {
      logDrop('latinRescue', word, `${source}: watermark-like`);
      return false;
    }

    // Fix 1.5: Relax rescue filter for panel profile if it's a known lexical token
    // This assumes the panelProfile (which uses this filter) passes a special source string or we can
    // infer it from the context. The caller passes 'emptyLineFallback', 'anchorTopSparse', etc.
    // For panel profile, we want to allow high-value dictionary words even at very low confidence.
    const isPanelProfileRescue = source.includes('Fallback') || source.includes('Sparse') || source.includes('Rescan');
    if (lexicalToken && isPanelProfileRescue && word.confidence >= 25) {
      // Allow extremely low confidence for known words in specific rescue passes
    } else if (word.confidence < effectiveMinConf) {
      logDrop('latinRescue', word, `${source}: conf<${Math.round(effectiveMinConf)}`);
      return false;
    }

    const h = Math.max(1, word.bbox.y1 - word.bbox.y0);
    const hRatio = h / Math.max(1, pageHeight);
    const hasLatin = /[A-Za-z]/.test(alpha);
    const onlyDigits = /^[0-9]+$/.test(alpha);
    const consonantRun = /[BCDFGHJKLMNPQRSTVWXYZ]{3,}/i.test(alpha);
    const sparseLikeSource = source.includes('Sparse') || source.includes('lineRescan') || postPruneSource || anchorSource;
    const tokenReadable = scoreLatinTokenReadability(word);

    if (alpha.length === 1 && alpha !== 'I' && alpha !== 'A' && word.confidence < effectiveMinConf + 16) {
      logDrop('latinRescue', word, `${source}: weak single-char`);
      return false;
    }

    if (
      alpha.length <= 2
      && !strictShortKeep
      && sparseLikeSource
      && !(anchorSource && lexicalToken)
      && word.confidence < effectiveMinConf + 20
    ) {
      logDrop('latinRescue', word, `${source}: weak short sparse token`);
      return false;
    }

    if (source === 'topBandSparse' && !lexicalToken && alpha.length <= 3 && word.confidence < 98) {
      logDrop('latinRescue', word, `${source}: short non-lexical token`);
      return false;
    }

    if (source === 'topBandSparse' && /[0-9]/.test(alpha) && alpha.length <= 4 && word.confidence < 99) {
      logDrop('latinRescue', word, `${source}: digit-mixed top-band token`);
      return false;
    }

    if (onlyDigits) {
      const allowHighConfidenceDigit = !postPruneSource && word.confidence >= effectiveMinConf + 14;
      if (allowHighConfidenceDigit) return true;
      logDrop('latinRescue', word, `${source}: numeric artifact`);
      return false;
    }

    if (/^([A-Za-z])\1{1,2}$/.test(alpha) && word.confidence < effectiveMinConf + 20) {
      logDrop('latinRescue', word, `${source}: repeated-char artifact`);
      return false;
    }

    if (!hasLatin && alpha.length <= 2 && word.confidence < effectiveMinConf + 18) {
      logDrop('latinRescue', word, `${source}: non-latin short`);
      return false;
    }

    if (
      hasLatin
      && alpha.length >= 4
      && consonantRun
      && sparseLikeSource
      && tokenReadable < 0.6
      && word.confidence < effectiveMinConf + 18
    ) {
      logDrop('latinRescue', word, `${source}: consonant-cluster artifact`);
      return false;
    }

    if (hRatio < 0.0022 && word.confidence < effectiveMinConf + 12) {
      logDrop('latinRescue', word, `${source}: tiny token`);
      return false;
    }

    if (
      sparseLikeSource
      && tokenReadable < ((anchorSource && lexicalToken) ? 0.34 : 0.58)
      && word.confidence < ((anchorSource && lexicalToken) ? 88 : 95)
    ) {
      logDrop('latinRescue', word, `${source}: low readability token`);
      return false;
    }

    return true;
  });
}

function normalizeLatinDecorativeEdgeArtifacts(words: OCRWord[]): number {
  let fixed = 0;

  for (const word of words) {
    const raw = (word.text || '').trim();
    if (!raw) continue;
    const alpha = getAlphaNum(raw);
    if (!alpha || !/[A-Za-z]/.test(alpha)) continue;

    const chars = Array.from(raw);
    let start = 0;
    let end = chars.length;
    while (start < end && getAlphaNum(chars[start]).length === 0) start += 1;
    while (end > start && getAlphaNum(chars[end - 1]).length === 0) end -= 1;
    const cleaned = chars.slice(start, end).join('').trim();
    if (!cleaned || cleaned === raw) continue;

    const cleanedAlpha = getAlphaNum(cleaned);
    if (!cleanedAlpha) continue;
    if (cleanedAlpha.length < Math.max(1, Math.floor(alpha.length * 0.65))) continue;

    word.text = cleaned;
    fixed += 1;
  }

  return fixed;
}

function pruneLatinResidualNoiseWords(words: OCRWord[]): OCRWord[] {
  if (words.length === 0) return words;
  return words.filter((word) => {
    const raw = (word.text || '').trim();
    if (!raw) {
      logDrop('latinLine', word, 'residual empty token');
      return false;
    }

    const alphaRaw = getAlphaNum(raw);
    if (!alphaRaw) {
      logDrop('latinLine', word, 'residual punctuation token');
      return false;
    }

    const alpha = normalizeLatinTokenForLexicon(alphaRaw);
    const lexical = LATIN_COMMON_WORDS.has(alpha) || LATIN_SHORT_KEEP_FOR_LINE.has(alpha);
    const letters = (alpha.match(/[A-Za-z]/g) || []).length;
    const digits = (alpha.match(/[0-9]/g) || []).length;

    if (!lexical && countCaseTransitions(raw) >= 3 && word.confidence < 96) {
      logDrop('latinLine', word, 'mixed-case gibberish');
      return false;
    }

    if (
      !lexical
      && /^[a-z]+$/.test(alphaRaw)
      && alpha.length >= 3
      && (!/[aeiou]/i.test(alphaRaw) || /[bcdfghjklmnpqrstvwxyz]{4,}/i.test(alphaRaw))
      && word.confidence < 92
    ) {
      logDrop('latinLine', word, 'lowercase non-lexical noise');
      return false;
    }

    if (/^[0-9]+$/.test(alphaRaw)) {
      if (alphaRaw.length <= 2 || (alphaRaw.length <= 4 && word.confidence < 96)) {
        logDrop('latinLine', word, 'residual numeric artifact');
        return false;
      }
    }

    if (!lexical && letters > 0 && digits > 0 && alpha.length <= 3 && word.confidence < 100) {
      logDrop('latinLine', word, 'residual mixed digit short token');
      return false;
    }

    return true;
  });
}

function normalizeLatinRepeatedWordArtifacts(words: OCRWord[]): number {
  let fixed = 0;
  for (const word of words) {
    const raw = (word.text || '').trim();
    const alpha = getAlphaNum(raw);
    if (!alpha) continue;
    if (!/^[A-Za-z]+$/.test(alpha)) continue;
    if (alpha.length < 6) continue;
    const upper = alpha.toUpperCase();

    // Case 1: perfect half duplicate (e.g. MAYMAY → MAY)
    if (upper.length <= 14 && upper.length % 2 === 0) {
      const half = upper.length / 2;
      const left = upper.slice(0, half);
      const right = upper.slice(half);
      if (left === right) {
        word.text = alpha.slice(0, half);
        fixed += 1;
        continue;
      }
    }

    // Case 2: overlapping merge (e.g. DOINDOINGNG → DOING, ELDERLERLYLYNS → ELDERLY)
    // Try to find a word W where W's suffix overlaps with W's prefix in the merged string
    if (upper.length >= 8 && upper.length <= 20) {
      let bestCandidate = '';
      // Try split points: the original word W has length between 4 and upper.length/2+2
      for (let wLen = 4; wLen <= Math.min(upper.length - 3, Math.floor(upper.length * 0.65)); wLen++) {
        const candidate = upper.slice(0, wLen);
        // Check if the remainder starts with some suffix of the candidate
        const remainder = upper.slice(wLen);
        // Find overlap: candidate's suffix matches remainder's prefix
        for (let overlap = Math.min(candidate.length - 1, remainder.length); overlap >= 2; overlap--) {
          const candidateSuffix = candidate.slice(candidate.length - overlap);
          const remainderPrefix = remainder.slice(0, overlap);
          if (candidateSuffix === remainderPrefix) {
            // Reconstruct: candidate + remainder without the overlapping part
            const reconstructed = candidate + remainder.slice(overlap);
            if (reconstructed === candidate) {
              // Perfect overlap → candidate is the word
              const normalized = normalizeLatinTokenForLexicon(candidate);
              if (LATIN_COMMON_WORDS.has(normalized) && candidate.length > bestCandidate.length) {
                bestCandidate = candidate;
              }
            }
          }
        }
        // Also check if remainder IS the candidate (full repeat after partial)
        if (remainder.length >= wLen - 2 && remainder.length <= wLen + 2) {
          const normalized = normalizeLatinTokenForLexicon(candidate);
          if (LATIN_COMMON_WORDS.has(normalized) && candidate.length > bestCandidate.length) {
            // Verify that the remainder looks like the candidate with some noise
            let matchCount = 0;
            for (let i = 0; i < Math.min(candidate.length, remainder.length); i++) {
              if (candidate[i] === remainder[i]) matchCount++;
            }
            if (matchCount >= candidate.length * 0.6) {
              bestCandidate = candidate;
            }
          }
        }
      }
      if (bestCandidate) {
        word.text = bestCandidate.length <= alpha.length ? alpha.slice(0, bestCandidate.length) : bestCandidate;
        fixed += 1;
        continue;
      }
    }
  }
  return fixed;
}

/**
 * Fix 2.1: Correct Latin words using strict lexicon match
 * e.g. DOINNG → DOING, ELDERLLYNS → ELDERLY
 */
function correctLatinDictionaryArtifacts(words: OCRWord[]): number {
  let fixed = 0;
  for (const word of words) {
    const raw = (word.text || '').trim();
    const alpha = getAlphaNum(raw);
    if (!alpha || alpha.length < 4) continue;
    if (!/^[A-Za-z]+$/.test(alpha)) continue;

    const upper = alpha.toUpperCase();
    if (LATIN_COMMON_WORDS.has(upper)) continue;

    let bestMatch = '';
    let bestScore = 0;

    for (const dictWord of LATIN_COMMON_WORDS) {
      if (dictWord.length < 4) continue;
      
      let commonPrefixLen = 0;
      const minLen = Math.min(dictWord.length, upper.length);
      for (let i = 0; i < minLen; i++) {
        if (dictWord[i] === upper[i]) commonPrefixLen++;
        else break;
      }

      if (commonPrefixLen < Math.min(4, dictWord.length - 1)) continue;

      const remainingDict = dictWord.length - commonPrefixLen;
      const remainingUpper = upper.length - commonPrefixLen;
      
      if (remainingDict <= 2 && remainingUpper <= 3) {
        const score = commonPrefixLen * 2 - remainingDict - remainingUpper;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = dictWord;
        }
      }
    }

    if (bestMatch) {
      const isAllUpper = alpha === alpha.toUpperCase();
      const replacement = isAllUpper ? bestMatch : bestMatch.charAt(0) + bestMatch.slice(1).toLowerCase();
      // Replace the alphabetical part but keep surrounding punctuation
      const newText = raw.replace(/[A-Za-z]+/, replacement);
      if (word.text !== newText) {
        word.text = newText;
        fixed += 1;
      }
    }
  }
  return fixed;
}

function scoreLatinTokenReadability(word: OCRWord): number {
  const raw = (word.text || '').trim();
  if (!raw) return 0;
  const rawAlpha = getAlphaNum(raw);
  if (!rawAlpha) return 0;
  const alpha = normalizeLatinTokenForLexicon(rawAlpha);

  const confScore = Math.max(0, Math.min(1, word.confidence / 100));
  const letters = (alpha.match(/[A-Za-z]/g) || []).length;
  const digits = (rawAlpha.match(/[0-9]/g) || []).length;

  if (letters === 0) {
    if (/^[0-9]{1,2}$/.test(alpha)) return confScore * 0.18;
    return confScore * 0.08;
  }

  const vowels = (alpha.match(/[AEIOUaeiou]/g) || []).length;
  const consonants = letters - vowels;

  let score = confScore;
  if (alpha.length === 1 && !/^[IAia]$/.test(alpha)) score *= 0.35;
  if (letters >= 3 && vowels === 0 && consonants >= 3 && word.confidence < 92) score *= 0.38;
  if (digits > 0 && letters > 0 && word.confidence < 92) score *= 0.55;
  if (/^[A-Z]{2}$/.test(alpha) && word.confidence >= 60) score = Math.max(score, 0.62);
  if (/^[A-Z]{3,}$/.test(alpha) && vowels === 0 && word.confidence < 88) score *= 0.72;
  return Math.max(0, Math.min(1, score));
}

function scoreLatinLineReadability(lineWords: OCRWord[]): number {
  if (lineWords.length === 0) return 0;
  const score = lineWords.reduce((sum, word) => sum + scoreLatinTokenReadability(word), 0) / lineWords.length;
  return Math.max(0, Math.min(1, score));
}

function scoreLatinCandidate(words: OCRWord[], lines: Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }>): number {
  if (words.length === 0) return 0;
  const meaningful = countMeaningfulLatinWords(words);
  const lexicalHits = words.reduce((sum, word) => {
    const alpha = getAlphaNum((word.text || '').trim());
    if (!alpha) return sum;
    const normalized = normalizeLatinTokenForLexicon(alpha);
    return sum + (LATIN_COMMON_WORDS.has(normalized) ? 1 : 0);
  }, 0);
  const noisySingles = words.reduce((sum, word) => {
    const alpha = getAlphaNum((word.text || '').trim());
    if (!alpha) return sum;
    const normalized = normalizeLatinTokenForLexicon(alpha);
    return sum + (normalized.length === 1 && !LATIN_SHORT_KEEP_FOR_LINE.has(normalized) ? 1 : 0);
  }, 0);
  const avgConfidence = words.reduce((sum, word) => sum + word.confidence, 0) / Math.max(1, words.length);
  const avgLineQuality = lines.length > 0
    ? lines.reduce((sum, line) => sum + scoreLatinLineReadability((line.words as OCRWord[]) || []), 0) / lines.length
    : 0;
  return (meaningful * 2.6) + (lexicalHits * 1.6) + (avgConfidence * 0.06) + (avgLineQuality * 4.2) - (noisySingles * 1.2);
}

function extendLatinProtectedWords(
  lines: Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }>,
  protectedWords: Set<OCRWord>
): void {
  for (const line of lines) {
    const lineWords = (line.words as OCRWord[]) || [];
    if (lineWords.length === 0) continue;

    const lineTokens = lineWords
      .map((w) => normalizeLatinTokenForLexicon(getAlphaNum((w.text || '').trim())))
      .filter(Boolean);
    if (lineTokens.length === 0) continue;

    const commonHits = lineTokens.filter((token) => LATIN_COMMON_WORDS.has(token)).length;
    const shortKeepHits = lineTokens.filter((token) => LATIN_SHORT_KEEP_FOR_LINE.has(token)).length;
    const lexicalHits = commonHits + shortKeepHits;
    const readableCount = lineTokens.filter((token) => (
      LATIN_COMMON_WORDS.has(token)
      || LATIN_SHORT_KEEP_FOR_LINE.has(token)
      || (token.length >= 3 && /[AEIOU]/.test(token))
    )).length;
    const readableRatio = readableCount / Math.max(1, lineTokens.length);
    const quality = scoreLatinLineReadability(lineWords);
    const alpha = normalizeLatinTokenForLexicon(getAlphaNum((line.text || '').trim()));
    const chars = alpha.length;

    const protectLine = (
      commonHits >= 2
      || (commonHits >= 1 && readableRatio >= 0.42 && quality >= 0.3)
      || (shortKeepHits === lineTokens.length && lineTokens.length >= 2 && chars <= 8 && line.confidence >= 36)
      || (lexicalHits >= 2 && readableRatio >= 0.5 && quality >= 0.34)
      || (chars >= 6 && readableRatio >= 0.72 && quality >= 0.38 && line.confidence >= 48)
    );
    if (!protectLine) continue;

    for (const word of lineWords) {
      const token = normalizeLatinTokenForLexicon(getAlphaNum((word.text || '').trim()));
      if (!token) continue;
      const lexical = LATIN_COMMON_WORDS.has(token) || LATIN_SHORT_KEEP_FOR_LINE.has(token);
      if (lexical || word.confidence >= 34) {
        protectedWords.add(word);
      }
    }
  }
}

function pruneLatinHighRecallNoiseLines(
  lines: Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }>,
  protectedWordKeys?: Set<string>
): Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }> {
  if (lines.length === 0) return lines;

  return lines.filter((line) => {
    const lineWords = (line.words as OCRWord[]) || [];
    if (lineWords.length === 0) return false;
    const hasProtected = lineHasProtectedWord(line, protectedWordKeys);
    const probeWord = lineWords[0];
    const alpha = normalizeLatinTokenForLexicon(getAlphaNum((line.text || '').trim()));
    if (!alpha) {
      if (probeWord) logDrop('latinLine', probeWord, 'highRecall empty line');
      return false;
    }

    const lineTokens = lineWords
      .map((w) => normalizeLatinTokenForLexicon(getAlphaNum((w.text || '').trim())))
      .filter(Boolean);
    if (lineTokens.length === 0) {
      if (probeWord) logDrop('latinLine', probeWord, 'highRecall empty tokens');
      return false;
    }

    const commonHits = lineTokens.filter((token) => LATIN_COMMON_WORDS.has(token)).length;
    const shortKeepHits = lineTokens.filter((token) => LATIN_SHORT_KEEP_FOR_LINE.has(token)).length;
    const readableCount = lineTokens.filter((token) => (
      LATIN_COMMON_WORDS.has(token)
      || LATIN_SHORT_KEEP_FOR_LINE.has(token)
      || (token.length >= 3 && /[AEIOU]/.test(token))
    )).length;
    const readableRatio = readableCount / Math.max(1, lineTokens.length);
    const quality = scoreLatinLineReadability(lineWords);
    const hasDigits = /[0-9]/.test(alpha);
    const chars = alpha.length;
    const avgConf = lineWords.reduce((s, w) => s + w.confidence, 0) / Math.max(1, lineWords.length);

    // Protected words are a hint, not an unconditional bypass.
    // This avoids cases where one rescued token (e.g. "TO") keeps an otherwise
    // garbage line alive (e.g. "AVIA TO dl CR En Se").
    if (hasProtected && (commonHits >= 2 || quality >= 0.58 || avgConf >= 68 || readableRatio >= 0.62)) {
      return true;
    }

    if (commonHits >= 2) return true;
    // Single common-word hit: require supporting evidence so a lone "TO" or "IN"
    // cannot protect an entire garbage line like "AVIA TO dl CR En Se".
    if (commonHits === 1 && (readableRatio >= 0.4 || quality >= 0.4 || avgConf >= 55)) return true;
    if (shortKeepHits === lineTokens.length && lineTokens.length >= 2) return true;
    if (lineTokens.length >= 2 && readableRatio >= 0.7 && quality >= 0.38 && line.confidence >= 52) return true;

    // DEBUG: log line stats for diagnosis
    if (CONFIG.DEBUG_LOG_DROPS) {
      console.log(`[highRecallNoise] line="${(line.text || '').trim().slice(0, 40)}" tokens=${lineTokens.length} common=${commonHits} shortKeep=${shortKeepHits} readable=${readableRatio.toFixed(2)} quality=${quality.toFixed(2)} avgConf=${avgConf.toFixed(1)} chars=${chars} digits=${hasDigits} protected=${hasProtected}`);
    }

    if (
      lineTokens.length <= 3
      && commonHits === 0
      && shortKeepHits <= 1
      && readableRatio < 0.5
      && quality < 0.64
      && line.confidence < 96
    ) {
      if (probeWord) logDrop('latinLine', probeWord, 'highRecall low-readable short line');
      return false;
    }

    if (
      hasDigits
      && commonHits === 0
      && shortKeepHits === 0
      && chars <= 14
      && quality < 0.72
      && line.confidence < 98
    ) {
      if (probeWord) logDrop('latinLine', probeWord, 'highRecall digit-heavy noise');
      return false;
    }

    // Multi-token garbage line: many tokens but very few dictionary words and low quality
    // e.g. "AVIA TO dl CR En Se" — 6 tokens, 1 common hit, quality 0.34, avgConf 34
    if (
      lineTokens.length >= 4
      && commonHits <= 1
      && readableRatio < 0.45
      && quality < 0.45
      && avgConf < 55
    ) {
      if (probeWord) logDrop('latinLine', probeWord, 'highRecall multi-token garbage line');
      return false;
    }

    return true;
  });
}

function normalizeLatinFragmentedLines(
  lines: Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }>
): Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }> {
  if (lines.length <= 1) return lines.slice().sort((a, b) => a.bbox.y0 - b.bbox.y0);

  const sorted = lines
    .map((line) => ({
      ...line,
      words: (line.words || []).slice(),
    }))
    .sort((a, b) => a.bbox.y0 - b.bbox.y0);

  const heights = sorted
    .map((line) => Math.max(1, line.bbox.y1 - line.bbox.y0))
    .sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || heights[0] || 1;

  const merged: Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }> = [];
  for (const line of sorted) {
    if (merged.length === 0) {
      merged.push(line);
      continue;
    }

    const prev = merged[merged.length - 1];
    const prevH = Math.max(1, prev.bbox.y1 - prev.bbox.y0);
    const lineH = Math.max(1, line.bbox.y1 - line.bbox.y0);
    const minH = Math.max(1, Math.min(prevH, lineH));
    const minW = Math.max(1, Math.min(prev.bbox.x1 - prev.bbox.x0, line.bbox.x1 - line.bbox.x0));
    const yOverlap = Math.max(0, Math.min(prev.bbox.y1, line.bbox.y1) - Math.max(prev.bbox.y0, line.bbox.y0));
    const xOverlap = Math.max(0, Math.min(prev.bbox.x1, line.bbox.x1) - Math.max(prev.bbox.x0, line.bbox.x0));
    const prevCenterY = (prev.bbox.y0 + prev.bbox.y1) / 2;
    const lineCenterY = (line.bbox.y0 + line.bbox.y1) / 2;
    const centerDeltaY = Math.abs(prevCenterY - lineCenterY);
    const yOverlapRatio = yOverlap / minH;
    const xOverlapRatio = xOverlap / minW;
    const yGap = line.bbox.y0 > prev.bbox.y1 ? line.bbox.y0 - prev.bbox.y1 : 0;
    const hGap = line.bbox.x0 > prev.bbox.x1
      ? line.bbox.x0 - prev.bbox.x1
      : (prev.bbox.x0 > line.bbox.x1 ? prev.bbox.x0 - line.bbox.x1 : 0);

    const prevAlpha = normalizeLatinTokenForLexicon(getAlphaNum((prev.text || '').trim()));
    const lineAlpha = normalizeLatinTokenForLexicon(getAlphaNum((line.text || '').trim()));
    const prevTokens = (prev.words as OCRWord[])
      .map((w) => normalizeLatinTokenForLexicon(getAlphaNum((w.text || '').trim())))
      .filter(Boolean);
    const lineTokens = (line.words as OCRWord[])
      .map((w) => normalizeLatinTokenForLexicon(getAlphaNum((w.text || '').trim())))
      .filter(Boolean);
    const prevLexical = prevTokens.filter((token) => LATIN_COMMON_WORDS.has(token) || LATIN_SHORT_KEEP_FOR_LINE.has(token)).length;
    const lineLexical = lineTokens.filter((token) => LATIN_COMMON_WORDS.has(token) || LATIN_SHORT_KEEP_FOR_LINE.has(token)).length;
    const hasDigits = /[0-9]/.test(prevAlpha) || /[0-9]/.test(lineAlpha);

    const prevFragment = prev.words.length <= 2 || prevAlpha.length <= 5;
    const lineFragment = line.words.length <= 2 || lineAlpha.length <= 5;
    const nearSameBaseline = (
      yOverlapRatio >= 0.16
      || yGap <= Math.max(4, medianHeight * 0.3)
      || centerDeltaY <= Math.max(6, medianHeight * 0.62)
    );
    const nearInline = xOverlapRatio >= 0.18 || hGap <= Math.max(10, medianHeight * 3.4);
    const lexicalEnough = (prevLexical + lineLexical) >= 2
      || ((prevLexical + lineLexical) >= 1 && (prev.words.length + line.words.length) <= 4);
    const similarHeight = Math.min(prevH, lineH) / Math.max(prevH, lineH) >= 0.4;

    const canMerge = (
      (prevFragment || lineFragment)
      && nearSameBaseline
      && nearInline
      && similarHeight
      && lexicalEnough
      && !hasDigits
    );

    if (!canMerge) {
      merged.push(line);
      continue;
    }

    merged[merged.length - 1] = makeLineFromWords((prev.words as OCRWord[]).concat(line.words as OCRWord[]));
  }

  return merged.sort((a, b) => a.bbox.y0 - b.bbox.y0);
}

function pruneLatinIsolatedNoiseLines(
  lines: Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }>,
  protectedWordKeys?: Set<string>
): Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }> {
  if (lines.length <= 1) return lines;

  return lines.filter((line) => {
    const lineWords = (line.words as OCRWord[]) || [];
    if (lineWords.length === 0) return false;
    if (lineHasProtectedWord(line, protectedWordKeys)) return true;
    const probeWord = lineWords[0];
    const rawAlpha = getAlphaNum((line.text || '').trim());
    const alpha = normalizeLatinTokenForLexicon(rawAlpha);
    if (!alpha) {
      if (probeWord) logDrop('latinLine', probeWord, 'isolated empty line');
      return false;
    }

    const lineW = Math.max(1, line.bbox.x1 - line.bbox.x0);
    const lineH = Math.max(1, line.bbox.y1 - line.bbox.y0);
    let neighborCount = 0;

    for (const other of lines) {
      if (other === line) continue;
      const otherWords = (other.words as OCRWord[]) || [];
      if (otherWords.length === 0) continue;

      const otherW = Math.max(1, other.bbox.x1 - other.bbox.x0);
      const otherH = Math.max(1, other.bbox.y1 - other.bbox.y0);
      const maxH = Math.max(lineH, otherH);

      const xOverlap = Math.max(0, Math.min(line.bbox.x1, other.bbox.x1) - Math.max(line.bbox.x0, other.bbox.x0));
      const yOverlap = Math.max(0, Math.min(line.bbox.y1, other.bbox.y1) - Math.max(line.bbox.y0, other.bbox.y0));
      const yOverlapRatio = yOverlap / Math.max(1, Math.min(lineH, otherH));

      const xGap = other.bbox.x0 > line.bbox.x1
        ? other.bbox.x0 - line.bbox.x1
        : (line.bbox.x0 > other.bbox.x1 ? line.bbox.x0 - other.bbox.x1 : 0);
      const yGap = other.bbox.y0 > line.bbox.y1
        ? other.bbox.y0 - line.bbox.y1
        : (line.bbox.y0 > other.bbox.y1 ? line.bbox.y0 - other.bbox.y1 : 0);

      const sameRowNeighbor = yOverlapRatio >= 0.26 && xGap <= maxH * 5.4;
      const sameBlockNeighbor = yGap <= maxH * 3.2 && xOverlap >= Math.min(lineW, otherW) * 0.16;
      if (sameRowNeighbor || sameBlockNeighbor) {
        neighborCount += 1;
        if (neighborCount >= 1) break;
      }
    }

    if (neighborCount > 0) return true;

    const quality = scoreLatinLineReadability(lineWords);
    const chars = alpha.length;
    const lineTokens = lineWords
      .map(w => normalizeLatinTokenForLexicon(getAlphaNum((w.text || '').trim())))
      .filter(Boolean);
    const tokenHits = lineTokens.filter(token => LATIN_COMMON_WORDS.has(token)).length;
    const readableTokenCount = lineTokens.filter(token => {
      if (LATIN_COMMON_WORDS.has(token)) return true;
      if (LATIN_SHORT_KEEP_FOR_LINE.has(token)) return true;
      if (token.length >= 3) {
        const tokenVowels = (token.match(/[AEIOU]/g) || []).length;
        return tokenVowels > 0;
      }
      return false;
    }).length;
    const readableRatio = readableTokenCount / Math.max(1, lineTokens.length);
    const likelySpeechIsolated = (
      chars >= 4
      && /[AEIOU]/.test(alpha)
      && quality >= 0.34
      && line.confidence >= 55
      && (
        tokenHits >= 1
        || readableRatio >= 0.5
        || (lineWords.length === 1 && chars >= 7)
      )
    );
    if (likelySpeechIsolated) return true;
    const vowelCount = (alpha.match(/[AEIOU]/g) || []).length;
    const strongIsolated = (
      tokenHits >= 1 && quality >= 0.58 && chars >= 4
    ) || (
      readableRatio >= 0.84 && quality >= 0.72 && chars >= 6 && line.confidence >= 90
    ) || (
      readableRatio >= 0.92 && quality >= 0.56 && chars >= 6 && line.confidence >= 70
    ) || (
      LATIN_SHORT_KEEP_FOR_LINE.has(alpha) && chars <= 2 && quality >= 0.54 && line.confidence >= 60
    ) || (
      lineWords.length === 1
      && chars >= 7
      && vowelCount >= 2
      && quality >= 0.54
      && line.confidence >= 68
    ) || (
      line.confidence >= 98 && chars >= 8 && /[AEIOU]/.test(alpha)
    );

    if (!strongIsolated) {
      if (probeWord) logDrop('latinLine', probeWord, 'isolated weak line');
      return false;
    }
    return true;
  });
}

function pruneLatinEdgeGhostLines(
  lines: Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }>,
  pageWidth: number,
  pageHeight: number,
  protectedWordKeys?: Set<string>
): Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }> {
  if (lines.length === 0) return lines;
  // For tall images (manga webtoon ratio ≥ 1.4), shrink the edge band to avoid
  // swallowing valid speech bubbles near top/bottom.  Original formula could
  // mark 32%+ of a 2:3 page as "edge", killing dialogue like "XUJIA TOWN!".
  const aspectRatio = pageHeight / Math.max(1, pageWidth);
  const heightFactor = aspectRatio >= 1.4 ? 0.10 : 0.16;
  const edgeBand = Math.min(pageHeight * heightFactor, Math.max(200, pageWidth * 0.25));
  const topBand = edgeBand;
  const bottomBand = pageHeight - edgeBand;

  return lines.filter((line) => {
    const lineWords = (line.words as OCRWord[]) || [];
    if (lineWords.length === 0) return false;
    if (lineHasProtectedWord(line, protectedWordKeys)) return true;

    const cy = (line.bbox.y0 + line.bbox.y1) / 2;
    const inEdgeBand = cy <= topBand || cy >= bottomBand;
    if (!inEdgeBand) return true;

    const rawAlpha = getAlphaNum((line.text || '').trim());
    const alpha = normalizeLatinTokenForLexicon(rawAlpha);
    if (!alpha) {
      for (const word of lineWords) logDrop('edgeGhost', word, 'empty edge line');
      return false;
    }

    const quality = scoreLatinLineReadability(lineWords);
    const hasVowel = /[AEIOUaeiou]/.test(alpha);
    const hasDigit = /[0-9]/.test(rawAlpha);
    const chars = alpha.length;
    const suspiciousCase = /[A-Z]{3,}[a-z]{1,}/.test(alpha) || /[a-z]{2,}[A-Z]{2,}/.test(alpha);
    const consonantRun = /[BCDFGHJKLMNPQRSTVWXYZ]{6,}/.test(alpha);
    const lineTokens = lineWords
      .map((w) => normalizeLatinTokenForLexicon(getAlphaNum((w.text || '').trim())))
      .filter(Boolean);
    const lexicalHits = lineTokens.filter(token => LATIN_COMMON_WORDS.has(token) || LATIN_SHORT_KEEP_FOR_LINE.has(token)).length;
    const lexicalRatio = lexicalHits / Math.max(1, lineTokens.length);
    const shortEdgeLine = lineWords.length <= 3 && chars <= 22;
    const veryWeakEdge = quality < 0.52
      || suspiciousCase
      || (!hasVowel && chars >= 4)
      || (hasDigit && chars <= 6 && line.confidence < 90);
    const likelyGhost = shortEdgeLine && veryWeakEdge && line.confidence < 93;

    // Fix 1.4: Protect lines with multiple lexical tokens (e.g. "TAKE A LOOK")
    if (lexicalHits >= 2 && chars >= 4 && line.confidence >= 50) return true;

    const topShortLexicalInterjection = cy <= topBand
      && lineWords.length <= 3
      && chars >= 4
      && chars <= 12
      && hasVowel
      && !hasDigit
      && lexicalRatio >= 0.66
      && line.confidence >= 62;

    if (topShortLexicalInterjection) return true;

    const lexicalEdgeLine = lexicalRatio >= 0.85 && chars >= 4 && chars <= 24 && !hasDigit && line.confidence >= 68;
    if (lexicalEdgeLine && quality >= 0.58) return true;

    const readableLongTokenEdgeLine = hasVowel
      && !hasDigit
      && !suspiciousCase
      && !consonantRun
      && chars >= 6
      && chars <= 16
      && quality >= 0.56
      && line.confidence >= 60;
    if (readableLongTokenEdgeLine) return true;

    // Fix 1.3: Drop lowercase single-char standalone lines (e.g. "a", "i")
    // Real dialogue words like "I" or "A" are uppercase in manga context
    const rawFirstWord = (lineWords[0]?.text || '').trim();
    if (
      lineWords.length === 1
      && chars <= 1
      && rawFirstWord.length === 1
      && rawFirstWord === rawFirstWord.toLowerCase()
      && rawFirstWord !== rawFirstWord.toUpperCase()
    ) {
      logDrop('edgeGhost', lineWords[0], 'lowercase single-char ghost');
      return false;
    }

    const shortKeepEdgeToken = lineWords.length === 1
      && chars <= 2
      && LATIN_SHORT_KEEP_FOR_LINE.has(alpha)
      && quality >= 0.54
      && line.confidence >= 58;
    if (shortKeepEdgeToken) return true;

    if (likelyGhost && !(hasVowel && !suspiciousCase && chars >= 6 && quality >= 0.46 && line.confidence >= 56)) {
      for (const word of lineWords) logDrop('edgeGhost', word, 'low-quality edge line');
      return false;
    }
    if (
      lineWords.length === 1
      && chars <= 12
      && quality < 0.86
      && line.confidence < 97
      && !(hasVowel && !hasDigit && chars >= 4 && quality >= 0.48 && line.confidence >= 58)
      && !(LATIN_SHORT_KEEP_FOR_LINE.has(alpha) && chars <= 2 && quality >= 0.52 && line.confidence >= 58)
      && !(!hasDigit && chars >= 5 && quality >= 0.42 && line.confidence >= 54)
    ) {
      for (const word of lineWords) logDrop('edgeGhost', word, 'single-token edge line');
      return false;
    }
    return true;
  });
}

function pruneLatinGarbageLines(
  lines: Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }>,
  pageWidth: number,
  pageHeight: number,
  protectedWordKeys?: Set<string>
): Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }> {
  if (lines.length === 0) return lines;

  const strongLines = lines.filter((line) => {
    const lineWords = (line.words as OCRWord[]) || [];
    const rawAlpha = getAlphaNum((line.text || '').trim());
    const alpha = normalizeLatinTokenForLexicon(rawAlpha);
    return alpha.length >= 8 && scoreLatinLineReadability(lineWords) >= 0.72;
  }).length;

  return lines.filter((line) => {
    const lineWords = (line.words as OCRWord[]) || [];
    if (lineWords.length === 0) return false;
    if (lineHasProtectedWord(line, protectedWordKeys)) return true;

    // Fix 2.2: Drop standalone lowercase single-letter noise ("a", "i") anywhere on the page
    const rawFirstWord = (lineWords[0]?.text || '').trim();
    if (
      lineWords.length === 1
      && getAlphaNum(rawFirstWord).length <= 1
      && rawFirstWord.length === 1
      && rawFirstWord === rawFirstWord.toLowerCase()
      && rawFirstWord !== rawFirstWord.toUpperCase()
    ) {
      logDrop('noise', lineWords[0], 'lowercase single-char noise');
      return false;
    }
    const probeWord = lineWords[0];
    const rawAlpha = getAlphaNum((line.text || '').trim());
    const alpha = normalizeLatinTokenForLexicon(rawAlpha);
    if (!alpha) {
      if (probeWord) logDrop('latinLine', probeWord, 'empty line');
      return false;
    }

    if (lineWords.some(w => isLikelyWatermarkToken(w, pageWidth, pageHeight))) {
      if (probeWord) logDrop('latinLine', probeWord, 'watermark-like line');
      return false;
    }

    const chars = alpha.length;
    const letters = (alpha.match(/[A-Za-z]/g) || []).length;
    const digits = (rawAlpha.match(/[0-9]/g) || []).length;
    const vowels = (alpha.match(/[AEIOUaeiou]/g) || []).length;
    const quality = scoreLatinLineReadability(lineWords);
    const mixedCaseWeird = /[A-Z]{2,}[a-z]{2,}/.test(rawAlpha) || /[a-z]{2,}[A-Z]{2,}/.test(rawAlpha);
    const cy = (line.bbox.y0 + line.bbox.y1) / 2;
    const edgeBand = Math.min(pageHeight * 0.16, Math.max(260, pageWidth * 0.35));
    const inEdgeBand = cy <= edgeBand || cy >= (pageHeight - edgeBand);
    const lineW = Math.max(1, line.bbox.x1 - line.bbox.x0);
    const lineH = Math.max(1, line.bbox.y1 - line.bbox.y0);
    const lineWRatio = lineW / Math.max(1, pageWidth);
    const effectivePageHeight = Math.max(1, Math.min(pageHeight, pageWidth * 2.8));
    const lineHRatio = lineH / effectivePageHeight;

    if (chars <= 2) {
      const keep = LATIN_SHORT_KEEP_FOR_LINE.has(alpha) && (line.confidence >= 60 || quality >= 0.54);
      if (!keep) {
        if (probeWord) logDrop('latinLine', probeWord, `short line chars=${chars}`);
        return false;
      }
    }

    const lineTokens = lineWords
      .map(w => normalizeLatinTokenForLexicon(getAlphaNum((w.text || '').trim())))
      .filter(Boolean);
    const tokenHits = lineTokens.filter(token => LATIN_COMMON_WORDS.has(token)).length;
    const lexicalHits = lineTokens.filter(token => LATIN_COMMON_WORDS.has(token) || LATIN_SHORT_KEEP_FOR_LINE.has(token)).length;
    const lexicalRatio = lexicalHits / Math.max(1, lineTokens.length);
    const readableTokenCount = lineTokens.filter(token => {
      if (LATIN_COMMON_WORDS.has(token)) return true;
      if (LATIN_SHORT_KEEP_FOR_LINE.has(token)) return true;
      if (token.length >= 3) {
        const tokenVowels = (token.match(/[AEIOU]/g) || []).length;
        return tokenVowels > 0;
      }
      return false;
    }).length;
    const readableRatio = readableTokenCount / Math.max(1, lineTokens.length);
    const likelySpeechLine = (
      digits === 0
      && chars >= 4
      && vowels >= 1
      && quality >= 0.3
      && line.confidence >= 46
      && (
        tokenHits >= 1
        || readableRatio >= 0.42
        || (lineWords.length === 1 && chars >= 7)
        || (lineWords.length >= 2 && chars >= 5)
      )
    );
    if (likelySpeechLine) return true;
    const tinySingletonGeometry = lineHRatio <= 0.016
      || lineH <= Math.max(8, pageHeight * 0.007)
      || lineWRatio <= 0.045;

    if (
      lineWords.length === 1
      && chars <= 3
      && lexicalHits === 0
      && line.confidence < 99
      && (tinySingletonGeometry || (inEdgeBand && quality < 0.92))
    ) {
      if (probeWord) logDrop('latinLine', probeWord, 'micro singleton artifact');
      return false;
    }

    if (
      lineWords.length <= 2
      && chars <= 3
      && letters > 0
      && digits > 0
      && lexicalHits === 0
      && line.confidence < 100
    ) {
      if (probeWord) logDrop('latinLine', probeWord, 'mixed digit short artifact');
      return false;
    }

    if (
      lineWords.length === 1
      && chars <= 3
      && lexicalHits === 0
      && !LATIN_SHORT_KEEP_FOR_LINE.has(alpha)
      && strongLines > 0
      && line.confidence < 100
      && (lineHRatio <= 0.02 || lineWRatio <= 0.1 || quality < 0.92)
    ) {
      if (probeWord) logDrop('latinLine', probeWord, 'short singleton artifact');
      return false;
    }

    const likelyWideThinGhost = lineWRatio >= 0.62
      && lineHRatio <= 0.012
      && lineWords.length <= 2
      && chars <= 8
      && (quality < 0.62 || vowels === 0);
    const readableThinKeep = vowels > 0 && digits === 0 && chars >= 6 && quality >= 0.46 && line.confidence >= 58;
    if (likelyWideThinGhost && line.confidence < 97 && !readableThinKeep) {
      if (probeWord) logDrop('latinLine', probeWord, 'wide-thin line artifact');
      return false;
    }

    if (letters >= 4 && vowels === 0 && line.confidence < 95) {
      if (probeWord) logDrop('latinLine', probeWord, 'no-vowel latin artifact');
      return false;
    }

    const looksLikeLeetWord = /[A-Za-z]/.test(rawAlpha) && /[0-9]/.test(rawAlpha) && /[AEIOU]/.test(alpha);
    if (digits > 0 && letters > 0 && chars <= 14 && line.confidence < 90 && !looksLikeLeetWord) {
      if (probeWord) logDrop('latinLine', probeWord, 'mixed digit/latin artifact');
      return false;
    }

    if (mixedCaseWeird && quality < 0.72 && line.confidence < 95) {
      if (probeWord) logDrop('latinLine', probeWord, 'weird mixed-case line');
      return false;
    }

    if (inEdgeBand && quality < 0.72 && chars <= 18 && line.confidence < 94 && lexicalRatio < 0.67) {
      if (probeWord) logDrop('latinLine', probeWord, 'low-quality edge line');
      return false;
    }

    if (
      quality < 0.48
      && line.confidence < 93
      && (chars <= 18 || lineWords.length <= 3)
      && !(vowels > 0 && digits === 0 && chars >= 6 && line.confidence >= 64)
    ) {
      if (probeWord) logDrop('latinLine', probeWord, 'low-quality short line');
      return false;
    }

    if (strongLines > 0 && quality < 0.55 && chars <= 6 && line.confidence < 95) {
      if (probeWord) logDrop('latinLine', probeWord, 'isolated weak short line');
      return false;
    }

    if (lineWords.length === 1 && chars <= 1) {
      if (probeWord) logDrop('latinLine', probeWord, 'single-char line');
      return false;
    }

    if (lineWords.length === 1 && readableRatio < 1 && chars <= 12 && line.confidence < 96) {
      if (probeWord) logDrop('latinLine', probeWord, 'single-token non-lexical line');
      return false;
    }

    if (lineWords.length <= 3 && readableRatio < 0.6 && line.confidence < 96) {
      if (probeWord) logDrop('latinLine', probeWord, 'low lexical ratio line');
      return false;
    }

    if (
      lineWords.length <= 5
      && chars <= 22
      && tokenHits === 0
      && readableRatio < 0.55
      && quality < 0.74
      && line.confidence < 97
    ) {
      if (probeWord) logDrop('latinLine', probeWord, 'weak non-lexical short line');
      return false;
    }

    if (
      lineWords.length <= 3
      && chars <= 10
      && tokenHits === 0
      && readableRatio < 0.75
      && line.confidence < 98
    ) {
      if (probeWord) logDrop('latinLine', probeWord, 'very-short non-lexical line');
      return false;
    }

    return true;
  });
}

function pruneLatinShortFragmentLines(
  lines: Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }>,
  protectedWordKeys?: Set<string>
): Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }> {
  if (lines.length === 0) return lines;
  return lines.filter((line) => {
    const lineWords = (line.words as OCRWord[]) || [];
    if (lineWords.length === 0) return false;
    if (lineHasProtectedWord(line, protectedWordKeys)) return true;

    const tokens = lineWords
      .map((w) => getAlphaNum((w.text || '').trim()).toUpperCase())
      .filter(Boolean);
    if (tokens.length === 0) return false;

    const longTokens = tokens.filter((t) => t.length >= 3);
    const lexicalTokens = tokens.filter((t) => LATIN_COMMON_WORDS.has(t) || LATIN_SHORT_KEEP_FOR_LINE.has(t));
    const readableRatio = lexicalTokens.length / Math.max(1, tokens.length);
    const totalChars = tokens.reduce((sum, token) => sum + token.length, 0);
    if (longTokens.length > 0) return true;
    if (lexicalTokens.length > 0) return true;
    if (line.confidence >= 92) return true;
    if (totalChars >= 4 && readableRatio >= 0.5) return true;

    const keptShort = tokens.filter((t) => LATIN_SHORT_KEEP_FOR_LINE.has(t));
    const allShort = tokens.every((t) => t.length <= 2);
    if (allShort && keptShort.length < tokens.length) {
      const probeWord = lineWords[0];
      if (probeWord && line.confidence < 99) logDrop('latinLine', probeWord, 'short-fragment line');
      return line.confidence >= 99;
    }

    return true;
  });
}

// ============================================
// Message Handler
// ============================================

self.onmessage = async (e: MessageEvent) => {
  const { type, payload, id } = e.data;

  try {
    switch (type) {
      // ── INIT ──
      case 'INIT': {
        console.log('[Worker] Initializing Vision Worker...');
        await getOrCreateWorker('eng');
        self.postMessage({ type: 'INIT_SUCCESS', id });
        break;
      }

      // ── OCR_FOR_TEXT_LAYER ──
      case 'OCR_FOR_TEXT_LAYER': {
        const {
          imageUrl,
          imageWidth,
          imageHeight,
          language = 'eng',
          dpi = 300,
          pageSegMode,
          debugCollectDrops = false,
          pipelineProfile = 'panel'
        } = payload;
        startDropCollection(Boolean(debugCollectDrops) || CONFIG.DEBUG_LOG_DROPS);
        console.log(`[Worker] OCR pipeline version: ${OCR_ALGORITHM_VERSION}`);

        try {

        sendProgress('Preprocessing image...', 0);

        let processedInput: Blob | string = imageUrl;
        let actualWidth = Math.round(imageWidth);
        let actualHeight = Math.round(imageHeight);
        const isCjk = isCjkLanguage(language);
        const isKorean = hasLangCode(language, 'kor');
        const normalizedPipelineProfile = normalizePipelineProfile(pipelineProfile);
        const isPanelProfile = normalizedPipelineProfile === 'panel';
        const stageMetrics: OCRStageMetric[] = [];
        const candidateDebugs: OCRCandidateDebug[] = [];
        const protectedWordKeys = new Set<string>();

        let gray: Uint8ClampedArray | undefined;
        try {
          const binarize = CONFIG.OCR_BINARIZE && !isCjk && !isThaiLanguage(language);
          const preprocessed = await preprocessImage(imageUrl, { binarize, returnGray: true });
          processedInput = preprocessed.image;
          actualWidth = preprocessed.width;
          actualHeight = preprocessed.height;
          gray = preprocessed.gray;
        } catch (ppError) {
          console.error('[Worker] Preprocess error:', ppError);
        }

        sendProgress('Initializing OCR...', 0.1);
        const worker = await getOrCreateWorker(language);

        sendProgress('Configuring OCR...', 0.15);
        // Webtoon/CJK pages are usually sparse speech bubbles, not dense paragraphs.
        const defaultPsm = isCjk ? PSM.SPARSE_TEXT : PSM.AUTO;
        const psm = typeof pageSegMode === 'number' ? pageSegMode : defaultPsm;

        await worker.setParameters({
          tessedit_create_tsv: '1',
          user_defined_dpi: String(Math.round(dpi)),
          tessedit_pageseg_mode: String(psm),
        } as Record<string, string>);

        sendProgress('Recognizing text...', 0.2);

        let data: TesseractResult['data'] | null = null;
        let words: Array<OCRWord> = [];
        let lines: Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }> = [];
        let parsed: ReturnType<typeof parseTSV> | null = null;

        const tooLarge = actualWidth > CONFIG.MAX_OCR_WIDTH || actualHeight > CONFIG.MAX_OCR_HEIGHT;
        if (tooLarge) {
          console.warn(`[Worker] Image too large (${actualWidth}×${actualHeight}). Chunked OCR.`);
          const chunkResult = await recognizeInChunks(worker, processedInput, actualWidth, actualHeight, CONFIG.CHUNK_OVERLAP);
          words = chunkResult.words;
          lines = chunkResult.lines as Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }>;
          data = { text: chunkResult.text, confidence: chunkResult.confidence, tsv: '' };
        } else {
          const result = await worker.recognize(processedInput, undefined, {
            text: true,
            tsv: true,
          }) as TesseractResult;

          sendProgress('Processing results...', 0.8);
          data = result.data;

          parsed = parseTSV(data.tsv || '');
          words = parsed.words;
          lines = parsed.lines;

          // CJK retry: if OCR is too weak, retry with binarization + SPARSE_TEXT
          if (isCjk) {
            const textLen = (data.text || '').trim().length;
            if (words.length < CONFIG.CJK_MIN_WORDS_BEFORE_RETRY || textLen < CONFIG.CJK_MIN_TEXT_CHARS_BEFORE_RETRY) {
              try {
                const alt = await preprocessImage(imageUrl, { binarize: true });
                await worker.setParameters({
                  tessedit_create_tsv: '1',
                  user_defined_dpi: String(Math.round(dpi)),
                  tessedit_pageseg_mode: String(PSM.SPARSE_TEXT),
                } as Record<string, string>);
                const retryResult = await worker.recognize(alt.image, undefined, {
                  text: true,
                  tsv: true,
                }) as TesseractResult;

                const retryData = retryResult.data;
                const retryParsed = parseTSV(retryData.tsv || '');
                if (retryParsed.words.length > words.length) {
                  const added = appendUniqueWords(words, retryParsed.words, 0.55);
                  for (const word of added) {
                    const target = findBestLineForBox(lines, word.bbox);
                    if (target) mergeWordsIntoLine(target, [word]);
                    else lines.push(makeLineFromWords([word]));
                  }
                  console.log('[Worker] CJK retry improved:', { before: words.length - added.length, after: words.length });
                  data = retryData.text && retryData.text.length > (data.text || '').length ? retryData : data;
                  parsed = retryParsed;
                }
              } catch (retryError) {
                console.warn('[Worker] CJK retry failed:', retryError);
              } finally {
                await worker.setParameters({
                  tessedit_create_tsv: '1',
                  user_defined_dpi: String(Math.round(dpi)),
                  tessedit_pageseg_mode: String(psm),
                } as Record<string, string>);
              }
            }
          }
        }

        // ── Diagnostic: dump Tesseract raw output before any filtering ──
        if (words.length > 0) {
          const rawSample = words.slice(0, 60).map(w => `${w.text}(${w.confidence.toFixed(0)})`).join(' | ');
          console.log(`[Worker] Raw Tesseract words (${words.length} total): ${rawSample}`);
        }

        const baseWordsSnapshot = words.slice();
        const baseLinesSnapshot = lines.slice();

        // ── Noise filter ──
        if (lines.length > 0 && !(isCjk && words.length <= CONFIG.CJK_SKIP_NOISE_FILTER_MAX_WORDS)) {
          const cleaned = cleanLineNoise(lines);
          if (cleaned.words.length !== words.length) {
            console.log(`[Worker] Filtered noisy tokens: ${words.length - cleaned.words.length} removed`);
            words = cleaned.words;
            lines = cleaned.lines;
          }
        }
        if (isPanelProfile) {
          recordStageMetric(stageMetrics, 'base', baseWordsSnapshot, words, baseLinesSnapshot, lines);
        }

        const baseWordCountBeforeRecovery = words.length;
        const maxRecoveryAdded = isCjk ? CONFIG.CJK_RECOVERY_MAX_ADDED_WORDS : Number.POSITIVE_INFINITY;
        let recoveryAdded = 0;
        const remainingRecoveryBudget = (): number => {
          if (!Number.isFinite(maxRecoveryAdded)) return Number.MAX_SAFE_INTEGER;
          return Math.max(0, maxRecoveryAdded - recoveryAdded);
        };

        // ── CJK vertical gap rescan ──
        if (
          isCjk
          && !tooLarge
          && lines.length > 0
          && baseWordCountBeforeRecovery <= CONFIG.CJK_VERTICAL_GAP_ENABLE_MAX_WORDS
          && remainingRecoveryBudget() > 0
        ) {
          const gapRegions = findVerticalGapRegions(lines, actualWidth, actualHeight);
          if (gapRegions.length > 0) {
            let addedCount = 0;
            for (const region of gapRegions) {
              if (remainingRecoveryBudget() <= 0) break;
              const regionWords = await recognizeRegion(worker, processedInput as Blob | string, region, Number(PSM.SPARSE_TEXT), actualWidth, actualHeight, dpi);
              const filtered = filterRecoveredCjkWords(regionWords, {
                source: 'verticalGap',
                minConf: CONFIG.CJK_VERTICAL_GAP_CONF,
                isKorean,
              });
              const capped = takeRecoveryCandidates(filtered, remainingRecoveryBudget(), 'verticalGap');
              if (capped.length === 0) continue;
              const added = appendUniqueWords(words, capped, 0.55);
              if (added.length === 0) continue;
              addedCount += added.length;
              recoveryAdded += added.length;
              const regionLines = buildLinesFromWordsByY(added, actualHeight);
              for (const rl of regionLines) {
                const target = findBestLineForBox(lines, rl.bbox);
                if (target) mergeWordsIntoLine(target, rl.words as OCRWord[]);
                else lines.push(rl);
              }
            }
            if (addedCount > 0) {
              lines.sort((a, b) => a.bbox.y0 - b.bbox.y0);
              console.log(`[Worker] CJK vertical gap added ${addedCount} tokens`);
            }
          }
        }

        // ── Line rescan for low-coverage lines ──
        const needsUnbinarized = CONFIG.OCR_BINARIZE && !isCjk;
        let fallbackInput: Blob | string | null = null;
        const ensureFallbackInput = async () => {
          if (fallbackInput) return;
          fallbackInput = needsUnbinarized ? imageUrl : processedInput;
        };

        const lineRescanWordsBefore = words.slice();
        const lineRescanLinesBefore = lines.slice();
        const lineRescanMax = isCjk
          ? (
            baseWordCountBeforeRecovery <= CONFIG.CJK_LINE_RESCAN_ENABLE_MAX_WORDS
            ? CONFIG.CJK_LINE_RESCAN_MAX
            : 0
          )
          : CONFIG.LATIN_LINE_RESCAN_MAX;
        if (lineRescanMax > 0 && !tooLarge && parsed && lines.length > 0 && parsed.lineBoxes.length > 0) {
          const allowWeakLatinRescan = !isCjk && words.length <= CONFIG.LATIN_RETRY_MIN_WORDS && lines.length > 0;
          const allowLineRescan = isCjk || allowWeakLatinRescan || lines.some((line) => {
            const lw = (line.words as OCRWord[]) || [];
            const chars = getAlphaNum((line.text || '').trim()).length;
            const quality = scoreLatinLineReadability(lw);
            return (lw.length >= 2 && chars >= 4 && quality >= 0.52)
              || (lw.length >= 3 && chars >= 6);
          });
          if (!allowLineRescan && !isCjk) {
            console.log('[Worker] Skipped Latin line rescan: no stable base lines');
          }
          if (allowLineRescan) {
          const coverageThreshold = isCjk ? CONFIG.CJK_LINE_RESCAN_COVERAGE : CONFIG.LATIN_LINE_RESCAN_COVERAGE;
          const confThreshold = isCjk ? CONFIG.CJK_LINE_RESCAN_CONF : CONFIG.LATIN_LINE_RESCAN_CONF;
          const padXMult = isCjk ? CONFIG.CJK_LINE_RESCAN_PAD_X : CONFIG.LATIN_LINE_RESCAN_PAD_X;
          const padYMult = isCjk ? CONFIG.CJK_LINE_RESCAN_PAD_Y : CONFIG.LATIN_LINE_RESCAN_PAD_Y;

          const candidates: Array<{ line: typeof lines[number]; lineBox: BBox; coverage: number; quality: number }> = [];
          for (const line of lines) {
            const lineWords = (line.words as OCRWord[]) || [];
            if (lineWords.length === 0) continue;
            if (isCjk) {
              const mergedAlpha = getAlphaNum(lineWords.map(w => (w.text || '').trim()).join(''));
              if (!mergedAlpha) continue;
              const syllableCount = isKorean ? (mergedAlpha.match(/[\uAC00-\uD7AF]/g) || []).length : 1;
              const jamoCount = isKorean ? (mergedAlpha.match(/[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]/g) || []).length : 0;
              if (mergedAlpha.length <= 2 && line.confidence < confThreshold + 20) continue;
              if (isKorean && syllableCount === 0 && line.confidence < confThreshold + 24) continue;
              if (isKorean && jamoCount > syllableCount && mergedAlpha.length <= 8 && line.confidence < 98) continue;
            }
            const lineBox = findBestLineBoxForLine(parsed.lineBoxes, line);
            if (!lineBox) continue;
            if (!isCjk) {
              const bw = Math.max(1, lineBox.x1 - lineBox.x0);
              const bh = Math.max(1, lineBox.y1 - lineBox.y0);
              const smallThinNoise = bw <= actualWidth * 0.25 && bh <= Math.max(14, actualHeight * 0.0045);
              const tinyAreaNoise = (bw * bh) <= (actualWidth * actualHeight * 0.00014) && lineWords.length <= 2;
              if (smallThinNoise || tinyAreaNoise) continue;
            }
            const coverage = computeLineCoverageRatio(lineWords, lineBox);
            const quality = isCjk ? 1 : scoreLatinLineReadability(lineWords);
            const lowQualityLatin = !isCjk
              && quality < CONFIG.LATIN_LINE_RESCAN_QUALITY
              && line.confidence <= CONFIG.LATIN_LINE_RESCAN_QUALITY_CONF_MAX;
            if (coverage < coverageThreshold || lowQualityLatin) candidates.push({ line, lineBox, coverage, quality });
          }
          candidates.sort((a, b) => {
            if (a.coverage !== b.coverage) return a.coverage - b.coverage;
            return a.quality - b.quality;
          });
          const limited = candidates.slice(0, lineRescanMax);

          if (limited.length > 0) {
            await ensureFallbackInput();
            let rescanAdded = 0;
            for (const item of limited) {
              if (remainingRecoveryBudget() <= 0) break;
              const lineWords = (item.line.words as OCRWord[]) || [];
              if (lineWords.length === 0) continue;
              const heights = lineWords.map(w => Math.max(1, w.bbox.y1 - w.bbox.y0)).sort((a, b) => a - b);
              const medianHeight = heights[Math.floor(heights.length / 2)] || heights[0] || 1;
              const lowCoverageLatin = !isCjk && item.coverage < CONFIG.LATIN_LINE_RESCAN_LOW_COVERAGE_THRESHOLD;
              const effectivePadX = lowCoverageLatin
                ? Math.max(padXMult, CONFIG.LATIN_LINE_RESCAN_LOW_COVERAGE_PAD_X)
                : padXMult;
              const effectivePadY = lowCoverageLatin
                ? Math.max(padYMult, CONFIG.LATIN_LINE_RESCAN_LOW_COVERAGE_PAD_Y)
                : padYMult;
              const padded: BBox = {
                x0: item.lineBox.x0 - medianHeight * effectivePadX,
                y0: item.lineBox.y0 - medianHeight * effectivePadY,
                x1: item.lineBox.x1 + medianHeight * effectivePadX,
                y1: item.lineBox.y1 + medianHeight * effectivePadY
              };
              const boxW = Math.max(1, item.lineBox.x1 - item.lineBox.x0);
              const boxH = Math.max(1, item.lineBox.y1 - item.lineBox.y0);
              const linePsm = isCjk
                ? (boxH > boxW * 1.25 ? Number(PSM.SPARSE_TEXT) : Number(PSM.SINGLE_LINE))
                : (lowCoverageLatin ? Number(PSM.SINGLE_BLOCK) : Number(PSM.SINGLE_LINE));
              const regionWords = await recognizeRegion(worker, (fallbackInput ?? processedInput) as Blob | string, padded, linePsm, actualWidth, actualHeight, dpi);
              const validWords = isCjk
                ? filterRecoveredCjkWords(regionWords, {
                  source: 'lineRescan',
                  minConf: confThreshold,
                  lineWords,
                  lineBox: item.lineBox,
                  isKorean,
                })
                : filterLatinRescueWords(regionWords, actualWidth, actualHeight, confThreshold, 'lineRescan');
              const capped = takeRecoveryCandidates(validWords, remainingRecoveryBudget(), 'lineRescan');
              if (capped.length === 0) continue;
              const candidateScore = !isCjk
                ? scoreLatinCandidate(capped, [makeLineFromWords(capped)])
                : 0;
              const added = appendUniqueWords(words, capped, 0.55);
              if (added.length === 0) continue;
              rescanAdded += added.length;
              recoveryAdded += added.length;
              if (!isCjk && isPanelProfile && candidateScore >= CONFIG.LATIN_ANCHOR_PROBE_MIN_LINE_SCORE) {
                protectWords(protectedWordKeys, added);
              }
              mergeWordsIntoLine(item.line, added);
            }
            if (rescanAdded > 0) {
              lines.sort((a, b) => a.bbox.y0 - b.bbox.y0);
              console.log(`[Worker] ${isCjk ? 'CJK' : 'Latin'} line rescan added ${rescanAdded} tokens`);
            }
          }
          }
        }
        if (isPanelProfile) {
          recordStageMetric(stageMetrics, 'rescan', lineRescanWordsBefore, words, lineRescanLinesBefore, lines);
        }

        const anchorProbeWordsBefore = words.slice();
        const anchorProbeLinesBefore = lines.slice();
        if (
          isPanelProfile
          && !isCjk
          && !tooLarge
          && lines.length > 0
          && remainingRecoveryBudget() > 0
        ) {
          await ensureFallbackInput();
          const probes = buildLatinAnchorProbes(lines, actualWidth, actualHeight);
          let anchorAdded = 0;

          for (const probe of probes) {
            if (remainingRecoveryBudget() <= 0) break;
            const textLike = analyzeTextLikeProbe(gray, actualWidth, actualHeight, probe.bbox);
            if (!textLike.allowed) {
              recordCandidateDebug(candidateDebugs, {
                id: probe.id,
                stage: probe.probeType,
                bbox: probe.bbox,
                accepted: false,
                score: textLike.score,
                reason: textLike.reason,
              });
              continue;
            }

            let bestValid: OCRWord[] = [];
            let bestScore = Number.NEGATIVE_INFINITY;
            let bestReason = 'noWords';

            for (const probePsm of probe.psmOrder) {
              const regionWords = await recognizeRegion(
                worker,
                (fallbackInput ?? processedInput) as Blob | string,
                probe.bbox,
                probePsm,
                actualWidth,
                actualHeight,
                dpi
              );
              if (regionWords.length === 0) {
                bestReason = 'noWords';
                continue;
              }

              const valid = filterLatinRescueWords(
                regionWords,
                actualWidth,
                actualHeight,
                probe.minConf,
                probe.probeType
              );
              if (valid.length === 0) {
                bestReason = 'noValidWords';
                continue;
              }

              const candidateLines = buildLinesFromWordsByY(valid, actualHeight) as OCRLine[];
              const candidateScore = scoreLatinCandidate(valid, candidateLines);
              if (candidateScore > bestScore) {
                bestScore = candidateScore;
                bestValid = valid;
                bestReason = 'scored';
              }
            }

            if (bestValid.length < CONFIG.LATIN_ANCHOR_PROBE_MIN_ACCEPT_WORDS || bestScore <= 0) {
              recordCandidateDebug(candidateDebugs, {
                id: probe.id,
                stage: probe.probeType,
                bbox: probe.bbox,
                accepted: false,
                score: Number.isFinite(bestScore) ? bestScore : textLike.score,
                reason: bestReason,
              });
              continue;
            }

            const capped = takeRecoveryCandidates(
              bestValid.sort((a, b) => b.confidence - a.confidence),
              remainingRecoveryBudget(),
              probe.probeType
            );
            if (capped.length < CONFIG.LATIN_ANCHOR_PROBE_MIN_ACCEPT_WORDS) {
              recordCandidateDebug(candidateDebugs, {
                id: probe.id,
                stage: probe.probeType,
                bbox: probe.bbox,
                accepted: false,
                score: bestScore,
                reason: 'budgetCapped',
              });
              continue;
            }

            const added = appendUniqueWords(words, capped, 0.5);
            if (added.length < CONFIG.LATIN_ANCHOR_PROBE_MIN_ACCEPT_WORDS) {
              recordCandidateDebug(candidateDebugs, {
                id: probe.id,
                stage: probe.probeType,
                bbox: probe.bbox,
                accepted: false,
                score: bestScore,
                reason: 'noUniqueWords',
              });
              continue;
            }

            if (bestScore >= CONFIG.LATIN_ANCHOR_PROBE_MIN_LINE_SCORE) {
              protectWords(protectedWordKeys, added);
            }
            recoveryAdded += added.length;
            anchorAdded += added.length;
            const target = lines[probe.anchorLineIndex]
              ? findBestLineForBox(lines, probe.bbox) || lines[probe.anchorLineIndex]
              : findBestLineForBox(lines, probe.bbox);
            if (target) mergeWordsIntoLine(target, added);
            else lines.push(makeLineFromWords(added));
            recordCandidateDebug(candidateDebugs, {
              id: probe.id,
              stage: probe.probeType,
              bbox: probe.bbox,
              accepted: true,
              score: bestScore,
              reason: 'accepted',
            });
          }

          if (anchorAdded > 0) {
            lines.sort((a, b) => a.bbox.y0 - b.bbox.y0);
            console.log(`[Worker] Panel anchor probes added ${anchorAdded} tokens`);
          }
        }
        if (isPanelProfile) {
          recordStageMetric(stageMetrics, 'anchorProbe', anchorProbeWordsBefore, words, anchorProbeLinesBefore, lines);
        }

        // ── Local neighborhood rescue for stylized balloons (avoid full-page sparse noise) ──
        if (
          !isPanelProfile
          && !isCjk
          && !tooLarge
          && lines.length > 0
          && lines.length <= 4
          && words.length > 0
          && words.length <= 10
          && remainingRecoveryBudget() > 0
        ) {
          await ensureFallbackInput();
          const anchorCandidates = lines
            .map((line) => {
              const lineWords = (line.words as OCRWord[]) || [];
              if (lineWords.length < 2) return null;
              const quality = scoreLatinLineReadability(lineWords);
              const tokenHits = lineWords
                .map((w) => normalizeLatinTokenForLexicon(getAlphaNum((w.text || '').trim())))
                .filter(token => LATIN_COMMON_WORDS.has(token)).length;
              const chars = normalizeLatinTokenForLexicon(getAlphaNum((line.text || '').trim())).length;
              if (!(quality >= 0.5 && chars >= 4 && (tokenHits >= 1 || lineWords.length >= 3))) return null;
              return { line, lineWords, quality, tokenHits };
            })
            .filter(Boolean) as Array<{ line: typeof lines[number]; lineWords: OCRWord[]; quality: number; tokenHits: number }>;

          let neighborhoodAdded = 0;
          for (const anchor of anchorCandidates.slice(0, 2)) {
            if (remainingRecoveryBudget() <= 0) break;
            const heights = anchor.lineWords
              .map((w) => Math.max(1, w.bbox.y1 - w.bbox.y0))
              .sort((a, b) => a - b);
            const medianHeight = heights[Math.floor(heights.length / 2)] || heights[0] || 1;
            const expanded = clampBBox({
              x0: anchor.line.bbox.x0 - medianHeight * 0.45,
              y0: anchor.line.bbox.y0 - medianHeight * 1.0,
              x1: anchor.line.bbox.x1 + medianHeight * 0.45,
              y1: anchor.line.bbox.y1 + medianHeight * 2.0,
            }, actualWidth, actualHeight);

            const regionWords = await recognizeRegion(
              worker,
              (fallbackInput ?? processedInput) as Blob | string,
              expanded,
              Number(PSM.SINGLE_BLOCK),
              actualWidth,
              actualHeight,
              dpi
            );
            const rescuedWords = filterLatinRescueWords(
              regionWords,
              actualWidth,
              actualHeight,
              Math.max(28, CONFIG.LATIN_LINE_RESCAN_CONF - 26),
              'lineNeighborhood'
            );
            const localValidWords = rescuedWords.filter((word) => {
              const cx = (word.bbox.x0 + word.bbox.x1) / 2;
              const cy = (word.bbox.y0 + word.bbox.y1) / 2;
              const alpha = normalizeLatinTokenForLexicon(getAlphaNum((word.text || '').trim()));
              if (!alpha) return false;
              if (alpha.length === 1 && !LATIN_SHORT_KEEP_FOR_LINE.has(alpha)) return false;
              const lexical = LATIN_COMMON_WORDS.has(alpha) || LATIN_SHORT_KEEP_FOR_LINE.has(alpha);
              if (!lexical) return false;
              const inX = cx >= (anchor.line.bbox.x0 - medianHeight * 1.1) && cx <= (anchor.line.bbox.x1 + medianHeight * 1.1);
              const inY = cy >= (anchor.line.bbox.y0 - medianHeight * 1.1) && cy <= (anchor.line.bbox.y1 + medianHeight * 2.35);
              return inX && inY;
            });
            const capped = takeRecoveryCandidates(localValidWords, remainingRecoveryBudget(), 'lineNeighborhood');
            if (capped.length === 0) continue;
            const added = appendUniqueWords(words, capped, 0.54);
            if (added.length === 0) continue;
            mergeWordsIntoLine(anchor.line, added);
            recoveryAdded += added.length;
            neighborhoodAdded += added.length;
          }
          if (neighborhoodAdded > 0) {
            lines.sort((a, b) => a.bbox.y0 - b.bbox.y0);
            console.log(`[Worker] Latin neighborhood rescue added ${neighborhoodAdded} tokens`);
          }
        }

        // ── Focused top-balloon block rescue (lexical-only) ──
        if (
          !isPanelProfile
          && !isCjk
          && !tooLarge
          && lines.length > 0
          && lines.length <= 5
          && words.length > 0
          && words.length <= 14
          && remainingRecoveryBudget() > 0
        ) {
          const topAnchor = lines
            .map((line) => {
              const lineWords = (line.words as OCRWord[]) || [];
              if (lineWords.length === 0) return null;
              const centerY = (line.bbox.y0 + line.bbox.y1) / 2;
              if (centerY > actualHeight * 0.52) return null;
              const lexicalHits = lineWords
                .map((w) => normalizeLatinTokenForLexicon(getAlphaNum((w.text || '').trim())))
                .filter((token) => LATIN_COMMON_WORDS.has(token) || LATIN_SHORT_KEEP_FOR_LINE.has(token))
                .length;
              if (lexicalHits < 2) return null;
              return { line, lineWords };
            })
            .filter(Boolean)[0] as { line: typeof lines[number]; lineWords: OCRWord[] } | undefined;

          if (topAnchor) {
            await ensureFallbackInput();
            const heights = topAnchor.lineWords
              .map((w) => Math.max(1, w.bbox.y1 - w.bbox.y0))
              .sort((a, b) => a - b);
            const medianHeight = heights[Math.floor(heights.length / 2)] || heights[0] || 1;
            const probeBox = clampBBox({
              x0: topAnchor.line.bbox.x0 - medianHeight * 0.9,
              y0: topAnchor.line.bbox.y0 - medianHeight * 1.1,
              x1: topAnchor.line.bbox.x1 + medianHeight * 0.9,
              y1: topAnchor.line.bbox.y1 + medianHeight * 3.6,
            }, actualWidth, actualHeight);

            const probeInputs: Array<Blob | string> = [(fallbackInput ?? processedInput) as Blob | string];
            if (fallbackInput && fallbackInput !== processedInput) {
              probeInputs.push(processedInput as Blob | string);
            }

            let balloonAdded = 0;
            for (const probeInput of probeInputs) {
              if (remainingRecoveryBudget() <= 0) break;
              if (balloonAdded >= 8) break;

              const blockWords = await recognizeRegion(
                worker,
                probeInput,
                probeBox,
                Number(PSM.SINGLE_BLOCK),
                actualWidth,
                actualHeight,
                dpi
              );
              const lexicalWords = filterLatinRescueWords(
                blockWords,
                actualWidth,
                actualHeight,
                Math.max(24, CONFIG.FALLBACK_LINE_CONF - 40),
                'balloonBlock'
              ).filter((word) => {
                const token = normalizeLatinTokenForLexicon(getAlphaNum((word.text || '').trim()));
                if (!token) return false;
                if (/^[0-9]+$/.test(token)) return false;
                return LATIN_COMMON_WORDS.has(token) || LATIN_SHORT_KEEP_FOR_LINE.has(token);
              });
              if (lexicalWords.length === 0) continue;

              const capped = takeRecoveryCandidates(
                lexicalWords.sort((a, b) => b.confidence - a.confidence).slice(0, 10),
                remainingRecoveryBudget(),
                'balloonBlock'
              );
              if (capped.length === 0) continue;
              const added = appendUniqueWords(words, capped, 0.5);
              if (added.length === 0) continue;
              balloonAdded += added.length;
              recoveryAdded += added.length;
              const target = findBestLineForBox(lines, probeBox);
              if (target) mergeWordsIntoLine(target, added);
              else lines.push(makeLineFromWords(added));
            }

            if (balloonAdded > 0) {
              lines.sort((a, b) => a.bbox.y0 - b.bbox.y0);
              console.log(`[Worker] Latin top-balloon block rescue added ${balloonAdded} tokens`);
            }
          }
        }

        // ── Fallback OCR for empty line boxes & large gaps ──
        const hasStrongLatinAnchor = isCjk || lines.some((line) => {
          const lineWords = (line.words as OCRWord[]) || [];
          if (lineWords.length === 0) return false;
          const text = normalizeLatinTokenForLexicon(getAlphaNum((line.text || '').trim()));
          const chars = text.length;
          const quality = scoreLatinLineReadability(lineWords);
          const tokenHits = lineWords
            .map(w => normalizeLatinTokenForLexicon(getAlphaNum((w.text || '').trim())))
            .filter(token => LATIN_COMMON_WORDS.has(token)).length;
          if (chars >= 6 && quality >= 0.58 && lineWords.length >= 2 && tokenHits >= 1) return true;
          if (chars >= 8 && quality >= 0.5 && lineWords.length >= 3 && tokenHits >= 1) return true;
          return tokenHits >= 1 && quality >= 0.5;
        });
        const hasWeakLatinAnchor = !isCjk && lines.some((line) => {
          const lineWords = (line.words as OCRWord[]) || [];
          if (lineWords.length === 0) return false;
          const text = normalizeLatinTokenForLexicon(getAlphaNum((line.text || '').trim()));
          const chars = text.length;
          const quality = scoreLatinLineReadability(lineWords);
          return (
            chars >= 4
            && (
              (lineWords.length >= 2 && quality >= 0.46)
              || line.confidence >= 72
            )
          );
        });
        const latinAnchorAvailable = hasStrongLatinAnchor || hasWeakLatinAnchor;
        const allowLowWordFallback = !isCjk
          && words.length > 0
          && words.length <= CONFIG.LATIN_LOW_WORD_RESCUE_MAX_WORDS
          && latinAnchorAvailable;
        const allowWeakAnchorFallback = !isCjk
          && !hasStrongLatinAnchor
          && hasWeakLatinAnchor
          && words.length > 0
          && words.length <= Math.max(CONFIG.LATIN_RETRY_MIN_WORDS, CONFIG.LATIN_LOW_WORD_RESCUE_MAX_WORDS + 3);
        const parsedData = parsed;
        if (
          !tooLarge
          && parsedData
          && (words.length >= CONFIG.FALLBACK_MIN_WORDS || allowLowWordFallback)
          && (parsedData.lineBoxes.length > 0 || lines.length > 0)
          && (hasStrongLatinAnchor || allowWeakAnchorFallback)
          && (!isCjk || baseWordCountBeforeRecovery <= CONFIG.CJK_FALLBACK_ENABLE_MAX_WORDS)
          && remainingRecoveryBudget() > 0
        ) {
          let fallbackAdded = 0;

          // Empty line boxes
          const allowEmptyLineFallback = !isCjk || CONFIG.CJK_ENABLE_EMPTY_LINE_FALLBACK;
          const latinEmptyLineConf = !isCjk && words.length <= 10
            ? Math.max(48, CONFIG.FALLBACK_LINE_CONF - 16)
            : CONFIG.FALLBACK_LINE_CONF;
          const emptyLineBoxes = parsedData.lineBoxes.filter(line => !parsedData.lineKeysWithWords.has(line.key));
          if (allowEmptyLineFallback && emptyLineBoxes.length > 0) {
            const limitedBoxes = emptyLineBoxes.slice(0, CONFIG.FALLBACK_MAX_EMPTY_LINES);
            await ensureFallbackInput();
            for (const lineBox of limitedBoxes) {
              if (remainingRecoveryBudget() <= 0) break;
              const h = Math.max(1, lineBox.bbox.y1 - lineBox.bbox.y0);
              if (!isCjk) {
                const w = Math.max(1, lineBox.bbox.x1 - lineBox.bbox.x0);
                if ((w <= actualWidth * 0.25 && h <= Math.max(14, actualHeight * 0.0045))
                  || (w * h) <= (actualWidth * actualHeight * 0.00014)) {
                  continue;
                }
              }
              const padded: BBox = {
                x0: lineBox.bbox.x0 - h * 0.25,
                y0: lineBox.bbox.y0 - h * 0.35,
                x1: lineBox.bbox.x1 + h * 0.25,
                y1: lineBox.bbox.y1 + h * 0.35
              };
              const emptyCandidateId = `empty-${lineBox.key}`;
              if (isPanelProfile && !isCjk) {
                const probeInfo = analyzeTextLikeProbe(gray, actualWidth, actualHeight, padded);
                if (!probeInfo.allowed) {
                  recordCandidateDebug(candidateDebugs, {
                    id: emptyCandidateId,
                    stage: 'emptyLineFallback',
                    bbox: padded,
                    accepted: false,
                    score: probeInfo.score,
                    reason: probeInfo.reason,
                  });
                  continue;
                }
              }
              const regionWords = await recognizeRegion(worker, (fallbackInput ?? processedInput) as Blob | string, padded, Number(PSM.SINGLE_LINE), actualWidth, actualHeight, dpi);
              const validWords = isCjk
                ? filterRecoveredCjkWords(regionWords, {
                  source: 'emptyLineFallback',
                  minConf: CONFIG.FALLBACK_LINE_CONF,
                  lineBox: padded,
                  isKorean,
                })
                : filterLatinRescueWords(regionWords, actualWidth, actualHeight, latinEmptyLineConf, 'emptyLineFallback');
              const capped = takeRecoveryCandidates(validWords, remainingRecoveryBudget(), 'emptyLineFallback');
              if (capped.length === 0) {
                if (isPanelProfile && !isCjk) {
                  recordCandidateDebug(candidateDebugs, {
                    id: emptyCandidateId,
                    stage: 'emptyLineFallback',
                    bbox: padded,
                    accepted: false,
                    reason: validWords.length === 0 ? 'noValidWords' : 'budgetCapped',
                  });
                }
                continue;
              }
              const added = appendUniqueWords(words, capped, 0.55);
              if (added.length === 0) {
                if (isPanelProfile && !isCjk) {
                  recordCandidateDebug(candidateDebugs, {
                    id: emptyCandidateId,
                    stage: 'emptyLineFallback',
                    bbox: padded,
                    accepted: false,
                    reason: 'noUniqueWords',
                  });
                }
                continue;
              }
              fallbackAdded += added.length;
              recoveryAdded += added.length;
              const targetLine = findBestLineForBox(lines, padded);
              if (targetLine) mergeWordsIntoLine(targetLine, added);
              else lines.push(makeLineFromWords(added));
              if (isPanelProfile && !isCjk) {
                recordCandidateDebug(candidateDebugs, {
                  id: emptyCandidateId,
                  stage: 'emptyLineFallback',
                  bbox: padded,
                  accepted: true,
                  score: scoreLatinCandidate(added, [makeLineFromWords(added)]),
                  reason: 'accepted',
                });
              }
            }
          }

          // Large gaps within lines
          let gapBudget = 20;
          const allowGapFallback = !isCjk || CONFIG.CJK_ENABLE_GAP_FALLBACK;
          for (const [lineIndex, line] of lines.slice().entries()) {
            if (!allowGapFallback) break;
            if (gapBudget <= 0) break;
            if (remainingRecoveryBudget() <= 0) break;
            const lineWords = (line.words as OCRWord[]) || [];
            if (lineWords.length === 0) continue;
            if (!isCjk) {
              const lineChars = getAlphaNum((line.text || '').trim()).length;
              const lineQuality = scoreLatinLineReadability(lineWords);
              if (lineChars < 6 || (lineQuality < 0.72 && line.confidence < 92)) continue;
            }
            const gaps = lineWords.length >= 2 ? findLargeGaps(lineWords, isCjk) : [];
            const edgeGaps: BBox[] = [];
            const lineBox = findBestLineBoxForLine(parsedData.lineBoxes, line);
            if (lineBox) {
              const sorted = lineWords.slice().sort((a, b) => a.bbox.x0 - b.bbox.x0);
              const heights = sorted.map(w => Math.max(1, w.bbox.y1 - w.bbox.y0)).sort((a, b) => a - b);
              const medianHeight = heights[Math.floor(heights.length / 2)] || heights[0] || 1;
              const gapValues: number[] = [];
              for (let i = 0; i < sorted.length - 1; i++) {
                const gap = sorted[i + 1].bbox.x0 - sorted[i].bbox.x1;
                if (gap > 0) gapValues.push(gap);
              }
              gapValues.sort((a, b) => a - b);
              const medianGap = gapValues.length > 0 ? gapValues[Math.floor(gapValues.length / 2)] : 0;
              const gapMult = isCjk ? CONFIG.FALLBACK_GAP_MEDIAN_MULT_CJK : CONFIG.FALLBACK_GAP_MEDIAN_MULT;
              const heightMult = isCjk ? CONFIG.FALLBACK_GAP_HEIGHT_MULT_CJK : CONFIG.FALLBACK_GAP_HEIGHT_MULT;
              const threshold = Math.max(CONFIG.FALLBACK_GAP_MIN_PX, medianGap * gapMult, medianHeight * heightMult);
              const padX = medianHeight * CONFIG.FALLBACK_GAP_PAD_RATIO;
              const padY = medianHeight * CONFIG.FALLBACK_GAP_PAD_RATIO;
              const leadGap = sorted[0].bbox.x0 - lineBox.x0;
              if (leadGap > threshold) {
                edgeGaps.push({ x0: lineBox.x0 - padX, y0: lineBox.y0 - padY, x1: sorted[0].bbox.x0 + padX, y1: lineBox.y1 + padY });
              }
              const trailGap = lineBox.x1 - sorted[sorted.length - 1].bbox.x1;
              if (trailGap > threshold) {
                edgeGaps.push({ x0: sorted[sorted.length - 1].bbox.x1 - padX, y0: lineBox.y0 - padY, x1: lineBox.x1 + padX, y1: lineBox.y1 + padY });
              }
            }
            const gapRegions = gaps.concat(edgeGaps);
            if (gapRegions.length === 0) continue;
            await ensureFallbackInput();
            const limitedGaps = gapRegions.slice(0, 3);
            for (const [gapIndex, gap] of limitedGaps.entries()) {
              if (gapBudget <= 0) break;
              if (remainingRecoveryBudget() <= 0) break;
              gapBudget -= 1;
              const gapCandidateId = `gap-${lineIndex}-${gapIndex}`;
              if (isPanelProfile && !isCjk) {
                const probeInfo = analyzeTextLikeProbe(gray, actualWidth, actualHeight, gap);
                if (!probeInfo.allowed) {
                  recordCandidateDebug(candidateDebugs, {
                    id: gapCandidateId,
                    stage: 'gapFallback',
                    bbox: gap,
                    accepted: false,
                    score: probeInfo.score,
                    reason: probeInfo.reason,
                  });
                  continue;
                }
              }
              const gapPsm = isCjk ? Number(PSM.SINGLE_LINE) : Number(PSM.SINGLE_WORD);
              const gapWords = await recognizeRegion(worker, (fallbackInput ?? processedInput) as Blob | string, gap, gapPsm, actualWidth, actualHeight, dpi);
              const validWords = isCjk
                ? filterRecoveredCjkWords(
                  gapWords.filter(w => {
                    const alphaNum = getAlphaNum((w.text || '').trim());
                    return alphaNum.length > 0 && alphaNum.length <= CONFIG.FALLBACK_GAP_MAX_LEN_CJK;
                  }),
                  {
                    source: 'gapFallback',
                    minConf: CONFIG.FALLBACK_GAP_CONF_CJK,
                    lineWords,
                    lineBox: line.bbox,
                    isKorean,
                  }
                )
                : filterLatinRescueWords(
                  gapWords.filter(w => {
                    const alphaNum = getAlphaNum((w.text || '').trim());
                    if (alphaNum.length === 0) return false;
                    const nonLatin = isNonLatinToken(alphaNum);
                    const maxLen = nonLatin ? CONFIG.FALLBACK_GAP_MAX_LEN_CJK : CONFIG.FALLBACK_GAP_MAX_LEN;
                    return alphaNum.length <= maxLen;
                  }),
                  actualWidth,
                  actualHeight,
                  CONFIG.FALLBACK_GAP_CONF,
                  'gapFallback'
                );
              const capped = takeRecoveryCandidates(validWords, remainingRecoveryBudget(), 'gapFallback');
              if (capped.length === 0) {
                if (isPanelProfile && !isCjk) {
                  recordCandidateDebug(candidateDebugs, {
                    id: gapCandidateId,
                    stage: 'gapFallback',
                    bbox: gap,
                    accepted: false,
                    reason: validWords.length === 0 ? 'noValidWords' : 'budgetCapped',
                  });
                }
                continue;
              }
              const added = appendUniqueWords(words, capped, 0.5);
              if (added.length === 0) {
                if (isPanelProfile && !isCjk) {
                  recordCandidateDebug(candidateDebugs, {
                    id: gapCandidateId,
                    stage: 'gapFallback',
                    bbox: gap,
                    accepted: false,
                    reason: 'noUniqueWords',
                  });
                }
                continue;
              }
              fallbackAdded += added.length;
              recoveryAdded += added.length;
              mergeWordsIntoLine(line, added);
              if (isPanelProfile && !isCjk) {
                recordCandidateDebug(candidateDebugs, {
                  id: gapCandidateId,
                  stage: 'gapFallback',
                  bbox: gap,
                  accepted: true,
                  score: scoreLatinCandidate(added, [makeLineFromWords(added)]),
                  reason: 'accepted',
                });
              }
            }
          }

          if (fallbackAdded > 0) {
            lines.sort((a, b) => a.bbox.y0 - b.bbox.y0);
            console.log(`[Worker] Fallback OCR added ${fallbackAdded} tokens`);
          }
        }

        // ── Image tile & background filters ──
        const imageFilterWordsBefore = words.slice();
        const imageFilterLinesBefore = lines.slice();
        if (gray && words.length > 0) {
          const latinMeaningfulBeforeImage = !isCjk ? countMeaningfulLatinWords(words) : 0;
          const latinSpeechFastPath = !isCjk && (
            isPanelProfile
              ? isLikelyLatinSpeechPage(lines, words, actualHeight)
              : true
          );
          const highRecallImageMode = latinSpeechFastPath || (!isCjk && (
            words.length <= 10
            || (words.length <= 16 && latinMeaningfulBeforeImage >= 3)
          ));
          const protectedWords = buildProtectedWordSet(lines as OCRLine[], {
            isCjk,
            isKorean,
          });
          if (!isCjk) {
            extendLatinProtectedWords(lines, protectedWords);
          }
          if (!highRecallImageMode) {
            const maskInfo = buildImageTileMask(gray, actualWidth, actualHeight, words);
            if (maskInfo && maskInfo.imageTiles > 0) {
              console.log(`[Worker] Image tiles: ${maskInfo.imageTiles}/${maskInfo.totalTiles}`);
              const filteredWords = filterWordsByImageTiles(words, maskInfo, actualWidth, actualHeight, protectedWords, gray);
              if (filteredWords.length !== words.length) {
                console.log(`[Worker] Filtered image regions: ${words.length - filteredWords.length} words removed`);
                words = filteredWords;
                lines = rebuildLinesFromWords(lines, filteredWords);
              }
            }
          } else {
            console.log(`[Worker] High-recall Latin mode: skipped image tile filter${latinSpeechFastPath ? ' (speech fast-path)' : ''}`);
          }

          if (words.length > 0) {
            if (!highRecallImageMode) {
              const filteredWords = filterWordsByBackground(words, gray, actualWidth, actualHeight, protectedWords);
              if (filteredWords.length !== words.length) {
                console.log(`[Worker] Filtered photo-text: ${words.length - filteredWords.length} words removed`);
                words = filteredWords;
                lines = rebuildLinesFromWords(lines, filteredWords);
              }
            } else {
              console.log(`[Worker] High-recall Latin mode: skipped background variance filter${latinSpeechFastPath ? ' (speech fast-path)' : ''}`);
            }
          }

          if (isCjk && words.length > 0) {
            const filteredWords = filterIsolatedCjkNoise(words, protectedWords);
            if (filteredWords.length !== words.length) {
              console.log(`[Worker] Filtered isolated CJK noise: ${words.length - filteredWords.length} words removed`);
              words = filteredWords;
              lines = rebuildLinesFromWords(lines, filteredWords);
            }
          }

          if (hasLangCode(language, 'kor') && words.length > 0) {
            const filteredWords = filterKoreanJamoNoise(words, protectedWords);
            if (filteredWords.length !== words.length) {
              console.log(`[Worker] Filtered Korean jamo noise: ${words.length - filteredWords.length} words removed`);
              words = filteredWords;
              lines = rebuildLinesFromWords(lines, filteredWords);
            }
          }

          if (isCjk && lines.length > 0) {
            const pruned = filterWeakIsolatedCjkLines(lines as OCRLine[], gray, actualWidth, actualHeight);
            if (pruned.words.length !== words.length) {
              console.log(`[Worker] Filtered weak isolated CJK lines: ${words.length - pruned.words.length} words removed`);
              words = pruned.words;
              lines = pruned.lines;
            }
          }

          // Latin retry: stylized balloon text often benefits from sparse-text pass.
          if (!isCjk) {
            console.log('[Worker] Skipped Latin sparse retry: disabled for speed/stability');
          }
        }
        if (isPanelProfile) {
          recordStageMetric(stageMetrics, 'imageFilter', imageFilterWordsBefore, words, imageFilterLinesBefore, lines);
        }

        // ── Latin watermark suppression + targeted sparse rescues ──
        if (!isCjk) {
          const watermarkWordsBefore = words.slice();
          const watermarkLinesBefore = lines.slice();
          if (words.length > 0) {
            const meaningfulLatinAfterWatermark = countMeaningfulLatinWords(words);
            const highRecallLatin = isLikelyLatinSpeechPage(lines, words, actualHeight)
              || words.length <= CONFIG.LATIN_HIGH_RECALL_MAX_WORDS
              || (
                words.length <= CONFIG.LATIN_HIGH_RECALL_MEANINGFUL_MAX_WORDS
                && meaningfulLatinAfterWatermark >= CONFIG.LATIN_HIGH_RECALL_MIN_MEANINGFUL
              );
            const noWatermark = stripLikelyWatermarkWords(words, actualWidth, actualHeight);
            if (noWatermark.length !== words.length) {
              console.log(`[Worker] Filtered watermark text: ${words.length - noWatermark.length} words removed`);
              words = noWatermark;
              lines = rebuildLinesFromWords(lines, words);
            }
            if (isPanelProfile) {
              recordStageMetric(stageMetrics, 'watermark', watermarkWordsBefore, words, watermarkLinesBefore, lines);
            }

            const linePruneWordsBefore = words.slice();
            const linePruneLinesBefore = lines.slice();
            const prunedEdgeLines = pruneLatinEdgeGhostLines(lines, actualWidth, actualHeight, protectedWordKeys);
            if (prunedEdgeLines.length !== lines.length) {
              const droppedLineWords = lines.reduce((sum, line) => sum + (((line.words as OCRWord[]) || []).length), 0)
                - prunedEdgeLines.reduce((sum, line) => sum + (((line.words as OCRWord[]) || []).length), 0);
              if (droppedLineWords > 0) {
                console.log(`[Worker] Filtered edge ghost lines: ${droppedLineWords} words removed`);
              }
              lines = prunedEdgeLines;
              words = lines.flatMap(line => (line.words as OCRWord[]) || []);
            }
            if (!highRecallLatin) {
              const prunedLatinLines = pruneLatinGarbageLines(lines, actualWidth, actualHeight, protectedWordKeys);
              if (prunedLatinLines.length !== lines.length) {
                const droppedLineWords = lines.reduce((sum, line) => sum + (((line.words as OCRWord[]) || []).length), 0)
                  - prunedLatinLines.reduce((sum, line) => sum + (((line.words as OCRWord[]) || []).length), 0);
                if (droppedLineWords > 0) {
                  console.log(`[Worker] Filtered latin garbage lines: ${droppedLineWords} words removed`);
                }
                lines = prunedLatinLines;
                words = lines.flatMap(line => (line.words as OCRWord[]) || []);
              }
              const prunedIsolatedLatinLines = pruneLatinIsolatedNoiseLines(lines, protectedWordKeys);
              if (prunedIsolatedLatinLines.length !== lines.length) {
                const droppedLineWords = lines.reduce((sum, line) => sum + (((line.words as OCRWord[]) || []).length), 0)
                  - prunedIsolatedLatinLines.reduce((sum, line) => sum + (((line.words as OCRWord[]) || []).length), 0);
                if (droppedLineWords > 0) {
                  console.log(`[Worker] Filtered isolated latin lines: ${droppedLineWords} words removed`);
                }
                lines = prunedIsolatedLatinLines;
                words = lines.flatMap(line => (line.words as OCRWord[]) || []);
              }
              const prunedShortFragments = pruneLatinShortFragmentLines(lines, protectedWordKeys);
              if (prunedShortFragments.length !== lines.length) {
                const droppedLineWords = lines.reduce((sum, line) => sum + (((line.words as OCRWord[]) || []).length), 0)
                  - prunedShortFragments.reduce((sum, line) => sum + (((line.words as OCRWord[]) || []).length), 0);
                if (droppedLineWords > 0) {
                  console.log(`[Worker] Filtered latin short fragments: ${droppedLineWords} words removed`);
                }
                lines = prunedShortFragments;
                words = lines.flatMap(line => (line.words as OCRWord[]) || []);
              }
            } else {
              console.log('[Worker] High-recall Latin mode: skipped aggressive line pruning');
              const prunedHighRecallLines = pruneLatinHighRecallNoiseLines(lines, protectedWordKeys);
              if (prunedHighRecallLines.length !== lines.length) {
                const droppedLineWords = lines.reduce((sum, line) => sum + (((line.words as OCRWord[]) || []).length), 0)
                  - prunedHighRecallLines.reduce((sum, line) => sum + (((line.words as OCRWord[]) || []).length), 0);
                if (droppedLineWords > 0) {
                  console.log(`[Worker] High-recall Latin cleanup removed ${droppedLineWords} words`);
                }
                lines = prunedHighRecallLines;
                words = lines.flatMap(line => (line.words as OCRWord[]) || []);
              }
            }

            if (isPanelProfile) {
              recordStageMetric(stageMetrics, 'linePrune', linePruneWordsBefore, words, linePruneLinesBefore, lines);
            }
          }

          const runLatinSparseProbe = async (probeBox: BBox, minConf: number, source: string): Promise<number> => {
            const safeBox = clampBBox(probeBox, actualWidth, actualHeight);
            const w = Math.max(1, safeBox.x1 - safeBox.x0);
            const h = Math.max(1, safeBox.y1 - safeBox.y0);
            if (w < 12 || h < 12) return 0;

            await ensureFallbackInput();
            const probeWords = await recognizeRegion(
              worker,
              (fallbackInput ?? processedInput) as Blob | string,
              safeBox,
              Number(PSM.SPARSE_TEXT),
              actualWidth,
              actualHeight,
              dpi
            );
            if (probeWords.length === 0) return 0;

            const rankedProbeWords = probeWords
              .slice()
              .sort((a, b) => b.confidence - a.confidence)
              .slice(0, CONFIG.LATIN_SPARSE_MAX_PROBE_WORDS);

            const valid = filterLatinRescueWords(rankedProbeWords, actualWidth, actualHeight, minConf, source);
            if (valid.length === 0) return 0;
            const limitedValid = valid
              .sort((a, b) => b.confidence - a.confidence)
              .slice(0, CONFIG.LATIN_SPARSE_MAX_ADDED_PER_PROBE);
            if (limitedValid.length === 0) return 0;

            const added = appendUniqueWords(words, limitedValid, 0.52);
            if (added.length === 0) return 0;

            const addedLines = buildLinesFromWordsByY(added, actualHeight);
            for (const rl of addedLines) {
              const target = findBestLineForBox(lines, rl.bbox);
              if (target) mergeWordsIntoLine(target, rl.words as OCRWord[]);
              else lines.push(rl);
            }
            lines.sort((a, b) => a.bbox.y0 - b.bbox.y0);
            return added.length;
          };

          // If a page ends up with zero words, run one full-page sparse rescue.
          if (
            !isPanelProfile
            &&
            CONFIG.LATIN_ENABLE_SPARSE_RESCUE
            && !CONFIG.LATIN_ENABLE_TOP_BAND_PROBE
            && !tooLarge
            && words.length === 0
          ) {
            const rescued = await runLatinSparseProbe(
              { x0: 0, y0: 0, x1: actualWidth, y1: actualHeight },
              CONFIG.LATIN_SPARSE_RESCUE_MIN_CONF,
              'lowWordSparse'
            );
            if (rescued > 0) {
              console.log(`[Worker] Latin low-word sparse rescue added ${rescued} tokens`);
            }
          }

          // Probe top strip when first detected text starts too low (common for missing top interjections).
          if (!isPanelProfile && CONFIG.LATIN_ENABLE_TOP_BAND_PROBE && words.length >= CONFIG.LATIN_TOP_PROBE_MIN_WORDS) {
            const firstY = words.reduce((minY, w) => Math.min(minY, w.bbox.y0), Number.POSITIVE_INFINITY);
            const topBand = Math.min(
              CONFIG.LATIN_TOP_PROBE_MAX_HEIGHT,
              Math.max(420, Math.round(actualHeight * CONFIG.LATIN_TOP_PROBE_HEIGHT_RATIO))
            );
            const topWordCount = words.filter(w => ((w.bbox.y0 + w.bbox.y1) / 2) <= topBand).length;
            const firstYThreshold = Math.max(120, Math.round(actualHeight * CONFIG.LATIN_TOP_PROBE_MIN_FIRST_Y_RATIO));
            if (Number.isFinite(firstY) && firstY > firstYThreshold && topWordCount <= CONFIG.LATIN_TOP_PROBE_MAX_TOP_WORDS) {
              const probeHeight = Math.min(
                actualHeight,
                Math.max(topBand, Math.min(CONFIG.LATIN_TOP_PROBE_MAX_HEIGHT, Math.round(firstY + 560)))
              );
              const rescuedTop = await runLatinSparseProbe(
                { x0: 0, y0: 0, x1: actualWidth, y1: probeHeight },
                CONFIG.LATIN_TOP_PROBE_MIN_CONF,
                'topBandSparse'
              );
              if (rescuedTop > 0) {
                console.log(`[Worker] Latin top-band sparse rescue added ${rescuedTop} tokens`);
              }
            }
          }

          if (words.length > 0) {
            const noWatermarkAfterRescue = stripLikelyWatermarkWords(words, actualWidth, actualHeight);
            if (noWatermarkAfterRescue.length !== words.length) {
              console.log(`[Worker] Filtered watermark text after rescue: ${words.length - noWatermarkAfterRescue.length} words removed`);
              words = noWatermarkAfterRescue;
              lines = rebuildLinesFromWords(lines, words);
            }
            // Keep low-count sparse rescue results from being over-pruned back to zero.
            const allowAggressivePostRescuePrune = words.length > CONFIG.LATIN_SKIP_POST_RESCUE_PRUNE_MAX_WORDS;
            if (allowAggressivePostRescuePrune) {
              const prunedEdgeLinesAfterRescue = pruneLatinEdgeGhostLines(lines, actualWidth, actualHeight, protectedWordKeys);
              if (prunedEdgeLinesAfterRescue.length !== lines.length) {
                const droppedLineWords = lines.reduce((sum, line) => sum + (((line.words as OCRWord[]) || []).length), 0)
                  - prunedEdgeLinesAfterRescue.reduce((sum, line) => sum + (((line.words as OCRWord[]) || []).length), 0);
                if (droppedLineWords > 0) {
                  console.log(`[Worker] Filtered edge ghost lines after rescue: ${droppedLineWords} words removed`);
                }
                lines = prunedEdgeLinesAfterRescue;
                words = lines.flatMap(line => (line.words as OCRWord[]) || []);
              }
              const prunedLatinLinesAfterRescue = pruneLatinGarbageLines(lines, actualWidth, actualHeight, protectedWordKeys);
              if (prunedLatinLinesAfterRescue.length !== lines.length) {
                const droppedLineWords = lines.reduce((sum, line) => sum + (((line.words as OCRWord[]) || []).length), 0)
                  - prunedLatinLinesAfterRescue.reduce((sum, line) => sum + (((line.words as OCRWord[]) || []).length), 0);
                if (droppedLineWords > 0) {
                  console.log(`[Worker] Filtered latin garbage lines after rescue: ${droppedLineWords} words removed`);
                }
                lines = prunedLatinLinesAfterRescue;
                words = lines.flatMap(line => (line.words as OCRWord[]) || []);
              }
              const prunedIsolatedLatinLinesAfterRescue = pruneLatinIsolatedNoiseLines(lines, protectedWordKeys);
              if (prunedIsolatedLatinLinesAfterRescue.length !== lines.length) {
                const droppedLineWords = lines.reduce((sum, line) => sum + (((line.words as OCRWord[]) || []).length), 0)
                  - prunedIsolatedLatinLinesAfterRescue.reduce((sum, line) => sum + (((line.words as OCRWord[]) || []).length), 0);
                if (droppedLineWords > 0) {
                  console.log(`[Worker] Filtered isolated latin lines after rescue: ${droppedLineWords} words removed`);
                }
                lines = prunedIsolatedLatinLinesAfterRescue;
                words = lines.flatMap(line => (line.words as OCRWord[]) || []);
              }
              const prunedShortFragmentsAfterRescue = pruneLatinShortFragmentLines(lines, protectedWordKeys);
              if (prunedShortFragmentsAfterRescue.length !== lines.length) {
                const droppedLineWords = lines.reduce((sum, line) => sum + (((line.words as OCRWord[]) || []).length), 0)
                  - prunedShortFragmentsAfterRescue.reduce((sum, line) => sum + (((line.words as OCRWord[]) || []).length), 0);
                if (droppedLineWords > 0) {
                  console.log(`[Worker] Filtered latin short fragments after rescue: ${droppedLineWords} words removed`);
                }
                lines = prunedShortFragmentsAfterRescue;
                words = lines.flatMap(line => (line.words as OCRWord[]) || []);
              }
            }
          }
        }

        // ── Post-prune line-box rescue (recover real lines lost by late filters) ──
        if (
          !isCjk
          && !tooLarge
          && parsed
          && parsed.lineBoxes.length > 0
          && words.length > 0
          && words.length <= CONFIG.LATIN_POST_PRUNE_RESCUE_MAX_WORDS
          && lines.length <= CONFIG.LATIN_POST_PRUNE_RESCUE_MAX_LINES
        ) {
          const candidateLineBoxes = parsed.lineBoxes
            .map((lineBox) => {
              const box = clampBBox(lineBox.bbox, actualWidth, actualHeight);
              const w = Math.max(1, box.x1 - box.x0);
              const h = Math.max(1, box.y1 - box.y0);
              const area = w * h;
              return { key: lineBox.key, bbox: box, w, h, area, aspect: w / h };
            })
            .filter((item) => {
              if (item.w <= Math.max(60, actualWidth * 0.03)) return false;
              if (item.h <= 10) return false;
              if (item.area <= 1400) return false;
              if (item.aspect < 1.2 || item.aspect > 22) return false;

              const overlapLine = findBestLineForBox(lines, item.bbox);
              if (!overlapLine) return true;
              const overlapWords = (overlapLine.words as OCRWord[]) || [];
              const overlapAlpha = normalizeLatinTokenForLexicon(getAlphaNum((overlapLine.text || '').trim()));
              const overlapLexicalHits = overlapWords
                .map((w) => normalizeLatinTokenForLexicon(getAlphaNum((w.text || '').trim())))
                .filter(token => LATIN_COMMON_WORDS.has(token) || LATIN_SHORT_KEEP_FOR_LINE.has(token))
                .length;
              const overlapCoverage = overlapWords.length > 0
                ? computeLineCoverageRatio(overlapWords, item.bbox)
                : 0;
              return overlapAlpha.length <= 3
                || overlapLexicalHits === 0
                || overlapWords.length <= 3
                || overlapCoverage < 0.74;
            })
            .sort((a, b) => a.bbox.y0 - b.bbox.y0)
            .slice(0, 8);

          if (candidateLineBoxes.length > 0) {
            await ensureFallbackInput();
            let postPruneAdded = 0;
            for (const candidate of candidateLineBoxes) {
              const overlapLine = findBestLineForBox(lines, candidate.bbox);
              const overlapWords = overlapLine ? ((overlapLine.words as OCRWord[]) || []) : [];
              const overlapCoverage = overlapLine && overlapWords.length > 0
                ? computeLineCoverageRatio(overlapWords, candidate.bbox)
                : 0;
              const lowCoverageCandidate = overlapCoverage > 0 && overlapCoverage < CONFIG.LATIN_LINE_RESCAN_LOW_COVERAGE_THRESHOLD;
              const padX = candidate.h * (lowCoverageCandidate ? 0.6 : 0.35);
              const padY = candidate.h * (lowCoverageCandidate ? 0.58 : 0.42);
              const probeBox = clampBBox({
                x0: candidate.bbox.x0 - padX,
                y0: candidate.bbox.y0 - padY,
                x1: candidate.bbox.x1 + padX,
                y1: candidate.bbox.y1 + padY
              }, actualWidth, actualHeight);

              const probeInputs: Array<{ input: Blob | string; source: string }> = [
                { input: (fallbackInput ?? processedInput) as Blob | string, source: 'postPruneLine' }
              ];
              if (fallbackInput && fallbackInput !== processedInput) {
                probeInputs.push({ input: processedInput as Blob | string, source: 'postPruneLineBin' });
              }

              let bestValid: OCRWord[] = [];
              let bestScore = Number.NEGATIVE_INFINITY;
              for (const probe of probeInputs) {
                const regionWords = await recognizeRegion(
                  worker,
                  probe.input,
                  probeBox,
                  lowCoverageCandidate ? Number(PSM.SINGLE_BLOCK) : Number(PSM.SINGLE_LINE),
                  actualWidth,
                  actualHeight,
                  dpi
                );
                const valid = filterLatinRescueWords(
                  regionWords,
                  actualWidth,
                  actualHeight,
                  Math.max(30, CONFIG.FALLBACK_LINE_CONF - 34),
                  probe.source
                );
                if (valid.length === 0) continue;
                const ranked = valid
                  .slice()
                  .sort((a, b) => b.confidence - a.confidence)
                  .slice(0, 10);
                const lineCandidate = makeLineFromWords(ranked);
                const lineAlpha = normalizeLatinTokenForLexicon(getAlphaNum((lineCandidate.text || '').trim()));
                if (!lineAlpha) continue;
                const lineQuality = scoreLatinLineReadability(ranked);
                const lexicalHits = ranked
                  .map((w) => normalizeLatinTokenForLexicon(getAlphaNum((w.text || '').trim())))
                  .filter(token => LATIN_COMMON_WORDS.has(token) || LATIN_SHORT_KEEP_FOR_LINE.has(token))
                  .length;
                const noisySingles = ranked.reduce((sum, w) => {
                  const token = normalizeLatinTokenForLexicon(getAlphaNum((w.text || '').trim()));
                  return sum + (token.length === 1 && !LATIN_SHORT_KEEP_FOR_LINE.has(token) ? 1 : 0);
                }, 0);
                const score = (lexicalHits * 3.4)
                  + (lineQuality * 4.5)
                  + (lineCandidate.confidence * 0.04)
                  + (/[AEIOU]/.test(lineAlpha) ? 0.9 : 0)
                  - (noisySingles * 1.4);
                if (score > bestScore) {
                  bestScore = score;
                  bestValid = ranked;
                }
              }

              if (bestValid.length === 0) continue;

              let candidateWords = bestValid;
              let candidateLine = makeLineFromWords(candidateWords);
              let candidateAlpha = normalizeLatinTokenForLexicon(getAlphaNum((candidateLine.text || '').trim()));
              let candidateQuality = scoreLatinLineReadability(candidateWords);
              let candidateTokens = candidateWords
                .map((w) => normalizeLatinTokenForLexicon(getAlphaNum((w.text || '').trim())))
                .filter(Boolean);
              let candidateCommonHits = candidateTokens.filter((token) => LATIN_COMMON_WORDS.has(token)).length;
              let candidateShortKeepHits = candidateTokens.filter((token) => LATIN_SHORT_KEEP_FOR_LINE.has(token)).length;
              let candidateLexicalHits = candidateCommonHits + candidateShortKeepHits;
              let candidateNonLexicalCount = Math.max(0, candidateTokens.length - candidateLexicalHits);
              let keepLine = (
                candidateCommonHits >= 2 && candidateAlpha.length >= 4 && candidateQuality >= 0.28
              ) || (
                candidateCommonHits >= 1
                && candidateAlpha.length >= 4
                && candidateQuality >= 0.4
                && candidateLine.confidence >= 52
                && candidateNonLexicalCount <= Math.max(1, Math.floor(candidateTokens.length * 0.45))
              ) || (
                candidateShortKeepHits >= 2
                && candidateNonLexicalCount === 0
                && candidateTokens.length <= 3
                && candidateAlpha.length <= 8
                && candidateQuality >= 0.4
                && candidateLine.confidence >= 50
              );

              if (!keepLine) {
                const lexicalRegionWords = await recognizeRegion(
                  worker,
                  (fallbackInput ?? processedInput) as Blob | string,
                  probeBox,
                  Number(PSM.SINGLE_BLOCK),
                  actualWidth,
                  actualHeight,
                  dpi
                );
                const lexicalValid = filterLatinRescueWords(
                  lexicalRegionWords,
                  actualWidth,
                  actualHeight,
                  Math.max(22, CONFIG.FALLBACK_LINE_CONF - 42),
                  'postPruneLineLex'
                )
                  .filter((word) => {
                    const token = normalizeLatinTokenForLexicon(getAlphaNum((word.text || '').trim()));
                    return Boolean(token && (LATIN_COMMON_WORDS.has(token) || LATIN_SHORT_KEEP_FOR_LINE.has(token)));
                  })
                  .sort((a, b) => b.confidence - a.confidence)
                  .slice(0, 8);

                if (lexicalValid.length > 0) {
                  candidateWords = lexicalValid;
                  candidateLine = makeLineFromWords(candidateWords);
                  candidateAlpha = normalizeLatinTokenForLexicon(getAlphaNum((candidateLine.text || '').trim()));
                  candidateQuality = scoreLatinLineReadability(candidateWords);
                  candidateTokens = candidateWords
                    .map((w) => normalizeLatinTokenForLexicon(getAlphaNum((w.text || '').trim())))
                    .filter(Boolean);
                  candidateCommonHits = candidateTokens.filter((token) => LATIN_COMMON_WORDS.has(token)).length;
                  candidateShortKeepHits = candidateTokens.filter((token) => LATIN_SHORT_KEEP_FOR_LINE.has(token)).length;
                  candidateLexicalHits = candidateCommonHits + candidateShortKeepHits;
                  candidateNonLexicalCount = Math.max(0, candidateTokens.length - candidateLexicalHits);
                  keepLine = (
                    candidateCommonHits >= 1
                    && candidateTokens.length >= 2
                    && candidateAlpha.length >= 3
                    && candidateQuality >= 0.32
                    && candidateLine.confidence >= 44
                  ) || (
                    candidateShortKeepHits >= 2
                    && candidateNonLexicalCount === 0
                    && candidateTokens.length <= 3
                    && candidateAlpha.length <= 8
                    && candidateLine.confidence >= 42
                  );
                }
              }

              if (!keepLine) {
                if (bestValid[0]) logDrop('latinRescue', bestValid[0], 'postPruneLine: weak candidate line');
                continue;
              }

              const added = appendUniqueWords(words, candidateWords, 0.48);
              if (added.length === 0) continue;

              postPruneAdded += added.length;
              const target = findBestLineForBox(lines, candidate.bbox);
              if (target) mergeWordsIntoLine(target, added);
              else lines.push(makeLineFromWords(added));
            }

            if (postPruneAdded > 0) {
              lines.sort((a, b) => a.bbox.y0 - b.bbox.y0);
              console.log(`[Worker] Latin post-prune line rescue added ${postPruneAdded} tokens`);
            }
          }
        }

        if (!isCjk && words.length > 0) {
          const fixedDecorative = normalizeLatinDecorativeEdgeArtifacts(words);
          if (fixedDecorative > 0) {
            console.log(`[Worker] Normalized decorative Latin token edges: ${fixedDecorative} tokens`);
            lines = rebuildLinesFromWords(lines, words);
          }

          const deNoisedResidual = pruneLatinResidualNoiseWords(words);
          if (deNoisedResidual.length !== words.length) {
            console.log(`[Worker] Removed residual Latin noise tokens: ${words.length - deNoisedResidual.length} tokens`);
            words = deNoisedResidual;
            lines = rebuildLinesFromWords(lines, words);
          }

          const fixedRepeated = normalizeLatinRepeatedWordArtifacts(words);
          if (fixedRepeated > 0) {
            console.log(`[Worker] Normalized repeated Latin artifacts: ${fixedRepeated} tokens`);
            lines = rebuildLinesFromWords(lines, words);
          }

          const fixedApprox = correctApproxLatinWords(words, LATIN_COMMON_WORDS, LATIN_SHORT_KEEP_FOR_LINE);
          if (fixedApprox > 0) {
            console.log(`[Worker] Corrected approximate Latin words: ${fixedApprox} tokens`);
            lines = rebuildLinesFromWords(lines, words);
          }

          // Fix 2.1: Correct truncated / artifact words using lexicon (e.g. DOINNG→DOING)
          const fixedTruncated = correctLatinDictionaryArtifacts(words);
          if (fixedTruncated > 0) {
            console.log(`[Worker] Corrected truncated Latin words: ${fixedTruncated} tokens`);
            lines = rebuildLinesFromWords(lines, words);
          }

          const splitMerged = splitMergedLatinWords(words, LATIN_COMMON_WORDS, LATIN_SHORT_KEEP_FOR_LINE);
          if (splitMerged > 0) {
            console.log(`[Worker] Split merged Latin words: ${splitMerged} tokens`);
            lines = rebuildLinesFromWords(lines, words);
          }
        }

        // ── Fallback: no words from TSV but raw text exists ──
        if (
          CONFIG.ENABLE_RAW_TEXT_LINE_FALLBACK
          && words.length === 0
          && data?.text
          && data.text.trim().length > 0
        ) {
          const allowRawFallback = isCjk || shouldUseLatinRawTextFallback(data.text);
          if (!allowRawFallback) {
            console.log('[Worker] Skipped raw text fallback: low lexical quality');
          } else {
            console.log('[Worker] No words from TSV, creating fallback from raw text');
          const rawLines = data.text
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 0)
            .filter((line) => {
              if (isCjk) return true;
              const tokens = line
                .split(/\s+/)
                .map((part) => normalizeLatinTokenForLexicon(getAlphaNum(part)))
                .filter(Boolean);
              if (tokens.length === 0) return false;
              const meaningful = tokens.filter(isMeaningfulLatinToken).length;
              const ratio = meaningful / Math.max(1, tokens.length);
              return meaningful >= 1 && ratio >= 0.34;
            });
          if (rawLines.length > 0) {
          const approxLineHeight = actualHeight / (rawLines.length + 2);
          words = [];
          lines = [];
          rawLines.forEach((lineText, i) => {
            const y0 = (i + 1) * approxLineHeight;
            const y1 = y0 + approxLineHeight;
            const bbox = { x0: 20, y0, x1: actualWidth - 20, y1 };
            const lineWords = [{ text: lineText.trim(), confidence: data.confidence || 0, bbox }];
            words.push(...lineWords);
            lines.push({ text: lineText.trim(), confidence: data.confidence || 0, bbox, words: lineWords });
          });
          } else {
            console.log('[Worker] Raw text fallback rejected: no usable lines');
          }
          }
        }

        if (words.length > 0) {
          const seededLines = buildLinesFromWordsByY(words, actualHeight) as OCRLine[];
          const rebuiltFromWords = rebuildLinesFromWords(seededLines, words);
          lines = normalizeFinalLines(rebuiltFromWords, isCjk);
          if (!isCjk) {
            lines = normalizeLatinFragmentedLines(lines as OCRLine[]);
            lines = cleanNoiseWordsWithinLatinLines(
              lines as OCRLine[],
              LATIN_COMMON_WORDS,
              LATIN_SHORT_KEEP_FOR_LINE,
              makeLineFromWords
            );
            lines = pruneResidualLatinNoiseLines(
              lines as OCRLine[],
              protectedWordKeys,
              LATIN_COMMON_WORDS,
              LATIN_SHORT_KEEP_FOR_LINE,
              scoreLatinLineReadability,
              lineHasProtectedWord
            );
            words = lines.flatMap((line) => (line.words as OCRWord[]) || []);
          }
        }

        if (!isCjk && words.length > 0) {
          const hasStrongReadableLine = lines.some((line) => {
            const lineWords = (line.words as OCRWord[]) || [];
            const chars = normalizeLatinTokenForLexicon(getAlphaNum((line.text || '').trim())).length;
            const quality = scoreLatinLineReadability(lineWords);
            const tokenHits = lineWords
              .map((w) => normalizeLatinTokenForLexicon(getAlphaNum((w.text || '').trim())))
              .filter(token => LATIN_COMMON_WORDS.has(token)).length;
            return chars >= 6 && quality >= 0.62 && (tokenHits >= 1 || lineWords.length >= 3);
          });
          const meaningfulWordCount = countMeaningfulLatinWords(words);
          const totalAlphaChars = words.reduce((sum, word) => {
            const rawAlpha = getAlphaNum((word.text || '').trim());
            return sum + normalizeLatinTokenForLexicon(rawAlpha).length;
          }, 0);
          const hasProtectedLine = lines.some((line) => lineHasProtectedWord(line, protectedWordKeys));
          if (!hasStrongReadableLine && !hasProtectedLine && meaningfulWordCount < 2 && totalAlphaChars < 22) {
            for (const word of words) logDrop('latinLine', word, 'page-level low-readability clear');
            words = [];
            lines = [];
          }
        }

        const finalText = lines.length > 0
          ? lines.map(line => line.text).filter(Boolean).join('\n')
          : (words.length > 0 ? words.map(w => w.text).join(' ') : (data?.text || ''));

        const droppedWords = finishDropCollection();
        const dropCounts = droppedWords.reduce<Record<string, number>>((acc, dropped) => {
          acc[dropped.filter] = (acc[dropped.filter] || 0) + 1;
          return acc;
        }, {});
        if (!isCjk && lines.length <= 2 && droppedWords.length > 0) {
          const focusFilters = ['edgeGhost', 'latinLine', 'noise', 'bgVariance', 'latinRescue'];
          for (const filterName of focusFilters) {
            const sample = droppedWords
              .filter((d) => d.filter === filterName)
              .slice(0, 8)
              .map((d) => `${d.text}(${d.reason})`);
            if (sample.length > 0) {
              console.log(`[Worker] drop-sample ${filterName}: ${sample.join(' | ')}`);
            }
          }
        }
        const debugInfo = (droppedWords.length > 0 || stageMetrics.length > 0 || candidateDebugs.length > 0)
          ? {
            droppedWords,
            dropCounts,
            stageMetrics: stageMetrics.length > 0 ? stageMetrics : undefined,
            candidates: candidateDebugs.length > 0 ? candidateDebugs : undefined,
          }
          : undefined;

        console.log(`[Worker] OCR complete: ${words.length} words, ${lines.length} lines, conf=${data?.confidence?.toFixed(1)}%`);

        self.postMessage({
          type: 'OCR_TEXT_LAYER_RESULT',
          id,
          payload: {
            pageNumber: 1,
            width: actualWidth,
            height: actualHeight,
            dpi,
            language,
            pageSegMode: psm,
            algorithmVersion: OCR_ALGORITHM_VERSION,
            pipelineProfile: normalizedPipelineProfile,
            lines,
            words,
            text: finalText,
            confidence: data?.confidence || 0,
            debug: debugInfo
          }
        });
        } finally {
          finishDropCollection();
        }
        break;
      }

      // ── SEGMENT ──
      case 'SEGMENT': {
        const { imageUrl, language = 'eng', documentType = 'manga' } = payload as {
          imageUrl: string;
          language: string;
          documentType: DocumentType;
        };

        sendProgress('Preprocessing image...', 0);
        let processedInput: Blob | string = imageUrl;
        let imgWidth = 1000;
        let imgHeight = 1000;

        try {
          const preprocessed = await preprocessImage(imageUrl);
          processedInput = preprocessed.image;
          imgWidth = preprocessed.width;
          imgHeight = preprocessed.height;
        } catch (ppError) {
          console.warn('[Worker] SEGMENT preprocessing failed:', ppError);
          try {
            const dims = await getImageDimensions(imageUrl);
            imgWidth = dims.width;
            imgHeight = dims.height;
          } catch { /* use defaults */ }
        }

        sendProgress('Starting segmentation...', 0.1);
        const segWorker = await getOrCreateWorker(language);
        const segPsm = documentType === 'manga' ? PSM.SPARSE_TEXT : PSM.AUTO;

        await segWorker.setParameters({
          tessedit_create_tsv: '1',
          tessedit_pageseg_mode: String(segPsm),
        } as Record<string, string>);

        sendProgress('Running OCR...', 0.3);
        const segResult = await segWorker.recognize(processedInput, undefined, {
          text: true,
          tsv: true,
        }) as TesseractResult;

        sendProgress('Analyzing regions...', 0.7);
        const segData = segResult.data;
        const { words: segWords } = parseTSV(segData.tsv || '');
        const regions = groupWordsIntoRegions(segWords, imgWidth, imgHeight, documentType);

        // Block-level fallback
        if (regions.length === 0 && segData.blocks && segData.blocks.length > 0) {
          const blockRegions = segData.blocks
            .filter(block => block.text.trim().length > 0)
            .map((block, index) => ({
              id: `block-${index}-${Date.now()}`,
              type: classifyRegion(block.text, block.bbox, block.confidence, imgWidth, imgHeight, documentType),
              box: { x: block.bbox.x0, y: block.bbox.y0, w: block.bbox.x1 - block.bbox.x0, h: block.bbox.y1 - block.bbox.y0 },
              originalText: block.text.trim(),
              confidence: block.confidence / 100,
            }))
            .filter(r => r.confidence >= CONFIG.MIN_CONFIDENCE / 100);

          self.postMessage({ type: 'SEGMENT_RESULT', id, payload: blockRegions });
          break;
        }

        // Full-page fallback
        if (regions.length === 0 && segData.text && segData.text.trim().length > 0) {
          self.postMessage({
            type: 'SEGMENT_RESULT',
            id,
            payload: [{
              id: `fallback-${Date.now()}`,
              type: 'text' as const,
              box: { x: 0, y: 0, w: imgWidth, h: imgHeight },
              originalText: segData.text.trim(),
              confidence: (segData.confidence || 50) / 100,
            }]
          });
          break;
        }

        console.log(`[Worker] SEGMENT complete: ${regions.length} regions`);
        self.postMessage({ type: 'SEGMENT_RESULT', id, payload: regions });
        break;
      }

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    console.error('[Worker] Error:', error);
    self.postMessage({
      type: 'ERROR',
      id,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export {};
