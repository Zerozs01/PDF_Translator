/**
 * ocrManhwaHeuristics.ts
 *
 * Layer 2: Heuristic OCR Filter
 * Layer 3: Spatial Box Merging Algorithm
 *
 * Designed for Korean Manhwa processed via OCR.
 */

import { BBox, OCRLine, OCRPageResult, OCRWord } from '../../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OcrBox {
  bbox: BBox;
  text: string;
  /** Recognition confidence 0-1 */
  score: number;
  originalLine: OCRLine;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function bboxToRect(bbox: BBox): Rect {
  return {
    x: bbox.x0,
    y: bbox.y0,
    w: bbox.x1 - bbox.x0,
    h: bbox.y1 - bbox.y0,
  };
}

export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.w, b.x + b.w);
  const y2 = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: x2 - x, h: y2 - y };
}

// ---------------------------------------------------------------------------
// Layer 2 — Heuristic Filter
// ---------------------------------------------------------------------------

const HANGUL_RE = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;
const VALID_TEXT_RE = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F\u4E00-\u9FFF\w]/;
const LONE_PUNCTUATION_RE = /^[\s…\.\!\?\~\-\u2026\u3001\u3002]+$/;

export interface FilterOptions {
  minHangulRatio?: number;
  minContentLength?: number;
  maxSymbolRatio?: number;
}

export function isValidOcrBox(
  box: OcrBox,
  options: FilterOptions = {}
): boolean {
  const {
    minHangulRatio = 0.0,
    minContentLength = 1,
    maxSymbolRatio = 0.6,
  } = options;

  const text = box.text.trim();

  // 1. Empty / whitespace only
  if (text.length === 0) return false;

  // 2. Pass lone punctuation (ellipsis, !, ?, etc.) — valid bubble endings
  if (LONE_PUNCTUATION_RE.test(text)) return true;

  // 3. Count character classes
  const chars = [...text]; // Unicode-safe split
  const hangulCount = chars.filter((c) => HANGUL_RE.test(c)).length;
  const validCount = chars.filter((c) => VALID_TEXT_RE.test(c)).length;
  const symbolCount = chars.filter(
    (c) => !VALID_TEXT_RE.test(c) && !/\s/.test(c)
  ).length;

  // 4. Must have minimum content length
  if (validCount < minContentLength) return false;

  // 5. Reject boxes that are predominantly garbage symbols
  const symbolRatio = symbolCount / chars.length;
  if (symbolRatio > maxSymbolRatio) return false;

  // 6. Must meet minimum Hangul ratio (guards against pure Latin/number noise)
  const hangulRatio = hangulCount / validCount;
  if (hangulRatio < minHangulRatio) {
    const hasCjk = /[\u4E00-\u9FFF]/.test(text);
    if (!hasCjk) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Layer 3 — Spatial Box Merging Algorithm
// ---------------------------------------------------------------------------

export interface MergeOptions {
  maxVerticalGap?: number;
  maxHorizontalGap?: number;
  minColumnOverlapRatio?: number;
  maxGroupHeightRatio?: number;
  pageHeight?: number;
  readingDirection?: "rtl-ttb" | "ltr-ttb";
}

export interface BoxWithRect {
  box: OcrBox;
  rect: Rect;
}

function hasColumnOverlap(a: Rect, b: Rect, minRatio: number): boolean {
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

function isVerticallyAdjacent(
  upper: Rect,
  lower: Rect,
  maxGap: number,
  minColumnOverlap: number
): boolean {
  if (upper.y > lower.y) return isVerticallyAdjacent(lower, upper, maxGap, minColumnOverlap);

  const verticalGap = lower.y - (upper.y + upper.h);
  if (verticalGap < 0 || verticalGap > maxGap) return false;

  return hasColumnOverlap(upper, lower, minColumnOverlap);
}

function isHorizontallyAdjacent(a: Rect, b: Rect, maxGap: number): boolean {
  const left = a.x < b.x ? a : b;
  const right = a.x < b.x ? b : a;
  const horizontalGap = right.x - (left.x + left.w);
  if (horizontalGap < 0 || horizontalGap > maxGap) return false;

  const topOverlap = Math.max(a.y, b.y);
  const bottomOverlap = Math.min(a.y + a.h, b.y + b.h);
  const verticalOverlap = Math.max(0, bottomOverlap - topOverlap);
  const minHeight = Math.min(a.h, b.h);

  return minHeight > 0 && verticalOverlap / minHeight >= 0.4;
}

export class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
    this.rank = new Array(size).fill(0);
  }

  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]);
    }
    return this.parent[x];
  }

  union(x: number, y: number): void {
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx === ry) return;
    if (this.rank[rx] < this.rank[ry]) {
      this.parent[rx] = ry;
    } else if (this.rank[rx] > this.rank[ry]) {
      this.parent[ry] = rx;
    } else {
      this.parent[ry] = rx;
      this.rank[rx]++;
    }
  }

  groups(): Map<number, number[]> {
    const map = new Map<number, number[]>();
    for (let i = 0; i < this.parent.length; i++) {
      const root = this.find(i);
      if (!map.has(root)) map.set(root, []);
      map.get(root)!.push(i);
    }
    return map;
  }
}

function sortGroupByReadingOrder(
  items: BoxWithRect[],
  direction: "rtl-ttb" | "ltr-ttb"
): BoxWithRect[] {
  if (items.length === 1) return items;

  const widths = items.map((i) => i.rect.w).sort((a, b) => a - b);
  const medianWidth = widths[Math.floor(widths.length / 2)];
  const colThreshold = medianWidth * 0.6;

  const sortedByX = [...items].sort((a, b) => a.rect.x - b.rect.x);
  const columns: BoxWithRect[][] = [];
  let currentCol: BoxWithRect[] = [sortedByX[0]];

  for (let i = 1; i < sortedByX.length; i++) {
    const prev = currentCol[currentCol.length - 1];
    const curr = sortedByX[i];
    const gap = curr.rect.x - (prev.rect.x + prev.rect.w);
    if (gap > colThreshold) {
      columns.push(currentCol);
      currentCol = [curr];
    } else {
      currentCol.push(curr);
    }
  }
  columns.push(currentCol);

  for (const col of columns) {
    col.sort((a, b) => a.rect.y - b.rect.y);
  }

  if (direction === "rtl-ttb") {
    columns.sort(
      (a, b) =>
        b[0].rect.x + b[0].rect.w / 2 - (a[0].rect.x + a[0].rect.w / 2)
    );
  } else {
    columns.sort(
      (a, b) =>
        a[0].rect.x + a[0].rect.w / 2 - (b[0].rect.x + b[0].rect.w / 2)
    );
  }

  return columns.flat();
}

// ---------------------------------------------------------------------------
// Pipeline Orchestrator — combines Layers 2 + 3
// ---------------------------------------------------------------------------

export interface PipelineOptions {
  filter?: FilterOptions;
  merge?: MergeOptions;
  debug?: boolean;
}

export function processKoreanManhwaPipeline(
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
    const valid = isValidOcrBox(box, filter);
    if (!valid && debug) {
      console.debug(`[ManhwaPipeline] DROPPED: "${box.text}" (score=${box.score.toFixed(3)})`);
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
  const maxVerticalGap = merge?.maxVerticalGap ?? 20;
  const maxHorizontalGap = merge?.maxHorizontalGap ?? 30;
  const minColumnOverlapRatio = merge?.minColumnOverlapRatio ?? 0.3;
  const maxGroupHeightRatio = merge?.maxGroupHeightRatio ?? 0.3;
  const pageHeight = merge?.pageHeight ?? result.height;
  const readingDirection = merge?.readingDirection ?? "rtl-ttb";

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i].rect;
      const b = items[j].rect;

      const adjacent =
        isVerticallyAdjacent(a, b, maxVerticalGap, minColumnOverlapRatio) ||
        isHorizontallyAdjacent(a, b, maxHorizontalGap);

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
    const sorted = sortGroupByReadingOrder(groupItems, readingDirection);

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

  if (readingDirection === "rtl-ttb") {
    mergedLines.sort((a, b) => {
      const aCenterX = a.bbox.x0 + (a.bbox.x1 - a.bbox.x0) / 2;
      const bCenterX = b.bbox.x0 + (b.bbox.x1 - b.bbox.x0) / 2;
      if (Math.abs(aCenterX - bCenterX) > 50) return bCenterX - aCenterX;
      return a.bbox.y0 - b.bbox.y0;
    });
  } else {
    mergedLines.sort((a, b) => {
      const aCenterX = a.bbox.x0 + (a.bbox.x1 - a.bbox.x0) / 2;
      const bCenterX = b.bbox.x0 + (b.bbox.x1 - b.bbox.x0) / 2;
      if (Math.abs(aCenterX - bCenterX) > 50) return aCenterX - bCenterX;
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
