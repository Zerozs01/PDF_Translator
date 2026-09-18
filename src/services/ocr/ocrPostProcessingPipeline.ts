/**
 * OCR Post-Processing Pipeline — Extracted from useOCRTextLayerStore
 *
 * ทำไมถึงเขียนแบบนี้: pipeline logic (split → ghost filter → Korean/Japanese → dedup)
 * เคยถูก copy-paste ซ้ำ 2 ที่ใน Store (setPageOCR / setPageOCRForEngine) ทำให้เสี่ยง diverge
 * การย้ายออกมาเป็นฟังก์ชันกลางทำให้มี single source of truth สำหรับ OCR post-processing
 *
 * [Scrutinize M2 + S5]: Extract shared pipeline → ลด code duplication ใน Store
 */

import type { OCRPageResult, OCREngine } from '../../types';
import { splitAggressiveMergedLines } from '../layers/LayerGroupingService';
import { processKoreanManhwaPipeline } from './ocrManhwaHeuristics';
import { processJapaneseVerticalPipeline, isVerticalJapaneseLayout } from './ocrJapaneseVerticalHeuristics';
import { applyPanelSafetyLineDedup } from './ocrSafetyLineDedup';
import { filterGhostOcrData } from './ghostFilter';

export interface OCRPostProcessingOptions {
  engine: OCREngine;
  dpi: number;
  /** ภาษาจาก store options — ใช้เป็น fallback เมื่อ result.language ไม่มีค่า */
  storeLanguage: string;
}

/**
 * รัน OCR post-processing pipeline ทั้งหมดบน OCRPageResult:
 * 1. Split aggressively merged lines (ถ้ายังไม่ทำ)
 * 2. Ghost noise filter (spiky balloon borders)
 * 3. Korean Manhwa pipeline (ถ้าเป็นภาษาเกาหลี)
 * 4. Japanese Vertical pipeline (ถ้าเป็นภาษาญี่ปุ่นแนวตั้ง)
 * 5. Panel-level safety line dedup
 *
 * คืนค่า processed OCRPageResult พร้อม _splitDone: true
 */
export function processOCRPageResult(
  result: OCRPageResult,
  options: OCRPostProcessingOptions
): OCRPageResult {
  // Step 1: Split aggressively merged lines (skip if already done)
  const processedLines = result._splitDone
    ? result.lines
    : splitAggressiveMergedLines(result.lines || [], 2.2);

  // Step 2: Ghost noise filter
  const {
    lines: cleanLines,
    words: cleanWords,
    droppedWords: ghostDroppedWords,
    dropCounts: ghostDropCounts,
  } = filterGhostOcrData(
    processedLines,
    result.words || [],
    options.engine,
    result.dpi || options.dpi || 300
  );

  let processed: OCRPageResult = {
    ...result,
    lines: cleanLines,
    words: cleanWords,
    _splitDone: true,
    debug: {
      ...(result.debug || {}),
      droppedWords: [
        ...(result.debug?.droppedWords || []),
        ...(ghostDroppedWords || []),
      ],
      dropCounts: {
        ...(result.debug?.dropCounts || {}),
        ...(ghostDropCounts || {}),
      },
    },
  };

  // Step 3: Korean Manhwa Pipeline
  const isKorean = String(processed.language || '').toLowerCase() === 'kor'
    || String(options.storeLanguage || '').toLowerCase() === 'kor';
  if (isKorean) {
    const koreanResult = processKoreanManhwaPipeline(processed, {
      merge: {
        maxVerticalGap: 25,
        maxHorizontalGap: 35,
        minColumnOverlapRatio: 0.3,
        maxGroupHeightRatio: 0.3,
        pageHeight: processed.height || 1200,
        readingDirection: "rtl-ttb",
      },
      debug: false
    });
    processed = { ...koreanResult, _splitDone: true };
  }

  // Step 4: Japanese Vertical Pipeline
  const isJapanese = String(processed.language || '').toLowerCase() === 'jpn'
    || String(options.storeLanguage || '').toLowerCase() === 'ja';
  if (isJapanese && isVerticalJapaneseLayout(processed.lines)) {
    const japaneseResult = processJapaneseVerticalPipeline(processed, {
      merge: {
        maxVerticalGap: 25,
        maxHorizontalGap: 18,
        minColumnOverlapRatio: 0.35,
        maxGroupHeightRatio: 0.45,
        pageHeight: processed.height || 1200,
        readingDirection: "rtl-ttb",
      },
      debug: false
    });
    processed = { ...japaneseResult, _splitDone: true };
  }

  // Step 5: Panel-level safety line dedup
  processed = { ...applyPanelSafetyLineDedup(processed), _splitDone: true };

  return processed;
}

/**
 * Returns a breakdown distribution of dropped lines by reason category
 */
export function getDroppedLineReasonDistribution(result: OCRPageResult): Record<string, number> {
  return { ...(result.debug?.dropCounts || {}) };
}

