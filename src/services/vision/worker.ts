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
import { CONFIG } from './ocr-config';
import type { BBox, OCRWord, OCRLine, TesseractResult, DocumentType } from './ocr-types';
import { hasLangCode, isCjkLanguage, isThaiLanguage, getAlphaNum, isNonLatinToken } from './ocr-text-utils';
import { preprocessImage, getImageDimensions } from './ocr-preprocessing';
import {
  parseTSV, buildLinesFromWordsByY, clampBBox,
  makeLineFromWords, mergeWordsIntoLine, findBestLineForBox,
  findBestLineBoxForLine, appendUniqueWords, rebuildLinesFromWords,
  computeLineCoverageRatio, findLargeGaps,
} from './ocr-parsing';
import {
  cleanLineNoise, buildProtectedWordSet, buildImageTileMask,
  filterWordsByImageTiles, filterWordsByBackground, filterIsolatedCjkNoise,
  filterKoreanJamoNoise, filterWeakIsolatedCjkLines,
} from './ocr-filtering';
import { findVerticalGapRegions, recognizeRegion, recognizeInChunks } from './ocr-fallback';
import { classifyRegion, groupWordsIntoRegions } from './ocr-region';

// ============================================
// Tesseract Worker State
// ============================================

let tesseractWorker: Awaited<ReturnType<typeof createWorker>> | null = null;
let currentLang = 'eng';
let isInitializing = false;

function sendProgress(status: string, progress: number, workerId?: string): void {
  self.postMessage({ type: 'OCR_PROGRESS', payload: { status, progress, workerId } });
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
      logger: m => {
        if (sendUpdates && m.status && typeof m.progress === 'number') {
          sendProgress(m.status, m.progress, m.workerId);
        }
      }
    });
    console.log(`[Worker] Tesseract initialized for: ${lang}${langPath ? ` (langPath=${langPath})` : ''}`);
    return worker;
  } catch (err) {
    console.warn(`[Worker] Failed with local langPath, retrying CDN...`, err);
    const worker = await createWorker(lang, OEM.LSTM_ONLY, {
      corePath: CONFIG.CORE_PATH,
      logger: m => {
        if (sendUpdates && m.status && typeof m.progress === 'number') {
          sendProgress(m.status, m.progress, m.workerId);
        }
      }
    });
    console.log(`[Worker] Tesseract initialized for: ${lang} (CDN fallback)`);
    return worker;
  }
}

async function getOrCreateWorker(targetLang: string): Promise<Awaited<ReturnType<typeof createWorker>>> {
  while (isInitializing) await new Promise(r => setTimeout(r, 100));

  if (!tesseractWorker || currentLang !== targetLang) {
    isInitializing = true;
    try {
      if (tesseractWorker) {
        console.log(`[Worker] Switching language ${currentLang} → ${targetLang}`);
        await tesseractWorker.terminate();
      }
      tesseractWorker = await createWorkerWithLanguage(targetLang, false);
      currentLang = targetLang;
    } finally {
      isInitializing = false;
    }
  }
  return tesseractWorker;
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
        const { imageUrl, imageWidth, imageHeight, language = 'eng', dpi = 300, pageSegMode } = payload;

        sendProgress('Preprocessing image...', 0);

        let processedInput: Blob | string = imageUrl;
        let actualWidth = Math.round(imageWidth);
        let actualHeight = Math.round(imageHeight);
        const isCjk = isCjkLanguage(language);

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
        let lines: Array<{ text: string; confidence: number; bbox: BBox; words: unknown[] }> = [];
        let parsed: ReturnType<typeof parseTSV> | null = null;

        const tooLarge = actualWidth > CONFIG.MAX_OCR_WIDTH || actualHeight > CONFIG.MAX_OCR_HEIGHT;
        if (tooLarge) {
          console.warn(`[Worker] Image too large (${actualWidth}×${actualHeight}). Chunked OCR.`);
          const chunkResult = await recognizeInChunks(worker, processedInput, actualWidth, actualHeight, CONFIG.CHUNK_OVERLAP);
          words = chunkResult.words;
          lines = chunkResult.lines as Array<{ text: string; confidence: number; bbox: BBox; words: unknown[] }>;
          data = { text: chunkResult.text, confidence: chunkResult.confidence, tsv: '' };
        } else {
          const result = await worker.recognize(processedInput as any, undefined, {
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
                const retryResult = await worker.recognize(alt.image as any, undefined, {
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

        // ── Noise filter ──
        if (lines.length > 0 && !(isCjk && words.length <= CONFIG.CJK_SKIP_NOISE_FILTER_MAX_WORDS)) {
          const cleaned = cleanLineNoise(lines);
          if (cleaned.words.length !== words.length) {
            console.log(`[Worker] Filtered noisy tokens: ${words.length - cleaned.words.length} removed`);
            words = cleaned.words;
            lines = cleaned.lines;
          }
        }

        // ── CJK vertical gap rescan ──
        if (isCjk && !tooLarge && lines.length > 0) {
          const gapRegions = findVerticalGapRegions(lines, actualWidth, actualHeight);
          if (gapRegions.length > 0) {
            let addedCount = 0;
            for (const region of gapRegions) {
              const regionWords = await recognizeRegion(worker, processedInput as Blob | string, region, Number(PSM.SPARSE_TEXT), actualWidth, actualHeight, dpi);
              const filtered = regionWords.filter(w => {
                if (w.confidence < CONFIG.CJK_VERTICAL_GAP_CONF) return false;
                return getAlphaNum(w.text.trim()).length > 0;
              });
              if (filtered.length === 0) continue;
              const added = appendUniqueWords(words, filtered, 0.55);
              if (added.length === 0) continue;
              addedCount += added.length;
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
          if (needsUnbinarized) {
            try {
              const alt = await preprocessImage(imageUrl, { binarize: false });
              fallbackInput = alt.image;
            } catch {
              fallbackInput = processedInput;
            }
          } else {
            fallbackInput = processedInput;
          }
        };

        const lineRescanMax = isCjk ? CONFIG.CJK_LINE_RESCAN_MAX : CONFIG.LATIN_LINE_RESCAN_MAX;
        if (lineRescanMax > 0 && !tooLarge && parsed && lines.length > 0 && parsed.lineBoxes.length > 0) {
          const coverageThreshold = isCjk ? CONFIG.CJK_LINE_RESCAN_COVERAGE : CONFIG.LATIN_LINE_RESCAN_COVERAGE;
          const confThreshold = isCjk ? CONFIG.CJK_LINE_RESCAN_CONF : CONFIG.LATIN_LINE_RESCAN_CONF;
          const padXMult = isCjk ? CONFIG.CJK_LINE_RESCAN_PAD_X : CONFIG.LATIN_LINE_RESCAN_PAD_X;
          const padYMult = isCjk ? CONFIG.CJK_LINE_RESCAN_PAD_Y : CONFIG.LATIN_LINE_RESCAN_PAD_Y;

          const candidates: Array<{ line: typeof lines[number]; lineBox: BBox; coverage: number }> = [];
          for (const line of lines) {
            const lineWords = (line.words as OCRWord[]) || [];
            if (lineWords.length === 0) continue;
            const lineBox = findBestLineBoxForLine(parsed.lineBoxes, line);
            if (!lineBox) continue;
            const coverage = computeLineCoverageRatio(lineWords, lineBox);
            if (coverage < coverageThreshold) candidates.push({ line, lineBox, coverage });
          }
          candidates.sort((a, b) => a.coverage - b.coverage);
          const limited = candidates.slice(0, lineRescanMax);

          if (limited.length > 0) {
            await ensureFallbackInput();
            let rescanAdded = 0;
            for (const item of limited) {
              const lineWords = (item.line.words as OCRWord[]) || [];
              if (lineWords.length === 0) continue;
              const heights = lineWords.map(w => Math.max(1, w.bbox.y1 - w.bbox.y0)).sort((a, b) => a - b);
              const medianHeight = heights[Math.floor(heights.length / 2)] || heights[0] || 1;
              const padded: BBox = {
                x0: item.lineBox.x0 - medianHeight * padXMult,
                y0: item.lineBox.y0 - medianHeight * padYMult,
                x1: item.lineBox.x1 + medianHeight * padXMult,
                y1: item.lineBox.y1 + medianHeight * padYMult
              };
              const boxW = Math.max(1, item.lineBox.x1 - item.lineBox.x0);
              const boxH = Math.max(1, item.lineBox.y1 - item.lineBox.y0);
              const linePsm = isCjk && boxH > boxW * 1.25 ? Number(PSM.SPARSE_TEXT) : Number(PSM.SINGLE_LINE);
              const regionWords = await recognizeRegion(worker, (fallbackInput ?? processedInput) as Blob | string, padded, linePsm, actualWidth, actualHeight, dpi);
              const validWords = regionWords.filter(w => {
                const raw = w.text.trim();
                if (!raw || w.confidence < confThreshold) return false;
                return getAlphaNum(raw).length > 0;
              });
              if (validWords.length === 0) continue;
              const added = appendUniqueWords(words, validWords, 0.55);
              if (added.length === 0) continue;
              rescanAdded += added.length;
              mergeWordsIntoLine(item.line, added);
            }
            if (rescanAdded > 0) {
              lines.sort((a, b) => a.bbox.y0 - b.bbox.y0);
              console.log(`[Worker] ${isCjk ? 'CJK' : 'Latin'} line rescan added ${rescanAdded} tokens`);
            }
          }
        }

        // ── Fallback OCR for empty line boxes & large gaps ──
        if (!tooLarge && parsed && words.length >= CONFIG.FALLBACK_MIN_WORDS && (parsed.lineBoxes.length > 0 || lines.length > 0)) {
          let fallbackAdded = 0;

          // Empty line boxes
          const emptyLineBoxes = parsed.lineBoxes.filter(line => !parsed.lineKeysWithWords.has(line.key));
          if (emptyLineBoxes.length > 0) {
            const limitedBoxes = emptyLineBoxes.slice(0, CONFIG.FALLBACK_MAX_EMPTY_LINES);
            await ensureFallbackInput();
            for (const lineBox of limitedBoxes) {
              const h = Math.max(1, lineBox.bbox.y1 - lineBox.bbox.y0);
              const padded: BBox = {
                x0: lineBox.bbox.x0 - h * 0.25,
                y0: lineBox.bbox.y0 - h * 0.35,
                x1: lineBox.bbox.x1 + h * 0.25,
                y1: lineBox.bbox.y1 + h * 0.35
              };
              const regionWords = await recognizeRegion(worker, (fallbackInput ?? processedInput) as Blob | string, padded, Number(PSM.SINGLE_LINE), actualWidth, actualHeight, dpi);
              const validWords = regionWords.filter(w => w.text.trim() && w.confidence >= CONFIG.FALLBACK_LINE_CONF);
              if (validWords.length === 0) continue;
              const added = appendUniqueWords(words, validWords, 0.55);
              if (added.length === 0) continue;
              fallbackAdded += added.length;
              const targetLine = findBestLineForBox(lines, padded);
              if (targetLine) mergeWordsIntoLine(targetLine, added);
              else lines.push(makeLineFromWords(added));
            }
          }

          // Large gaps within lines
          let gapBudget = 20;
          for (const line of lines) {
            if (gapBudget <= 0) break;
            const lineWords = (line.words as OCRWord[]) || [];
            if (lineWords.length === 0) continue;
            const gaps = lineWords.length >= 2 ? findLargeGaps(lineWords, isCjk) : [];
            const edgeGaps: BBox[] = [];
            const lineBox = findBestLineBoxForLine(parsed.lineBoxes, line);
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
            for (const gap of limitedGaps) {
              if (gapBudget <= 0) break;
              gapBudget -= 1;
              const gapPsm = isCjk ? Number(PSM.SINGLE_LINE) : Number(PSM.SINGLE_WORD);
              const gapWords = await recognizeRegion(worker, (fallbackInput ?? processedInput) as Blob | string, gap, gapPsm, actualWidth, actualHeight, dpi);
              const validWords = gapWords.filter(w => {
                const raw = w.text.trim();
                const gapConf = isCjk ? CONFIG.FALLBACK_GAP_CONF_CJK : CONFIG.FALLBACK_GAP_CONF;
                if (!raw || w.confidence < gapConf) return false;
                const alphaNum = getAlphaNum(raw);
                if (alphaNum.length === 0) return false;
                const nonLatin = isNonLatinToken(alphaNum);
                const maxLen = nonLatin ? CONFIG.FALLBACK_GAP_MAX_LEN_CJK : CONFIG.FALLBACK_GAP_MAX_LEN;
                return alphaNum.length <= maxLen;
              });
              if (validWords.length === 0) continue;
              const added = appendUniqueWords(words, validWords, 0.5);
              if (added.length === 0) continue;
              fallbackAdded += added.length;
              mergeWordsIntoLine(line, added);
            }
          }

          if (fallbackAdded > 0) {
            lines.sort((a, b) => a.bbox.y0 - b.bbox.y0);
            console.log(`[Worker] Fallback OCR added ${fallbackAdded} tokens`);
          }
        }

        // ── Image tile & background filters ──
        if (gray && words.length > 0) {
          const protectedWords = buildProtectedWordSet(lines);
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

          if (words.length > 0) {
            const filteredWords = filterWordsByBackground(words, gray, actualWidth, actualHeight, protectedWords);
            if (filteredWords.length !== words.length) {
              console.log(`[Worker] Filtered photo-text: ${words.length - filteredWords.length} words removed`);
              words = filteredWords;
              lines = rebuildLinesFromWords(lines, filteredWords);
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
        }

        // ── Fallback: no words from TSV but raw text exists ──
        if (words.length === 0 && data?.text && data.text.trim().length > 0) {
          console.log('[Worker] No words from TSV, creating fallback from raw text');
          const rawLines = data.text.split('\n').filter(l => l.trim().length > 0);
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
        }

        const finalText = lines.length > 0
          ? lines.map(line => line.text).filter(Boolean).join('\n')
          : (words.length > 0 ? words.map(w => w.text).join(' ') : (data?.text || ''));

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
            lines,
            words,
            text: finalText,
            confidence: data?.confidence || 0
          }
        });
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
        const segResult = await segWorker.recognize(processedInput as any, undefined, {
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
