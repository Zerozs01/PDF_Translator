/**
 * ocrJapaneseVerticalHeuristics.ts
 *
 * Layer 2: Heuristic OCR Filter for Japanese
 * Layer 3: Spatial Box Merging Algorithm for Japanese Vertical Text (RTL-TTB)
 */

import { BBox, OCRLine, OCRPageResult, OCRWord } from '../../types';
import { bboxToRect, Rect, unionRect, UnionFind, BoxWithRect, OcrBox } from './ocrManhwaHeuristics';

// ---------------------------------------------------------------------------
// Constants & RegExp
// ---------------------------------------------------------------------------

const JAPANESE_RE = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/;
const VALID_TEXT_RE = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\w]/;
const LONE_PUNCTUATION_RE = /^[\s…\.\!\?\~\-\u2026\u3001\u3002\uFF0C\uFF0E\u300c\u300d\u300e\u300f]+$/;

export interface FilterOptions {
  minJapaneseRatio?: number;
  minContentLength?: number;
  maxSymbolRatio?: number;
}

// ---------------------------------------------------------------------------
// Layer 2 — Heuristic Filter
// ---------------------------------------------------------------------------

export function isValidOcrBoxJapanese(
  box: OcrBox,
  options: FilterOptions = {}
): boolean {
  const {
    minJapaneseRatio = 0.0,
    minContentLength = 1,
    maxSymbolRatio = 0.6,
  } = options;

  const text = box.text.trim();

  // 1. Empty check
  if (text.length === 0) return false;

  // 2. Pass lone punctuation (manga bubbles often contain exclamation marks, etc.)
  if (LONE_PUNCTUATION_RE.test(text)) return true;

  // 3. Count character classes
  const chars = [...text];
  const jaCount = chars.filter((c) => JAPANESE_RE.test(c)).length;
  const validCount = chars.filter((c) => VALID_TEXT_RE.test(c)).length;
  const symbolCount = chars.filter(
    (c) => !VALID_TEXT_RE.test(c) && !/\s/.test(c)
  ).length;

  if (validCount < minContentLength) return false;

  const symbolRatio = symbolCount / chars.length;
  if (symbolRatio > maxSymbolRatio) return false;

  const jaRatio = jaCount / validCount;
  if (jaRatio < minJapaneseRatio) {
    // Check if it has any Chinese chars (often shared in Japanese Kanji)
    const hasCjk = /[\u4E00-\u9FFF]/.test(text);
    if (!hasCjk) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Layer 3 — Spatial Box Merging for Japanese Vertical Text
// ---------------------------------------------------------------------------

export interface MergeOptions {
  maxVerticalGap?: number; // fallback absolute pixels
  maxHorizontalGap?: number; // fallback absolute pixels
  minColumnOverlapRatio?: number;
  maxGroupHeightRatio?: number;
  pageHeight?: number;
  readingDirection?: "rtl-ttb" | "ltr-ttb";
}

/**
 * Checks if box A and B overlap vertically in a column-like structure.
 * For vertical text, columns are aligned horizontally, so they should share X coordinate.
 */
function hasColumnOverlapJA(a: Rect, b: Rect, minRatio: number): boolean {
  const aLeft = a.x;
  const aRight = a.x + a.w;
  const bLeft = b.x;
  const bRight = b.x + b.w;

  const overlapLeft = Math.max(aLeft, bLeft);
  const overlapRight = Math.min(aRight, bRight);
  const overlapWidth = Math.max(0, overlapRight - overlapLeft);

  const narrowerWidth = Math.min(a.w, b.w);
  if (narrowerWidth === 0) return false;

  return overlapWidth / narrowerWidth >= minRatio;
}

/**
 * Checks if lower is vertically below upper with a dynamic threshold based on character size.
 * Japanese vertical text character spacing is tighter.
 */
function isVerticallyAdjacentJA(
  upper: Rect,
  lower: Rect,
  maxGap: number,
  minColumnOverlap: number
): boolean {
  if (upper.y > lower.y) return isVerticallyAdjacentJA(lower, upper, maxGap, minColumnOverlap);

  const verticalGap = lower.y - (upper.y + upper.h);
  
  // Dynamic gap threshold: JA vertical characters are usually squares (height ~ width).
  // Use a ratio of their width/height to make gap checks scale-invariant.
  const charHeight = Math.min(upper.h, lower.h);
  const dynamicMaxGap = Math.max(maxGap, charHeight * 0.85);

  if (verticalGap < 0 || verticalGap > dynamicMaxGap) return false;

  return hasColumnOverlapJA(upper, lower, minColumnOverlap);
}

/**
 * Furigana Detection & Adjacency:
 * Furigana boxes are very small (height < 50% of the adjacent kanji column)
 * and sit immediately to the right (in RTL vertical layouts) or left of the main column.
 */
function isFuriganaAdjacency(a: Rect, b: Rect): boolean {
  const heightRatio = a.h > 0 && b.h > 0 ? Math.min(a.h, b.h) / Math.max(a.h, b.h) : 1;
  const widthRatio = a.w > 0 && b.w > 0 ? Math.min(a.w, b.w) / Math.max(a.w, b.w) : 1;
  
  // Furigana is significantly smaller in height or width, or both
  if (heightRatio > 0.65 && widthRatio > 0.65) return false;

  const leftBox = a.x < b.x ? a : b;
  const rightBox = a.x < b.x ? b : a;

  // Horizontal distance between them
  const hGap = rightBox.x - (leftBox.x + leftBox.w);
  
  // Vertical overlap ratio
  const topOverlap = Math.max(a.y, b.y);
  const bottomOverlap = Math.min(a.y + a.h, b.y + b.h);
  const vOverlap = Math.max(0, bottomOverlap - topOverlap);
  const minHeight = Math.min(a.h, b.h);

  // If they are side-by-side (hGap is small) and overlap vertically (vOverlap/minHeight is high)
  const isAdjacent = hGap >= -10 && hGap <= Math.max(15, minHeight * 0.6) && (minHeight > 0 && vOverlap / minHeight >= 0.5);
  return isAdjacent;
}

/**
 * Sorts boxes in vertical columns. 
 * Japanese columns are read Right-to-Left (RTL), and Top-to-Bottom (TTB) within each column.
 */
function sortJapaneseGroupByReadingOrder(
  items: BoxWithRect[],
  direction: "rtl-ttb" | "ltr-ttb"
): BoxWithRect[] {
  if (items.length === 1) return items;

  // 1. Determine column boundaries. Since columns are vertical, X coordinate indicates columns.
  // Cluster boxes by X-center value.
  const sortedByX = [...items].sort((a, b) => (a.rect.x + a.rect.w / 2) - (b.rect.x + b.rect.w / 2));
  
  // Calculate average character width/height to guide tolerance
  const avgWidth = items.reduce((sum, i) => sum + i.rect.w, 0) / items.length;
  const colThreshold = avgWidth * 0.45; // Column gap threshold

  const columns: BoxWithRect[][] = [];
  let currentCol: BoxWithRect[] = [sortedByX[0]];

  for (let i = 1; i < sortedByX.length; i++) {
    const prev = currentCol[currentCol.length - 1];
    const curr = sortedByX[i];
    const prevCenter = prev.rect.x + prev.rect.w / 2;
    const currCenter = curr.rect.x + curr.rect.w / 2;
    const gap = currCenter - prevCenter;

    if (gap > colThreshold) {
      columns.push(currentCol);
      currentCol = [curr];
    } else {
      currentCol.push(curr);
    }
  }
  columns.push(currentCol);

  // 2. Sort within each column (Top to Bottom)
  for (const col of columns) {
    col.sort((a, b) => a.rect.y - b.rect.y);
  }

  // 3. Sort columns themselves (Right to Left for Japanese RTL, Left to Right otherwise)
  if (direction === "rtl-ttb") {
    // Right columns first (descending X-center)
    columns.sort((a, b) => {
      const aCenter = a[0].rect.x + a[0].rect.w / 2;
      const bCenter = b[0].rect.x + b[0].rect.w / 2;
      return bCenter - aCenter;
    });
  } else {
    // Left columns first (ascending X-center)
    columns.sort((a, b) => {
      const aCenter = a[0].rect.x + a[0].rect.w / 2;
      const bCenter = b[0].rect.x + b[0].rect.w / 2;
      return aCenter - bCenter;
    });
  }

  return columns.flat();
}

/**
 * Detects if a set of OCR boxes represents a vertical Japanese layout.
 * Aspect ratio height/width > 1.3 is indicative of vertical columns.
 */
export function isVerticalJapaneseLayout(lines: OCRLine[]): boolean {
  if (!lines || lines.length < 2) return false;
  
  let verticalCount = 0;
  let jpCount = 0;
  
  for (const line of lines) {
    const text = line.text || '';
    if (JAPANESE_RE.test(text)) {
      jpCount++;
    }
    const bbox = line.bbox;
    if (bbox) {
      const w = bbox.x1 - bbox.x0;
      const h = bbox.y1 - bbox.y0;
      // Height is noticeably larger than width for vertical boxes
      if (h / Math.max(1, w) >= 1.25) {
        verticalCount++;
      }
    }
  }
  
  // If at least 35% of the CJK lines are vertical, treat the page as vertical Japanese
  return jpCount > 0 && (verticalCount / lines.length) >= 0.35;
}

// ---------------------------------------------------------------------------
// Pipeline Orchestrator — processJapaneseVerticalPipeline
// ---------------------------------------------------------------------------

export interface PipelineOptions {
  filter?: FilterOptions;
  merge?: MergeOptions;
  debug?: boolean;
}

export function processJapaneseVerticalPipeline(
  result: OCRPageResult,
  options: PipelineOptions = {}
): OCRPageResult {
  const { filter, merge, debug = false } = options;

  if (!result.lines || result.lines.length === 0) {
    return result;
  }

  const boxes: OcrBox[] = result.lines.map((line) => ({
    bbox: line.bbox,
    text: line.text,
    score: line.confidence / 100.0,
    originalLine: line,
  }));

  const filteredBoxes = boxes.filter((box) => {
    const valid = isValidOcrBoxJapanese(box, filter);
    if (!valid && debug) {
      console.debug(`[JA-VerticalPipeline] DROPPED: "${box.text}" (score=${box.score.toFixed(3)})`);
    }
    return valid;
  });

  if (filteredBoxes.length === 0) {
    return {
      ...result,
      lines: [],
      words: [],
      text: "",
      confidence: 0,
    };
  }

  const items: BoxWithRect[] = filteredBoxes.map((box) => ({
    box,
    rect: bboxToRect(box.bbox),
  }));

  const uf = new UnionFind(items.length);
  const maxVerticalGap = merge?.maxVerticalGap ?? 25;
  const maxHorizontalGap = merge?.maxHorizontalGap ?? 18;
  const minColumnOverlapRatio = merge?.minColumnOverlapRatio ?? 0.35;
  const maxGroupHeightRatio = merge?.maxGroupHeightRatio ?? 0.45;
  const pageHeight = merge?.pageHeight ?? result.height;
  const readingDirection = merge?.readingDirection ?? "rtl-ttb";

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i].rect;
      const b = items[j].rect;

      const adjacent =
        isVerticallyAdjacentJA(a, b, maxVerticalGap, minColumnOverlapRatio) ||
        isFuriganaAdjacency(a, b);

      if (adjacent) {
        if (pageHeight !== undefined) {
          const mergedRect = unionRect(a, b);
          if (mergedRect.h / pageHeight > maxGroupHeightRatio) continue;
        }
        uf.union(i, j);
      }
    }
  }

  const mergedLines: OCRLine[] = [];

  for (const [, indices] of uf.groups()) {
    const groupItems = indices.map((i) => items[i]);
    
    // Sort vertical Japanese groups Right-to-Left, Top-to-Bottom
    const sorted = sortJapaneseGroupByReadingOrder(groupItems, readingDirection);

    const text = sorted
      .map((item) => item.box.text.trim())
      .filter(Boolean)
      .join("\n");

    const boundingRect = sorted
      .map((item) => item.rect)
      .reduce(unionRect);

    const avgScore =
      groupItems.reduce((sum, item) => sum + item.box.originalLine.confidence, 0) /
      groupItems.length;

    const words: OCRWord[] = [];
    for (const item of sorted) {
      if (item.box.originalLine.words) {
        words.push(...item.box.originalLine.words);
      }
    }

    const bbox = {
      x0: boundingRect.x,
      y0: boundingRect.y,
      x1: boundingRect.x + boundingRect.w,
      y1: boundingRect.y + boundingRect.h,
    };

    const sourceEngine = sorted[0]?.box.originalLine.sourceEngine;
    const angleDeg = sorted[0]?.box.originalLine.angleDeg;
    const quad = sorted[0]?.box.originalLine.quad;

    mergedLines.push({
      text,
      confidence: avgScore,
      bbox,
      words,
      ...(angleDeg !== undefined ? { angleDeg } : {}),
      ...(quad ? { quad } : {}),
      ...(sourceEngine ? { sourceEngine } : {}),
      sortHintX: bbox.x0,
      sortHintY: bbox.y0,
      _sortX: bbox.x0,
      _sortY: bbox.y0,
    });
  }

  // Sort overall page blocks from Right to Left for vertical reading flow
  if (readingDirection === "rtl-ttb") {
    mergedLines.sort((a, b) => {
      const aCenterX = a.bbox.x0 + (a.bbox.x1 - a.bbox.x0) / 2;
      const bCenterX = b.bbox.x0 + (b.bbox.x1 - b.bbox.x0) / 2;
      // If they are on distinct columns (horizontal gap > 40px), read right-most column first
      if (Math.abs(aCenterX - bCenterX) > 40) return bCenterX - aCenterX;
      // In the same column-band, read top-most block first
      return a.bbox.y0 - b.bbox.y0;
    });
  } else {
    mergedLines.sort((a, b) => {
      const aCenterX = a.bbox.x0 + (a.bbox.x1 - a.bbox.x0) / 2;
      const bCenterX = b.bbox.x0 + (b.bbox.x1 - b.bbox.x0) / 2;
      if (Math.abs(aCenterX - bCenterX) > 40) return aCenterX - bCenterX;
      return a.bbox.y0 - b.bbox.y0;
    });
  }

  const allWords: OCRWord[] = [];
  for (const line of mergedLines) {
    allWords.push(...line.words);
  }

  const fullText = mergedLines.map((line) => line.text).join("\n");
  const overallConfidence = mergedLines.length > 0
    ? mergedLines.reduce((sum, line) => sum + line.confidence, 0) / mergedLines.length
    : 0;

  return {
    ...result,
    lines: mergedLines,
    words: allWords,
    text: fullText,
    confidence: overallConfidence,
  };
}
