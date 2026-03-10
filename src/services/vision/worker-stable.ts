/**
 * Stable Vision Worker — Reliable OCR without complex heuristics
 *
 * Based on the proven-stable temp_working_worker.ts.
 * Self-contained: only imports tesseract.js so the module-level import chain
 * cannot cause WASM-level crashes.
 *
 * Handles message types:
 *   INIT             → initialise Tesseract engine
 *   OCR_FOR_TEXT_LAYER → word-level OCR for searchable-PDF / text overlay
 *   SEGMENT          → simple region detection for panel view
 */

import { createWorker, PSM, OEM } from 'tesseract.js';

// ─── Types (duplicated intentionally — keep self-contained) ───

interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface TesseractResult {
  data: {
    text: string;
    confidence: number;
    blocks?: Array<{ text: string; confidence: number; bbox: BBox }>;
    lines?: Array<{ text: string; confidence: number; bbox: BBox; words: unknown[] }>;
    words?: Array<{ text: string; confidence: number; bbox: BBox }>;
    hocr?: string;
    tsv?: string;
  };
}

type DocumentType = 'manga' | 'document';

// ─── State ───

let tesseractWorker: Awaited<ReturnType<typeof createWorker>> | null = null;
let currentLang = '';
let isInitializing = false;

// ─── Config ───

const CONFIG = {
  CORE_PATH: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0/tesseract-core.wasm.js',
  MIN_CONFIDENCE: 20,
  BALLOON_ASPECT_RATIO_MIN: 0.3,
  BALLOON_ASPECT_RATIO_MAX: 3.5,
  SFX_MIN_FONT_SIZE_RATIO: 0.1,
  SFX_MAX_WORDS: 3,
};

// ─── Helpers ───

function sendProgress(status: string, progress: number, workerId?: string): void {
  self.postMessage({
    type: 'OCR_PROGRESS',
    payload: { status, progress, workerId },
  });
}

/**
 * Get image dimensions without heavy pixel processing.
 * Uses createImageBitmap (available in Workers) to read width/height.
 */
async function getImageDimensions(imageUrl: string): Promise<{ width: number; height: number }> {
  const response = await fetch(imageUrl);
  const blob = await response.blob();
  const bmp = await createImageBitmap(blob);
  const { width, height } = bmp;
  bmp.close();
  return { width, height };
}

// ─── Garbage / noise filtering ───

/** Regex: mostly non-alphanumeric (symbols, pipes, brackets, dots, etc.) */
const GARBAGE_RE = /^[\s|=\-_.,;:!?'"(){}\[\]\\/<>@#$%^&*~`+0-9]+$/;

/** Words that are obviously OCR noise from manga artwork */
function isGarbageWord(text: string, confidence: number): boolean {
  // Very low confidence → garbage
  if (confidence < 25) return true;
  // Single character with low conf
  if (text.length === 1 && confidence < 50) return true;
  // Mostly symbols / punctuation
  if (GARBAGE_RE.test(text)) return true;
  // Very short non-word with low confidence  
  if (text.length <= 2 && confidence < 40 && !/^[a-zA-Z]{2}$/i.test(text)) return true;
  return false;
}

/** Filter garbage words out of results */
function filterGarbageWords(
  words: Array<{ text: string; confidence: number; bbox: BBox }>,
): Array<{ text: string; confidence: number; bbox: BBox }> {
  return words.filter(w => !isGarbageWord(w.text, w.confidence));
}

// ─── Tesseract worker management ───

async function createWorkerWithLanguage(
  lang: string,
  sendUpdates = false,
): Promise<Awaited<ReturnType<typeof createWorker>>> {
  console.log(`[Worker-Stable] Creating Tesseract worker for: ${lang}`);
  const w = await createWorker(lang, OEM.LSTM_ONLY, {
    corePath: CONFIG.CORE_PATH,
    logger: m => {
      if (sendUpdates && m.status && typeof m.progress === 'number') {
        sendProgress(m.status, m.progress, m.workerId);
      }
    },
  });
  console.log(`[Worker-Stable] Tesseract ready for: ${lang}`);
  return w;
}

async function getOrCreateWorker(lang: string): Promise<Awaited<ReturnType<typeof createWorker>>> {
  while (isInitializing) await new Promise(r => setTimeout(r, 100));

  if (!tesseractWorker || currentLang !== lang) {
    isInitializing = true;
    try {
      if (tesseractWorker) {
        console.log(`[Worker-Stable] Switching language ${currentLang} → ${lang}`);
        await tesseractWorker.terminate();
      }
      tesseractWorker = await createWorkerWithLanguage(lang, false);
      currentLang = lang;
    } finally {
      isInitializing = false;
    }
  }
  return tesseractWorker;
}

// ─── TSV parser ───

function parseTSV(tsv: string): {
  words: Array<{ text: string; confidence: number; bbox: BBox }>;
  lines: Array<{ text: string; confidence: number; bbox: BBox; words: unknown[] }>;
} {
  const words: Array<{ text: string; confidence: number; bbox: BBox }> = [];
  const lines: Array<{ text: string; confidence: number; bbox: BBox; words: unknown[] }> = [];

  if (!tsv || typeof tsv !== 'string') return { words, lines };
  const rows = tsv.split('\n');
  if (rows.length < 2) return { words, lines };

  const header = rows[0].split('\t');
  const idx = {
    level: header.indexOf('level'),
    left: header.indexOf('left'),
    top: header.indexOf('top'),
    width: header.indexOf('width'),
    height: header.indexOf('height'),
    conf: header.indexOf('conf'),
    text: header.indexOf('text'),
  };
  if (Object.values(idx).some(i => i === -1)) return { words, lines };

  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i].split('\t');
    if (cols.length <= idx.text) continue;

    const level = parseInt(cols[idx.level] || '0');
    const text = cols[idx.text]?.trim() || '';
    if (!text) continue;

    const left = parseInt(cols[idx.left] || '0');
    const top = parseInt(cols[idx.top] || '0');
    const w = parseInt(cols[idx.width] || '0');
    const h = parseInt(cols[idx.height] || '0');
    const conf = parseFloat(cols[idx.conf] || '0');
    const bbox: BBox = { x0: left, y0: top, x1: left + w, y1: top + h };

    if (level === 5) words.push({ text, confidence: conf, bbox });
    if (level === 4) lines.push({ text, confidence: conf, bbox, words: [] });
  }

  return { words, lines };
}

// ─── Region grouping (for SEGMENT) ───

function groupWordsIntoRegions(
  words: Array<{ text: string; confidence: number; bbox: BBox }>,
  pageWidth: number,
  pageHeight: number,
  documentType: DocumentType,
) {
  if (words.length === 0) return [];

  const GAP_X = pageWidth * 0.05;
  const GAP_Y = pageHeight * 0.02;

  const sorted = [...words].sort((a, b) => {
    const dy = a.bbox.y0 - b.bbox.y0;
    return Math.abs(dy) > GAP_Y ? dy : a.bbox.x0 - b.bbox.x0;
  });

  const groups: Array<{ words: typeof words; bbox: BBox }> = [];

  for (const word of sorted) {
    let added = false;
    for (const g of groups) {
      const xGap = word.bbox.x0 - g.bbox.x1;
      const yOverlap = Math.min(word.bbox.y1, g.bbox.y1) - Math.max(word.bbox.y0, g.bbox.y0);
      const yGap = Math.abs(word.bbox.y0 - g.bbox.y1);

      if ((yOverlap > 0 && xGap < GAP_X && xGap > -word.bbox.x1) ||
          (yGap < GAP_Y && yGap >= 0 && Math.min(word.bbox.x1, g.bbox.x1) - Math.max(word.bbox.x0, g.bbox.x0) > 0)) {
        g.words.push(word);
        g.bbox = {
          x0: Math.min(g.bbox.x0, word.bbox.x0),
          y0: Math.min(g.bbox.y0, word.bbox.y0),
          x1: Math.max(g.bbox.x1, word.bbox.x1),
          y1: Math.max(g.bbox.y1, word.bbox.y1),
        };
        added = true;
        break;
      }
    }
    if (!added) groups.push({ words: [word], bbox: { ...word.bbox } });
  }

  return groups
    .map((g, i) => {
      const text = g.words.map(w => w.text).join(' ');
      const avgConf = g.words.reduce((s, w) => s + w.confidence, 0) / g.words.length;
      return {
        id: `region-${i}-${Date.now()}`,
        type: 'text' as const,
        box: { x: g.bbox.x0, y: g.bbox.y0, w: g.bbox.x1 - g.bbox.x0, h: g.bbox.y1 - g.bbox.y0 },
        originalText: text,
        confidence: avgConf / 100,
      };
    })
    .filter(r => r.originalText.length > 0 && r.confidence >= CONFIG.MIN_CONFIDENCE / 100);
}

// ─── Message handler ───

self.onmessage = async (e: MessageEvent) => {
  const { type, payload, id } = e.data;

  try {
    switch (type) {
      // ─── INIT ───
      case 'INIT': {
        console.log('[Worker-Stable] Initializing...');
        await getOrCreateWorker('eng');
        self.postMessage({ type: 'INIT_SUCCESS', id });
        break;
      }

      // ─── OCR_FOR_TEXT_LAYER ───
      case 'OCR_FOR_TEXT_LAYER': {
        const {
          imageUrl,
          imageWidth,
          imageHeight,
          language = 'eng',
          dpi = 300,
        } = payload;

        console.log(
          `[Worker-Stable] OCR_FOR_TEXT_LAYER: ${imageWidth}x${imageHeight} @${dpi}DPI lang=${language}`,
        );

        // Skip heavy preprocessing — pass image directly to Tesseract.
        // Only fetch dimensions if the caller didn't supply valid ones.
        let actualWidth = Math.round(imageWidth);
        let actualHeight = Math.round(imageHeight);

        if (actualWidth < 10 || actualHeight < 10) {
          try {
            const dims = await getImageDimensions(imageUrl);
            actualWidth = dims.width;
            actualHeight = dims.height;
          } catch { /* use caller values */ }
        }

        sendProgress('Initializing OCR...', 0.1);
        const worker = await getOrCreateWorker(language);

        sendProgress('Configuring OCR...', 0.15);
        await worker.setParameters({
          tessedit_create_hocr: '1',
          tessedit_create_tsv: '1',
          tessedit_create_pdf: '0',
          hocr_font_info: '1',
        });

        sendProgress('Recognizing text...', 0.2);
        const result = (await worker.recognize(imageUrl)) as TesseractResult;

        sendProgress('Processing results...', 0.8);
        const data = result.data;

        let { words, lines } = parseTSV(data.tsv || '');

        // Filter garbage / noise words from manga artwork
        words = filterGarbageWords(words);
        // Fallback: no words from TSV but raw text exists
        if (words.length === 0 && data.text && data.text.trim().length > 0) {
          const rawLines = data.text.split('\n').filter(l => l.trim().length > 0);
          const lineH = actualHeight / (rawLines.length + 2);

          rawLines.forEach((lineText, idx) => {
            const y0 = (idx + 1) * lineH;
            const bbox: BBox = { x0: 20, y0, x1: actualWidth - 20, y1: y0 + lineH };
            const w = { text: lineText.trim(), confidence: data.confidence || 0, bbox };
            words.push(w);
            lines.push({ text: lineText.trim(), confidence: data.confidence || 0, bbox, words: [w] });
          });
        }

        console.log(
          `[Worker-Stable] OCR done: ${words.length} words, ${lines.length} lines, conf=${data.confidence?.toFixed(1)}%`,
        );

        // Build lines from words if parseTSV only gave us words
        if (lines.length === 0 && words.length > 0) {
          // Group words into lines by Y proximity
          const sortedWords = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
          let currentLine: typeof words = [];
          let lastY = -Infinity;
          const lineThreshold = actualHeight * 0.015;

          for (const w of sortedWords) {
            if (w.bbox.y0 - lastY > lineThreshold && currentLine.length > 0) {
              const lineText = currentLine.map(cw => cw.text).join(' ');
              const lineBbox: BBox = {
                x0: Math.min(...currentLine.map(cw => cw.bbox.x0)),
                y0: Math.min(...currentLine.map(cw => cw.bbox.y0)),
                x1: Math.max(...currentLine.map(cw => cw.bbox.x1)),
                y1: Math.max(...currentLine.map(cw => cw.bbox.y1)),
              };
              const lineConf = currentLine.reduce((s, cw) => s + cw.confidence, 0) / currentLine.length;
              lines.push({ text: lineText, confidence: lineConf, bbox: lineBbox, words: currentLine });
              currentLine = [];
            }
            currentLine.push(w);
            lastY = w.bbox.y0;
          }
          if (currentLine.length > 0) {
            const lineText = currentLine.map(cw => cw.text).join(' ');
            const lineBbox: BBox = {
              x0: Math.min(...currentLine.map(cw => cw.bbox.x0)),
              y0: Math.min(...currentLine.map(cw => cw.bbox.y0)),
              x1: Math.max(...currentLine.map(cw => cw.bbox.x1)),
              y1: Math.max(...currentLine.map(cw => cw.bbox.y1)),
            };
            const lineConf = currentLine.reduce((s, cw) => s + cw.confidence, 0) / currentLine.length;
            lines.push({ text: lineText, confidence: lineConf, bbox: lineBbox, words: currentLine });
          }
        }

        const pageResult = {
          pageNumber: 1,
          width: actualWidth,
          height: actualHeight,
          dpi,
          language,
          algorithmVersion: 44,
          pipelineProfile: (payload.pipelineProfile as string) || 'export',
          lines,
          words,
          text: data.text || '',
          confidence: data.confidence || 0,
        };

        sendProgress('Complete', 1.0);
        self.postMessage({ type: 'OCR_TEXT_LAYER_RESULT', id, payload: pageResult });
        break;
      }

      // ─── SEGMENT ───
      case 'SEGMENT': {
        const { imageUrl, language = 'eng', documentType = 'manga' } = payload as {
          imageUrl: string;
          language: string;
          documentType: DocumentType;
        };

        sendProgress('Preprocessing image...', 0);

        let processedUrl = imageUrl;
        let imageWidth = 1000;
        let imageHeight = 1000;

        try {
          const dims = await getImageDimensions(imageUrl);
          imageWidth = dims.width;
          imageHeight = dims.height;
        } catch { /* use defaults */ }

        sendProgress('Starting segmentation...', 0.1);
        const worker = await getOrCreateWorker(language);
        await worker.setParameters({ tessedit_create_tsv: '1' });

        sendProgress('Running OCR...', 0.3);
        const result = (await worker.recognize(imageUrl)) as TesseractResult;

        sendProgress('Analyzing regions...', 0.7);
        const { words } = parseTSV(result.data.tsv || '');
        const regions = groupWordsIntoRegions(words, imageWidth, imageHeight, documentType);

        if (regions.length === 0 && result.data.text && result.data.text.trim().length > 0) {
          self.postMessage({
            type: 'SEGMENT_RESULT',
            id,
            payload: [{
              id: `fallback-${Date.now()}`,
              type: 'text',
              box: { x: 0, y: 0, w: imageWidth, h: imageHeight },
              originalText: result.data.text.trim(),
              confidence: (result.data.confidence || 50) / 100,
            }],
          });
          break;
        }

        self.postMessage({ type: 'SEGMENT_RESULT', id, payload: regions });
        break;
      }

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    console.error('[Worker-Stable] Error:', error);
    self.postMessage({
      type: 'ERROR',
      id,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export {};
