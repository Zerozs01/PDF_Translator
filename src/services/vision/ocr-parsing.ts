/**
 * OCR Parsing — TSV parsing, word orientation, line building, bbox utilities
 */

import type { BBox, OCRWord, OCRLine } from './ocr-types';
import { normalizeOcrText, joinWordsForLanguage, getAlphaNum, isNonLatinToken } from './ocr-text-utils';

// ============================================
// Word orientation & sorting
// ============================================

export function getWordCenter(word: OCRWord): { x: number; y: number } {
  return {
    x: (word.bbox.x0 + word.bbox.x1) / 2,
    y: (word.bbox.y0 + word.bbox.y1) / 2
  };
}

/**
 * Sort words by primary reading direction using PCA on word centers.
 * Handles horizontal, vertical, and diagonal text orientations.
 */
export function sortWordsByOrientation(words: OCRWord[]): OCRWord[] {
  if (words.length <= 1) return words.slice();
  const centers = words.map(getWordCenter);
  const meanX = centers.reduce((sum, p) => sum + p.x, 0) / centers.length;
  const meanY = centers.reduce((sum, p) => sum + p.y, 0) / centers.length;
  let varX = 0;
  let varY = 0;
  let cov = 0;
  for (const p of centers) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    varX += dx * dx;
    varY += dy * dy;
    cov += dx * dy;
  }
  if (varX < 1e-3 && varY < 1e-3) return words.slice();
  // Near-vertical lines: sort by Y
  if (varX < varY * 0.1) {
    return words.slice().sort((a, b) => getWordCenter(a).y - getWordCenter(b).y);
  }
  const slope = cov / Math.max(1e-6, varX);
  const angle = Math.atan(slope);
  if (Math.abs(angle) < 0.12) {
    return words.slice().sort((a, b) => a.bbox.x0 - b.bbox.x0);
  }
  const dirX = 1 / Math.sqrt(1 + slope * slope);
  const dirY = slope * dirX;
  return words.slice().sort((a, b) => {
    const ca = getWordCenter(a);
    const cb = getWordCenter(b);
    return (ca.x * dirX + ca.y * dirY) - (cb.x * dirX + cb.y * dirY);
  });
}

// ============================================
// BBox utilities
// ============================================

export function clampBBox(bbox: BBox, width: number, height: number): BBox {
  return {
    x0: Math.max(0, Math.min(width, bbox.x0)),
    y0: Math.max(0, Math.min(height, bbox.y0)),
    x1: Math.max(0, Math.min(width, bbox.x1)),
    y1: Math.max(0, Math.min(height, bbox.y1)),
  };
}

export function bboxIoU(a: BBox, b: BBox): number {
  const ix0 = Math.max(a.x0, b.x0);
  const iy0 = Math.max(a.y0, b.y0);
  const ix1 = Math.min(a.x1, b.x1);
  const iy1 = Math.min(a.y1, b.y1);
  const iw = Math.max(0, ix1 - ix0);
  const ih = Math.max(0, iy1 - iy0);
  const inter = iw * ih;
  if (inter === 0) return 0;
  const aArea = Math.max(1, (a.x1 - a.x0) * (a.y1 - a.y0));
  const bArea = Math.max(1, (b.x1 - b.x0) * (b.y1 - b.y0));
  return inter / (aArea + bArea - inter);
}

// ============================================
// TSV Parsing
// ============================================

/**
 * Parse Tesseract TSV output for word-level data.
 * Format: level, page, block, par, line, word, left, top, width, height, conf, text
 */
export function parseTSV(tsv: string): {
  words: Array<OCRWord>;
  lines: Array<{ text: string; confidence: number; bbox: BBox; words: unknown[] }>;
  lineBoxes: Array<{ key: string; bbox: BBox }>;
  lineKeysWithWords: Set<string>;
} {
  const words: Array<OCRWord> = [];
  const lines: Array<{ text: string; confidence: number; bbox: BBox; words: unknown[] }> = [];
  const lineBoxes: Array<{ key: string; bbox: BBox }> = [];
  const lineKeysWithWords = new Set<string>();
  const lineMap = new Map<string, {
    words: Array<{ text: string; confidence: number; bbox: BBox }>;
    bbox: BBox;
    confidenceSum: number;
    confidenceCount: number;
  }>();

  if (!tsv || typeof tsv !== 'string') return { words, lines, lineBoxes, lineKeysWithWords };

  const tsvLines = tsv.split('\n').filter(line => line.trim().length > 0);
  if (tsvLines.length < 1) return { words, lines, lineBoxes, lineKeysWithWords };

  const hasHeader = tsvLines[0].toLowerCase().includes('level');
  const startIndex = hasHeader ? 1 : 0;

  const COL = { level: 0, page: 1, block: 2, par: 3, line: 4, word: 5, left: 6, top: 7, width: 8, height: 9, conf: 10, text: 11 };

  for (let i = startIndex; i < tsvLines.length; i++) {
    const cols = tsvLines[i].split('\t');
    if (cols.length < 12) continue;

    const level = parseInt(cols[COL.level] || '0');
    const text = cols.slice(COL.text).join('\t').trim();
    const left = parseInt(cols[COL.left] || '0');
    const top = parseInt(cols[COL.top] || '0');
    const width = parseInt(cols[COL.width] || '0');
    const height = parseInt(cols[COL.height] || '0');
    const conf = parseFloat(cols[COL.conf] || '0');

    const bbox: BBox = { x0: left, y0: top, x1: left + width, y1: top + height };

    // Level 5 = word
    if (level === 5) {
      const word = { text: normalizeOcrText(text), confidence: conf, bbox };
      words.push(word);

      const key = `${cols[COL.page] || '0'}-${cols[COL.block] || '0'}-${cols[COL.par] || '0'}-${cols[COL.line] || '0'}`;
      lineKeysWithWords.add(key);

      const existing = lineMap.get(key);
      if (existing) {
        existing.words.push(word);
        existing.bbox = {
          x0: Math.min(existing.bbox.x0, bbox.x0),
          y0: Math.min(existing.bbox.y0, bbox.y0),
          x1: Math.max(existing.bbox.x1, bbox.x1),
          y1: Math.max(existing.bbox.y1, bbox.y1),
        };
        if (conf >= 0) { existing.confidenceSum += conf; existing.confidenceCount += 1; }
      } else {
        lineMap.set(key, {
          words: [word],
          bbox: { ...bbox },
          confidenceSum: conf >= 0 ? conf : 0,
          confidenceCount: conf >= 0 ? 1 : 0,
        });
      }
    }

    // Level 4 = line box (keep even if text is empty)
    if (level === 4) {
      const key = `${cols[COL.page] || '0'}-${cols[COL.block] || '0'}-${cols[COL.par] || '0'}-${cols[COL.line] || '0'}`;
      lineBoxes.push({ key, bbox });
    }
  }

  // Build line objects from grouped words
  for (const [, group] of lineMap) {
    const sortedWords = sortWordsByOrientation(group.words as OCRWord[]);
    const lineText = joinWordsForLanguage(sortedWords);
    const avgConf = group.confidenceCount > 0
      ? group.confidenceSum / group.confidenceCount
      : 0;

    lines.push({ text: lineText, confidence: avgConf, bbox: group.bbox, words: sortedWords });
  }

  lines.sort((a, b) => a.bbox.y0 - b.bbox.y0);
  return { words, lines, lineBoxes, lineKeysWithWords };
}

// ============================================
// Line building & merging
// ============================================

/** Split words in a line into sub-groups when there are large horizontal gaps */
export function splitLineWords(lineWords: OCRWord[]): OCRWord[][] {
  if (lineWords.length <= 1) return [lineWords];
  const sorted = lineWords.slice().sort((a, b) => a.bbox.x0 - b.bbox.x0);

  const heights = sorted.map(w => Math.max(1, w.bbox.y1 - w.bbox.y0)).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || heights[0] || 1;
  const gapThreshold = Math.max(18, medianHeight * 2.6);

  const groups: OCRWord[][] = [];
  let current: OCRWord[] = [];
  for (const word of sorted) {
    if (current.length === 0) { current.push(word); continue; }
    const prev = current[current.length - 1];
    const gap = word.bbox.x0 - prev.bbox.x1;
    if (gap > gapThreshold) {
      groups.push(current);
      current = [word];
    } else {
      current.push(word);
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** Build line objects from a flat list of words by grouping on Y proximity */
export function buildLinesFromWordsByY(
  words: Array<OCRWord>,
  pageHeight: number
): Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }> {
  if (words.length === 0) return [];
  const sorted = [...words].sort((a, b) => {
    const yDiff = a.bbox.y0 - b.bbox.y0;
    if (Math.abs(yDiff) > 2) return yDiff;
    return a.bbox.x0 - b.bbox.x0;
  });

  const heights = sorted.map(w => Math.max(1, w.bbox.y1 - w.bbox.y0)).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || heights[0] || 1;
  const yThreshold = Math.max(4, medianHeight * 0.6, pageHeight * 0.001);

  const lines: Array<{ words: OCRWord[]; bbox: BBox; confidenceSum: number }> = [];
  for (const word of sorted) {
    const centerY = (word.bbox.y0 + word.bbox.y1) / 2;
    const last = lines[lines.length - 1];
    if (!last) {
      lines.push({ words: [word], bbox: { ...word.bbox }, confidenceSum: word.confidence });
      continue;
    }
    const lastCenterY = (last.bbox.y0 + last.bbox.y1) / 2;
    if (Math.abs(centerY - lastCenterY) > yThreshold) {
      lines.push({ words: [word], bbox: { ...word.bbox }, confidenceSum: word.confidence });
      continue;
    }
    last.words.push(word);
    last.bbox = {
      x0: Math.min(last.bbox.x0, word.bbox.x0),
      y0: Math.min(last.bbox.y0, word.bbox.y0),
      x1: Math.max(last.bbox.x1, word.bbox.x1),
      y1: Math.max(last.bbox.y1, word.bbox.y1),
    };
    last.confidenceSum += word.confidence;
  }

  return lines.map(line => {
    const sw = sortWordsByOrientation(line.words);
    return {
      text: joinWordsForLanguage(sw),
      confidence: line.confidenceSum / Math.max(1, sw.length),
      bbox: line.bbox,
      words: sw
    };
  });
}

export function makeLineFromWords(words: OCRWord[]): { text: string; confidence: number; bbox: BBox; words: OCRWord[] } {
  const sorted = sortWordsByOrientation(words.slice());
  const bbox = sorted.reduce((acc, w) => ({
    x0: Math.min(acc.x0, w.bbox.x0),
    y0: Math.min(acc.y0, w.bbox.y0),
    x1: Math.max(acc.x1, w.bbox.x1),
    y1: Math.max(acc.y1, w.bbox.y1),
  }), { ...sorted[0].bbox });
  return {
    text: joinWordsForLanguage(sorted),
    confidence: sorted.reduce((s, w) => s + w.confidence, 0) / sorted.length,
    bbox,
    words: sorted
  };
}

export function mergeWordsIntoLine(
  line: { text: string; confidence: number; bbox: BBox; words: unknown[] },
  added: OCRWord[]
): void {
  if (added.length === 0) return;
  const lineWords = (line.words as OCRWord[]).slice();
  lineWords.push(...added);
  const merged = makeLineFromWords(lineWords);
  line.text = merged.text;
  line.confidence = merged.confidence;
  line.bbox = merged.bbox;
  line.words = merged.words;
}

export function findBestLineForBox(
  lines: Array<{ text: string; confidence: number; bbox: BBox; words: unknown[] }>,
  box: BBox
): { text: string; confidence: number; bbox: BBox; words: unknown[] } | null {
  let best: typeof lines[number] | null = null;
  let bestScore = 0;
  const boxH = Math.max(1, box.y1 - box.y0);
  for (const line of lines) {
    const lineH = Math.max(1, line.bbox.y1 - line.bbox.y0);
    const overlap = Math.min(line.bbox.y1, box.y1) - Math.max(line.bbox.y0, box.y0);
    if (overlap <= 0) continue;
    const score = overlap / Math.min(lineH, boxH);
    if (score > bestScore) { bestScore = score; best = line; }
  }
  return bestScore >= 0.4 ? best : null;
}

export function findBestLineBoxForLine(
  lineBoxes: Array<{ key: string; bbox: BBox }>,
  line: { bbox: BBox }
): BBox | null {
  let best: BBox | null = null;
  let bestScore = 0;
  const lineH = Math.max(1, line.bbox.y1 - line.bbox.y0);
  for (const candidate of lineBoxes) {
    const box = candidate.bbox;
    const boxH = Math.max(1, box.y1 - box.y0);
    const overlap = Math.min(line.bbox.y1, box.y1) - Math.max(line.bbox.y0, box.y0);
    if (overlap <= 0) continue;
    const score = overlap / Math.min(lineH, boxH);
    if (score > bestScore) { bestScore = score; best = box; }
  }
  return bestScore >= 0.45 ? best : null;
}

export function appendUniqueWords(existing: OCRWord[], incoming: OCRWord[], iouThreshold: number = 0.6): OCRWord[] {
  const added: OCRWord[] = [];
  for (const w of incoming) {
    let overlap = false;
    for (const e of existing) {
      if (bboxIoU(e.bbox, w.bbox) >= iouThreshold) { overlap = true; break; }
    }
    if (!overlap) { existing.push(w); added.push(w); }
  }
  return added;
}

/** Rebuild lines from a filtered word set, splitting on large gaps */
export function rebuildLinesFromWords(
  lines: Array<OCRLine>,
  words: Array<OCRWord>
): Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }> {
  const wordSet = new Set(words);
  const rebuilt: Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }> = [];
  for (const line of lines) {
    const lineWords = (line.words as OCRWord[]).filter(w => wordSet.has(w));
    if (lineWords.length === 0) continue;

    const nonLatinCount = lineWords.reduce((count, w) => {
      const token = getAlphaNum((w.text || '').trim());
      return count + (token && isNonLatinToken(token) ? 1 : 0);
    }, 0);
    const mostlyNonLatin = nonLatinCount / Math.max(1, lineWords.length) >= 0.5;
    const groups = mostlyNonLatin ? [lineWords] : splitLineWords(lineWords);
    for (const group of groups) {
      if (group.length === 0) continue;
      const sortedGroup = sortWordsByOrientation(group);
      const bbox = sortedGroup.reduce((acc, w) => ({
        x0: Math.min(acc.x0, w.bbox.x0),
        y0: Math.min(acc.y0, w.bbox.y0),
        x1: Math.max(acc.x1, w.bbox.x1),
        y1: Math.max(acc.y1, w.bbox.y1)
      }), { ...sortedGroup[0].bbox });

      rebuilt.push({
        text: joinWordsForLanguage(sortedGroup),
        confidence: sortedGroup.reduce((s, w) => s + w.confidence, 0) / sortedGroup.length,
        bbox,
        words: sortedGroup
      });
    }
  }
  return rebuilt.sort((a, b) => a.bbox.y0 - b.bbox.y0);
}

/** Compute how much of a line box is covered by recognised words */
export function computeLineCoverageRatio(lineWords: OCRWord[], lineBox: BBox): number {
  if (lineWords.length === 0) return 0;
  const boxW = Math.max(1, lineBox.x1 - lineBox.x0);
  const boxH = Math.max(1, lineBox.y1 - lineBox.y0);
  const horizontal = boxW >= boxH * 1.2;
  const axisLength = horizontal ? boxW : boxH;
  const axisThickness = horizontal ? boxH : boxW;
  const intervals: Array<{ start: number; end: number }> = [];

  for (const word of lineWords) {
    const overlap = horizontal
      ? Math.min(word.bbox.y1, lineBox.y1) - Math.max(word.bbox.y0, lineBox.y0)
      : Math.min(word.bbox.x1, lineBox.x1) - Math.max(word.bbox.x0, lineBox.x0);
    if (overlap / Math.max(1, axisThickness) < 0.2) continue;
    const start = horizontal ? Math.max(lineBox.x0, word.bbox.x0) : Math.max(lineBox.y0, word.bbox.y0);
    const end = horizontal ? Math.min(lineBox.x1, word.bbox.x1) : Math.min(lineBox.y1, word.bbox.y1);
    if (end > start) intervals.push({ start, end });
  }

  if (intervals.length === 0) return 0;
  intervals.sort((a, b) => a.start - b.start);
  let covered = 0;
  let cs = intervals[0].start;
  let ce = intervals[0].end;
  for (let i = 1; i < intervals.length; i++) {
    const seg = intervals[i];
    if (seg.start <= ce) { ce = Math.max(ce, seg.end); }
    else { covered += Math.max(0, ce - cs); cs = seg.start; ce = seg.end; }
  }
  covered += Math.max(0, ce - cs);
  return Math.max(0, Math.min(1, covered / axisLength));
}

/** Find large horizontal gaps within a line's words */
export function findLargeGaps(lineWords: OCRWord[], isCjk: boolean = false): Array<BBox> {
  if (lineWords.length < 2) return [];
  const sorted = lineWords.slice().sort((a, b) => a.bbox.x0 - b.bbox.x0);
  const heights = sorted.map(w => Math.max(1, w.bbox.y1 - w.bbox.y0)).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || heights[0] || 1;

  const gapValues: number[] = [];
  const gaps: Array<{ gap: number; left: OCRWord; right: OCRWord; medianHeight: number }> = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1].bbox.x0 - sorted[i].bbox.x1;
    if (gap > 0) {
      gapValues.push(gap);
      gaps.push({ gap, left: sorted[i], right: sorted[i + 1], medianHeight });
    }
  }
  if (gapValues.length === 0) return [];
  gapValues.sort((a, b) => a - b);
  const medianGap = gapValues[Math.floor(gapValues.length / 2)] || 0;

  // Import CONFIG values inline to avoid circular deps
  const gapMult = isCjk ? 1.1 : 1.6;
  const heightMult = isCjk ? 0.6 : 0.9;
  const threshold = Math.max(12, medianGap * gapMult, medianHeight * heightMult);
  const padRatio = 0.25;

  const regions: BBox[] = [];
  for (const g of gaps) {
    if (g.gap <= threshold) continue;
    const padY = g.medianHeight * padRatio;
    const padX = g.medianHeight * padRatio;
    regions.push({
      x0: g.left.bbox.x1 - padX,
      y0: Math.min(g.left.bbox.y0, g.right.bbox.y0) - padY,
      x1: g.right.bbox.x0 + padX,
      y1: Math.max(g.left.bbox.y1, g.right.bbox.y1) + padY
    });
  }
  return regions;
}
