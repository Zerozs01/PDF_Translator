/**
 * OCR Filtering — noise cleanup, image tile mask, background variance filter
 *
 * Phase A changes:
 * - Added logDrop() calls at every filter drop point (A6)
 * - Thresholds tuned in ocr-config.ts (A2, A3)
 */

import { CONFIG, logDrop } from './ocr-config';
import type { BBox, OCRWord, OCRLine } from './ocr-types';
import { getAlphaNum, isNonLatinToken, joinWordsForLanguage } from './ocr-text-utils';
import { sortWordsByOrientation } from './ocr-parsing';

// ============================================
// Background variance
// ============================================

export function computeBackgroundVariance(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  rect: { x0: number; y0: number; x1: number; y1: number },
  inner: { x0: number; y0: number; x1: number; y1: number },
  grid: number = 5
): number {
  const x0 = Math.max(0, Math.min(width - 1, Math.round(rect.x0)));
  const y0 = Math.max(0, Math.min(height - 1, Math.round(rect.y0)));
  const x1 = Math.max(0, Math.min(width - 1, Math.round(rect.x1)));
  const y1 = Math.max(0, Math.min(height - 1, Math.round(rect.y1)));
  if (x1 <= x0 || y1 <= y0) return 0;

  const inX0 = Math.max(0, Math.min(width - 1, Math.round(inner.x0)));
  const inY0 = Math.max(0, Math.min(height - 1, Math.round(inner.y0)));
  const inX1 = Math.max(0, Math.min(width - 1, Math.round(inner.x1)));
  const inY1 = Math.max(0, Math.min(height - 1, Math.round(inner.y1)));

  const stepX = (x1 - x0) / (grid + 1);
  const stepY = (y1 - y0) / (grid + 1);

  let count = 0, sum = 0, sumSq = 0;
  for (let gy = 1; gy <= grid; gy++) {
    for (let gx = 1; gx <= grid; gx++) {
      const x = Math.round(x0 + stepX * gx);
      const y = Math.round(y0 + stepY * gy);
      if (x >= inX0 && x <= inX1 && y >= inY0 && y <= inY1) continue;
      const v = gray[y * width + x] || 0;
      count++; sum += v; sumSq += v * v;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return (sumSq / count) - (mean * mean);
}

export function getWordBackgroundVariance(
  word: OCRWord, gray: Uint8ClampedArray, width: number, height: number
): number {
  const h = Math.max(1, word.bbox.y1 - word.bbox.y0);
  const pad = Math.max(2, Math.round(h * 0.6));
  const rect = { x0: word.bbox.x0 - pad, y0: word.bbox.y0 - pad, x1: word.bbox.x1 + pad, y1: word.bbox.y1 + pad };
  const innerPad = Math.max(1, Math.round(h * 0.15));
  const inner = { x0: word.bbox.x0 - innerPad, y0: word.bbox.y0 - innerPad, x1: word.bbox.x1 + innerPad, y1: word.bbox.y1 + innerPad };
  return computeBackgroundVariance(gray, width, height, rect, inner);
}

// ============================================
// Photo background filter
// ============================================

export function filterWordsByBackground(
  words: Array<OCRWord>,
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  protectedWords?: Set<OCRWord>
): Array<OCRWord> {
  return words.filter(word => {
    if (protectedWords?.has(word)) return true;
    const h = word.bbox.y1 - word.bbox.y0;
    const heightRatio = h / Math.max(1, height);

    const pad = Math.max(2, Math.round(h * 0.6));
    const rect = { x0: word.bbox.x0 - pad, y0: word.bbox.y0 - pad, x1: word.bbox.x1 + pad, y1: word.bbox.y1 + pad };
    const innerPad = Math.max(1, Math.round(h * 0.15));
    const inner = { x0: word.bbox.x0 - innerPad, y0: word.bbox.y0 - innerPad, x1: word.bbox.x1 + innerPad, y1: word.bbox.y1 + innerPad };
    const variance = computeBackgroundVariance(gray, width, height, rect, inner);

    const alphaNum = getAlphaNum(word.text.trim());
    const nonLatin = isNonLatinToken(alphaNum);

    // Keep larger words (titles) even on photo backgrounds
    if (heightRatio >= 0.06) return true;

    if (variance > CONFIG.PHOTO_BG_VARIANCE) {
      const small = heightRatio < CONFIG.PHOTO_FILTER_MIN_HEIGHT_RATIO;
      const lowConf = word.confidence < CONFIG.PHOTO_FILTER_MIN_CONFIDENCE;
      const shortToken = alphaNum.length > 0 && alphaNum.length <= 3;
      if (small && lowConf) {
        logDrop('bgVariance', word, `small(${heightRatio.toFixed(3)}) + lowConf + variance=${variance.toFixed(0)}`);
        return false;
      }
      if (nonLatin) {
        // CJK false positives often come as short tokens on detailed/photo backgrounds.
        if ((small || shortToken) && word.confidence < CONFIG.PHOTO_FILTER_MIN_CONFIDENCE_CJK) {
          logDrop('bgVariance', word, `CJK short/small + conf<${CONFIG.PHOTO_FILTER_MIN_CONFIDENCE_CJK} + variance=${variance.toFixed(0)}`);
          return false;
        }
        if (variance > CONFIG.PHOTO_BG_VARIANCE * 1.35 && shortToken && word.confidence < CONFIG.IMG_TILE_DROP_CONF_CJK) {
          logDrop('bgVariance', word, `CJK high-variance short token conf=${word.confidence.toFixed(0)}`);
          return false;
        }
      }
    }
    return true;
  });
}

// ============================================
// Protected words
// ============================================

export function buildProtectedWordSet(lines: Array<OCRLine>): Set<OCRWord> {
  const protectedWords = new Set<OCRWord>();
  for (const line of lines) {
    const lineWords = (line.words as OCRWord[]) || [];
    if (lineWords.length === 0) continue;
    if (lineWords.length >= CONFIG.IMG_PROTECT_LINE_WORDS || line.confidence >= CONFIG.IMG_PROTECT_LINE_CONF) {
      for (const word of lineWords) protectedWords.add(word);
    }
  }
  return protectedWords;
}

// ============================================
// Image tile mask
// ============================================

export function buildImageTileMask(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  words: Array<OCRWord>
): { mask: Uint8Array; tileSize: number; cols: number; rows: number; imageTiles: number; totalTiles: number } | null {
  if (!gray || gray.length < width * height) return null;

  const baseSize = Math.round(Math.min(width, height) / 40);
  const tileSize = Math.max(CONFIG.IMG_TILE_SIZE_MIN, Math.min(CONFIG.IMG_TILE_SIZE_MAX, baseSize));
  const cols = Math.ceil(width / tileSize);
  const rows = Math.ceil(height / tileSize);
  const totalTiles = cols * rows;

  const sum = new Float64Array(totalTiles);
  const sumSq = new Float64Array(totalTiles);
  const edge = new Float64Array(totalTiles);
  const mid = new Uint32Array(totalTiles);
  const samples = new Uint32Array(totalTiles);

  const step = Math.max(1, CONFIG.IMG_TILE_SAMPLE_STEP);
  for (let y = 0; y < height; y += step) {
    const row = Math.min(rows - 1, (y / tileSize) | 0);
    const yIdx = y * width;
    for (let x = 0; x < width; x += step) {
      const col = Math.min(cols - 1, (x / tileSize) | 0);
      const idx = row * cols + col;
      const v = gray[yIdx + x] || 0;
      sum[idx] += v;
      sumSq[idx] += v * v;
      samples[idx] += 1;
      if (v >= CONFIG.IMG_TILE_MID_LOW && v <= CONFIG.IMG_TILE_MID_HIGH) mid[idx] += 1;
      if (x + step < width) edge[idx] += Math.abs(v - (gray[yIdx + x + step] || 0));
      if (y + step < height) edge[idx] += Math.abs(v - (gray[(y + step) * width + x] || 0));
    }
  }

  const wordCount = new Uint16Array(totalTiles);
  const confSum = new Float32Array(totalTiles);
  const areaSum = new Float32Array(totalTiles);

  for (const word of words) {
    const cx = (word.bbox.x0 + word.bbox.x1) / 2;
    const cy = (word.bbox.y0 + word.bbox.y1) / 2;
    if (cx < 0 || cy < 0 || cx > width || cy > height) continue;
    const col = Math.min(cols - 1, Math.max(0, (cx / tileSize) | 0));
    const row = Math.min(rows - 1, Math.max(0, (cy / tileSize) | 0));
    const idx = row * cols + col;
    wordCount[idx] += 1;
    confSum[idx] += word.confidence;
    areaSum[idx] += Math.max(0, (word.bbox.x1 - word.bbox.x0) * (word.bbox.y1 - word.bbox.y0));
  }

  let mask = new Uint8Array(totalTiles);
  let imageTiles = 0;

  for (let idx = 0; idx < totalTiles; idx++) {
    if (samples[idx] === 0) continue;
    const mean = sum[idx] / samples[idx];
    const variance = (sumSq[idx] / samples[idx]) - (mean * mean);
    const midRatio = mid[idx] / samples[idx];
    const edgeAvg = edge[idx] / samples[idx];

    const wc = wordCount[idx];
    const avgConf = wc > 0 ? confSum[idx] / wc : 0;
    const coverage = areaSum[idx] / (tileSize * tileSize);

    // Don't let a single weak token mark a tile as text-likely.
    const textLikely = wc >= (CONFIG.IMG_TEXT_WORDS_MIN + 1)
      || (wc >= CONFIG.IMG_TEXT_WORDS_MIN
        && (coverage >= CONFIG.IMG_TEXT_COVERAGE_MIN || avgConf >= CONFIG.IMG_TEXT_CONF_MIN));

    const imageLikely = (midRatio >= CONFIG.IMG_MID_RATIO && variance >= CONFIG.IMG_VARIANCE)
      || (edgeAvg >= CONFIG.IMG_EDGE && variance >= CONFIG.IMG_EDGE_VARIANCE);

    if (imageLikely && !textLikely) {
      mask[idx] = 1;
      imageTiles += 1;
    }
  }

  if (CONFIG.IMG_HOLE_FILL_MIN > 0) {
    const filled = mask.slice();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (mask[idx] === 1) continue;
        if (wordCount[idx] > 0) continue;
        let neighbors = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nr = r + dy, nc = c + dx;
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
            if (mask[nr * cols + nc] === 1) neighbors += 1;
          }
        }
        if (neighbors >= CONFIG.IMG_HOLE_FILL_MIN) {
          filled[idx] = 1;
          imageTiles += 1;
        }
      }
    }
    mask = filled;
  }

  return { mask, tileSize, cols, rows, imageTiles, totalTiles };
}

// ============================================
// Image tile word filter
// ============================================

export function filterWordsByImageTiles(
  words: Array<OCRWord>,
  maskInfo: { mask: Uint8Array; tileSize: number; cols: number; rows: number },
  width: number,
  height: number,
  protectedWords?: Set<OCRWord>,
  gray?: Uint8ClampedArray
): Array<OCRWord> {
  const { mask, tileSize, cols, rows } = maskInfo;
  return words.filter(word => {
    const h = word.bbox.y1 - word.bbox.y0;
    const heightRatio = h / Math.max(1, height);
    if (heightRatio >= CONFIG.IMG_KEEP_LARGE_TEXT_RATIO && word.confidence >= CONFIG.IMG_KEEP_LARGE_TEXT_CONF) return true;
    if (protectedWords?.has(word)) return true;

    const col0 = Math.min(cols - 1, Math.max(0, Math.floor(word.bbox.x0 / tileSize)));
    const col1 = Math.min(cols - 1, Math.max(0, Math.floor(word.bbox.x1 / tileSize)));
    const row0 = Math.min(rows - 1, Math.max(0, Math.floor(word.bbox.y0 / tileSize)));
    const row1 = Math.min(rows - 1, Math.max(0, Math.floor(word.bbox.y1 / tileSize)));

    let inImageTile = false;
    for (let r = row0; r <= row1 && !inImageTile; r++) {
      for (let c = col0; c <= col1; c++) {
        if (mask[r * cols + c] === 1) { inImageTile = true; break; }
      }
    }

    const raw = word.text.trim();
    const alphaNum = getAlphaNum(raw);
    const len = alphaNum.length;
    const nonLatin = isNonLatinToken(alphaNum);
    const boxW = Math.max(1, word.bbox.x1 - word.bbox.x0);
    const boxH = Math.max(1, word.bbox.y1 - word.bbox.y0);
    const aspect = boxW / boxH;

    if (inImageTile) {
      if (!nonLatin && len > 0 && len <= CONFIG.IMG_TILE_DROP_MAX_LEN
        && heightRatio <= CONFIG.IMG_TILE_DROP_HEIGHT_RATIO
        && word.confidence < CONFIG.IMG_TILE_DROP_CONF) {
        logDrop('imgTile', word, `latin short len=${len} hr=${heightRatio.toFixed(3)}`);
        return false;
      }
      if (nonLatin && !protectedWords?.has(word)) {
        if (gray) {
          const variance = getWordBackgroundVariance(word, gray, width, height);
          if (variance <= CONFIG.PHOTO_BG_VARIANCE) return true; // clean background → keep
        }
        const shortToken = len > 0 && len <= 3;
        if (word.confidence < CONFIG.IMG_TILE_DROP_CONF_CJK
          && (heightRatio <= CONFIG.IMG_TILE_DROP_HEIGHT_RATIO_CJK || shortToken)) {
          logDrop('imgTile', word, `CJK low conf=${word.confidence.toFixed(0)} hr=${heightRatio.toFixed(3)} len=${len}`);
          return false;
        }
        if (aspect >= CONFIG.IMG_TILE_DROP_AR_CJK && word.confidence < CONFIG.IMG_TILE_DROP_CONF_CJK) {
          logDrop('imgTile', word, `CJK wide aspect=${aspect.toFixed(1)}`);
          return false;
        }
      }
      return true;
    }
    return true;
  });
}

// ============================================
// Isolated CJK false-positive cleanup
// ============================================

export function filterIsolatedCjkNoise(
  words: Array<OCRWord>,
  protectedWords?: Set<OCRWord>
): Array<OCRWord> {
  if (words.length <= 2) return words;

  const heights = words.map(w => Math.max(1, w.bbox.y1 - w.bbox.y0)).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || heights[0] || 1;
  const maxGap = medianHeight * CONFIG.ISOLATED_NEIGHBOR_GAP_MULT;

  return words.filter(word => {
    if (protectedWords?.has(word)) return true;

    const alphaNum = getAlphaNum(word.text.trim());
    if (!alphaNum) return false;
    if (!isNonLatinToken(alphaNum)) return true;
    if (alphaNum.length > CONFIG.ISOLATED_CJK_MAX_LEN) return true;

    const strictConf = alphaNum.length === 1
      ? CONFIG.ISOLATED_CJK_SINGLE_CHAR_STRICT_CONF
      : CONFIG.ISOLATED_CJK_MIN_CONF;
    if (word.confidence >= strictConf) return true;

    const h = Math.max(1, word.bbox.y1 - word.bbox.y0);
    const w = Math.max(1, word.bbox.x1 - word.bbox.x0);
    let hasNeighbor = false;

    for (const other of words) {
      if (other === word) continue;
      const otherAlpha = getAlphaNum(other.text.trim());
      if (!otherAlpha) continue;

      const oh = Math.max(1, other.bbox.y1 - other.bbox.y0);
      const ow = Math.max(1, other.bbox.x1 - other.bbox.x0);
      const yOverlap = Math.max(0, Math.min(word.bbox.y1, other.bbox.y1) - Math.max(word.bbox.y0, other.bbox.y0));
      const xOverlap = Math.max(0, Math.min(word.bbox.x1, other.bbox.x1) - Math.max(word.bbox.x0, other.bbox.x0));

      const hGap = other.bbox.x0 > word.bbox.x1
        ? other.bbox.x0 - word.bbox.x1
        : (word.bbox.x0 > other.bbox.x1 ? word.bbox.x0 - other.bbox.x1 : 0);
      const vGap = other.bbox.y0 > word.bbox.y1
        ? other.bbox.y0 - word.bbox.y1
        : (word.bbox.y0 > other.bbox.y1 ? word.bbox.y0 - other.bbox.y1 : 0);

      const sameRow = yOverlap / Math.min(h, oh) >= CONFIG.ISOLATED_NEIGHBOR_Y_OVERLAP && hGap <= maxGap;
      const sameColumn = xOverlap / Math.min(w, ow) >= CONFIG.ISOLATED_NEIGHBOR_Y_OVERLAP && vGap <= maxGap;
      if (sameRow || sameColumn) {
        hasNeighbor = true;
        break;
      }
    }

    if (!hasNeighbor) {
      logDrop('isolatedCjk', word, `isolated len=${alphaNum.length} conf=${word.confidence.toFixed(0)} < ${strictConf}`);
      return false;
    }
    return true;
  });
}

// ============================================
// Korean jamo ghost suppression
// ============================================

const KOR_SYLLABLE_RE = /[\uAC00-\uD7AF]/;
const KOR_JAMO_RE = /[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]/;

export function filterKoreanJamoNoise(
  words: Array<OCRWord>,
  protectedWords?: Set<OCRWord>
): Array<OCRWord> {
  return words.filter(word => {
    if (protectedWords?.has(word)) return true;
    const alphaNum = getAlphaNum(word.text.trim());
    if (!alphaNum) return false;

    const hasSyllable = KOR_SYLLABLE_RE.test(alphaNum);
    const hasJamo = KOR_JAMO_RE.test(alphaNum);
    const hasDigit = /[0-9]/.test(alphaNum);
    const hasAscii = /[A-Za-z]/.test(alphaNum);
    const len = alphaNum.length;

    // Suppress OCR artifacts like "62", "L", "0", "226" on non-text areas.
    if (!hasSyllable && hasDigit && word.confidence < CONFIG.KOR_NONSYLLABLE_DIGIT_CONF) {
      logDrop('korGhost', word, `digit non-syllable len=${len} conf=${word.confidence.toFixed(0)}`);
      return false;
    }
    if (!hasSyllable && hasAscii && len <= CONFIG.KOR_NONSYLLABLE_SHORT_MAX_LEN
      && word.confidence < CONFIG.KOR_NONSYLLABLE_ASCII_SHORT_CONF) {
      logDrop('korGhost', word, `ascii non-syllable len=${len} conf=${word.confidence.toFixed(0)}`);
      return false;
    }
    if (!hasJamo) return true;

    const repeatedJamo = /^([\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF])\1+$/.test(alphaNum);

    // Keep high-confidence laughter/emphasis tokens like "ㅋㅋ" / "ㅎㅎ"
    if (!hasSyllable && repeatedJamo && len >= 2 && word.confidence >= 92) return true;

    if (!hasSyllable) {
      if (word.confidence < CONFIG.KOR_JAMO_STRICT_CONF) {
        logDrop('korJamo', word, `jamo-only len=${len} conf=${word.confidence.toFixed(0)}`);
        return false;
      }
      return true;
    }

    // Mixed jamo+syllable token like "ㄴ내" is usually OCR artifact.
    const edgeJamo = KOR_JAMO_RE.test(alphaNum[0] || '') || KOR_JAMO_RE.test(alphaNum[alphaNum.length - 1] || '');
    if (edgeJamo && len <= 4 && word.confidence < CONFIG.KOR_JAMO_MIXED_STRICT_CONF) {
      logDrop('korJamo', word, `mixed edge-jamo len=${len} conf=${word.confidence.toFixed(0)}`);
      return false;
    }

    return true;
  });
}

// ============================================
// Weak isolated CJK line suppression
// ============================================

export function filterWeakIsolatedCjkLines(
  lines: Array<OCRLine>,
  gray?: Uint8ClampedArray,
  width?: number,
  height?: number
): {
  lines: Array<OCRLine>;
  words: Array<OCRWord>;
} {
  if (lines.length === 0) return { lines: [], words: [] };

  const heights = lines.map(line => Math.max(1, line.bbox.y1 - line.bbox.y0)).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || heights[0] || 1;
  const maxNeighborGap = medianHeight * CONFIG.CJK_WEAK_LINE_NEIGHBOR_GAP_MULT;

  const keptLines: OCRLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineWords = (line.words as OCRWord[]) || [];
    if (lineWords.length === 0) continue;

    const mergedAlpha = getAlphaNum(lineWords.map(w => (w.text || '').trim()).join(''));
    const totalChars = mergedAlpha.length;
    const syllables = (mergedAlpha.match(/[\uAC00-\uD7AF]/g) || []).length;
    const jamo = (mergedAlpha.match(/[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]/g) || []).length;
    const repeatedJamoOnly = syllables === 0
      && mergedAlpha.length >= 2
      && /^([\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF])\1+$/.test(mergedAlpha);

    let lineVariance = CONFIG.CJK_WEAK_LINE_DROP_BG_VARIANCE_MIN;
    if (gray && typeof width === 'number' && typeof height === 'number' && width > 1 && height > 1) {
      const h = Math.max(1, line.bbox.y1 - line.bbox.y0);
      const pad = Math.max(2, Math.round(h * 0.55));
      const innerPad = Math.max(1, Math.round(h * 0.1));
      const rect = {
        x0: line.bbox.x0 - pad,
        y0: line.bbox.y0 - pad,
        x1: line.bbox.x1 + pad,
        y1: line.bbox.y1 + pad
      };
      const inner = {
        x0: line.bbox.x0 - innerPad,
        y0: line.bbox.y0 - innerPad,
        x1: line.bbox.x1 + innerPad,
        y1: line.bbox.y1 + innerPad
      };
      lineVariance = computeBackgroundVariance(gray, width, height, rect, inner);
    }

    const weakSingle = lineWords.length === 1 && totalChars <= 2 && line.confidence < CONFIG.CJK_WEAK_LINE_SINGLE_CONF;
    const weakShort = lineWords.length <= CONFIG.CJK_WEAK_LINE_MAX_WORDS
      && totalChars <= CONFIG.CJK_WEAK_LINE_MAX_CHARS
      && line.confidence < CONFIG.CJK_WEAK_LINE_CONF;
    const noSyllableShort = syllables === 0
      && totalChars > 0
      && totalChars <= CONFIG.CJK_GHOST_SHORT_CHARS
      && line.confidence < CONFIG.CJK_GHOST_NO_SYLLABLE_CONF
      && !repeatedJamoOnly;
    const jamoRatio = jamo / Math.max(1, syllables + jamo);
    const jamoHeavyWithSyllables = syllables > 0
      && jamoRatio >= CONFIG.CJK_GHOST_JAMO_RATIO_MIN
      && line.confidence < CONFIG.CJK_GHOST_LINE_CONF;

    const weakByShape = noSyllableShort
      || ((weakSingle || weakShort || jamoHeavyWithSyllables)
        && lineVariance >= CONFIG.CJK_WEAK_LINE_DROP_BG_VARIANCE_MIN);

    if (!weakByShape) {
      keptLines.push(line);
      continue;
    }

    const w = Math.max(1, line.bbox.x1 - line.bbox.x0);
    let hasNeighbor = false;

    for (let j = 0; j < lines.length; j++) {
      if (i === j) continue;
      const other = lines[j];
      const otherWords = (other.words as OCRWord[]) || [];
      const otherChars = otherWords.reduce((sum, w) => sum + getAlphaNum((w.text || '').trim()).length, 0);
      const otherStrong = other.confidence >= CONFIG.CJK_WEAK_LINE_CONF || otherChars > CONFIG.CJK_WEAK_LINE_MAX_CHARS;
      if (!otherStrong) continue;
      const ow = Math.max(1, other.bbox.x1 - other.bbox.x0);

      const vGap = other.bbox.y0 > line.bbox.y1
        ? other.bbox.y0 - line.bbox.y1
        : (line.bbox.y0 > other.bbox.y1 ? line.bbox.y0 - other.bbox.y1 : 0);
      if (vGap > maxNeighborGap) continue;

      const xOverlap = Math.max(0, Math.min(line.bbox.x1, other.bbox.x1) - Math.max(line.bbox.x0, other.bbox.x0));
      const overlapRatio = xOverlap / Math.min(w, ow);
      if (overlapRatio >= CONFIG.CJK_WEAK_LINE_X_OVERLAP_MIN) {
        hasNeighbor = true;
        break;
      }
    }

    if (hasNeighbor) {
      keptLines.push(line);
    } else {
      const keyWord = lineWords[0];
      if (keyWord) {
        logDrop('weakCjkLine', keyWord, `isolated weak line words=${lineWords.length} chars=${totalChars} conf=${line.confidence.toFixed(0)} var=${lineVariance.toFixed(0)}`);
      }
    }
  }

  const keptWords = keptLines.flatMap(line => (line.words as OCRWord[]) || []);
  return { lines: keptLines, words: keptWords };
}

// ============================================
// Line noise cleanup
// ============================================

export function cleanLineNoise(lines: Array<{ text: string; confidence: number; bbox: BBox; words: unknown[] }>): {
  lines: Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }>;
  words: Array<OCRWord>;
} {
  const cleanedLines: Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }> = [];
  const cleanedWords: Array<OCRWord> = [];

  for (const line of lines) {
    const lineWords = sortWordsByOrientation((line.words as OCRWord[]).slice());
    if (lineWords.length === 0) continue;
    const denseLine = lineWords.length >= 4;

    const heights = lineWords.map(w => Math.max(1, w.bbox.y1 - w.bbox.y0)).sort((a, b) => a - b);
    const medianHeight = heights[Math.floor(heights.length / 2)] || heights[0] || 1;

    const filtered = lineWords.filter((word, index) => {
      const raw = word.text.trim();
      const alphaNum = getAlphaNum(raw);
      if (alphaNum.length === 0) return false;

      const nonLatin = isNonLatinToken(alphaNum);
      const hasUpper = /[A-Z]/.test(alphaNum);
      const hasLower = /[a-z]/.test(alphaNum);

      const h = Math.max(1, word.bbox.y1 - word.bbox.y0);
      const shortHeight = h < medianHeight * CONFIG.NOISE_SHORT_HEIGHT_RATIO;
      const mixedHeight = h < medianHeight * CONFIG.NOISE_MIXEDCASE_HEIGHT_RATIO;
      const keepSingle = alphaNum.length === 1
        && CONFIG.NOISE_KEEP_SINGLE_CHARS.includes(alphaNum)
        && lineWords.length >= 2
        && h >= medianHeight * CONFIG.NOISE_KEEP_SINGLE_HEIGHT_RATIO;

      if (keepSingle) return true;
      // Keep non-Latin tokens to avoid dropping valid syllables
      if (nonLatin) return true;

      // Drop mixed-case short noise like "rE" or "Bm"
      if (alphaNum.length <= 3 && hasUpper && hasLower && word.confidence < CONFIG.NOISE_MIXEDCASE_CONF && mixedHeight) {
        logDrop('noise', word, 'mixed-case short');
        return false;
      }

      if (alphaNum.length === 1 && word.confidence < CONFIG.NOISE_MIN_CONF_SINGLE && shortHeight && (!denseLine || index === 0)) {
        logDrop('noise', word, 'single low-conf short');
        return false;
      }
      if (alphaNum.length === 2 && word.confidence < CONFIG.NOISE_MIN_CONF_SHORT && shortHeight && (!denseLine || index === 0)) {
        logDrop('noise', word, 'two-char low-conf short');
        return false;
      }

      // Leading bullet-like noise
      if (index === 0 && alphaNum.length <= 2 && word.confidence < CONFIG.NOISE_LEADING_CONF) {
        if (h < medianHeight * CONFIG.NOISE_LEADING_HEIGHT_RATIO) {
          logDrop('noise', word, 'leading short');
          return false;
        }
        if (/^[mMbB]+$/.test(alphaNum)) {
          logDrop('noise', word, 'leading mMbB');
          return false;
        }
        if (/^[iIl1]+$/.test(alphaNum) && word.confidence < 80) {
          logDrop('noise', word, 'leading iIl1');
          return false;
        }
      }

      return true;
    });

    if (filtered.length === 0) continue;

    const bbox = filtered.reduce((acc, w) => ({
      x0: Math.min(acc.x0, w.bbox.x0),
      y0: Math.min(acc.y0, w.bbox.y0),
      x1: Math.max(acc.x1, w.bbox.x1),
      y1: Math.max(acc.y1, w.bbox.y1),
    }), { ...filtered[0].bbox });

    cleanedLines.push({
      text: joinWordsForLanguage(filtered),
      confidence: filtered.reduce((s, w) => s + w.confidence, 0) / filtered.length,
      bbox,
      words: filtered
    });
    cleanedWords.push(...filtered);
  }

  return { lines: cleanedLines, words: cleanedWords };
}
