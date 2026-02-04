/**
 * Enhanced Vision Worker - Smart OCR & Segmentation
 * 
 * Features:
 * - Stable Tesseract.js integration with error recovery
 * - Smart region classification (text, balloon, sfx)
 * - Improved TSV parsing for word-level OCR
 * - Document type aware segmentation
 */

import { createWorker, PSM, OEM } from 'tesseract.js';

// ============================================
// Types
// ============================================

interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface OCRBlock {
  text: string;
  confidence: number;
  bbox: BBox;
  blockType?: 'text' | 'image' | 'separator' | 'unknown';
}

type OCRWord = { text: string; confidence: number; bbox: BBox };

interface TesseractResult {
  data: {
    text: string;
    confidence: number;
    blocks?: OCRBlock[];
    lines?: Array<{ text: string; confidence: number; bbox: BBox; words: unknown[] }>;
    words?: Array<{ text: string; confidence: number; bbox: BBox }>;
    hocr?: string;
    tsv?: string;
  };
}

type DocumentType = 'manga' | 'document';

// ============================================
// State
// ============================================

let tesseractWorker: Awaited<ReturnType<typeof createWorker>> | null = null;
let currentLang = 'eng';
let isInitializing = false;

// ============================================
// Configuration
// ============================================

const CONFIG = {
  // Tesseract WASM core URL (stable version)
  CORE_PATH: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0/tesseract-core.wasm.js',
  
  // Region classification thresholds
  MIN_REGION_AREA: 100, // Minimum pixel area to consider
  MIN_CONFIDENCE: 20, // Minimum OCR confidence (0-100)
  
  // Balloon detection (for manga)
  BALLOON_ASPECT_RATIO_MIN: 0.3,
  BALLOON_ASPECT_RATIO_MAX: 3.5,
  BALLOON_DENSITY_THRESHOLD: 0.15, // Text density in region
  
  // SFX detection
  SFX_MIN_FONT_SIZE_RATIO: 0.1, // Relative to page height
  SFX_MAX_WORDS: 3,

  // OCR preprocessing
  OCR_BINARIZE: true,

  // Photo-text filtering (reduce OCR in image-heavy regions)
  PHOTO_BG_VARIANCE: 850,
  PHOTO_FILTER_MIN_HEIGHT_RATIO: 0.028,
  PHOTO_FILTER_MIN_CONFIDENCE: 80,

  // Image tile detection (coarse image region mask)
  IMG_TILE_SIZE_MIN: 44,
  IMG_TILE_SIZE_MAX: 88,
  IMG_TILE_SAMPLE_STEP: 2,
  IMG_TILE_MID_LOW: 40,
  IMG_TILE_MID_HIGH: 220,
  IMG_MID_RATIO: 0.4,
  IMG_VARIANCE: 820,
  IMG_EDGE: 23,
  IMG_EDGE_VARIANCE: 480,
  IMG_TEXT_WORDS_MIN: 1,
  IMG_TEXT_COVERAGE_MIN: 0.05,
  IMG_TEXT_CONF_MIN: 80,
  IMG_HOLE_FILL_MIN: 7,
  IMG_KEEP_LARGE_TEXT_RATIO: 0.045,
  IMG_KEEP_LARGE_TEXT_CONF: 80,
  IMG_PROTECT_LINE_WORDS: 3,
  IMG_PROTECT_LINE_CONF: 70,
  IMG_TILE_DROP_MAX_LEN: 2,
  IMG_TILE_DROP_CONF: 70,
  IMG_TILE_DROP_HEIGHT_RATIO: 0.02,
  IMG_KEEP_MIN_LEN: 4,
  IMG_KEEP_MIN_CONF: 78,
  IMG_KEEP_MIN_HEIGHT_RATIO: 0.022,
  IMG_DROP_SHORT_MAX_LEN: 3,
  IMG_DROP_SHORT_HEIGHT_RATIO: 0.025,

  // Noise filtering
  NOISE_MIN_CONF_SINGLE: 55,
  NOISE_MIN_CONF_SHORT: 45,
  NOISE_MIXEDCASE_CONF: 75,
  NOISE_LEADING_CONF: 70,
  NOISE_LEADING_HEIGHT_RATIO: 0.75,
};

// ============================================
// Helper Functions
// ============================================

/**
 * Send progress to main thread
 */
function sendProgress(status: string, progress: number, workerId?: string): void {
  self.postMessage({
    type: 'OCR_PROGRESS',
    payload: { status, progress, workerId }
  });
}

/**
 * Preprocess image: Load, validate, and re-render through canvas
 * This fixes corrupted JPEG issues and ensures proper dimensions
 * NOTE: Uses fetch + createImageBitmap because Image is not available in Workers
 */
async function preprocessImage(
  imageUrl: string | Blob,
  options: { binarize?: boolean; returnGray?: boolean } = {}
): Promise<{
  image: Blob;
  width: number;
  height: number;
  gray?: Uint8ClampedArray;
}> {
  try {
    // Fetch the image as blob when needed (data: and http(s): supported)
    const blob = typeof imageUrl === 'string'
      ? await (await fetch(imageUrl)).blob()
      : imageUrl;
    
    // Create ImageBitmap (works in Workers)
    const imageBitmap = await createImageBitmap(blob);
    
    const width = imageBitmap.width;
    const height = imageBitmap.height;
    
    // Validate minimum dimensions
    if (width < 10 || height < 10) {
      imageBitmap.close();
      throw new Error(`Image too small: ${width}x${height}`);
    }
    
    // Create canvas and re-render image (fixes corrupted JPEG)
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      imageBitmap.close();
      throw new Error('Failed to create canvas context');
    }
    
    // Draw with white background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(imageBitmap, 0, 0, width, height);
    
    // Close the bitmap to free memory
    imageBitmap.close();
    
    // ============================================
    // OCR PREPROCESSING
    // - Optional grayscale + contrast stretch + binarize (document friendly)
    // ============================================
    let gray: Uint8ClampedArray | undefined;
    if (options.binarize || options.returnGray) {
      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;
      const grayData = new Uint8ClampedArray(width * height);

      let min = 255;
      let max = 0;
      for (let i = 0, p = 0; i < grayData.length; i++, p += 4) {
        const r = data[p];
        const g = data[p + 1];
        const b = data[p + 2];
        const v = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
        grayData[i] = v;
        if (v < min) min = v;
        if (v > max) max = v;
      }

      // Contrast stretch
      const range = Math.max(1, max - min);
      const scale = 255 / range;
      for (let i = 0; i < grayData.length; i++) {
        grayData[i] = Math.max(0, Math.min(255, ((grayData[i] - min) * scale) | 0));
      }

      if (options.binarize) {
        // Otsu threshold
        const hist = new Uint32Array(256);
        for (let i = 0; i < grayData.length; i++) {
          hist[grayData[i]]++;
        }
        const total = grayData.length;
        let sum = 0;
        for (let i = 0; i < 256; i++) sum += i * hist[i];
        let sumB = 0;
        let wB = 0;
        let maxVar = 0;
        let threshold = 128;
        for (let i = 0; i < 256; i++) {
          wB += hist[i];
          if (wB === 0) continue;
          const wF = total - wB;
          if (wF === 0) break;
          sumB += i * hist[i];
          const mB = sumB / wB;
          const mF = (sum - sumB) / wF;
          const varBetween = wB * wF * (mB - mF) * (mB - mF);
          if (varBetween > maxVar) {
            maxVar = varBetween;
            threshold = i;
          }
        }

        for (let i = 0, p = 0; i < grayData.length; i++, p += 4) {
          const v = grayData[i] > threshold ? 255 : 0;
          data[p] = v;
          data[p + 1] = v;
          data[p + 2] = v;
          data[p + 3] = 255;
        }
      } else {
        for (let i = 0, p = 0; i < grayData.length; i++, p += 4) {
          const v = grayData[i];
          data[p] = v;
          data[p + 1] = v;
          data[p + 2] = v;
          data[p + 3] = 255;
        }
      }

      ctx.putImageData(imageData, 0, 0);
      gray = grayData;
    }
    
    // Convert to PNG (lossless, no JPEG artifacts)
    const outputBlob = await canvas.convertToBlob({ type: 'image/png' });

    return { image: outputBlob, width, height, gray };
  } catch (error) {
    console.error('[Worker] preprocessImage error:', error);
    throw error;
  }
}

/**
 * Get image dimensions using createImageBitmap
 */
async function getImageDimensions(imageUrl: string | Blob): Promise<{ width: number; height: number }> {
  try {
    const blob = typeof imageUrl === 'string'
      ? await (await fetch(imageUrl)).blob()
      : imageUrl;
    
    const imageBitmap = await createImageBitmap(blob);
    const result = {
      width: imageBitmap.width,
      height: imageBitmap.height
    };
    imageBitmap.close();
    return result;
  } catch (error) {
    throw error;
  }
}

/**
 * Create Tesseract worker with specific language
 */
async function createWorkerWithLanguage(
  lang: string, 
  sendUpdates: boolean = false
): Promise<Awaited<ReturnType<typeof createWorker>>> {
  console.log(`[Worker] Creating Tesseract worker for: ${lang}`);
  
  try {
    const worker = await createWorker(lang, OEM.LSTM_ONLY, {
      corePath: CONFIG.CORE_PATH,
      logger: m => {
        if (sendUpdates && m.status && typeof m.progress === 'number') {
          sendProgress(m.status, m.progress, m.workerId);
        }
      }
    });
    
    console.log(`[Worker] Tesseract initialized for: ${lang}`);
    return worker;
  } catch (err) {
    console.error(`[Worker] Failed to initialize Tesseract for ${lang}:`, err);
    throw err;
  }
}

/**
 * Get or create Tesseract worker (with language switching)
 */
async function getOrCreateWorker(targetLang: string): Promise<Awaited<ReturnType<typeof createWorker>>> {
  // Prevent concurrent initialization
  while (isInitializing) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  if (!tesseractWorker || currentLang !== targetLang) {
    isInitializing = true;
    
    try {
      if (tesseractWorker) {
        console.log(`[Worker] Switching language from ${currentLang} to ${targetLang}`);
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

/**
 * Classify region type based on characteristics
 */
function classifyRegion(
  text: string, 
  bbox: BBox, 
  confidence: number,
  pageWidth: number,
  pageHeight: number,
  documentType: DocumentType
): 'text' | 'balloon' | 'sfx' | 'panel' {
  const width = bbox.x1 - bbox.x0;
  const height = bbox.y1 - bbox.y0;
  const area = width * height;
  const aspectRatio = width / Math.max(height, 1);
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
  
  // Calculate relative size
  const relativeHeight = height / pageHeight;
  const relativeWidth = width / pageWidth;
  
  // For documents: everything is text
  if (documentType === 'document') {
    return 'text';
  }
  
  // For manga: classify based on characteristics
  
  // SFX detection: Large text, few words, often diagonal or stylized
  if (
    wordCount <= CONFIG.SFX_MAX_WORDS &&
    relativeHeight > CONFIG.SFX_MIN_FONT_SIZE_RATIO &&
    confidence < 70 // SFX often has lower OCR confidence due to stylization
  ) {
    return 'sfx';
  }
  
  // Balloon detection: medium-sized regions with reasonable aspect ratio
  if (
    aspectRatio >= CONFIG.BALLOON_ASPECT_RATIO_MIN &&
    aspectRatio <= CONFIG.BALLOON_ASPECT_RATIO_MAX &&
    wordCount >= 1 &&
    confidence >= CONFIG.MIN_CONFIDENCE
  ) {
    return 'balloon';
  }
  
  // Default to text for regular text blocks
  return 'text';
}

/**
 * Parse TSV output for word-level data
 * Tesseract.js v7 TSV format (no header):
 * level, page_num, block_num, par_num, line_num, word_num, left, top, width, height, conf, text
 * Columns: 0      1         2         3        4         5        6    7    8      9       10   11
 */
function parseTSV(tsv: string): {
  words: Array<OCRWord>;
  lines: Array<{ text: string; confidence: number; bbox: BBox; words: unknown[] }>;
} {
  const words: Array<OCRWord> = [];
  const lines: Array<{ text: string; confidence: number; bbox: BBox; words: unknown[] }> = [];
  const lineMap = new Map<string, {
    words: Array<{ text: string; confidence: number; bbox: BBox }>;
    bbox: BBox;
    confidenceSum: number;
    confidenceCount: number;
  }>();
  
  if (!tsv || typeof tsv !== 'string') {
    console.log('[parseTSV] No TSV input');
    return { words, lines };
  }
  
  const tsvLines = tsv.split('\n').filter(line => line.trim().length > 0);
  console.log(`[parseTSV] Total lines: ${tsvLines.length}`);
  
  if (tsvLines.length < 1) {
    console.log('[parseTSV] No data lines');
    return { words, lines };
  }
  
  // Check if first line is a header (contains 'level' text)
  const firstLine = tsvLines[0];
  const hasHeader = firstLine.toLowerCase().includes('level');
  const startIndex = hasHeader ? 1 : 0;
  
  console.log(`[parseTSV] Has header: ${hasHeader}, starting from index ${startIndex}`);
  
  // Fixed column indices for Tesseract TSV format
  const COL = {
    level: 0,
    page: 1,
    block: 2,
    par: 3,
    line: 4,
    word: 5,
    left: 6,
    top: 7,
    width: 8,
    height: 9,
    conf: 10,
    text: 11,
  };
  
  // Parse data rows
  let level5Count = 0;
  let level4Count = 0;
  
  for (let i = startIndex; i < tsvLines.length; i++) {
    const cols = tsvLines[i].split('\t');
    
    // Need at least 12 columns
    if (cols.length < 12) continue;
    
    const level = parseInt(cols[COL.level] || '0');
    const text = cols.slice(COL.text).join('\t').trim();
    
    // Log first few rows
    if (i < startIndex + 5) {
      console.log(`[parseTSV] Row ${i}: level=${level}, text="${text.substring(0, 30)}"`);
    }
    
    if (text.length === 0) continue;
    
    const left = parseInt(cols[COL.left] || '0');
    const top = parseInt(cols[COL.top] || '0');
    const width = parseInt(cols[COL.width] || '0');
    const height = parseInt(cols[COL.height] || '0');
    const conf = parseFloat(cols[COL.conf] || '0');
    
    const bbox: BBox = {
      x0: left,
      y0: top,
      x1: left + width,
      y1: top + height
    };
    
    // Level 5 = word
    if (level === 5) {
      level5Count++;
      const word = { text, confidence: conf, bbox };
      words.push(word);

      const pageNum = cols[COL.page] || '0';
      const blockNum = cols[COL.block] || '0';
      const parNum = cols[COL.par] || '0';
      const lineNum = cols[COL.line] || '0';
      const key = `${pageNum}-${blockNum}-${parNum}-${lineNum}`;

      const existing = lineMap.get(key);
      if (existing) {
        existing.words.push(word);
        existing.bbox = {
          x0: Math.min(existing.bbox.x0, bbox.x0),
          y0: Math.min(existing.bbox.y0, bbox.y0),
          x1: Math.max(existing.bbox.x1, bbox.x1),
          y1: Math.max(existing.bbox.y1, bbox.y1),
        };
        if (conf >= 0) {
          existing.confidenceSum += conf;
          existing.confidenceCount += 1;
        }
      } else {
        lineMap.set(key, {
          words: [word],
          bbox: { ...bbox },
          confidenceSum: conf >= 0 ? conf : 0,
          confidenceCount: conf >= 0 ? 1 : 0,
        });
      }
    }
    
    // Level 4 = line (keep for logging)
    if (level === 4) {
      level4Count++;
    }
  }
  
  // Build line objects from grouped words
  for (const [, group] of lineMap) {
    const sortedWords = group.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const lineText = sortedWords.map(w => w.text).join(' ');
    const avgConf = group.confidenceCount > 0
      ? group.confidenceSum / group.confidenceCount
      : 0;

    lines.push({
      text: lineText,
      confidence: avgConf,
      bbox: group.bbox,
      words: sortedWords
    });
  }

  // Sort lines by vertical position
  lines.sort((a, b) => a.bbox.y0 - b.bbox.y0);
  
  console.log(`[parseTSV] Found: ${level5Count} words, ${lines.length} lines (level4 rows: ${level4Count})`);
  
  return { words, lines };
}

function computeBackgroundVariance(
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

  let count = 0;
  let sum = 0;
  let sumSq = 0;

  for (let gy = 1; gy <= grid; gy++) {
    for (let gx = 1; gx <= grid; gx++) {
      const x = Math.round(x0 + stepX * gx);
      const y = Math.round(y0 + stepY * gy);

      // Skip samples inside the word bbox (focus on background)
      if (x >= inX0 && x <= inX1 && y >= inY0 && y <= inY1) continue;

      const idx = y * width + x;
      const v = gray[idx] || 0;
      count++;
      sum += v;
      sumSq += v * v;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  return (sumSq / count) - (mean * mean);
}

function filterWordsByBackground(
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

    const rect = {
      x0: word.bbox.x0 - pad,
      y0: word.bbox.y0 - pad,
      x1: word.bbox.x1 + pad,
      y1: word.bbox.y1 + pad
    };

    const innerPad = Math.max(1, Math.round(h * 0.15));
    const inner = {
      x0: word.bbox.x0 - innerPad,
      y0: word.bbox.y0 - innerPad,
      x1: word.bbox.x1 + innerPad,
      y1: word.bbox.y1 + innerPad
    };

    const variance = computeBackgroundVariance(gray, width, height, rect, inner);

    // Keep larger words (titles) even on photo backgrounds
    if (heightRatio >= 0.06) return true;

    if (variance > CONFIG.PHOTO_BG_VARIANCE) {
      const small = heightRatio < CONFIG.PHOTO_FILTER_MIN_HEIGHT_RATIO;
      const lowConf = word.confidence < CONFIG.PHOTO_FILTER_MIN_CONFIDENCE;
      if (small && lowConf) return false;
    }

    return true;
  });
}

type OCRLine = { text: string; confidence: number; bbox: BBox; words: unknown[] };

function buildProtectedWordSet(lines: Array<OCRLine>): Set<OCRWord> {
  const protectedWords = new Set<OCRWord>();
  for (const line of lines) {
    const lineWords = (line.words as OCRWord[]) || [];
    if (lineWords.length === 0) continue;
    if (lineWords.length >= CONFIG.IMG_PROTECT_LINE_WORDS || line.confidence >= CONFIG.IMG_PROTECT_LINE_CONF) {
      for (const word of lineWords) {
        protectedWords.add(word);
      }
    }
  }
  return protectedWords;
}

function splitLineWords(lineWords: OCRWord[]): OCRWord[][] {
  if (lineWords.length <= 1) return [lineWords];
  const sorted = lineWords.slice().sort((a, b) => a.bbox.x0 - b.bbox.x0);

  const heights = sorted.map(w => Math.max(1, w.bbox.y1 - w.bbox.y0)).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || heights[0] || 1;
  const gapThreshold = Math.max(18, medianHeight * 2.6);

  const groups: OCRWord[][] = [];
  let current: OCRWord[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const word = sorted[i];
    if (current.length === 0) {
      current.push(word);
      continue;
    }
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

function rebuildLinesFromWords(
  lines: Array<OCRLine>,
  words: Array<OCRWord>
): Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }> {
  const wordSet = new Set(words);
  const rebuilt: Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }> = [];
  for (const line of lines) {
    const lineWords = (line.words as OCRWord[]).filter(w => wordSet.has(w));
    if (lineWords.length === 0) continue;

    const groups = splitLineWords(lineWords);
    for (const group of groups) {
      if (group.length === 0) continue;
      const bbox = group.reduce((acc, w) => ({
        x0: Math.min(acc.x0, w.bbox.x0),
        y0: Math.min(acc.y0, w.bbox.y0),
        x1: Math.max(acc.x1, w.bbox.x1),
        y1: Math.max(acc.y1, w.bbox.y1)
      }), { ...group[0].bbox });

      const avgConf = group.reduce((sum, w) => sum + w.confidence, 0) / group.length;
      const text = group.map(w => w.text).join(' ');

      rebuilt.push({
        text,
        confidence: avgConf,
        bbox,
        words: group
      });
    }
  }

  return rebuilt.sort((a, b) => a.bbox.y0 - b.bbox.y0);
}

function buildImageTileMask(
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

      if (v >= CONFIG.IMG_TILE_MID_LOW && v <= CONFIG.IMG_TILE_MID_HIGH) {
        mid[idx] += 1;
      }

      if (x + step < width) {
        edge[idx] += Math.abs(v - (gray[yIdx + x + step] || 0));
      }
      if (y + step < height) {
        edge[idx] += Math.abs(v - (gray[(y + step) * width + x] || 0));
      }
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

    const area = Math.max(0, (word.bbox.x1 - word.bbox.x0) * (word.bbox.y1 - word.bbox.y0));
    areaSum[idx] += area;
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

    const textLikely = wc >= CONFIG.IMG_TEXT_WORDS_MIN
      || coverage >= CONFIG.IMG_TEXT_COVERAGE_MIN
      || avgConf >= CONFIG.IMG_TEXT_CONF_MIN;

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
            const nr = r + dy;
            const nc = c + dx;
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

function filterWordsByImageTiles(
  words: Array<OCRWord>,
  maskInfo: { mask: Uint8Array; tileSize: number; cols: number; rows: number },
  width: number,
  height: number,
  protectedWords?: Set<OCRWord>
): Array<OCRWord> {
  const { mask, tileSize, cols, rows } = maskInfo;
  return words.filter(word => {
    const h = word.bbox.y1 - word.bbox.y0;
    const heightRatio = h / Math.max(1, height);
    if (heightRatio >= CONFIG.IMG_KEEP_LARGE_TEXT_RATIO && word.confidence >= CONFIG.IMG_KEEP_LARGE_TEXT_CONF) {
      return true;
    }
    if (protectedWords?.has(word)) {
      return true;
    }

    const col0 = Math.min(cols - 1, Math.max(0, Math.floor(word.bbox.x0 / tileSize)));
    const col1 = Math.min(cols - 1, Math.max(0, Math.floor(word.bbox.x1 / tileSize)));
    const row0 = Math.min(rows - 1, Math.max(0, Math.floor(word.bbox.y0 / tileSize)));
    const row1 = Math.min(rows - 1, Math.max(0, Math.floor(word.bbox.y1 / tileSize)));

    let inImageTile = false;
    for (let r = row0; r <= row1 && !inImageTile; r++) {
      for (let c = col0; c <= col1; c++) {
        if (mask[r * cols + c] === 1) {
          inImageTile = true;
          break;
        }
      }
    }

    const raw = word.text.trim();
    const alphaNum = raw.replace(/[^a-zA-Z0-9]/g, '');
    const len = alphaNum.length;

    if (inImageTile) {
      if (len > 0 && len <= CONFIG.IMG_TILE_DROP_MAX_LEN
        && heightRatio <= CONFIG.IMG_TILE_DROP_HEIGHT_RATIO
        && word.confidence < CONFIG.IMG_TILE_DROP_CONF) {
        return false;
      }
      return true;
    }

    return true;
  });
}

function cleanLineNoise(lines: Array<{ text: string; confidence: number; bbox: BBox; words: unknown[] }>): {
  lines: Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }>;
  words: Array<OCRWord>;
} {
  const cleanedLines: Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }> = [];
  const cleanedWords: Array<OCRWord> = [];

  for (const line of lines) {
    const lineWords = (line.words as OCRWord[]).slice().sort((a, b) => a.bbox.x0 - b.bbox.x0);
    if (lineWords.length === 0) continue;
    const denseLine = lineWords.length >= 4;

    const heights = lineWords.map(w => Math.max(1, w.bbox.y1 - w.bbox.y0)).sort((a, b) => a - b);
    const medianHeight = heights[Math.floor(heights.length / 2)] || heights[0] || 1;

    const filtered = lineWords.filter((word, index) => {
      const raw = word.text.trim();
      const alphaNum = raw.replace(/[^a-zA-Z0-9]/g, '');
      if (alphaNum.length === 0) return false;

      const hasUpper = /[A-Z]/.test(alphaNum);
      const hasLower = /[a-z]/.test(alphaNum);

      // Drop mixed-case short noise like "rE" or "Bm" when confidence is low
      if (alphaNum.length <= 3 && hasUpper && hasLower && word.confidence < CONFIG.NOISE_MIXEDCASE_CONF) {
        return false;
      }

      // Drop very low confidence single/short tokens
      if (alphaNum.length === 1 && word.confidence < CONFIG.NOISE_MIN_CONF_SINGLE && (!denseLine || index === 0)) return false;
      if (alphaNum.length === 2 && word.confidence < CONFIG.NOISE_MIN_CONF_SHORT && (!denseLine || index === 0)) return false;

      // Leading bullet-like noise
      if (index === 0 && alphaNum.length <= 2 && word.confidence < CONFIG.NOISE_LEADING_CONF) {
        const h = Math.max(1, word.bbox.y1 - word.bbox.y0);
        if (h < medianHeight * CONFIG.NOISE_LEADING_HEIGHT_RATIO) return false;
        if (/^[mMbB]+$/.test(alphaNum)) return false;
        if (/^[iIl1]+$/.test(alphaNum) && word.confidence < 80) return false;
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

    const avgConf = filtered.reduce((sum, w) => sum + w.confidence, 0) / filtered.length;
    const text = filtered.map(w => w.text).join(' ');

    cleanedLines.push({
      text,
      confidence: avgConf,
      bbox,
      words: filtered
    });
    cleanedWords.push(...filtered);
  }

  return { lines: cleanedLines, words: cleanedWords };
}

/**
 * Group words into logical blocks/regions
 */
function groupWordsIntoRegions(
  words: Array<{ text: string; confidence: number; bbox: BBox }>,
  pageWidth: number,
  pageHeight: number,
  documentType: DocumentType
): Array<{
  id: string;
  type: 'text' | 'balloon' | 'sfx' | 'panel';
  box: { x: number; y: number; w: number; h: number };
  originalText: string;
  confidence: number;
}> {
  if (words.length === 0) return [];
  
  // Simple grouping: Merge nearby words
  const merged: Array<{
    words: typeof words;
    bbox: BBox;
  }> = [];
  
  const GAP_THRESHOLD_X = pageWidth * 0.05; // 5% of page width
  const GAP_THRESHOLD_Y = pageHeight * 0.02; // 2% of page height
  
  // Sort words by position (top-to-bottom, left-to-right)
  const sortedWords = [...words].sort((a, b) => {
    const yDiff = a.bbox.y0 - b.bbox.y0;
    if (Math.abs(yDiff) > GAP_THRESHOLD_Y) return yDiff;
    return a.bbox.x0 - b.bbox.x0;
  });
  
  for (const word of sortedWords) {
    let addedToGroup = false;
    
    // Try to add to existing group
    for (const group of merged) {
      const lastWord = group.words[group.words.length - 1];
      
      // Check if word is close to this group
      const xGap = word.bbox.x0 - group.bbox.x1;
      const yOverlap = Math.min(word.bbox.y1, group.bbox.y1) - Math.max(word.bbox.y0, group.bbox.y0);
      const yGap = Math.abs(word.bbox.y0 - group.bbox.y1);
      
      // Same line (y overlap) and close horizontally
      if (yOverlap > 0 && xGap < GAP_THRESHOLD_X && xGap > -word.bbox.x1) {
        group.words.push(word);
        group.bbox = {
          x0: Math.min(group.bbox.x0, word.bbox.x0),
          y0: Math.min(group.bbox.y0, word.bbox.y0),
          x1: Math.max(group.bbox.x1, word.bbox.x1),
          y1: Math.max(group.bbox.y1, word.bbox.y1),
        };
        addedToGroup = true;
        break;
      }
      
      // New line but close vertically and overlaps horizontally
      if (yGap < GAP_THRESHOLD_Y && yGap >= 0) {
        const xOverlap = Math.min(word.bbox.x1, group.bbox.x1) - Math.max(word.bbox.x0, group.bbox.x0);
        if (xOverlap > 0) {
          group.words.push(word);
          group.bbox = {
            x0: Math.min(group.bbox.x0, word.bbox.x0),
            y0: Math.min(group.bbox.y0, word.bbox.y0),
            x1: Math.max(group.bbox.x1, word.bbox.x1),
            y1: Math.max(group.bbox.y1, word.bbox.y1),
          };
          addedToGroup = true;
          break;
        }
      }
    }
    
    // Create new group if not added
    if (!addedToGroup) {
      merged.push({
        words: [word],
        bbox: { ...word.bbox },
      });
    }
  }
  
  // Convert to regions
  return merged.map((group, index) => {
    const text = group.words.map(w => w.text).join(' ');
    const avgConfidence = group.words.reduce((sum, w) => sum + w.confidence, 0) / group.words.length;
    
    const type = classifyRegion(
      text,
      group.bbox,
      avgConfidence,
      pageWidth,
      pageHeight,
      documentType
    );
    
    return {
      id: `region-${index}-${Date.now()}`,
      type,
      box: {
        x: group.bbox.x0,
        y: group.bbox.y0,
        w: group.bbox.x1 - group.bbox.x0,
        h: group.bbox.y1 - group.bbox.y0,
      },
      originalText: text,
      confidence: avgConfidence / 100,
    };
  }).filter(r => r.originalText.length > 0 && r.confidence >= CONFIG.MIN_CONFIDENCE / 100);
}

// ============================================
// Message Handler
// ============================================

self.onmessage = async (e: MessageEvent) => {
  const { type, payload, id } = e.data;

  try {
    switch (type) {
      // ============================================
      // INIT - Initialize OCR Engine
      // ============================================
      case 'INIT': {
        console.log('[Worker] Initializing Vision Worker...');
        await getOrCreateWorker('eng');
        self.postMessage({ type: 'INIT_SUCCESS', id });
        break;
      }

      // ============================================
      // OCR_FOR_TEXT_LAYER - Word-Level OCR
      // ============================================
      case 'OCR_FOR_TEXT_LAYER': {
        const { imageUrl, imageWidth, imageHeight, language = 'eng', dpi = 300, pageSegMode } = payload;
        
        sendProgress('Preprocessing image...', 0);
        
        // Preprocess image to fix corrupted JPEG and ensure valid dimensions
        let processedInput: Blob | string = imageUrl;
        let actualWidth = Math.round(imageWidth);
        let actualHeight = Math.round(imageHeight);
        
        const isStringInput = typeof imageUrl === 'string';
        console.log('[Worker] OCR_FOR_TEXT_LAYER input:', {
          imageType: isStringInput ? 'string' : 'blob',
          imageBytes: isStringInput ? undefined : (imageUrl as Blob).size,
          imageUrlLength: isStringInput ? imageUrl.length : undefined,
          imageUrlStart: isStringInput ? imageUrl.substring(0, 100) : undefined,
          imageWidth,
          imageHeight
        });
        
        let gray: Uint8ClampedArray | undefined;
        try {
          const preprocessed = await preprocessImage(imageUrl, { binarize: CONFIG.OCR_BINARIZE, returnGray: true });
          processedInput = preprocessed.image;
          actualWidth = preprocessed.width;
          actualHeight = preprocessed.height;
          gray = preprocessed.gray;
          console.log('[Worker] After preprocess:', { actualWidth, actualHeight, processedBytes: preprocessed.image.size });
        } catch (preprocessError) {
          // Continue with original image
          console.error('[Worker] Preprocess error:', preprocessError);
        }
        
        sendProgress('Initializing OCR...', 0.1);
        
        // Get or create worker with correct language
        const worker = await getOrCreateWorker(language);
        
        sendProgress('Configuring OCR...', 0.15);
        
        const psm = typeof pageSegMode === 'number' ? pageSegMode : PSM.AUTO;

        // Configure for detailed output
        await worker.setParameters({
          tessedit_create_tsv: '1',
          user_defined_dpi: String(Math.round(dpi)),
          tessedit_pageseg_mode: String(psm),
        });
        
        sendProgress('Recognizing text...', 0.2);
        
        // Run OCR on preprocessed image
        // Tesseract.js v7: Must request output formats in recognize() 3rd arg
        // setParameters alone doesn't enable tsv output anymore
        const result = await worker.recognize(processedInput as any, undefined, {
          text: true,
          tsv: true,
        }) as TesseractResult;
        
        sendProgress('Processing results...', 0.8);
        
        const data = result.data;
        
        // Debug raw OCR data
        console.log(`[Worker] Raw text length: ${data.text?.length || 0}`);
        console.log(`[Worker] Raw text preview:`, data.text?.substring(0, 200));
        if (data.tsv) {
          console.log(`[Worker] TSV length: ${data.tsv.length}`);
          console.log(`[Worker] TSV first 500 chars:`, data.tsv.substring(0, 500));
        } else {
          console.warn('[Worker] No TSV data returned!');
        }

        // Parse TSV for word-level data
        let { words, lines } = parseTSV(data.tsv || '');

        if (lines.length > 0) {
          const cleaned = cleanLineNoise(lines);
          if (cleaned.words.length !== words.length) {
            console.log(`[Worker] Filtered noisy tokens: ${words.length - cleaned.words.length} removed`);
            words = cleaned.words;
            lines = cleaned.lines;
          }
        }

        if (gray && words.length > 0) {
          const protectedWords = buildProtectedWordSet(lines);
          const maskInfo = buildImageTileMask(gray, actualWidth, actualHeight, words);
          if (maskInfo && maskInfo.imageTiles > 0) {
            console.log(`[Worker] Image tiles: ${maskInfo.imageTiles}/${maskInfo.totalTiles} (tile=${maskInfo.tileSize})`);
            const filteredWords = filterWordsByImageTiles(words, maskInfo, actualWidth, actualHeight, protectedWords);
            if (filteredWords.length !== words.length) {
              console.log(`[Worker] Filtered image regions: ${words.length - filteredWords.length} words removed`);
              words = filteredWords;
              lines = rebuildLinesFromWords(lines, filteredWords);
            }
          }

          if (gray && words.length > 0) {
            const filteredWords = filterWordsByBackground(words, gray, actualWidth, actualHeight, protectedWords);
            if (filteredWords.length !== words.length) {
              console.log(`[Worker] Filtered photo-text: ${words.length - filteredWords.length} words removed`);
              words = filteredWords;
              lines = rebuildLinesFromWords(lines, filteredWords);
            }
          }
        }
        
        // Fallback: If no words found but text exists, create a single large block
        // This handles cases where TSV parsing fails or structure is simple
        if (words.length === 0 && data.text && data.text.trim().length > 0) {
          console.log('[Worker] No words from TSV, creating fallback from raw text (split by lines)');
          
          const rawLines = data.text.split('\n').filter(l => l.trim().length > 0);
          const approxLineHeight = actualHeight / (rawLines.length + 2); // Add padding
          
          words = [];
          lines = [];
          
          rawLines.forEach((lineText, i) => {
            const y0 = (i + 1) * approxLineHeight; // Start from top margin
            const y1 = y0 + approxLineHeight;
            const bbox = { x0: 20, y0: y0, x1: actualWidth - 20, y1: y1 }; // Full width approx
            
            const lineWords = [{
              text: lineText.trim(),
              confidence: data.confidence || 0,
              bbox: bbox
            }];
            
            words.push(...lineWords);
            lines.push({
              text: lineText.trim(),
              confidence: data.confidence || 0,
              bbox: bbox,
              words: lineWords
            });
          });
        }
        
        console.log(`[Worker] OCR complete: ${words.length} words, ${lines.length} lines, confidence: ${data.confidence?.toFixed(1)}%`);
        
        const pageResult = {
          pageNumber: 1,
          width: actualWidth,
          height: actualHeight,
          dpi: dpi,
          language: language,
          lines: lines,
          words: words,
          text: data.text || '',
          confidence: data.confidence || 0
        };
        
        sendProgress('Complete', 1.0);
        
        self.postMessage({ type: 'OCR_TEXT_LAYER_RESULT', id, payload: pageResult });
        break;
      }

      // ============================================
      // SEGMENT - Smart Region Detection
      // ============================================
      case 'SEGMENT': {
        const { imageUrl, language = 'eng', documentType = 'manga' } = payload as {
          imageUrl: string;
          language: string;
          documentType: DocumentType;
        };
        
        console.log(`[Worker] SEGMENT: Lang=${language}, Type=${documentType}`);
        
        sendProgress('Preprocessing image...', 0);
        
        // Preprocess image to get proper dimensions and fix corrupted images
        let processedInput: Blob | string = imageUrl;
        let imageWidth = 1000;
        let imageHeight = 1000;
        
        try {
          const preprocessed = await preprocessImage(imageUrl);
          processedInput = preprocessed.image;
          imageWidth = preprocessed.width;
          imageHeight = preprocessed.height;
          console.log(`[Worker] SEGMENT image preprocessed: ${imageWidth}x${imageHeight}`);
        } catch (preprocessError) {
          console.warn('[Worker] SEGMENT preprocessing failed, using original:', preprocessError);
          
          // Try to get dimensions without full preprocessing
          try {
            const dims = await getImageDimensions(imageUrl);
            imageWidth = dims.width;
            imageHeight = dims.height;
          } catch {
            // Use defaults
          }
        }
        
        sendProgress('Starting segmentation...', 0.1);
        
        const worker = await getOrCreateWorker(language);
        
        const segPsm = documentType === 'manga' ? PSM.SPARSE_TEXT : PSM.AUTO;

        // Enable TSV output for word-level data
        await worker.setParameters({
          tessedit_create_tsv: '1',
          tessedit_pageseg_mode: String(segPsm),
        });
        
        sendProgress('Running OCR...', 0.3);
        
        // Run OCR on preprocessed image
        const result = await worker.recognize(processedInput as any, undefined, {
          text: true,
          tsv: true,
        }) as TesseractResult;
        
        sendProgress('Analyzing regions...', 0.7);
        
        const data = result.data;
        
        // Parse TSV for word-level data
        const { words } = parseTSV(data.tsv || '');
        
        // Group words into regions with smart classification
        const regions = groupWordsIntoRegions(
          words,
          imageWidth,
          imageHeight,
          documentType
        );
        
        // If word-level failed, fall back to block-level
        if (regions.length === 0 && data.blocks && data.blocks.length > 0) {
          console.log(`[Worker] Using block-level fallback: ${data.blocks.length} blocks`);
          
          const blockRegions = data.blocks
            .filter(block => block.text.trim().length > 0)
            .map((block, index) => {
              const type = classifyRegion(
                block.text,
                block.bbox,
                block.confidence,
                imageWidth,
                imageHeight,
                documentType
              );
              
              return {
                id: `block-${index}-${Date.now()}`,
                type,
                box: {
                  x: block.bbox.x0,
                  y: block.bbox.y0,
                  w: block.bbox.x1 - block.bbox.x0,
                  h: block.bbox.y1 - block.bbox.y0,
                },
                originalText: block.text.trim(),
                confidence: block.confidence / 100,
              };
            })
            .filter(r => r.confidence >= CONFIG.MIN_CONFIDENCE / 100);
          
          self.postMessage({ type: 'SEGMENT_RESULT', id, payload: blockRegions });
          break;
        }
        
        // Final fallback: single region with all text
        if (regions.length === 0 && data.text && data.text.trim().length > 0) {
          console.log('[Worker] Using full-page fallback');
          
          self.postMessage({
            type: 'SEGMENT_RESULT',
            id,
            payload: [{
              id: `fallback-${Date.now()}`,
              type: 'text',
              box: { x: 0, y: 0, w: imageWidth, h: imageHeight },
              originalText: data.text.trim(),
              confidence: (data.confidence || 50) / 100,
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


/**
 * Process a large image in overlapping chunks to handle Tesseract limitations
 * Useful for long webtoons or documents that exceed Tesseract's max dimension
 */
async function processLargeImageInChunks(
  worker: any, 
  imageUrl: string, 
  width: number, 
  height: number
): Promise<{ words: any[], lines: any[], text: string, confidence: number }> {
  const CHUNK_SIZE = 4000;
  const OVERLAP = 200; // Overlap to catch text cut by chunk boundary
  const EFF_HEIGHT = CHUNK_SIZE - OVERLAP;
  
  const allWords: any[] = [];
  let fullText = '';
  let totalConf = 0;
  let chunkCount = 0;

  // 1. Prepare source canvas
  let sourceBitmap: ImageBitmap | null = null;
  try {
    let blob: Blob;
    if (imageUrl.startsWith('data:')) {
      const resp = await fetch(imageUrl);
      blob = await resp.blob();
    } else {
      const resp = await fetch(imageUrl);
      blob = await resp.blob();
    }
    sourceBitmap = await createImageBitmap(blob);
  } catch (e) {
    throw new Error(`Failed to load source image for chunking: ${e}`);
  }

  // We need to render slices. Since we can't easily crop ImageBitmap to Blob without canvas,
  // we use OffscreenCanvas.
  
  const totalChunks = Math.ceil(height / EFF_HEIGHT);

  for (let i = 0; i < totalChunks; i++) {
    const yStart = i * EFF_HEIGHT;
    const chunkHeight = Math.min(CHUNK_SIZE, height - yStart);
    
    // Stop if we have passed the end
    if (chunkHeight <= 0) break;

    // Create chunk canvas
    const chunkCanvas = new OffscreenCanvas(width, chunkHeight);
    const ctx = chunkCanvas.getContext('2d');
    
    if (!ctx) throw new Error('Failed to create chunk canvas context');
    
    // Draw white background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, chunkHeight);
    
    // Draw slice from source
    // drawImage(image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
    // Beware of source bounds
    const sourceHeight = Math.min(chunkHeight, height - yStart);
    ctx.drawImage(sourceBitmap, 0, yStart, width, sourceHeight, 0, 0, width, sourceHeight);
    
    // Prepare chunk URL
    const chunkBlob = await chunkCanvas.convertToBlob({ type: 'image/png' });
    const chunkUrl = URL.createObjectURL(chunkBlob);
    
    try {
      // Run OCR on this chunk
      const result = await worker.recognize(chunkUrl);
      const data = result.data as any;
      
      // Accumulate text and confidence
      fullText += (data.text || '') + '\n';
      totalConf += (data.confidence || 0);
      chunkCount++;
      
      // Extract words from Tesseract's nested structure using helper
      const chunkWords = extractWordsFromBlocks(data);
      
      // Offset coordinates and filter duplicates in overlap area
      chunkWords.forEach(w => {
        // Adjust Y coordinates
        const absY0 = w.bbox.y0 + yStart;
        const absY1 = w.bbox.y1 + yStart;
        
        // Filtering logic:
        // We want to avoid duplicates in the overlap region.
        // Rule: Only accept words that end BEFORE the overlap region start of this chunk,
        // UNLESS it's the last chunk.
        
        const isLastChunk = (i === totalChunks - 1);
        const overlapStartInChunk = EFF_HEIGHT;
        
        // If word is completely in the overlap region (bottom of this chunk), skip it 
        // (unless it's the last chunk, then keep everything)
        // Using center point for safety
        const wordCenterY = (w.bbox.y0 + w.bbox.y1) / 2;
        
        if (!isLastChunk && wordCenterY > overlapStartInChunk) {
           return; // Skip, let next chunk handle it
        }
        
        // Also skip if it's in the top overlap region (which is covered by previous chunk)
        // But our yStart increment is based on EFF_HEIGHT, so the previous chunk covered up to yStart
        // Wait, chunk i covers [yStart, yStart + chunkHeight]
        // Chunk i-1 covered [yStart - EFF_HEIGHT, yStart - EFF_HEIGHT + chunkHeight] 
        // = [yStart - EFF_HEIGHT, yStart + OVERLAP]
        // So the top 200px of this chunk (0 to OVERLAP) was covered by previous chunk bottom.
        // We should skip top overlap if not first chunk?
        // No, let's stick to "Bottom overlap is strictly for next chunk".
        // The previous chunk's bottom overlap was skipped by previous chunk logic.
        // So this chunk should handle its top part.
        
        // However, if the word started in previous chunk but ended here?
        // This simple logic might split words. But Tesseract usually finds whole words.
        
        // Add valid word
        allWords.push({
            ...w,
            bbox: {
                x0: w.bbox.x0,
                x1: w.bbox.x1,
                y0: absY0,
                y1: absY1
            }
        });
      });
      
    } catch (err) {
      console.error(`[Worker] Error processing chunk ${i}:`, err);
    } finally {
      URL.revokeObjectURL(chunkUrl);
    }
  }
  
  if (sourceBitmap) sourceBitmap.close();
  
  // Reconstruct lines from all words
  // Sort words by Y then X
  allWords.sort((a, b) => {
      const yDiff = a.bbox.y0 - b.bbox.y0;
      if (Math.abs(yDiff) < 10) return a.bbox.x0 - b.bbox.x0; // Same lineish
      return yDiff;
  });
  
  // Simple line grouping
  const lines: any[] = [];
  let currentLine: any = null;
  
  allWords.forEach(w => {
      if (!currentLine) {
          currentLine = { words: [w], bbox: { ...w.bbox }, text: w.text, confidence: w.confidence };
      } else {
          // Check if vertically aligned with current line
          const verticalOverlap = Math.min(currentLine.bbox.y1, w.bbox.y1) - Math.max(currentLine.bbox.y0, w.bbox.y0);
          const lineHeight = Math.max(1, currentLine.bbox.y1 - currentLine.bbox.y0);
          
          // If overlap > 50% of height, same line
          if (verticalOverlap > lineHeight * 0.5) {
             // Add to line
             currentLine.words.push(w);
             currentLine.text += ' ' + w.text;
             currentLine.bbox.x1 = Math.max(currentLine.bbox.x1, w.bbox.x1);
             currentLine.bbox.y0 = Math.min(currentLine.bbox.y0, w.bbox.y0);
             currentLine.bbox.y1 = Math.max(currentLine.bbox.y1, w.bbox.y1);
             // Avg confidence
             const totalWords = currentLine.words.length;
             currentLine.confidence = ((currentLine.confidence * (totalWords - 1)) + w.confidence) / totalWords;
          } else {
             // New line
             lines.push(currentLine);
             currentLine = { words: [w], bbox: { ...w.bbox }, text: w.text, confidence: w.confidence };
          }
      }
  });
  if (currentLine) lines.push(currentLine);
  
  return {
      words: allWords,
      lines: lines,
      text: fullText,
      confidence: chunkCount > 0 ? totalConf / chunkCount : 0
  };
}

export {};
